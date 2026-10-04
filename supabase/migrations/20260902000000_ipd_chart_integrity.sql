-- ============================================================================
-- Ward chart integrity: an honest "time taken", a locked "time charted",
-- and a correction trail on the three tables the nursing sheet prints from.
--
-- The problem this closes
-- -----------------------
-- ipd_vitals, ipd_intake_output and ipd_nursing_notes each carried a single
-- blanket policy:
--
--   CREATE POLICY tenant_write ON public.ipd_vitals FOR ALL TO authenticated
--     USING (clinic_id IN (SELECT public.user_clinic_ids()))
--
-- Clinic membership was the ONLY check. Any authenticated user of the clinic --
-- a receptionist, not just an admin -- could UPDATE recorded_at or DELETE a
-- charted round straight through the API: no permission key, no audit row, no
-- updated_at. Nothing in the app does this, but nothing in the database
-- stopped it either, and these rows are now printed on the Nursing Sheet as a
-- legal record. This is the same hole that was closed on ipd_documents in
-- 20260824000000; the ward chart was left behind.
--
-- The second problem was quieter. recordVitals() never sent recorded_at, so
-- the DEFAULT now() always won: a round taken at 06:00 and charted at 10:00
-- was stored as 10:00. There was no way to be honest about late charting
-- except to lie about it later -- which the wide-open policy above happily
-- allowed.
--
-- What this does
-- --------------
-- 1. Splits the two times apart.
--
--      recorded_at / created_at   the CLINICAL time -- when the reading was
--                                 taken, the fluid given, the observation
--                                 made. Settable at entry (backdated only),
--                                 amendable afterwards with a reason.
--      charted_at                 when it was ENTERED into the system. Set by
--                                 the database, never accepted from the
--                                 client, immutable on update.
--
--    Late charting is now recorded as late charting instead of tempting a
--    backdate: the sheet prints "06:00 (charted 10:00)".
--
-- 2. Gives each table INSERT / UPDATE / DELETE policies instead of FOR ALL.
--    Charting needs a charting key; amending charted data needs a new key,
--    'ipd_vitals_amend', which nobody holds by default -- admin roles pass
--    through user_has_permission()'s wildcard, and Masters -> Users can grant
--    it to a ward sister or matron.
--
-- 3. Requires a reason for every amendment and writes the before/after row to
--    ipd_chart_amendments. The trail is append-only: the trigger is the only
--    writer, and there is no client write policy.
--
-- Nothing in the app updates or deletes these three tables today, so the
-- tightened policies break no existing path.
--
-- Safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Provenance columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.ipd_vitals
  ADD COLUMN IF NOT EXISTS charted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by       uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS amendment_reason text;

ALTER TABLE public.ipd_intake_output
  ADD COLUMN IF NOT EXISTS charted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by       uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS amendment_reason text;

ALTER TABLE public.ipd_nursing_notes
  ADD COLUMN IF NOT EXISTS charted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by       uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS amendment_reason text;

-- Existing rows were charted at the moment they were recorded -- that is
-- exactly what the old single-timestamp model meant.
UPDATE public.ipd_vitals        SET charted_at = recorded_at WHERE charted_at IS NULL;
UPDATE public.ipd_intake_output SET charted_at = recorded_at WHERE charted_at IS NULL;
UPDATE public.ipd_nursing_notes SET charted_at = created_at  WHERE charted_at IS NULL;

ALTER TABLE public.ipd_vitals
  ALTER COLUMN charted_at SET DEFAULT now(),
  ALTER COLUMN charted_at SET NOT NULL;
ALTER TABLE public.ipd_intake_output
  ALTER COLUMN charted_at SET DEFAULT now(),
  ALTER COLUMN charted_at SET NOT NULL;
ALTER TABLE public.ipd_nursing_notes
  ALTER COLUMN charted_at SET DEFAULT now(),
  ALTER COLUMN charted_at SET NOT NULL;

COMMENT ON COLUMN public.ipd_vitals.recorded_at IS
  'Clinical time the reading was taken. May be backdated at entry and amended with a reason; see charted_at for when it was keyed in.';
COMMENT ON COLUMN public.ipd_vitals.charted_at IS
  'When the row was entered into the system. Database-set, immutable.';

-- ---------------------------------------------------------------------------
-- 2. Correction trail (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ipd_chart_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  source_table text NOT NULL CHECK (source_table IN (
    'ipd_vitals', 'ipd_intake_output', 'ipd_nursing_notes'
  )),
  source_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('update', 'delete')),
  reason text,
  before_row jsonb NOT NULL,
  after_row jsonb,
  changed_fields text[] NOT NULL DEFAULT '{}',
  amended_by uuid REFERENCES public.profiles(id),
  amended_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chart_amendments_admission
  ON public.ipd_chart_amendments (admission_id, amended_at DESC);
CREATE INDEX IF NOT EXISTS idx_chart_amendments_source
  ON public.ipd_chart_amendments (source_table, source_id);

ALTER TABLE public.ipd_chart_amendments ENABLE ROW LEVEL SECURITY;

-- Read-only to the clinic. The trigger below is the only writer: with no
-- INSERT/UPDATE/DELETE policy, a client cannot forge or erase a trail row.
DROP POLICY IF EXISTS ipd_chart_amendments_select ON public.ipd_chart_amendments;
CREATE POLICY ipd_chart_amendments_select ON public.ipd_chart_amendments
  FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ---------------------------------------------------------------------------
-- 3. Permission keys
-- ---------------------------------------------------------------------------

-- Who may chart at all. A doctor holding only the treatment-plan key still
-- charts vitals on a round (and the voice dictation path writes them), so the
-- clinical key is not the sole route -- same "a doctor may do what a nurse
-- does" rule as ipd_can_author_doc().
-- Keep in sync with canChartIpd() in src/modules/ipd/utils/permissions.ts.
CREATE OR REPLACE FUNCTION public.ipd_can_chart()
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT public.user_has_permission('ipd_clinical')
      OR public.user_has_permission('ipd_treatment_plan');
$fn$;

GRANT EXECUTE ON FUNCTION public.ipd_can_chart() TO authenticated;

-- Who may correct something already charted. Deliberately granted to nobody:
-- admin roles pass through the wildcard inside user_has_permission(), and a
-- clinic that wants its ward sister to hold it grants 'ipd_vitals_amend' in
-- IPD -> Masters -> Users.

-- ---------------------------------------------------------------------------
-- 4. Row guard: charted_at immutable, clinical time never in the future,
--    amendments must carry a reason
-- ---------------------------------------------------------------------------

-- TG_ARGV[0] is the name of the table's clinical time column.
CREATE OR REPLACE FUNCTION public.ipd_chart_row_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_clinical timestamptz;
BEGIN
  v_clinical := (to_jsonb(NEW) ->> TG_ARGV[0])::timestamptz;

  -- A reading cannot have been taken in the future. Backdating to when it
  -- actually happened is the whole point and stays allowed; the small grace
  -- absorbs clock skew between the browser and the database.
  IF v_clinical > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'The time taken cannot be in the future';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- charted_at is the system's word, never the client's
    NEW.charted_at       := now();
    NEW.updated_at       := NULL;
    NEW.updated_by       := NULL;
    NEW.amendment_reason := NULL;
  ELSE
    NEW.charted_at := OLD.charted_at;   -- when it was keyed in never changes
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    IF nullif(trim(coalesce(NEW.amendment_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'A correction reason is required to amend a charted entry';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_chart_guard ON public.ipd_vitals;
CREATE TRIGGER trg_chart_guard BEFORE INSERT OR UPDATE ON public.ipd_vitals
  FOR EACH ROW EXECUTE FUNCTION public.ipd_chart_row_guard('recorded_at');

DROP TRIGGER IF EXISTS trg_chart_guard ON public.ipd_intake_output;
CREATE TRIGGER trg_chart_guard BEFORE INSERT OR UPDATE ON public.ipd_intake_output
  FOR EACH ROW EXECUTE FUNCTION public.ipd_chart_row_guard('recorded_at');

DROP TRIGGER IF EXISTS trg_chart_guard ON public.ipd_nursing_notes;
CREATE TRIGGER trg_chart_guard BEFORE INSERT OR UPDATE ON public.ipd_nursing_notes
  FOR EACH ROW EXECUTE FUNCTION public.ipd_chart_row_guard('created_at');

-- ---------------------------------------------------------------------------
-- 5. Trail writer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ipd_log_chart_amendment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_before  jsonb := to_jsonb(OLD);
  v_after   jsonb;
  v_reason  text;
  v_changed text[] := '{}';
  k text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_after  := to_jsonb(NEW);
    v_reason := NEW.amendment_reason;
    FOR k IN SELECT jsonb_object_keys(v_before) LOOP
      IF k NOT IN ('updated_at', 'updated_by', 'amendment_reason')
         AND (v_before -> k) IS DISTINCT FROM (v_after -> k) THEN
        v_changed := array_append(v_changed, k);
      END IF;
    END LOOP;
    -- Setting only the reason (what delete_ipd_chart_row does on its way to
    -- the DELETE) is not itself an amendment.
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NULL;
    END IF;
  ELSE
    v_reason := OLD.amendment_reason;
  END IF;

  INSERT INTO public.ipd_chart_amendments (
    clinic_id, admission_id, source_table, source_id, action,
    reason, before_row, after_row, changed_fields, amended_by
  ) VALUES (
    OLD.clinic_id, OLD.admission_id, TG_TABLE_NAME, OLD.id, lower(TG_OP),
    v_reason, v_before, v_after, v_changed, auth.uid()
  );

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_chart_amendment_log ON public.ipd_vitals;
CREATE TRIGGER trg_chart_amendment_log AFTER UPDATE OR DELETE ON public.ipd_vitals
  FOR EACH ROW EXECUTE FUNCTION public.ipd_log_chart_amendment();

DROP TRIGGER IF EXISTS trg_chart_amendment_log ON public.ipd_intake_output;
CREATE TRIGGER trg_chart_amendment_log AFTER UPDATE OR DELETE ON public.ipd_intake_output
  FOR EACH ROW EXECUTE FUNCTION public.ipd_log_chart_amendment();

DROP TRIGGER IF EXISTS trg_chart_amendment_log ON public.ipd_nursing_notes;
CREATE TRIGGER trg_chart_amendment_log AFTER UPDATE OR DELETE ON public.ipd_nursing_notes
  FOR EACH ROW EXECUTE FUNCTION public.ipd_log_chart_amendment();

-- ---------------------------------------------------------------------------
-- 6. Split the blanket FOR ALL policies
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ipd_vitals', 'ipd_intake_output', 'ipd_nursing_notes'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_write ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS chart_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS chart_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS chart_delete ON public.%I', t);

    EXECUTE format(
      'CREATE POLICY chart_insert ON public.%I FOR INSERT TO authenticated
         WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids())
                     AND public.ipd_can_chart())', t);

    EXECUTE format(
      'CREATE POLICY chart_update ON public.%I FOR UPDATE TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids())
                AND public.user_has_permission(''ipd_vitals_amend''))
         WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids())
                     AND public.user_has_permission(''ipd_vitals_amend''))', t);

    EXECUTE format(
      'CREATE POLICY chart_delete ON public.%I FOR DELETE TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids())
                AND public.user_has_permission(''ipd_vitals_amend''))', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7. The app's amend / delete path
--
--    SECURITY DEFINER, so the checks below -- not RLS -- are what gate these.
--    They are deliberately stricter than the policies: a reason is mandatory
--    and the identity/provenance columns cannot be moved by the patch.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.amend_ipd_chart_row(
  p_table text, p_id uuid, p_patch jsonb, p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_clinic uuid;
  v_patch  jsonb;
  v_vitals public.ipd_vitals%ROWTYPE;
  v_io     public.ipd_intake_output%ROWTYPE;
  v_note   public.ipd_nursing_notes%ROWTYPE;
BEGIN
  IF p_table NOT IN ('ipd_vitals', 'ipd_intake_output', 'ipd_nursing_notes') THEN
    RAISE EXCEPTION 'Not an amendable chart table';
  END IF;
  IF nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A correction reason is required';
  END IF;
  IF NOT public.user_has_permission('ipd_vitals_amend') THEN
    RAISE EXCEPTION 'Not permitted to amend a charted entry';
  END IF;

  -- Identity, tenancy and provenance are never the caller's to rewrite.
  v_patch := coalesce(p_patch, '{}'::jsonb)
             - 'id' - 'clinic_id' - 'admission_id' - 'charted_at'
             - 'updated_at' - 'updated_by' - 'amendment_reason';

  IF p_table = 'ipd_vitals' THEN
    SELECT * INTO v_vitals FROM ipd_vitals WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
    v_clinic := v_vitals.clinic_id;
    IF NOT (v_clinic IN (SELECT public.user_clinic_ids())) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    -- recorded_by stays with whoever charted it; an amendment is attributed
    -- through the trail, not by rewriting the original signature.
    v_vitals := jsonb_populate_record(v_vitals, v_patch - 'recorded_by' - 'created_at');
    UPDATE ipd_vitals SET
      recorded_at = v_vitals.recorded_at, temperature = v_vitals.temperature,
      pulse = v_vitals.pulse, resp_rate = v_vitals.resp_rate,
      bp_systolic = v_vitals.bp_systolic, bp_diastolic = v_vitals.bp_diastolic,
      spo2 = v_vitals.spo2, pain_score = v_vitals.pain_score, gcs = v_vitals.gcs,
      blood_sugar = v_vitals.blood_sugar, weight_kg = v_vitals.weight_kg,
      extra = v_vitals.extra, amendment_reason = p_reason
    WHERE id = p_id;

  ELSIF p_table = 'ipd_intake_output' THEN
    SELECT * INTO v_io FROM ipd_intake_output WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
    v_clinic := v_io.clinic_id;
    IF NOT (v_clinic IN (SELECT public.user_clinic_ids())) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    v_io := jsonb_populate_record(v_io, v_patch - 'recorded_by' - 'created_at');
    UPDATE ipd_intake_output SET
      recorded_at = v_io.recorded_at, io_type = v_io.io_type, route = v_io.route,
      volume_ml = v_io.volume_ml, notes = v_io.notes, amendment_reason = p_reason
    WHERE id = p_id;

  ELSE
    SELECT * INTO v_note FROM ipd_nursing_notes WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
    v_clinic := v_note.clinic_id;
    IF NOT (v_clinic IN (SELECT public.user_clinic_ids())) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    -- created_at IS the clinical time on a nursing note, so unlike the other
    -- two tables the patch is allowed to move it.
    v_note := jsonb_populate_record(v_note, v_patch - 'created_by');
    UPDATE ipd_nursing_notes SET
      created_at = v_note.created_at, note_type = v_note.note_type,
      note = v_note.note, amendment_reason = p_reason
    WHERE id = p_id;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.amend_ipd_chart_row(text, uuid, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.amend_ipd_chart_row(text, uuid, jsonb, text) TO authenticated;

-- Deleting is a two-step on purpose: stamp the reason, then remove the row, so
-- the AFTER DELETE trigger has a reason to file. The intermediate UPDATE
-- changes no clinical field, so it logs nothing of its own.
CREATE OR REPLACE FUNCTION public.delete_ipd_chart_row(
  p_table text, p_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_clinic uuid;
BEGIN
  IF p_table NOT IN ('ipd_vitals', 'ipd_intake_output', 'ipd_nursing_notes') THEN
    RAISE EXCEPTION 'Not an amendable chart table';
  END IF;
  IF nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to strike a charted entry';
  END IF;
  IF NOT public.user_has_permission('ipd_vitals_amend') THEN
    RAISE EXCEPTION 'Not permitted to strike a charted entry';
  END IF;

  EXECUTE format(
    'UPDATE public.%I SET amendment_reason = $1
      WHERE id = $2 AND clinic_id IN (SELECT public.user_clinic_ids())
      RETURNING clinic_id', p_table)
    INTO v_clinic USING p_reason, p_id;
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'Entry not found'; END IF;

  EXECUTE format('DELETE FROM public.%I WHERE id = $1', p_table) USING p_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.delete_ipd_chart_row(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_ipd_chart_row(text, uuid, text) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- Policies are split, not FOR ALL:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('ipd_vitals','ipd_intake_output','ipd_nursing_notes')
--    ORDER BY tablename, cmd;
--
-- Late charting is visible:
--   SELECT recorded_at, charted_at, charted_at - recorded_at AS lag
--     FROM ipd_vitals WHERE charted_at - recorded_at > interval '15 minutes';
--
-- Who holds the amend key:
--   SELECT name, 'ipd_vitals_amend' = ANY(permissions) FROM roles ORDER BY name;
--
-- The trail:
--   SELECT amended_at, source_table, action, changed_fields, reason
--     FROM ipd_chart_amendments WHERE admission_id = '<id>' ORDER BY amended_at DESC;
--
-- Staff must sign out and back in -- profiles.permissions is read at login.
--
-- ROLLBACK:
--   DROP TRIGGER trg_chart_guard/trg_chart_amendment_log on the three tables,
--   restore the single 'tenant_write' FOR ALL policy from
--   20260707100005_nursing.sql, then DROP TABLE public.ipd_chart_amendments.
