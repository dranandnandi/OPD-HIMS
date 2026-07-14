-- ============================================================================
-- IPD Migration 006: Medications & eMAR
-- medication orders -> expanded schedule -> administrations (eMAR),
-- linked to the existing OPD pharmacy stock tables.
-- Also: additive admission_id columns on existing OPD tables (safe, nullable).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ipd_medication_orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_medication_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  medicine_id uuid REFERENCES public.medicines_master(id) ON DELETE SET NULL,
  medicine_name text NOT NULL,       -- snapshot / non-formulary entry
  dose text,
  route text,                        -- 'oral', 'iv', 'im', 'sc', 'topical', 'inhalation'
  frequency_code text NOT NULL DEFAULT 'od',  -- 'od','bd','tid','qid','q6h','stat','sos'
  start_at timestamptz NOT NULL DEFAULT now(),
  end_at timestamptz,
  instructions text,
  ordered_by uuid REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'held', 'stopped', 'completed')),
  stopped_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at IS NULL OR end_at > start_at)
);

-- ---------------------------------------------------------------------------
-- 2. ipd_medication_schedule — expanded doses (generated app-side/edge fn)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_medication_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  medication_order_id uuid NOT NULL REFERENCES public.ipd_medication_orders(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'due'
    CHECK (status IN ('due', 'given', 'held', 'missed', 'refused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (medication_order_id, scheduled_at)
);

-- ---------------------------------------------------------------------------
-- 3. ipd_medication_administrations — eMAR events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_medication_administrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES public.ipd_medication_schedule(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  administered_by uuid REFERENCES public.profiles(id),
  administered_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('given', 'held', 'refused', 'wasted')),
  reason text,
  wristband_scanned boolean NOT NULL DEFAULT false,   -- five-rights barcode check (Wave 2)
  med_barcode_scanned boolean NOT NULL DEFAULT false,
  stock_movement_id uuid REFERENCES public.stock_movement_log(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Keep schedule status in sync with the administration event
CREATE OR REPLACE FUNCTION public.ipd_emar_sync_schedule()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.ipd_medication_schedule
     SET status = CASE NEW.status
                    WHEN 'given' THEN 'given'
                    WHEN 'held' THEN 'held'
                    WHEN 'refused' THEN 'refused'
                    ELSE status
                  END
   WHERE id = NEW.schedule_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_emar_sync_schedule
  AFTER INSERT ON public.ipd_medication_administrations
  FOR EACH ROW EXECUTE FUNCTION public.ipd_emar_sync_schedule();

-- ---------------------------------------------------------------------------
-- 4. Additive columns on existing OPD tables (nullable — OPD behavior unchanged)
-- ---------------------------------------------------------------------------
ALTER TABLE public.pharmacy_dispensed_items
  ADD COLUMN IF NOT EXISTS admission_id uuid REFERENCES public.ipd_admissions(id) ON DELETE SET NULL;

ALTER TABLE public.tests_ordered
  ADD COLUMN IF NOT EXISTS admission_id uuid REFERENCES public.ipd_admissions(id) ON DELETE SET NULL;

ALTER TABLE public.ocr_uploads
  ADD COLUMN IF NOT EXISTS admission_id uuid REFERENCES public.ipd_admissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pharmacy_dispensed_admission
  ON public.pharmacy_dispensed_items (admission_id) WHERE admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tests_ordered_admission
  ON public.tests_ordered (admission_id) WHERE admission_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_med_orders_admission ON public.ipd_medication_orders (admission_id, status);
CREATE INDEX IF NOT EXISTS idx_med_schedule_admission ON public.ipd_medication_schedule (admission_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_med_schedule_due ON public.ipd_medication_schedule (clinic_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_med_admin_schedule ON public.ipd_medication_administrations (schedule_id);
CREATE INDEX IF NOT EXISTS idx_med_admin_admission ON public.ipd_medication_administrations (admission_id);

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.ipd_medication_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_medication_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_medication_administrations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ipd_medication_orders', 'ipd_medication_schedule', 'ipd_medication_administrations'
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
