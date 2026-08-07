-- ============================================================================
-- IPD Migration 025: Doctor treatment plan (date-wise), cross consultations,
-- diet chart (nursing), and diagnostics reports (pathology / radiology).
--
-- The treatment plan is deliberately its OWN note stream — not a nursing note.
-- Everything a round produces (tests, medicines, cross consultation, diet)
-- links back to the plan entry it came from, so a day's documentation and the
-- orders it generated stay together.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ipd_treatment_plans — one row per round / plan entry, grouped by date
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_treatment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  plan_date date NOT NULL DEFAULT CURRENT_DATE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  doctor_id uuid REFERENCES public.profiles(id),
  -- SOAP: kept as separate columns so voice dictation can fill them field-wise
  subjective text,                   -- how the patient is today
  objective text,                    -- examination / findings on the round
  assessment text,                   -- impression, problem status
  plan text,                         -- TODAY'S TREATMENT PLAN (the spine)
  advice text,                       -- instructions to ward / attendants
  voice_transcript text,             -- raw dictation this entry came from
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Orders raised from a plan entry point back at it
ALTER TABLE public.ipd_orders
  ADD COLUMN IF NOT EXISTS treatment_plan_id uuid
    REFERENCES public.ipd_treatment_plans(id) ON DELETE SET NULL;

ALTER TABLE public.ipd_medication_orders
  ADD COLUMN IF NOT EXISTS treatment_plan_id uuid
    REFERENCES public.ipd_treatment_plans(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. ipd_consultations — cross / referral consultation asked for on a round
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  treatment_plan_id uuid REFERENCES public.ipd_treatment_plans(id) ON DELETE SET NULL,
  specialty text,                    -- 'cardiology', 'orthopaedics' …
  doctor_id uuid REFERENCES public.profiles(id),   -- in-house consultant
  external_doctor_name text,         -- visiting / outside consultant
  reason text NOT NULL,
  urgency text NOT NULL DEFAULT 'routine'
    CHECK (urgency IN ('routine', 'urgent', 'stat')),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'seen', 'cancelled')),
  opinion text,                      -- consultant's note once seen
  charge_posting_id uuid REFERENCES public.charge_postings(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES public.profiles(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  seen_by uuid REFERENCES public.profiles(id),
  seen_at timestamptz,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Diet chart (nursing) — a standing diet order + meal-wise service record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_diet_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  treatment_plan_id uuid REFERENCES public.ipd_treatment_plans(id) ON DELETE SET NULL,
  diet_type text NOT NULL DEFAULT 'normal'
    CHECK (diet_type IN (
      'normal', 'soft', 'liquid', 'semi_solid', 'diabetic', 'renal', 'cardiac',
      'low_salt', 'high_protein', 'low_fat', 'bland', 'pediatric', 'npo', 'other'
    )),
  route text NOT NULL DEFAULT 'oral'
    CHECK (route IN ('oral', 'ryles_tube', 'peg', 'npo', 'tpn')),
  calories_kcal integer CHECK (calories_kcal IS NULL OR calories_kcal >= 0),
  protein_g integer CHECK (protein_g IS NULL OR protein_g >= 0),
  fluid_restriction_ml integer CHECK (fluid_restriction_ml IS NULL OR fluid_restriction_ml >= 0),
  special_instructions text,
  restrictions text,                 -- allergies / avoid list for the kitchen
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'stopped')),
  ordered_by uuid REFERENCES public.profiles(id),
  stopped_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.ipd_diet_chart_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  diet_order_id uuid REFERENCES public.ipd_diet_orders(id) ON DELETE SET NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  meal text NOT NULL CHECK (meal IN (
    'early_morning', 'breakfast', 'mid_morning', 'lunch', 'evening', 'dinner', 'bedtime'
  )),
  items text,                        -- what was planned / served
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'served', 'refused', 'withheld')),
  intake_percent integer CHECK (intake_percent IS NULL OR (intake_percent BETWEEN 0 AND 100)),
  notes text,
  served_by uuid REFERENCES public.profiles(id),
  served_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admission_id, entry_date, meal)
);

-- ---------------------------------------------------------------------------
-- 4. ipd_reports — pathology / radiology reports, uploaded or externally filed
--    Linked to the order item when the report answers an order; standalone
--    uploads (outside labs, old films) are allowed with order_item_id NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.ipd_order_items(id) ON DELETE SET NULL,
  report_type text NOT NULL DEFAULT 'pathology'
    CHECK (report_type IN ('pathology', 'radiology', 'cardiology', 'other')),
  title text NOT NULL,
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  performed_at text,                 -- lab / imaging centre name
  file_url text,                     -- storage public URL (PDF / image)
  file_name text,
  mime_type text,
  findings text,
  impression text,
  is_abnormal boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'filed'
    CHECK (status IN ('filed', 'reviewed')),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  uploaded_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_treatment_plans_admission
  ON public.ipd_treatment_plans (admission_id, plan_date DESC, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_admission
  ON public.ipd_consultations (admission_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_status
  ON public.ipd_consultations (clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_diet_orders_admission
  ON public.ipd_diet_orders (admission_id, status);
CREATE INDEX IF NOT EXISTS idx_diet_entries_admission_date
  ON public.ipd_diet_chart_entries (admission_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_reports_admission
  ON public.ipd_reports (admission_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_reports_order_item
  ON public.ipd_reports (order_item_id);
CREATE INDEX IF NOT EXISTS idx_orders_treatment_plan
  ON public.ipd_orders (treatment_plan_id);
CREATE INDEX IF NOT EXISTS idx_med_orders_treatment_plan
  ON public.ipd_medication_orders (treatment_plan_id);

-- ---------------------------------------------------------------------------
-- 6. RLS — same tenant pattern as every other IPD table
-- ---------------------------------------------------------------------------
ALTER TABLE public.ipd_treatment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_diet_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_diet_chart_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_reports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ipd_treatment_plans', 'ipd_consultations',
    'ipd_diet_orders', 'ipd_diet_chart_entries', 'ipd_reports'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_write ON public.%I', t);
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
