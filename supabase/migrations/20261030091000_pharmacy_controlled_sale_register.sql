BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.medicines_master
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_nrx boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_schedule_h1 boolean NOT NULL DEFAULT false;
ALTER TABLE public.pharmacy_dispensed_items ADD COLUMN IF NOT EXISTS controlled_sale_details jsonb;

-- Common authorization for pharmacy operations, including legacy OPD roles.
CREATE FUNCTION public.require_pharmacy_clinic() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to access pharmacy records'; END IF;
  SELECT * INTO actor FROM public.profiles WHERE id=auth.uid();
  IF NOT FOUND OR actor.clinic_id IS NULL OR actor.clinic_id NOT IN (SELECT public.user_clinic_ids())
    THEN RAISE EXCEPTION 'Clinic access is required'; END IF;
  IF NOT (
    lower(coalesce(actor.role_name,'')) IN ('admin','super_admin') OR
    coalesce(actor.permissions,'{}') && ARRAY['all','admin','master_data_management','pharmacy']::text[] OR
    NOT (coalesce(actor.permissions,'{}') && ARRAY['modules_assigned','opd_appointments','opd_patients','opd_visits','opd_followups','opd_billing','opd_collections','pharmacy','gmb_reviews','chatbots','analytics']::text[])
  ) THEN RAISE EXCEPTION 'Pharmacy or master data access is required'; END IF;
  RETURN actor.clinic_id;
END; $$;
REVOKE ALL ON FUNCTION public.require_pharmacy_clinic() FROM PUBLIC, anon, authenticated;

-- Deliberately no cascading reference to mutable patient, product, invoice or
-- dispense rows. Subsequent edits, refunds and merges cannot erase a supply.
CREATE TABLE public.pharmacy_controlled_sales (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE RESTRICT,
  clinic_name text NOT NULL,
  drug_license_number text,
  dispensed_item_id uuid NOT NULL UNIQUE,
  medicine_id uuid NOT NULL,
  supplied_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL,
  is_nrx boolean NOT NULL,
  is_schedule_h1 boolean NOT NULL,
  medicine_name text NOT NULL,
  manufacturer text,
  batch_number text,
  expiry_date date,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  mrp numeric,
  bill_number text,
  details jsonb NOT NULL
);
CREATE INDEX ON public.pharmacy_controlled_sales(clinic_id,supplied_at,id);
ALTER TABLE public.pharmacy_controlled_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_controlled_sales FROM PUBLIC, anon, authenticated;
-- Reads also go through the permission-checked, paginated RPC below.

CREATE FUNCTION public.record_pharmacy_controlled_supply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE med public.medicines_master%ROWTYPE; clinic uuid; field text; details jsonb;
  batch public.medicine_batches%ROWTYPE; invoice text; facility record;
BEGIN
  -- Serialize against product flag changes and merges before deciding whether
  -- a register entry is required. Client-provided flags are never trusted.
  SELECT * INTO med FROM public.medicines_master WHERE id=NEW.medicine_id FOR UPDATE;
  IF NOT med.is_nrx AND NOT med.is_schedule_h1 THEN RETURN NEW; END IF;
  clinic := public.require_pharmacy_clinic();
  SELECT clinic_name,drug_license_number INTO facility FROM public.clinic_settings WHERE id=clinic;
  IF med.clinic_id IS DISTINCT FROM clinic OR NEW.clinic_id IS DISTINCT FROM clinic OR NEW.dispensed_by IS DISTINCT FROM auth.uid()
    THEN RAISE EXCEPTION 'Supply must be recorded by the signed-in pharmacist in their clinic'; END IF;
  details := NEW.controlled_sale_details;
  IF jsonb_typeof(details) IS DISTINCT FROM 'object' OR pg_column_size(details)>16000
    THEN RAISE EXCEPTION 'Prescription details are required for NRx / H1 supply'; END IF;
  IF details->>'prescriptionVerified' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION 'Verify the prescription before supplying NRx / H1 medicines'; END IF;
  FOREACH field IN ARRAY ARRAY['patientName','patientAddress','prescriberName','prescriberAddress',
    'prescriptionReference','prescriptionDate','pharmacistName','pharmacistRegistration'] LOOP
    IF jsonb_typeof(details->field) IS DISTINCT FROM 'string' OR nullif(btrim(details->>field),'') IS NULL
      OR length(details->>field)>2000 THEN RAISE EXCEPTION 'Required prescription detail: %',field; END IF;
  END LOOP;
  IF details->>'prescriptionDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Enter a valid prescription date'; END IF;
  IF (details->>'prescriptionDate')::date > (now() AT TIME ZONE 'Asia/Kolkata')::date
    THEN RAISE EXCEPTION 'Prescription date cannot be in the future'; END IF;
  IF NEW.quantity <= 0 THEN RAISE EXCEPTION 'Supply quantity must be positive'; END IF;
  IF NEW.batch_id IS NOT NULL THEN
    SELECT * INTO batch FROM public.medicine_batches WHERE id=NEW.batch_id;
    IF NOT FOUND OR batch.clinic_id IS DISTINCT FROM clinic OR batch.medicine_id IS DISTINCT FROM med.id
      THEN RAISE EXCEPTION 'Invalid medicine batch'; END IF;
  END IF;
  IF NEW.bill_id IS NOT NULL THEN
    SELECT bill_number INTO invoice FROM public.bills WHERE id=NEW.bill_id AND clinic_id=clinic;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice is outside your clinic'; END IF;
  END IF;
  INSERT INTO public.pharmacy_controlled_sales(clinic_id,clinic_name,drug_license_number,dispensed_item_id,medicine_id,recorded_by,
    is_nrx,is_schedule_h1,medicine_name,manufacturer,batch_number,expiry_date,quantity,unit,mrp,bill_number,details)
  VALUES(clinic,facility.clinic_name,facility.drug_license_number,NEW.id,med.id,auth.uid(),med.is_nrx,med.is_schedule_h1,
    concat_ws(' ',med.name,nullif(med.strength,'')),med.manufacturer,coalesce(batch.batch_number,NEW.batch_number),
    CASE WHEN NEW.batch_id IS NULL THEN med.expiry_date ELSE batch.expiry_date END,
    round(NEW.quantity*coalesce(med.pack_size,1),3),
    coalesce(nullif(med.dispense_unit,''),CASE WHEN coalesce(med.pack_size,1)>1 THEN
      CASE med.dosage_form::text WHEN 'tablet' THEN 'Tablet' WHEN 'capsule' THEN 'Capsule'
        WHEN 'syrup' THEN 'ml' WHEN 'suspension' THEN 'ml' WHEN 'drops' THEN 'ml'
        WHEN 'injection' THEN 'Vial' WHEN 'cream' THEN 'gm' WHEN 'ointment' THEN 'gm'
        ELSE CASE WHEN med.name ~* '\mTAB(LET)?S?\M' THEN 'Tablet'
          WHEN med.name ~* '\mCAP(SULE)?S?\M' THEN 'Capsule' ELSE 'Unit' END END
      ELSE coalesce(nullif(med.stock_unit,''),nullif(NEW.billed_unit,''),'Unit') END),
    coalesce(batch.mrp,NEW.mrp),invoice,details);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.record_pharmacy_controlled_supply() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pharmacy_controlled_supply AFTER INSERT ON public.pharmacy_dispensed_items
  FOR EACH ROW EXECUTE FUNCTION public.record_pharmacy_controlled_supply();

CREATE FUNCTION public.pharmacy_controlled_sale_register(p_from date,p_to date,p_kind text DEFAULT 'all',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE clinic uuid; result jsonb;
BEGIN
  clinic := public.require_pharmacy_clinic();
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('all','nrx','h1') THEN RAISE EXCEPTION 'Invalid register filter'; END IF;
  IF p_page IS NULL OR p_page<0 OR p_page>1000000 THEN RAISE EXCEPTION 'Invalid page'; END IF;
  WITH filtered AS (
    SELECT * FROM public.pharmacy_controlled_sales s WHERE s.clinic_id=clinic
      AND s.supplied_at >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND s.supplied_at < ((p_to+1)::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND (p_kind='all' OR (p_kind='nrx' AND s.is_nrx) OR (p_kind='h1' AND s.is_schedule_h1))
  ), paged AS (SELECT * FROM filtered ORDER BY supplied_at,id LIMIT 100 OFFSET p_page*100)
  SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY supplied_at,id) FROM paged p),'[]'::jsonb)) INTO result;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.pharmacy_controlled_sale_register(date,date,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pharmacy_controlled_sale_register(date,date,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
