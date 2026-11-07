CREATE OR REPLACE FUNCTION public.record_pharmacy_controlled_supply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END; $function$
