BEGIN;

-- Receipts make a retry safe when the transaction committed but its HTTP
-- response was lost. Store a fingerprint, not another copy of clinical data.
CREATE TABLE public.visit_save_receipts (
  request_id uuid PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
  visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.visit_save_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY visit_save_receipts_clinic ON public.visit_save_receipts
  FOR ALL TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid()));
-- Supabase projects can grant privileges through ALTER DEFAULT PRIVILEGES.
-- Remove those explicit grants as well as PUBLIC before granting only what's needed.
REVOKE ALL ON public.visit_save_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.visit_save_receipts TO authenticated;

CREATE FUNCTION public.save_visit_with_details(
  p_visit_id uuid,
  p_visit jsonb,
  p_details jsonb,
  p_request_id uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  clinic uuid;
  target_visit_id uuid;
  previous public.visits%ROWTYPE;
  proposed public.visits%ROWTYPE;
  receipt public.visit_save_receipts%ROWTYPE;
  fingerprint text;
  item jsonb;
  test_row public.tests_ordered%ROWTYPE;
  kept_tests uuid[] := ARRAY[]::uuid[];
  affected integer;
  section text;
BEGIN
  SELECT clinic_id INTO clinic FROM public.profiles WHERE id = auth.uid();
  IF clinic IS NULL THEN RAISE EXCEPTION 'User not assigned to a clinic'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_visit) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_details) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid visit save request';
  END IF;
  FOR section IN SELECT jsonb_object_keys(p_details) LOOP
    IF section NOT IN ('symptoms', 'diagnoses', 'prescriptions', 'tests_ordered', 'test_results')
      OR jsonb_typeof(p_details->section) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid visit detail section: %', section;
    END IF;
  END LOOP;

  fingerprint := md5(jsonb_build_array(p_visit_id, p_visit, p_details, p_expected_updated_at)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT * INTO receipt FROM public.visit_save_receipts WHERE request_id = p_request_id;
  IF FOUND THEN
    IF receipt.clinic_id <> clinic OR receipt.payload_hash <> fingerprint THEN
      RAISE EXCEPTION 'Save request was reused with different data';
    END IF;
    RETURN receipt.visit_id;
  END IF;

  IF p_visit_id IS NOT NULL THEN
    SELECT * INTO previous FROM public.visits
      WHERE id = p_visit_id AND clinic_id = clinic FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Visit not found or access denied'; END IF;
    IF p_expected_updated_at IS NOT NULL AND previous.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'This visit changed since you opened it. Reopen the visit before saving to avoid overwriting newer details';
    END IF;
  ELSE
    previous.id := COALESCE((p_visit->>'id')::uuid, gen_random_uuid());
    IF EXISTS (SELECT 1 FROM public.visits WHERE id = previous.id AND clinic_id = clinic) THEN
      RAISE EXCEPTION 'A visit from this form was already saved. Reopen that visit to apply further changes';
    END IF;
    previous.date := now();
    previous.advice := ARRAY[]::text[];
    previous.advice_language := 'english';
    previous.physical_examination := '{}'::jsonb;
  END IF;
  proposed := jsonb_populate_record(previous, p_visit);
  target_visit_id := previous.id;
  IF proposed.patient_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.patients WHERE id = proposed.patient_id AND clinic_id = clinic
  ) THEN RAISE EXCEPTION 'Patient not found in your clinic'; END IF;
  IF proposed.doctor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = proposed.doctor_id AND clinic_id = clinic
  ) THEN RAISE EXCEPTION 'Doctor not found in your clinic'; END IF;
  IF proposed.appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments WHERE id = proposed.appointment_id
      AND clinic_id = clinic AND patient_id = proposed.patient_id
  ) THEN RAISE EXCEPTION 'Appointment does not belong to this patient and clinic'; END IF;

  IF p_visit_id IS NULL THEN
    INSERT INTO public.visits (id, clinic_id, patient_id, doctor_id, appointment_id,
      visit_type, date, chief_complaint, vitals, advice, advice_language, advice_regional,
      follow_up_date, physical_examination, doctor_notes, case_image_url, visit_images)
    VALUES (target_visit_id, clinic, proposed.patient_id, proposed.doctor_id, proposed.appointment_id,
      proposed.visit_type, proposed.date, proposed.chief_complaint, proposed.vitals,
      proposed.advice, proposed.advice_language, proposed.advice_regional, proposed.follow_up_date,
      proposed.physical_examination, proposed.doctor_notes, proposed.case_image_url, proposed.visit_images);
  ELSE
    UPDATE public.visits SET patient_id = proposed.patient_id, doctor_id = proposed.doctor_id,
      appointment_id = proposed.appointment_id, visit_type = proposed.visit_type,
      date = proposed.date, chief_complaint = proposed.chief_complaint, vitals = proposed.vitals,
      advice = proposed.advice, advice_language = proposed.advice_language, advice_regional = proposed.advice_regional,
      follow_up_date = proposed.follow_up_date, physical_examination = proposed.physical_examination,
      doctor_notes = proposed.doctor_notes, case_image_url = proposed.case_image_url,
      visit_images = proposed.visit_images, pdf_url = NULL, print_pdf_url = NULL,
      compact_print_pdf_url = NULL, updated_at = clock_timestamp()
    WHERE id = target_visit_id AND clinic_id = clinic;
    IF NOT FOUND THEN RAISE EXCEPTION 'Visit update denied'; END IF;
  END IF;

  IF p_details ? 'symptoms' THEN
    DELETE FROM public.symptoms WHERE symptoms.visit_id = target_visit_id AND clinic_id = clinic;
    INSERT INTO public.symptoms (visit_id, clinic_id, name, severity, duration, notes)
    SELECT target_visit_id, clinic, r.name, r.severity, r.duration, r.notes
    FROM jsonb_populate_recordset(NULL::public.symptoms, p_details->'symptoms') r;
    IF (SELECT count(*) FROM public.symptoms s WHERE s.visit_id = target_visit_id AND s.clinic_id = clinic)
      <> jsonb_array_length(p_details->'symptoms') THEN RAISE EXCEPTION 'Could not save all symptoms'; END IF;
  END IF;
  IF p_details ? 'diagnoses' THEN
    DELETE FROM public.diagnoses WHERE diagnoses.visit_id = target_visit_id AND clinic_id = clinic;
    INSERT INTO public.diagnoses (visit_id, clinic_id, name, icd10_code, is_primary, notes)
    SELECT target_visit_id, clinic, r.name, r.icd10_code, COALESCE(r.is_primary, false), r.notes
    FROM jsonb_populate_recordset(NULL::public.diagnoses, p_details->'diagnoses') r;
    IF (SELECT count(*) FROM public.diagnoses d WHERE d.visit_id = target_visit_id AND d.clinic_id = clinic)
      <> jsonb_array_length(p_details->'diagnoses') THEN RAISE EXCEPTION 'Could not save all diagnoses'; END IF;
  END IF;
  IF p_details ? 'prescriptions' THEN
    DELETE FROM public.prescriptions WHERE prescriptions.visit_id = target_visit_id AND clinic_id = clinic;
    INSERT INTO public.prescriptions (visit_id, clinic_id, medicine, dosage, frequency, duration,
      instructions, quantity, refills, route)
    SELECT target_visit_id, clinic, r.medicine, r.dosage, r.frequency, r.duration, r.instructions,
      r.quantity, COALESCE(r.refills, 0), r.route
    FROM jsonb_populate_recordset(NULL::public.prescriptions, p_details->'prescriptions') r;
    IF (SELECT count(*) FROM public.prescriptions p WHERE p.visit_id = target_visit_id AND p.clinic_id = clinic)
      <> jsonb_array_length(p_details->'prescriptions') THEN RAISE EXCEPTION 'Could not save all prescriptions'; END IF;
  END IF;

  -- Preserve existing IDs, master-test links and result references. Never
  -- delete/reinsert an unchanged test just because another field was edited.
  IF p_details ? 'tests_ordered' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(p_details->'tests_ordered') LOOP
      test_row := jsonb_populate_record(NULL::public.tests_ordered, item);
      IF NULLIF(btrim(test_row."testName"), '') IS NULL THEN
        RAISE EXCEPTION 'Every test needs a name; remove empty test rows';
      END IF;
      IF test_row.test_type IS NULL OR test_row.urgency IS NULL OR test_row.status IS NULL THEN
        RAISE EXCEPTION 'Every test needs a type, urgency and status';
      END IF;
      test_row.id := COALESCE(test_row.id, gen_random_uuid());
      IF test_row.id = ANY(kept_tests) THEN RAISE EXCEPTION 'Duplicate test row'; END IF;
      kept_tests := array_append(kept_tests, test_row.id);
      INSERT INTO public.tests_ordered (id, visit_id, clinic_id, test_id, "testName", test_type,
        instructions, urgency, status, ordered_date, expected_date)
      VALUES (test_row.id, target_visit_id, clinic, test_row.test_id, btrim(test_row."testName"), test_row.test_type,
        test_row.instructions, test_row.urgency, test_row.status,
        COALESCE(test_row.ordered_date, now()), test_row.expected_date)
      ON CONFLICT (id) DO UPDATE SET "testName" = EXCLUDED."testName", test_type = EXCLUDED.test_type,
        test_id = CASE WHEN item ? 'test_id' THEN EXCLUDED.test_id ELSE tests_ordered.test_id END,
        instructions = EXCLUDED.instructions, urgency = EXCLUDED.urgency, status = EXCLUDED.status,
        ordered_date = EXCLUDED.ordered_date, expected_date = EXCLUDED.expected_date
      WHERE tests_ordered.visit_id = target_visit_id AND tests_ordered.clinic_id = clinic;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'Test does not belong to this visit'; END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM public.tests_ordered t JOIN public.test_results r ON r.test_ordered_id = t.id
      WHERE t.visit_id = target_visit_id AND t.clinic_id = clinic AND NOT (t.id = ANY(kept_tests))
    ) THEN RAISE EXCEPTION 'A test with saved results cannot be removed. Keep this test in the visit'; END IF;
    DELETE FROM public.tests_ordered t
      WHERE t.visit_id = target_visit_id AND t.clinic_id = clinic AND NOT (t.id = ANY(kept_tests));
    IF (SELECT count(*) FROM public.tests_ordered t WHERE t.visit_id = target_visit_id AND t.clinic_id = clinic)
      <> cardinality(kept_tests) THEN RAISE EXCEPTION 'Could not save all tests'; END IF;
  END IF;

  -- Results are created only with a new visit; editing the visit must not
  -- overwrite results delivered independently by the lab.
  IF p_details ? 'test_results' THEN
    IF p_visit_id IS NOT NULL THEN RAISE EXCEPTION 'Use the results workflow to change test results'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_details->'test_results') r
      WHERE NOT EXISTS (SELECT 1 FROM public.tests_ordered t
        WHERE t.id = (r->>'test_ordered_id')::uuid AND t.visit_id = target_visit_id AND t.clinic_id = clinic))
    THEN RAISE EXCEPTION 'Result does not belong to a test in this visit'; END IF;
    INSERT INTO public.test_results (id, visit_id, clinic_id, test_ordered_id, result, normal_range,
      is_abnormal, result_date, report_url)
    SELECT COALESCE(r.id, gen_random_uuid()), target_visit_id, clinic, r.test_ordered_id, r.result,
      r.normal_range, r.is_abnormal, r.result_date, r.report_url
    FROM jsonb_populate_recordset(NULL::public.test_results, p_details->'test_results') r;
  END IF;

  INSERT INTO public.visit_save_receipts (request_id, clinic_id, visit_id, payload_hash)
    VALUES (p_request_id, clinic, target_visit_id, fingerprint);
  RETURN target_visit_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_visit_with_details(uuid, jsonb, jsonb, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_visit_with_details(uuid, jsonb, jsonb, uuid, timestamptz) TO authenticated;

COMMIT;
