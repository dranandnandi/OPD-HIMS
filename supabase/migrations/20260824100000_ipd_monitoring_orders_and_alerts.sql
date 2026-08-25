-- ============================================================================
-- IPD: monitoring orders + user-chosen dose times + pending/missed alerting
--
-- Three gaps this closes, all from the same ward problem — a written order like
--   "NBM. TPR, BP every 30 min. Watch for abdominal distension, passage of urine.
--    Inj. Monosef 1 g IV 12 hourly at 8 PM and 8 AM."
-- could not be carried into the chart:
--
--   1. Observations ("TPR/BP every 30 min", "watch urine output") had nowhere to
--      live. Vitals could only be charted after the fact; nothing said a reading
--      was due, and nothing showed it had been skipped. -> ipd_monitoring_orders,
--      expanded into ipd_nursing_tasks the same way medications expand into
--      ipd_medication_schedule.
--   2. Dose clock times were hard-coded per frequency code (BD was always
--      09:00/21:00), so "8 PM and 8 AM" could not be ordered as written.
--      -> ipd_medication_orders.dose_times keeps the times the doctor chose.
--   3. Nothing was overdue-aware. Grace minutes on both tables define when a
--      pending item becomes "missed" for the always-on alert bar.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Medication orders: the actual clock times, chosen by the user
-- ---------------------------------------------------------------------------
ALTER TABLE public.ipd_medication_orders
  ADD COLUMN IF NOT EXISTS dose_times text[],
  ADD COLUMN IF NOT EXISTS grace_minutes integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.ipd_medication_orders.dose_times IS
  'HH:MM slots this order is actually given at (user-chosen). NULL = legacy order expanded from the frequency-code defaults.';
COMMENT ON COLUMN public.ipd_medication_orders.grace_minutes IS
  'How late a due dose may run before the alert bar calls it missed.';

-- ---------------------------------------------------------------------------
-- 2. ipd_monitoring_orders — standing observation orders
--    "TPR, BP every 30 min", "watch for abdominal distension", "chart urine
--    output hourly". Expanded into ipd_nursing_tasks occurrences.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_monitoring_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  title text NOT NULL,                                  -- 'TPR, BP'
  kind text NOT NULL DEFAULT 'vitals'
    CHECK (kind IN ('vitals', 'observation', 'intake_output', 'custom')),
  -- which vitals columns this order expects charted (kind = 'vitals')
  fields text[] NOT NULL DEFAULT '{}'::text[],
  interval_minutes integer NOT NULL CHECK (interval_minutes BETWEEN 5 AND 10080),
  start_at timestamptz NOT NULL DEFAULT now(),
  end_at timestamptz,
  instructions text,
  grace_minutes integer NOT NULL DEFAULT 15,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'stopped', 'completed')),
  stopped_reason text,
  ordered_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at IS NULL OR end_at > start_at)
);

-- ---------------------------------------------------------------------------
-- 3. Nursing tasks become the occurrence rows for monitoring orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.ipd_nursing_tasks
  ADD COLUMN IF NOT EXISTS monitoring_order_id uuid
    REFERENCES public.ipd_monitoring_orders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS grace_minutes integer NOT NULL DEFAULT 15;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ipd_nursing_tasks_category_check'
  ) THEN
    ALTER TABLE public.ipd_nursing_tasks
      ADD CONSTRAINT ipd_nursing_tasks_category_check
      CHECK (category IN ('general', 'monitoring', 'observation', 'intake_output', 'procedure'));
  END IF;
END $$;

-- One occurrence per order per due time — makes top-up expansion idempotent, so
-- two nurses opening the same chart cannot double the task list.
--
-- Deliberately NOT a partial index: ON CONFLICT cannot infer a partial index
-- without repeating its predicate, which PostgREST's upsert has no way to send.
-- Ad-hoc tasks are unaffected — their monitoring_order_id is NULL, and NULLs are
-- distinct in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_nursing_task_occurrence
  ON public.ipd_nursing_tasks (monitoring_order_id, due_at);

-- ---------------------------------------------------------------------------
-- 4. Indexes for the alert bar (clinic-wide "what is pending / missed")
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_monitoring_orders_admission
  ON public.ipd_monitoring_orders (admission_id, status);
CREATE INDEX IF NOT EXISTS idx_monitoring_orders_active
  ON public.ipd_monitoring_orders (clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_nursing_tasks_pending_due
  ON public.ipd_nursing_tasks (clinic_id, status, due_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 5. RLS — same tenant policy shape as the rest of the IPD tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.ipd_monitoring_orders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ipd_monitoring_orders'
       AND policyname = 'tenant_select'
  ) THEN
    CREATE POLICY tenant_select ON public.ipd_monitoring_orders
      FOR SELECT TO authenticated
      USING (clinic_id IN (SELECT public.user_clinic_ids()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ipd_monitoring_orders'
       AND policyname = 'tenant_write'
  ) THEN
    CREATE POLICY tenant_write ON public.ipd_monitoring_orders
      FOR ALL TO authenticated
      USING (clinic_id IN (SELECT public.user_clinic_ids()))
      WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));
  END IF;
END $$;

COMMIT;
