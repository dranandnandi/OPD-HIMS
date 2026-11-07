-- Suggestions are separate from medicine master until a pharmacist confirms them.
BEGIN;

CREATE TABLE IF NOT EXISTS public.medicine_generic_name_reviews (
  medicine_id uuid PRIMARY KEY REFERENCES public.medicines_master(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  input_snapshot jsonb NOT NULL,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_version text NOT NULL,
  source_url text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'no_match', 'verified')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  generic_name text,
  selected_source_id text,
  verified_at timestamptz,
  verified_by uuid REFERENCES public.profiles(id)
);
CREATE INDEX IF NOT EXISTS medicine_generic_name_reviews_clinic_id_status_idx ON public.medicine_generic_name_reviews(clinic_id, status);
ALTER TABLE public.medicine_generic_name_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS generic_name_review_read ON public.medicine_generic_name_reviews;
CREATE POLICY generic_name_review_read ON public.medicine_generic_name_reviews FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));
GRANT SELECT ON public.medicine_generic_name_reviews TO authenticated;
-- Only the RPC can set verification identity or alter lookup history.
REVOKE INSERT, UPDATE, DELETE ON public.medicine_generic_name_reviews FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.pharmacy_generic_name_review(p_action text, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  item jsonb; med public.medicines_master%ROWTYPE; previous public.medicine_generic_name_reviews%ROWTYPE;
  snapshot jsonb; results jsonb := '[]'::jsonb; value text; actor public.profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to review generic names'; END IF;
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF NOT (
    lower(coalesce(actor.role_name, '')) IN ('admin','super_admin') OR
    coalesce(actor.permissions, '{}') && ARRAY['all','admin','master_data_management','pharmacy']::text[] OR
    -- Match the existing OPD legacy-role fallback in modulePermissions.ts.
    NOT (coalesce(actor.permissions, '{}') && ARRAY['modules_assigned','opd_appointments','opd_patients','opd_visits','opd_followups','opd_billing','opd_collections','pharmacy','gmb_reviews','chatbots','analytics']::text[])
  ) THEN RAISE EXCEPTION 'Pharmacy or master data access is required'; END IF;
  IF p_action NOT IN ('lookup','save') OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid review action'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected a list of medicines'; END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Review between 1 and 10 medicines at a time'; END IF;
  IF pg_column_size(p_rows) > 200000 THEN RAISE EXCEPTION 'Review payload is too large'; END IF;
  IF (SELECT count(DISTINCT x->>'medicine_id') FROM jsonb_array_elements(p_rows) x) <> jsonb_array_length(p_rows)
    THEN RAISE EXCEPTION 'Duplicate or missing medicine IDs'; END IF;

  -- Consistent lock order prevents two pharmacists processing overlapping batches from deadlocking.
  FOR item IN SELECT x FROM jsonb_array_elements(p_rows) x ORDER BY x->>'medicine_id' LOOP
    SELECT * INTO med FROM public.medicines_master WHERE id = (item->>'medicine_id')::uuid FOR UPDATE;
    IF NOT FOUND OR med.clinic_id IS DISTINCT FROM actor.clinic_id OR med.clinic_id NOT IN (SELECT public.user_clinic_ids())
      THEN RAISE EXCEPTION 'Medicine is outside your clinic'; END IF;
    snapshot := jsonb_build_object('name', btrim(med.name), 'brand_name', btrim(coalesce(med.brand_name,'')),
      'strength', btrim(coalesce(med.strength,'')), 'dosage_form', btrim(coalesce(med.dosage_form,'')), 'manufacturer', btrim(coalesce(med.manufacturer,'')));
    IF NOT med.is_active OR nullif(btrim(med.generic_name), '') IS NOT NULL THEN
      results := results || jsonb_build_array(jsonb_build_object('medicine_id',med.id,'result','already_filled'));
      CONTINUE;
    END IF;
    IF snapshot IS DISTINCT FROM item->'input_snapshot' THEN
      results := results || jsonb_build_array(jsonb_build_object('medicine_id',med.id,'result','changed'));
      CONTINUE;
    END IF;

    SELECT * INTO previous FROM public.medicine_generic_name_reviews WHERE medicine_id = med.id;
    IF p_action = 'lookup' THEN
      -- Reopening the same SKU never consumes another lookup, including no-match results.
      IF previous.input_snapshot IS DISTINCT FROM snapshot THEN
        IF jsonb_typeof(item->'candidates') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'candidates') > 5
          THEN RAISE EXCEPTION 'Invalid candidate list'; END IF;
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
        IF nullif(item->>'source_version','') IS NULL OR nullif(item->>'source_url','') IS NULL
          THEN RAISE EXCEPTION 'Reference source is required'; END IF;
        INSERT INTO public.medicine_generic_name_reviews(medicine_id,clinic_id,input_snapshot,candidates,source_version,source_url,status)
          VALUES(med.id,med.clinic_id,snapshot,item->'candidates',item->>'source_version',item->>'source_url',
            CASE WHEN jsonb_array_length(item->'candidates') = 0 THEN 'no_match' ELSE 'pending' END)
          ON CONFLICT(medicine_id) DO UPDATE SET input_snapshot=excluded.input_snapshot,candidates=excluded.candidates,
            source_version=excluded.source_version,source_url=excluded.source_url,status=excluded.status,checked_at=now(),
            generic_name=NULL,selected_source_id=NULL,verified_at=NULL,verified_by=NULL;
      END IF;
      results := results || jsonb_build_array(jsonb_build_object('medicine_id',med.id,'result','recorded'));
    ELSE
      IF previous.medicine_id IS NULL OR previous.input_snapshot IS DISTINCT FROM snapshot
        THEN RAISE EXCEPTION 'Look up the current medicine before verifying it'; END IF;
      IF item->>'verified' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Pharmacist verification is required'; END IF;
      value := btrim(coalesce(item->>'generic_name',''));
      IF length(value) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'Enter a generic name between 2 and 500 characters'; END IF;
      IF nullif(item->>'selected_source_id','') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(previous.candidates) c WHERE c->>'id' = item->>'selected_source_id'
      ) THEN RAISE EXCEPTION 'Selected product is not in the reviewed candidates'; END IF;
      UPDATE public.medicines_master SET generic_name=value,updated_at=now() WHERE id=med.id AND nullif(btrim(generic_name),'') IS NULL;
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
COMMIT;
