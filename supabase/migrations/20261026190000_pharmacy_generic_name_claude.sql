-- Revalidate legacy community suggestions once with a source-backed Claude lookup.
-- Verified generic names and pharmacist identity remain protected.
BEGIN;
CREATE OR REPLACE FUNCTION public.pharmacy_generic_name_review(p_action text, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  item jsonb; med public.medicines_master%ROWTYPE; previous public.medicine_generic_name_reviews%ROWTYPE;
  snapshot jsonb; provided_snapshot jsonb; previous_snapshot jsonb;
  results jsonb := '[]'::jsonb; value text; actor public.profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to review generic names'; END IF;
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF NOT (
    lower(coalesce(actor.role_name, '')) IN ('admin','super_admin') OR
    coalesce(actor.permissions, '{}') && ARRAY['all','admin','master_data_management','pharmacy']::text[] OR
    NOT (coalesce(actor.permissions, '{}') && ARRAY['modules_assigned','opd_appointments','opd_patients','opd_visits','opd_followups','opd_billing','opd_collections','pharmacy','gmb_reviews','chatbots','analytics']::text[])
  ) THEN RAISE EXCEPTION 'Pharmacy or master data access is required'; END IF;
  IF p_action NOT IN ('lookup','save') OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid review action'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected a list of medicines'; END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Review between 1 and 10 medicines at a time'; END IF;
  IF pg_column_size(p_rows) > 200000 THEN RAISE EXCEPTION 'Review payload is too large'; END IF;
  IF (SELECT count(DISTINCT x->>'medicine_id') FROM jsonb_array_elements(p_rows) x) <> jsonb_array_length(p_rows)
    THEN RAISE EXCEPTION 'Duplicate or missing medicine IDs'; END IF;

  FOR item IN SELECT x FROM jsonb_array_elements(p_rows) x ORDER BY x->>'medicine_id' LOOP
    SELECT * INTO med FROM public.medicines_master WHERE id = (item->>'medicine_id')::uuid FOR UPDATE;
    IF NOT FOUND OR med.clinic_id IS DISTINCT FROM actor.clinic_id OR med.clinic_id NOT IN (SELECT public.user_clinic_ids())
      THEN RAISE EXCEPTION 'Medicine is outside your clinic'; END IF;
    snapshot := jsonb_build_object('name', btrim(med.name), 'brand_name', btrim(coalesce(med.brand_name,'')),
      'strength', btrim(coalesce(med.strength,'')), 'dosage_form', btrim(coalesce(med.dosage_form::text,'')),
      'manufacturer', btrim(coalesce(med.manufacturer,'')), 'generic_name', btrim(coalesce(med.generic_name,'')));
    SELECT * INTO previous FROM public.medicine_generic_name_reviews WHERE medicine_id = med.id;
    -- Existing five-field snapshots were created for empty generic names.
    previous_snapshot := previous.input_snapshot || jsonb_build_object('generic_name',coalesce(previous.input_snapshot->>'generic_name',''));
    IF NOT med.is_active OR NOT public.pharmacy_generic_name_needs_review(med.name,med.brand_name,med.generic_name) OR (
      previous.status = 'verified' AND nullif(btrim(med.generic_name),'') IS NOT NULL AND
      btrim(previous.generic_name) = btrim(med.generic_name) AND
      (previous.input_snapshot - 'generic_name') = (snapshot - 'generic_name')
    ) THEN
      results := results || jsonb_build_array(jsonb_build_object('medicine_id',med.id,'result','already_filled'));
      CONTINUE;
    END IF;
    IF jsonb_typeof(item->'input_snapshot') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Medicine input snapshot is required'; END IF;
    provided_snapshot := item->'input_snapshot' || jsonb_build_object('generic_name',coalesce(item->'input_snapshot'->>'generic_name',''));
    IF snapshot IS DISTINCT FROM provided_snapshot THEN
      results := results || jsonb_build_array(jsonb_build_object('medicine_id',med.id,'result','changed'));
      CONTINUE;
    END IF;

    IF p_action = 'lookup' THEN
      IF previous_snapshot IS DISTINCT FROM snapshot OR (coalesce(item->>'source_version','') LIKE 'claude-%' AND previous.source_version NOT LIKE 'claude-%' AND previous.status <> 'verified') THEN
        IF jsonb_typeof(item->'candidates') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid candidate list'; END IF;
        IF jsonb_array_length(item->'candidates') > 5 THEN RAISE EXCEPTION 'Invalid candidate list'; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(item->'candidates') c WHERE
          jsonb_typeof(c) IS DISTINCT FROM 'object' OR
          jsonb_typeof(c->'id') IS DISTINCT FROM 'string' OR nullif(c->>'id','') IS NULL OR
          jsonb_typeof(c->'name') IS DISTINCT FROM 'string' OR
          jsonb_typeof(c->'genericName') IS DISTINCT FROM 'string' OR nullif(btrim(c->>'genericName'),'') IS NULL OR
          jsonb_typeof(c->'composition') IS DISTINCT FROM 'string' OR
          jsonb_typeof(c->'manufacturer') IS DISTINCT FROM 'string' OR
          jsonb_typeof(c->'pack') IS DISTINCT FROM 'string' OR
          jsonb_typeof(c->'match') IS DISTINCT FROM 'string' OR
          jsonb_typeof(c->'score') IS DISTINCT FROM 'number'
        ) THEN RAISE EXCEPTION 'Invalid medicine candidate'; END IF;
        IF nullif(item->>'source_version','') IS NULL OR nullif(item->>'source_url','') IS NULL THEN RAISE EXCEPTION 'Reference source is required'; END IF;
        INSERT INTO public.medicine_generic_name_reviews(medicine_id,clinic_id,input_snapshot,candidates,source_version,source_url,status,previous_generic_name)
          VALUES(med.id,med.clinic_id,snapshot,item->'candidates',item->>'source_version',item->>'source_url',
            CASE WHEN jsonb_array_length(item->'candidates') = 0 THEN 'no_match' ELSE 'pending' END,med.generic_name)
          ON CONFLICT(medicine_id) DO UPDATE SET input_snapshot=excluded.input_snapshot,candidates=excluded.candidates,
            source_version=excluded.source_version,source_url=excluded.source_url,status=excluded.status,checked_at=now(),
            previous_generic_name=excluded.previous_generic_name,generic_name=NULL,selected_source_id=NULL,verified_at=NULL,verified_by=NULL;
      END IF;
      results := results || jsonb_build_array(jsonb_build_object('medicine_id',med.id,'result','recorded','source_version',(SELECT r.source_version FROM public.medicine_generic_name_reviews r WHERE r.medicine_id=med.id)));
    ELSE
      IF previous.medicine_id IS NULL OR previous_snapshot IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Look up the current medicine before verifying it'; END IF;
      IF item->>'verified' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Pharmacist verification is required'; END IF;
      value := btrim(coalesce(item->>'generic_name',''));
      IF length(value) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'Enter a generic name between 2 and 500 characters'; END IF;
      IF nullif(item->>'selected_source_id','') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(previous.candidates) c WHERE c->>'id' = item->>'selected_source_id'
      ) THEN RAISE EXCEPTION 'Selected product is not in the reviewed candidates'; END IF;
      UPDATE public.medicines_master SET generic_name=value,updated_at=now()
        WHERE id=med.id AND generic_name IS NOT DISTINCT FROM med.generic_name;
      UPDATE public.medicine_generic_name_reviews SET status='verified',generic_name=value,
        selected_source_id=nullif(item->>'selected_source_id',''),verified_at=now(),verified_by=auth.uid() WHERE medicine_id=med.id;
      results := results || jsonb_build_array(jsonb_build_object('medicine_id',med.id,'result','saved'));
    END IF;
  END LOOP;
  RETURN results;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pharmacy_generic_name_review(text,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pharmacy_generic_name_review(text,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;


