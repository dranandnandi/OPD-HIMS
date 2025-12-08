/*
  # Refund infrastructure and billing adjustments

  - Adds enums and helper table for refund workflow
  - Extends billing, payment, and pharmacy tables with refund metadata
  - Introduces refund_requests table with RLS
  - Updates payment aggregation triggers to account for refunds
*/

-- 1) Ensure enums exist
DO $$
BEGIN
  CREATE TYPE public.refund_status_enum AS ENUM ('not_requested', 'pending', 'partial', 'refunded');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.refund_request_status_enum AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'paid', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.payment_record_type_enum AS ENUM ('payment', 'refund', 'adjustment');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- 2) Extend bills with refund tracking columns
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS total_refunded_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_status public.refund_status_enum NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS last_refund_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_notes text;

-- 3) Extend bill_items with refund metadata
ALTER TABLE public.bill_items
  ADD COLUMN IF NOT EXISTS refunded_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_refund_reason text;

DO $$
BEGIN
  ALTER TABLE public.bill_items
    ADD CONSTRAINT bill_items_refunded_qty_check CHECK (refunded_quantity >= 0 AND refunded_quantity <= quantity);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.bill_items
    ADD CONSTRAINT bill_items_refunded_amount_check CHECK (refunded_amount >= 0 AND refunded_amount <= total_price);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- 4) Extend pharmacy_dispensed_items for refund linkage (after table creation below)
-- Columns referencing refund_requests will be added after the table exists.

-- 5) Create refund_requests table
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
  source_type text NOT NULL CHECK (source_type IN ('bill', 'pharmacy_dispense')),
  total_amount numeric NOT NULL CHECK (total_amount >= 0),
  refund_method text CHECK (refund_method IN ('cash', 'card', 'upi', 'cheque', 'net_banking', 'wallet')),
  reason text,
  status public.refund_request_status_enum NOT NULL DEFAULT 'draft',
  initiated_by uuid REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  paid_at timestamptz,
  metadata jsonb,
  inventory_actions jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_bill_id ON public.refund_requests(bill_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON public.refund_requests(status);
CREATE INDEX IF NOT EXISTS idx_refund_requests_clinic_id ON public.refund_requests(clinic_id);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "refund_requests_select_clinic" ON public.refund_requests;
DROP POLICY IF EXISTS "refund_requests_mutate_clinic" ON public.refund_requests;
DROP POLICY IF EXISTS "refund_requests_update_clinic" ON public.refund_requests;
DROP POLICY IF EXISTS "refund_requests_delete_clinic" ON public.refund_requests;

CREATE POLICY "refund_requests_select_clinic"
ON public.refund_requests
FOR SELECT
TO authenticated
USING (
  clinic_id IN (
    SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "refund_requests_mutate_clinic"
ON public.refund_requests
FOR INSERT
TO authenticated
WITH CHECK (
  clinic_id IN (
    SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "refund_requests_update_clinic"
ON public.refund_requests
FOR UPDATE
TO authenticated
USING (
  clinic_id IN (
    SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
  )
)
WITH CHECK (
  clinic_id IN (
    SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "refund_requests_delete_clinic"
ON public.refund_requests
FOR DELETE
TO authenticated
USING (
  clinic_id IN (
    SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE TRIGGER trigger_refund_requests_updated_at
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 6) Extend pharmacy_dispensed_items now that refund_requests exists
ALTER TABLE public.pharmacy_dispensed_items
  ADD COLUMN IF NOT EXISTS refunded_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_request_id uuid REFERENCES public.refund_requests(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.pharmacy_dispensed_items
    ADD CONSTRAINT pharmacy_dispensed_refunded_qty_check CHECK (refunded_quantity >= 0 AND refunded_quantity <= quantity);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- 7) Extend payment_records with record_type and refund linkage
ALTER TABLE public.payment_records
  DROP CONSTRAINT IF EXISTS payment_records_amount_check,
  ADD COLUMN IF NOT EXISTS record_type public.payment_record_type_enum NOT NULL DEFAULT 'payment',
  ADD COLUMN IF NOT EXISTS refund_request_id uuid REFERENCES public.refund_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id);

UPDATE public.payment_records
SET record_type = 'payment'
WHERE record_type IS NULL;

ALTER TABLE public.payment_records
  ADD CONSTRAINT payment_records_amount_non_negative CHECK (amount >= 0);

-- 8) Helper function to keep bill refund status in sync
CREATE OR REPLACE FUNCTION public.refresh_bill_refund_status_for_bill(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  pending_count integer;
  total_refunds numeric := 0;
  bill_total numeric := 0;
  computed_status public.refund_status_enum := 'not_requested';
BEGIN
  IF p_bill_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO pending_count
  FROM public.refund_requests
  WHERE bill_id = p_bill_id
    AND status IN ('pending_approval', 'approved');

  SELECT total_refunded_amount, total_amount
  INTO total_refunds, bill_total
  FROM public.bills
  WHERE id = p_bill_id;

  bill_total := COALESCE(bill_total, 0);

  IF pending_count > 0 THEN
    computed_status := 'pending';
  ELSIF total_refunds >= COALESCE(bill_total, 0) AND COALESCE(total_refunds, 0) > 0 THEN
    computed_status := 'refunded';
  ELSIF COALESCE(total_refunds, 0) > 0 THEN
    computed_status := 'partial';
  ELSE
    computed_status := 'not_requested';
  END IF;

  UPDATE public.bills
  SET refund_status = computed_status
  WHERE id = p_bill_id;
END;
$$;

-- 9) Trigger function to react to refund_request changes
CREATE OR REPLACE FUNCTION public.handle_refund_request_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_bill uuid;
BEGIN
  target_bill := COALESCE(NEW.bill_id, OLD.bill_id);

  PERFORM public.refresh_bill_refund_status_for_bill(target_bill);

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.reason IS NOT NULL THEN
      UPDATE public.bills
      SET refund_notes = NEW.reason
      WHERE id = target_bill;
    END IF;

    IF NEW.status = 'paid' THEN
      UPDATE public.bills
      SET last_refund_at = COALESCE(NEW.paid_at, now())
      WHERE id = target_bill;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trigger_refund_request_change ON public.refund_requests;

CREATE TRIGGER trigger_refund_request_change
  AFTER INSERT OR UPDATE OR DELETE ON public.refund_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_refund_request_change();

-- 10) Recreate payment aggregation trigger to account for refunds
DROP TRIGGER IF EXISTS trigger_update_bill_paid_amount_insert ON public.payment_records;
DROP TRIGGER IF EXISTS trigger_update_bill_paid_amount_update ON public.payment_records;
DROP TRIGGER IF EXISTS trigger_update_bill_paid_amount_delete ON public.payment_records;
DROP FUNCTION IF EXISTS public.update_bill_paid_amount();

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

  SELECT total_amount INTO bill_total
  FROM public.bills
  WHERE id = target_bill_id;

  bill_total := COALESCE(bill_total, 0);

  net_paid := GREATEST(total_payments + total_adjustments - total_refunds, 0);

  UPDATE public.bills
  SET paid_amount = net_paid,
      total_refunded_amount = total_refunds,
      balance_amount = GREATEST(bill_total - net_paid, 0),
      status = CASE
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

CREATE TRIGGER trigger_update_bill_paid_amount_insert
  AFTER INSERT ON public.payment_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_bill_paid_amount();

CREATE TRIGGER trigger_update_bill_paid_amount_update
  AFTER UPDATE ON public.payment_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_bill_paid_amount();

CREATE TRIGGER trigger_update_bill_paid_amount_delete
  AFTER DELETE ON public.payment_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_bill_paid_amount();

-- 11) Refresh daily payment summary helper to ignore refund rows
DROP FUNCTION IF EXISTS public.get_daily_payment_summary(uuid, date);

CREATE OR REPLACE FUNCTION public.get_daily_payment_summary(
  p_clinic_id uuid,
  p_date date
)
RETURNS TABLE (
  payment_method text,
  total_amount numeric,
  transaction_count bigint
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pr.payment_method,
    COALESCE(SUM(pr.amount), 0) AS total_amount,
    COUNT(pr.id) AS transaction_count
  FROM public.payment_records pr
  WHERE pr.clinic_id = p_clinic_id
    AND DATE(pr.payment_date) = p_date
    AND pr.record_type = 'payment'
  GROUP BY pr.payment_method
  ORDER BY pr.payment_method;
END;
$$;
