-- ============================================================================
-- IPD Migration 003: ADT (Admission / Transfer / Discharge)
-- document numbering, ipd_admissions, ipd_bed_allocations, discharge checklist
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Race-safe document numbering (pattern ported from LIMS invoice numbering)
--    Used for admission numbers here; bills/receipts reuse it in 007.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_number_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  doc_type text NOT NULL,           -- 'admission' | 'ipd_bill' | 'ipd_receipt' | 'deposit'
  prefix text NOT NULL DEFAULT '',
  padding integer NOT NULL DEFAULT 6,
  next_val bigint NOT NULL DEFAULT 1,
  reset_period text NOT NULL DEFAULT 'never'
    CHECK (reset_period IN ('never', 'yearly', 'fiscal_yearly')),
  period_key text NOT NULL DEFAULT '',
  UNIQUE (clinic_id, doc_type)
);

CREATE OR REPLACE FUNCTION public.next_document_number(
  p_clinic_id uuid,
  p_doc_type text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.document_number_sequences%ROWTYPE;
  v_period text;
  v_num bigint;
BEGIN
  -- Ensure a sequence row exists
  INSERT INTO public.document_number_sequences (clinic_id, doc_type, prefix)
  VALUES (p_clinic_id, p_doc_type, upper(left(p_doc_type, 3)) || '-')
  ON CONFLICT (clinic_id, doc_type) DO NOTHING;

  -- Lock the row (serializes concurrent number generation per clinic+type)
  SELECT * INTO v_row
    FROM public.document_number_sequences
   WHERE clinic_id = p_clinic_id AND doc_type = p_doc_type
   FOR UPDATE;

  v_period := CASE v_row.reset_period
    WHEN 'yearly' THEN to_char(now(), 'YYYY')
    WHEN 'fiscal_yearly' THEN
      CASE WHEN extract(month FROM now()) >= 4
           THEN to_char(now(), 'YYYY') || '-' || to_char(now() + interval '1 year', 'YY')
           ELSE to_char(now() - interval '1 year', 'YYYY') || '-' || to_char(now(), 'YY')
      END
    ELSE ''
  END;

  IF v_period IS DISTINCT FROM v_row.period_key THEN
    v_num := 1;
    UPDATE public.document_number_sequences
       SET next_val = 2, period_key = v_period
     WHERE id = v_row.id;
  ELSE
    v_num := v_row.next_val;
    UPDATE public.document_number_sequences
       SET next_val = next_val + 1
     WHERE id = v_row.id;
  END IF;

  RETURN v_row.prefix
      || CASE WHEN v_period <> '' THEN v_period || '-' ELSE '' END
      || lpad(v_num::text, v_row.padding, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. ipd_admissions
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.ipd_admission_status_enum AS ENUM (
    'admitted', 'discharged', 'dama', 'transferred_out', 'expired', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ipd_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_number text NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  admitting_doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  treating_doctor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  current_bed_id uuid REFERENCES public.ipd_beds(id) ON DELETE SET NULL,
  admission_datetime timestamptz NOT NULL DEFAULT now(),
  admission_type text NOT NULL DEFAULT 'planned'
    CHECK (admission_type IN ('planned', 'emergency', 'transfer_in', 'daycare', 'mlc')),
  source_visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  provisional_diagnosis text,
  icd10_codes text[] NOT NULL DEFAULT '{}',
  reason_for_admission text,
  payer_id uuid REFERENCES public.payers(id) ON DELETE SET NULL,
  tariff_plan_id uuid REFERENCES public.tariff_plans(id) ON DELETE SET NULL,
  coverage_id uuid, -- FK added in migration 009
  estimated_cost numeric(12,2),
  estimated_stay_days integer,
  is_mlc boolean NOT NULL DEFAULT false,
  mlc_number text,
  status public.ipd_admission_status_enum NOT NULL DEFAULT 'admitted',
  discharge_datetime timestamptz,
  discharge_type text
    CHECK (discharge_type IN ('routine', 'dama', 'referred', 'expired', 'absconded')),
  attendant_name text,
  attendant_phone text,
  attendant_relation text,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, admission_number)
);

-- ---------------------------------------------------------------------------
-- 3. ipd_bed_allocations — full bed history including transfers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_bed_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  bed_id uuid NOT NULL REFERENCES public.ipd_beds(id) ON DELETE RESTRICT,
  from_datetime timestamptz NOT NULL DEFAULT now(),
  to_datetime timestamptz,          -- NULL = current allocation
  reason text NOT NULL DEFAULT 'admission'
    CHECK (reason IN ('admission', 'upgrade', 'downgrade', 'icu_shift', 'stepdown',
                      'patient_request', 'operational')),
  rate_snapshot numeric(12,2),      -- resolved room rate at allocation time
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_datetime IS NULL OR to_datetime > from_datetime)
);

-- Only one open allocation per admission
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_allocation_per_admission
  ON public.ipd_bed_allocations (admission_id)
  WHERE to_datetime IS NULL;

-- A bed can hold only one open allocation
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_allocation_per_bed
  ON public.ipd_bed_allocations (bed_id)
  WHERE to_datetime IS NULL;

-- ---------------------------------------------------------------------------
-- 4. ipd_discharge_checklist
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_discharge_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL UNIQUE REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  bill_cleared boolean NOT NULL DEFAULT false,
  summary_signed boolean NOT NULL DEFAULT false,
  meds_reconciled boolean NOT NULL DEFAULT false,
  implants_documented boolean NOT NULL DEFAULT false,
  followup_booked boolean NOT NULL DEFAULT false,
  cleared_by uuid REFERENCES public.profiles(id),
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. Admission lifecycle triggers: keep bed status + current_bed_id in sync
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ipd_allocation_sync_bed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.to_datetime IS NULL THEN
    UPDATE public.ipd_beds SET status = 'occupied', updated_at = now()
     WHERE id = NEW.bed_id;
    UPDATE public.ipd_admissions SET current_bed_id = NEW.bed_id, updated_at = now()
     WHERE id = NEW.admission_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.to_datetime IS NULL AND NEW.to_datetime IS NOT NULL THEN
    -- Allocation closed: bed goes to cleaning (housekeeping flips to available)
    UPDATE public.ipd_beds SET status = 'cleaning', updated_at = now()
     WHERE id = NEW.bed_id AND status = 'occupied';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_allocation_sync_bed
  AFTER INSERT OR UPDATE OF to_datetime ON public.ipd_bed_allocations
  FOR EACH ROW EXECUTE FUNCTION public.ipd_allocation_sync_bed();

-- ---------------------------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_admissions_clinic_status ON public.ipd_admissions (clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_admissions_patient ON public.ipd_admissions (patient_id);
CREATE INDEX IF NOT EXISTS idx_admissions_doctor ON public.ipd_admissions (admitting_doctor_id);
CREATE INDEX IF NOT EXISTS idx_admissions_date ON public.ipd_admissions (clinic_id, admission_datetime);
CREATE INDEX IF NOT EXISTS idx_allocations_admission ON public.ipd_bed_allocations (admission_id);
CREATE INDEX IF NOT EXISTS idx_allocations_bed ON public.ipd_bed_allocations (bed_id);

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.document_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_bed_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_discharge_checklist ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'document_number_sequences', 'ipd_admissions',
    'ipd_bed_allocations', 'ipd_discharge_checklist'
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
