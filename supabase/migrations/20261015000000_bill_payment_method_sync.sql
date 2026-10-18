/*
  # Keep bills.payment_method in step with payment_records

  bills.payment_method was only ever written by createPharmacyBill. OPD bills
  record their method on payment_records (paymentService.recordPayment) and
  nothing copied it back to the bill row, so bills.payment_method stayed NULL
  for every OPD bill. Everything that reads the bill row then misreported it:
    - Edit Bill fell back to 'cash' ("bill.paymentMethod || 'cash'"), showing
      Cash for a bill actually paid by UPI — and the PDF generated from that
      form printed Cash too.
    - The Billing dashboard's payment-method filter never matched OPD bills.

  The daily collection / reconciliation screens were already correct: they read
  payment_records.payment_method directly.

  This extends update_bill_paid_amount() — the payment_records trigger that
  already maintains paid_amount / balance / status — to also mirror the most
  recent 'payment' record's method onto the bill, and backfills existing rows.
*/

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
  latest_method text;
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

  -- The bill-level method mirrors the latest money actually received.
  SELECT pr.payment_method
  INTO latest_method
  FROM public.payment_records pr
  WHERE pr.bill_id = target_bill_id
    AND pr.record_type = 'payment'
  ORDER BY pr.payment_date DESC, pr.created_at DESC
  LIMIT 1;

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
      -- Keep a method set directly on the bill (e.g. a correction saved from
      -- Edit Bill before any payment row existed) when there are no payments.
      payment_method = COALESCE(latest_method, payment_method),
      last_refund_at = COALESCE(latest_refund_at, last_refund_at),
      updated_at = now()
  WHERE id = target_bill_id;

  PERFORM public.refresh_bill_refund_status_for_bill(target_bill_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Backfill: give every bill that has payments the method of its latest one.
UPDATE public.bills b
SET payment_method = lp.payment_method
FROM (
  SELECT DISTINCT ON (pr.bill_id) pr.bill_id, pr.payment_method
  FROM public.payment_records pr
  WHERE pr.record_type = 'payment'
  ORDER BY pr.bill_id, pr.payment_date DESC, pr.created_at DESC
) lp
WHERE lp.bill_id = b.id
  AND b.payment_method IS DISTINCT FROM lp.payment_method;
