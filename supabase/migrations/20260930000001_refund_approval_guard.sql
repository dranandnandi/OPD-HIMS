/*
  # Server-side guards on the refund workflow

  RLS on refund_requests was clinic-scope only: any authenticated user in the
  clinic could UPDATE a row straight to 'approved' or 'paid' through the REST
  API. The approver restriction lived entirely in the React components, so it
  was advisory, not enforced.

  This adds a trigger that:
    1. restricts the approved / paid / rejected transitions to admin roles or a
       profile holding 'approve_refunds' / 'manage_finance' / 'all';
    2. stamps approved_by / approved_at rather than trusting the client;
    3. refuses to let a request be paid without first being approved, matching
       refundService.markRefundPaid;
    4. caps the open refund exposure on a bill at what was actually paid.
*/

CREATE OR REPLACE FUNCTION public.enforce_refund_request_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
  actor_permissions text[];
  actor_is_approver boolean;
  bill_paid numeric := 0;
  bill_refunded numeric := 0;
  open_total numeric := 0;
BEGIN
  SELECT lower(COALESCE(role_name, '')), COALESCE(permissions, '{}')
  INTO actor_role, actor_permissions
  FROM public.profiles
  WHERE id = auth.uid();

  actor_is_approver :=
    actor_role IN ('admin', 'super_admin')
    OR 'all' = ANY(actor_permissions)
    OR 'approve_refunds' = ANY(actor_permissions)
    OR 'manage_finance' = ANY(actor_permissions)
    OR 'manage_billing' = ANY(actor_permissions);

  -- Cap total open exposure against what the patient actually paid.
  IF TG_OP = 'INSERT' OR NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
    SELECT COALESCE(paid_amount, 0), COALESCE(total_refunded_amount, 0)
    INTO bill_paid, bill_refunded
    FROM public.bills
    WHERE id = NEW.bill_id;

    SELECT COALESCE(SUM(total_amount), 0)
    INTO open_total
    FROM public.refund_requests
    WHERE bill_id = NEW.bill_id
      AND status IN ('draft', 'pending_approval', 'approved')
      AND (TG_OP = 'INSERT' OR id <> NEW.id);

    IF NEW.total_amount + open_total + bill_refunded > bill_paid + 0.01 THEN
      RAISE EXCEPTION
        'Refund of % exceeds the refundable balance on this bill (paid %, already refunded %, open requests %)',
        NEW.total_amount, bill_paid, bill_refunded, open_total;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('approved', 'rejected', 'paid') AND NOT actor_is_approver THEN
      RAISE EXCEPTION 'Only an approver may move a refund request to %', NEW.status;
    END IF;

    -- Money only goes out of an approved request.
    IF NEW.status = 'paid' AND OLD.status <> 'approved' THEN
      RAISE EXCEPTION 'A refund must be approved before it can be paid';
    END IF;

    IF NEW.status = 'approved' THEN
      NEW.approved_by := auth.uid();
      NEW.approved_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_refund_request_rules ON public.refund_requests;
CREATE TRIGGER trigger_enforce_refund_request_rules
  BEFORE INSERT OR UPDATE ON public.refund_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_refund_request_rules();
