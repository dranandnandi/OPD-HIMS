/*
  # Cancel (void) a bill instead of deleting it

  billingService.deleteBill() did a bare `bills.delete()`. payment_records,
  bill_items and refund_requests all cascade from bills, so a delete erased the
  record that money was ever collected — no trace, no actor, and a hole in the
  bill-number sequence. It would also simply fail on any bill tied to a lab
  order, since lims orders reference bills(id) with no ON DELETE clause.

  Voiding keeps the row and the audit trail. A cancelled bill stays visible and
  is excluded from revenue and outstanding.

  Rules enforced here rather than in the client:
    - only an admin / manage_billing profile may cancel;
    - a bill carrying payments cannot be cancelled (refund first, then cancel),
      otherwise you void the record of cash you are actually holding;
    - a reason is mandatory;
    - the two triggers that recompute bills.status must not resurrect a
      cancelled bill.
*/

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- ---------------------------------------------------------------------------
-- 1. Keep the recompute triggers from overwriting a cancellation.
--    Both set status from paid_amount vs total_amount, which would flip a
--    cancelled bill back to pending/paid on the next payment or edit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resync_bill_on_total_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  total_payments numeric := 0;
  total_refunds numeric := 0;
  total_adjustments numeric := 0;
  net_paid numeric := 0;
  bill_total numeric := COALESCE(NEW.total_amount, 0);
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN record_type = 'payment' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN record_type = 'refund' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN record_type = 'adjustment' THEN amount ELSE 0 END), 0)
  INTO total_payments, total_refunds, total_adjustments
  FROM public.payment_records
  WHERE bill_id = NEW.id;

  net_paid := GREATEST(total_payments + total_adjustments - total_refunds, 0);

  NEW.paid_amount := net_paid;
  NEW.total_refunded_amount := total_refunds;
  NEW.balance_amount := GREATEST(bill_total - net_paid, 0);

  IF NEW.status <> 'cancelled'::bill_payment_status_enum THEN
    NEW.status := CASE
      WHEN net_paid >= bill_total THEN 'paid'::bill_payment_status_enum
      WHEN net_paid > 0 THEN 'partial'::bill_payment_status_enum
      ELSE 'pending'::bill_payment_status_enum
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_bill_paid_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_bill_id uuid;
  total_payments numeric := 0;
  total_refunds numeric := 0;
  total_adjustments numeric := 0;
  net_paid numeric := 0;
  bill_total numeric := 0;
  current_status public.bill_payment_status_enum;
  latest_refund_at timestamptz;
BEGIN
  target_bill_id := COALESCE(NEW.bill_id, OLD.bill_id);
  IF target_bill_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN record_type = 'payment' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN record_type = 'refund' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN record_type = 'adjustment' THEN amount ELSE 0 END), 0),
    MAX(CASE WHEN record_type = 'refund' THEN payment_date ELSE NULL END)
  INTO total_payments, total_refunds, total_adjustments, latest_refund_at
  FROM public.payment_records
  WHERE bill_id = target_bill_id;

  SELECT total_amount, status INTO bill_total, current_status
  FROM public.bills
  WHERE id = target_bill_id;

  bill_total := COALESCE(bill_total, 0);
  net_paid := GREATEST(total_payments + total_adjustments - total_refunds, 0);

  UPDATE public.bills
  SET paid_amount = net_paid,
      total_refunded_amount = total_refunds,
      balance_amount = GREATEST(bill_total - net_paid, 0),
      status = CASE
        WHEN current_status = 'cancelled'::bill_payment_status_enum THEN current_status
        WHEN net_paid >= bill_total THEN 'paid'::bill_payment_status_enum
        WHEN net_paid > 0 THEN 'partial'::bill_payment_status_enum
        ELSE 'pending'::bill_payment_status_enum
      END,
      last_refund_at = COALESCE(latest_refund_at, last_refund_at),
      updated_at = now()
  WHERE id = target_bill_id;

  PERFORM public.refresh_bill_refund_status_for_bill(target_bill_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The cancel entry point. SECURITY DEFINER so the checks cannot be skipped
--    by writing bills.status straight through the REST API.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_bill(p_bill_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
  actor_permissions text[];
  actor_clinic uuid;
  bill_clinic uuid;
  bill_status public.bill_payment_status_enum;
  bill_paid numeric := 0;
  open_refunds integer := 0;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;

  SELECT lower(COALESCE(role_name, '')), COALESCE(permissions, '{}'), clinic_id
  INTO actor_role, actor_permissions, actor_clinic
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT (
    actor_role IN ('admin', 'super_admin')
    OR 'all' = ANY(actor_permissions)
    OR 'manage_billing' = ANY(actor_permissions)
  ) THEN
    RAISE EXCEPTION 'Only an admin or a billing manager may cancel a bill';
  END IF;

  SELECT clinic_id, status, COALESCE(paid_amount, 0)
  INTO bill_clinic, bill_status, bill_paid
  FROM public.bills
  WHERE id = p_bill_id;

  IF bill_clinic IS NULL THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;
  IF bill_clinic IS DISTINCT FROM actor_clinic THEN
    RAISE EXCEPTION 'Not authorized to cancel this bill';
  END IF;
  IF bill_status = 'cancelled'::bill_payment_status_enum THEN
    RAISE EXCEPTION 'This bill is already cancelled';
  END IF;

  -- Voiding a bill that holds money would erase the record of cash on hand.
  IF bill_paid > 0 THEN
    RAISE EXCEPTION
      'This bill has % collected against it. Refund the payment first, then cancel.',
      bill_paid;
  END IF;

  SELECT COUNT(*) INTO open_refunds
  FROM public.refund_requests
  WHERE bill_id = p_bill_id
    AND status IN ('draft', 'pending_approval', 'approved');

  IF open_refunds > 0 THEN
    RAISE EXCEPTION 'Settle the % open refund request(s) on this bill before cancelling it', open_refunds;
  END IF;

  UPDATE public.bills
  SET status = 'cancelled'::bill_payment_status_enum,
      balance_amount = 0,
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = btrim(p_reason),
      updated_at = now()
  WHERE id = p_bill_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_bill(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_bill(uuid, text) TO authenticated;
