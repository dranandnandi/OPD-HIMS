-- ============================================================================
-- IPD Migration 005: Nursing
-- vitals, nursing notes, nursing tasks, intake/output
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ipd_vitals (extra jsonb carries ICU flowsheet extensions: vent params etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_vitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES public.profiles(id),
  temperature numeric(4,1) CHECK (temperature IS NULL OR (temperature BETWEEN 30 AND 45)),
  pulse integer CHECK (pulse IS NULL OR (pulse BETWEEN 0 AND 300)),
  resp_rate integer CHECK (resp_rate IS NULL OR (resp_rate BETWEEN 0 AND 100)),
  bp_systolic integer CHECK (bp_systolic IS NULL OR (bp_systolic BETWEEN 0 AND 350)),
  bp_diastolic integer CHECK (bp_diastolic IS NULL OR (bp_diastolic BETWEEN 0 AND 250)),
  spo2 integer CHECK (spo2 IS NULL OR (spo2 BETWEEN 0 AND 100)),
  pain_score integer CHECK (pain_score IS NULL OR (pain_score BETWEEN 0 AND 10)),
  gcs integer CHECK (gcs IS NULL OR (gcs BETWEEN 3 AND 15)),
  blood_sugar numeric(6,1),
  weight_kg numeric(6,2),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. ipd_nursing_notes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_nursing_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  note_type text NOT NULL DEFAULT 'nursing'
    CHECK (note_type IN ('nursing', 'doctor_round', 'progress', 'handover', 'procedure')),
  note text NOT NULL,
  voice_transcript_id uuid REFERENCES public.voice_transcripts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. ipd_nursing_tasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_nursing_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  task text NOT NULL,
  due_at timestamptz,
  recurrence text,                   -- 'q4h', 'od', 'bd', 'sos' — expanded app-side
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'skipped')),
  done_by uuid REFERENCES public.profiles(id),
  done_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. ipd_intake_output
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_intake_output (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  io_type text NOT NULL CHECK (io_type IN ('intake', 'output')),
  route text NOT NULL,               -- 'oral', 'iv', 'ryles', 'urine', 'drain', 'vomit', 'stool'
  volume_ml integer NOT NULL CHECK (volume_ml >= 0),
  notes text,
  recorded_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_vitals_admission_time ON public.ipd_vitals (admission_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_nursing_notes_admission ON public.ipd_nursing_notes (admission_id, created_at);
CREATE INDEX IF NOT EXISTS idx_nursing_tasks_admission ON public.ipd_nursing_tasks (admission_id, status);
CREATE INDEX IF NOT EXISTS idx_nursing_tasks_due ON public.ipd_nursing_tasks (clinic_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_io_admission_time ON public.ipd_intake_output (admission_id, recorded_at);

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.ipd_vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_nursing_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_nursing_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_intake_output ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ipd_vitals', 'ipd_nursing_notes', 'ipd_nursing_tasks', 'ipd_intake_output'
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
