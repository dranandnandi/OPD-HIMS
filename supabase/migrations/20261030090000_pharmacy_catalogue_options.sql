-- Extend existing enum-backed installations without converting their columns.
-- Keep this separate: newly added enum labels must commit before they are used.
DO $options$
DECLARE col text; type_schema text; type_name text; type_kind "char"; value text; choices text[];
BEGIN
  FOREACH col IN ARRAY ARRAY['category','dosage_form'] LOOP
    SELECT ns.nspname, t.typname, t.typtype INTO type_schema, type_name, type_kind
      FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace ns ON ns.oid=t.typnamespace
      WHERE a.attrelid='public.medicines_master'::regclass AND a.attname=col AND NOT a.attisdropped;
    IF type_kind <> 'e' THEN CONTINUE; END IF;
    choices := CASE col WHEN 'category' THEN ARRAY[
      'analgesic','antibiotic','antihistamine','antiseptic','antipyretic','antidiabetic','diabetes',
      'antihypertensive','cardiovascular','anticoagulant','antiplatelet','lipid_lowering',
      'gastrointestinal','antacid','antiemetic','antidiarrhoeal','laxative','respiratory',
      'bronchodilator','cough_cold','antifungal','antiviral','antiparasitic','anti_inflammatory',
      'steroid','thyroid','neurological','psychiatric','dermatological','ophthalmic','otic',
      'hormonal','vitamin','mineral','supplement','surgical','other'
    ] ELSE ARRAY[
      'tablet','capsule','syrup','injection','cream','ointment','drops','inhaler','suppository',
      'suspension','powder','sachet','gel','spray','rotacap','respule','granules','soap',
      'shampoo','lotion','gargle','solution','mouthwash','patch','surgical','other'
    ] END;
    FOREACH value IN ARRAY choices LOOP
      EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L',type_schema,type_name,value);
    END LOOP;
  END LOOP;
END;
$options$;
