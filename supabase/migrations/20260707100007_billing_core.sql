-- ============================================================================
-- IPD Migration 007: Billing Core (Finance Layer A — revenue intent)
-- charge_postings (the heart), deposits, bills, bill lines, payments.
-- Bills are snapshots over postings; postings accrue live.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. charge_postings — every billable event = one row
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.charge_source_enum AS ENUM (
    'room_rent_job', 'order', 'emar', 'ot', 'pharmacy', 'manual', 'package_engine'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.charge_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services_master(id) ON DELETE RESTRICT,
  -- Denormalized MIS layer (filled by trigger from services_master -> charge_groups)
  charge_group_id uuid NOT NULL REFERENCES public.charge_groups(id) ON DELETE RESTRICT,
  charge_group_path text NOT NULL DEFAULT '',
  source public.charge_source_enum NOT NULL DEFAULT 'manual',
  source_ref uuid,                   -- order_item / med schedule / ot_consumption id
  service_date date NOT NULL DEFAULT CURRENT_DATE,
  quantity numeric(8,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_rate numeric(12,2) NOT NULL CHECK (unit_rate >= 0),
  gross_amount numeric(12,2) NOT NULL CHECK (gross_amount >= 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_approved_by uuid REFERENCES public.profiles(id),
  net_amount numeric(12,2) NOT NULL CHECK (net_amount >= 0),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  cost_snapshot numeric(12,2) NOT NULL DEFAULT 0,  -- Layer C seed
  ordering_doctor_id uuid REFERENCES public.profiles(id),
  performing_doctor_id uuid REFERENCES public.profiles(id),
  package_assignment_id uuid,        -- FK added in migration 008
  covered_by_package boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'billed', 'cancelled')),
  bill_line_id uuid,                 -- set when swept into a bill (FK added below)
  cancelled_reason text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (net_amount = gross_amount - discount_amount)
);

-- Fill denormalized charge group columns + defaults from the service
CREATE OR REPLACE FUNCTION public.charge_postings_fill_defaults()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_group_id uuid;
  v_path text;
  v_cost numeric;
BEGIN
  SELECT s.charge_group_id, g.path, s.base_cost
    INTO v_group_id, v_path, v_cost
    FROM public.services_master s
    JOIN public.charge_groups g ON g.id = s.charge_group_id
   WHERE s.id = NEW.service_id;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Service % not found for charge posting', NEW.service_id;
  END IF;

  NEW.charge_group_id := v_group_id;
  NEW.charge_group_path := v_path;
  IF NEW.cost_snapshot = 0 THEN
    NEW.cost_snapshot := v_cost * NEW.quantity;
  END IF;
  IF NEW.gross_amount = 0 THEN
    NEW.gross_amount := round(NEW.unit_rate * NEW.quantity, 2);
    NEW.net_amount := NEW.gross_amount - NEW.discount_amount;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_charge_postings_defaults
  BEFORE INSERT OR UPDATE OF service_id, quantity, unit_rate, discount_amount
  ON public.charge_postings
  FOR EACH ROW EXECUTE FUNCTION public.charge_postings_fill_defaults();

-- ---------------------------------------------------------------------------
-- 2. ipd_deposits — advance ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  entry_type text NOT NULL DEFAULT 'deposit'
    CHECK (entry_type IN ('deposit', 'refund', 'applied_to_bill')),
  payment_method text
    CHECK (payment_method IN ('cash', 'card', 'upi', 'cheque', 'net_banking', 'wallet', 'neft')),
  reference text,
  received_by uuid REFERENCES public.profiles(id),
  applied_bill_id uuid,              -- FK added below
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, receipt_number)
);

-- ---------------------------------------------------------------------------
-- 3. ipd_bills
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  bill_number text NOT NULL,
  bill_type text NOT NULL DEFAULT 'interim'
    CHECK (bill_type IN ('interim', 'final', 'supplementary')),
  bill_datetime timestamptz NOT NULL DEFAULT now(),
  gross_total numeric(12,2) NOT NULL DEFAULT 0,
  discount_total numeric(12,2) NOT NULL DEFAULT 0,
  tax_total numeric(12,2) NOT NULL DEFAULT 0,
  net_total numeric(12,2) NOT NULL DEFAULT 0,
  package_total numeric(12,2) NOT NULL DEFAULT 0,
  payer_expected numeric(12,2) NOT NULL DEFAULT 0,
  patient_payable numeric(12,2) NOT NULL DEFAULT 0,
  deposits_applied numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  balance_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'partially_paid', 'settled', 'cancelled')),
  notes text,
  pdf_url text,
  print_pdf_url text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, bill_number)
);

-- Only one non-cancelled final bill per admission
CREATE UNIQUE INDEX IF NOT EXISTS uq_final_bill_per_admission
  ON public.ipd_bills (admission_id)
  WHERE bill_type = 'final' AND status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 4. ipd_bill_lines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES public.ipd_bills(id) ON DELETE CASCADE,
  charge_posting_id uuid REFERENCES public.charge_postings(id) ON DELETE SET NULL,
  line_type text NOT NULL DEFAULT 'charge'
    CHECK (line_type IN ('charge', 'package', 'adjustment')),
  description text NOT NULL,
  quantity numeric(8,2) NOT NULL DEFAULT 1,
  unit_rate numeric(12,2) NOT NULL DEFAULT 0,
  gross numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  tax numeric(12,2) NOT NULL DEFAULT 0,
  net numeric(12,2) NOT NULL DEFAULT 0,
  charge_group_id uuid REFERENCES public.charge_groups(id),
  charge_group_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Deferred FKs now that both tables exist
ALTER TABLE public.charge_postings
  ADD CONSTRAINT fk_charge_postings_bill_line
  FOREIGN KEY (bill_line_id) REFERENCES public.ipd_bill_lines(id) ON DELETE SET NULL;

ALTER TABLE public.ipd_deposits
  ADD CONSTRAINT fk_deposits_applied_bill
  FOREIGN KEY (applied_bill_id) REFERENCES public.ipd_bills(id) ON DELETE SET NULL;

ALTER TABLE public.ipd_order_items
  ADD CONSTRAINT fk_order_items_charge_posting
  FOREIGN KEY (charge_posting_id) REFERENCES public.charge_postings(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5. ipd_payments (receipts against bills; refunds as record_type='refund')
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES public.ipd_bills(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payer_kind text NOT NULL DEFAULT 'patient'
    CHECK (payer_kind IN ('patient', 'tpa', 'insurer', 'corporate')),
  payment_method text NOT NULL
    CHECK (payment_method IN ('cash', 'card', 'upi', 'cheque', 'net_banking', 'wallet', 'neft')),
  reference text,
  record_type text NOT NULL DEFAULT 'payment'
    CHECK (record_type IN ('payment', 'refund')),
  received_by uuid REFERENCES public.profiles(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, receipt_number)
);

-- Roll paid_amount / balance / status up to the bill
CREATE OR REPLACE FUNCTION public.ipd_payments_rollup()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_bill_id uuid := COALESCE(NEW.bill_id, OLD.bill_id);
  v_paid numeric;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN record_type = 'payment' THEN amount ELSE -amount END), 0)
    INTO v_paid
    FROM public.ipd_payments WHERE bill_id = v_bill_id;

  UPDATE public.ipd_bills b
     SET paid_amount = v_paid,
         balance_amount = b.patient_payable - b.deposits_applied - v_paid,
         status = CASE
           WHEN b.status = 'cancelled' THEN b.status
           WHEN b.patient_payable - b.deposits_applied - v_paid <= 0 THEN 'settled'
           WHEN v_paid > 0 THEN 'partially_paid'
           ELSE b.status
         END,
         updated_at = now()
   WHERE b.id = v_bill_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_ipd_payments_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.ipd_payments
  FOR EACH ROW EXECUTE FUNCTION public.ipd_payments_rollup();

-- ---------------------------------------------------------------------------
-- 6. generate_ipd_bill(): sweep pending postings into a bill snapshot
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_ipd_bill(
  p_admission_id uuid,
  p_bill_type text DEFAULT 'interim',
  p_created_by uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id uuid;
  v_bill_id uuid;
  v_bill_number text;
  v_deposits numeric;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.ipd_admissions WHERE id = p_admission_id;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Admission % not found', p_admission_id;
  END IF;

  v_bill_number := public.next_document_number(v_clinic_id, 'ipd_bill');

  INSERT INTO public.ipd_bills (clinic_id, admission_id, bill_number, bill_type, created_by)
  VALUES (v_clinic_id, p_admission_id, v_bill_number, p_bill_type, p_created_by)
  RETURNING id INTO v_bill_id;

  -- Snapshot pending, non-package-covered postings into lines
  WITH pending AS (
    SELECT cp.*, s.name AS service_name, s.tax_rate
      FROM public.charge_postings cp
      JOIN public.services_master s ON s.id = cp.service_id
     WHERE cp.admission_id = p_admission_id
       AND cp.status = 'pending'
       AND cp.covered_by_package = false
     ORDER BY cp.service_date, cp.created_at
  ), lines AS (
    INSERT INTO public.ipd_bill_lines
      (clinic_id, bill_id, charge_posting_id, line_type, description,
       quantity, unit_rate, gross, discount, tax, net,
       charge_group_id, charge_group_path)
    SELECT clinic_id, v_bill_id, id, 'charge', service_name,
           quantity, unit_rate, gross_amount, discount_amount, tax_amount, net_amount,
           charge_group_id, charge_group_path
      FROM pending
    RETURNING charge_posting_id, id
  )
  UPDATE public.charge_postings cp
     SET status = 'billed', bill_line_id = l.id, updated_at = now()
    FROM lines l
   WHERE cp.id = l.charge_posting_id;

  -- Available (unapplied) deposits
  SELECT COALESCE(SUM(CASE entry_type
           WHEN 'deposit' THEN amount
           WHEN 'refund' THEN -amount
           WHEN 'applied_to_bill' THEN -amount
         END), 0)
    INTO v_deposits
    FROM public.ipd_deposits WHERE admission_id = p_admission_id;

  -- Totals
  UPDATE public.ipd_bills b
     SET gross_total = t.gross, discount_total = t.disc,
         tax_total = t.tax, net_total = t.net,
         patient_payable = t.net,          -- payer split refined by TPA flow (009)
         deposits_applied = LEAST(GREATEST(v_deposits, 0), t.net),
         balance_amount = t.net - LEAST(GREATEST(v_deposits, 0), t.net),
         status = 'issued', updated_at = now()
    FROM (
      SELECT COALESCE(SUM(gross),0) gross, COALESCE(SUM(discount),0) disc,
             COALESCE(SUM(tax),0) tax, COALESCE(SUM(net),0) net
        FROM public.ipd_bill_lines WHERE bill_id = v_bill_id
    ) t
   WHERE b.id = v_bill_id;

  RETURN v_bill_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Room-rent posting helper (called nightly and at discharge by edge fn)
--    Posts one bed-day charge per open allocation for the given date.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_room_rent_for_date(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT a.id AS admission_id, a.clinic_id, a.tariff_plan_id,
           bt.room_rent_service_id, bt.nursing_service_id
      FROM public.ipd_admissions a
      JOIN public.ipd_bed_allocations ba
        ON ba.admission_id = a.id AND ba.to_datetime IS NULL
      JOIN public.ipd_beds b ON b.id = ba.bed_id
      JOIN public.bed_types bt ON bt.id = b.bed_type_id
     WHERE a.status = 'admitted'
       AND ba.from_datetime::date <= p_date
       -- idempotency: skip if already posted for this date
       AND NOT EXISTS (
         SELECT 1 FROM public.charge_postings cp
          WHERE cp.admission_id = a.id
            AND cp.source = 'room_rent_job'
            AND cp.service_date = p_date
            AND cp.service_id = bt.room_rent_service_id
            AND cp.status <> 'cancelled'
       )
  LOOP
    INSERT INTO public.charge_postings
      (clinic_id, admission_id, service_id, charge_group_id, source, service_date,
       quantity, unit_rate, gross_amount, net_amount)
    VALUES
      (r.clinic_id, r.admission_id, r.room_rent_service_id,
       (SELECT charge_group_id FROM public.services_master WHERE id = r.room_rent_service_id),
       'room_rent_job', p_date, 1,
       public.resolve_tariff_rate(r.room_rent_service_id, r.tariff_plan_id),
       0, 0);  -- gross/net recomputed by trigger

    IF r.nursing_service_id IS NOT NULL THEN
      INSERT INTO public.charge_postings
        (clinic_id, admission_id, service_id, charge_group_id, source, service_date,
         quantity, unit_rate, gross_amount, net_amount)
      VALUES
        (r.clinic_id, r.admission_id, r.nursing_service_id,
         (SELECT charge_group_id FROM public.services_master WHERE id = r.nursing_service_id),
         'room_rent_job', p_date, 1,
         public.resolve_tariff_rate(r.nursing_service_id, r.tariff_plan_id),
         0, 0);
    END IF;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_postings_admission_status ON public.charge_postings (admission_id, status);
CREATE INDEX IF NOT EXISTS idx_postings_clinic_date ON public.charge_postings (clinic_id, service_date);
CREATE INDEX IF NOT EXISTS idx_postings_group_path ON public.charge_postings (clinic_id, charge_group_path text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_postings_performing_doctor ON public.charge_postings (performing_doctor_id) WHERE performing_doctor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deposits_admission ON public.ipd_deposits (admission_id);
CREATE INDEX IF NOT EXISTS idx_bills_admission ON public.ipd_bills (admission_id);
CREATE INDEX IF NOT EXISTS idx_bills_clinic_status ON public.ipd_bills (clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_bill_lines_bill ON public.ipd_bill_lines (bill_id);
CREATE INDEX IF NOT EXISTS idx_payments_bill ON public.ipd_payments (bill_id);

-- ---------------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.charge_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_bill_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_payments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'charge_postings', 'ipd_deposits', 'ipd_bills', 'ipd_bill_lines', 'ipd_payments'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))', t);
    EXECUTE format(
      'CREATE POLICY tenant_write ON public.%I FOR ALL TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))
         WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()))', t);
  END LOOP;
END $$;

COMMIT;
