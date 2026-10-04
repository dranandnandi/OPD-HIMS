/*
  # Keep balance_amount and status in step with an edited bill total

  update_bill_paid_amount() recomputes bills.balance_amount, paid_amount and
  status, but it is only wired to triggers on payment_records. Nothing reacts to
  bills.total_amount itself changing, and billingService.updateBill() writes
  total_amount directly when an admin edits a bill's line items.

  So editing a ₹500 bill up to ₹800 left balance_amount at its old value and the
  status at 'paid' until some unrelated payment row happened to touch that bill.
  Everything downstream reads those columns:
    - Analytics / Income Break-up outstanding  (bills.balance_amount > 0)
    - the OPD Billing status chip
  which meant edited bills quietly understated money owed.

  This recomputes the derived columns whenever total_amount moves, reusing the
  same net-of-refunds arithmetic as the payment trigger.
*/

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
  NEW.status := CASE
    WHEN net_paid >= bill_total THEN 'paid'::bill_payment_status_enum
    WHEN net_paid > 0 THEN 'partial'::bill_payment_status_enum
    ELSE 'pending'::bill_payment_status_enum
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_resync_bill_on_total_change ON public.bills;
CREATE TRIGGER trigger_resync_bill_on_total_change
  BEFORE UPDATE OF total_amount ON public.bills
  FOR EACH ROW
  WHEN (OLD.total_amount IS DISTINCT FROM NEW.total_amount)
  EXECUTE FUNCTION public.resync_bill_on_total_change();

-- Repair bills already edited before this trigger existed.
UPDATE public.bills b
SET balance_amount = GREATEST(COALESCE(b.total_amount, 0) - COALESCE(b.paid_amount, 0), 0),
    status = CASE
      WHEN COALESCE(b.paid_amount, 0) >= COALESCE(b.total_amount, 0) THEN 'paid'::bill_payment_status_enum
      WHEN COALESCE(b.paid_amount, 0) > 0 THEN 'partial'::bill_payment_status_enum
      ELSE 'pending'::bill_payment_status_enum
    END
WHERE b.balance_amount IS DISTINCT FROM GREATEST(COALESCE(b.total_amount, 0) - COALESCE(b.paid_amount, 0), 0);
