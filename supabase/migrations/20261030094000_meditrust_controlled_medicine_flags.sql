-- Reviewed positive NRx/H1 classifications for Meditrust Clinics only.
-- Evidence and exact before-values: seed/meditrust_controlled_medicines_20261030.json.
-- Deploy with the prescription-detail frontend; new flags require that flow.
-- H1: CDSCO Drugs Rules (Schedule H1), plus G.S.R. 377(E), May 2026 (pregabalin).
-- NRx: Rule 97 with the CBN psychotropic list and 2018 tramadol notification.
BEGIN;
SET LOCAL lock_timeout = '5s';
WITH reviewed(id,name,generic_name,nrx,h1) AS (VALUES
  ('8439b78e-8204-4d8a-a402-f92c7e6ea833'::uuid, 'AKT 3MG TAB', 'Isoniazid + Rifampicin + Ethambutol', false, true),
  ('8555921e-4b5f-4690-b94d-520c1eb033a1'::uuid, 'AKT 4MG TAB', 'Isoniazid + Rifampicin + Ethambutol + Pyrazinamide', false, true),
  ('333c9324-9c42-45c8-952c-970f2cc1316f'::uuid, 'AKURIT 3MG TAB', 'Isoniazid + Rifampicin +Ethambutol', false, true),
  ('3fc7b65c-46fc-46b0-83c0-72b8339a8337'::uuid, 'AKURIT 4MG TAB', 'Isoniazid + Rifampicin + Ethambutol + Pyrazinamide', false, true),
  ('83d255ed-27ce-4f2c-a150-a1c819ccea56'::uuid, 'ALPRAX 0.25 TAB', 'ALPRAZOLAM', true, true),
  ('59598729-1ed7-4e32-a6c3-7ba4f2a255d4'::uuid, 'ALPRAX 1MG TAB', 'ALPRAZOLAM', true, true),
  ('fc4f5aca-8df5-4b99-8994-644d2b9dedb4'::uuid, 'ALPRAX PLUS TAB', 'ALPRAZOLAM+SERTALINE', true, true),
  ('b89447ba-71f4-4211-ba6e-aba9906d530e'::uuid, 'ANXIT 0.25 TAB', 'ALPRAZOLAM', true, true),
  ('2fcfce40-b5b1-4434-a9fc-4185c61ad534'::uuid, 'CEFTAS 200 MG TAB', 'Cefixime', false, true),
  ('03284d36-8dcb-4795-9431-98f3ba9edf51'::uuid, 'CEFTAS 400 TAB', 'Cefixime', false, true),
  ('5b58fd52-7b64-4456-a53e-7a279f6bad7a'::uuid, 'CEFTAS-50 PINEAP FLAV DRY 30ML', 'Cefixime', false, true),
  ('19630140-93c5-4251-8b13-5f5a84daac39'::uuid, 'CEPODEM 200 TAB  ', 'Cefpodoxime', false, true),
  ('be3bd6fc-3d06-482a-b538-7c0f643d3de6'::uuid, 'CEPODEM XP 325 MG TAB', 'CEFPODOXIME+CLAVULANATE', false, true),
  ('52f40b0b-3ae8-43c6-9fbd-d457ddb92a43'::uuid, 'CIZASPA X TAB', 'Mebeverine + Chlordiazepoxide', true, true),
  ('53228f06-6a36-4680-9ba5-ef06d7153f48'::uuid, 'CONTRAMAL 50 DT TAB', 'TRAMADOL', true, true),
  ('02b3278a-93ea-4beb-bcef-e1bce69c5ae9'::uuid, 'FRISIUM 10 TAB', 'Clobazam', true, false),
  ('4c3b4299-e9a4-4979-bbe7-6eb8957df188'::uuid, 'FRISIUM 5 TAB', 'Clobazam', true, false),
  ('4e69e108-fda0-4fe0-b7a1-c382fd74c72a'::uuid, 'GB 29 TOTAL', 'PREGABALIN+NORTRIPTYLIN+METHYLCOBALAMIN', false, true),
  ('e3fa108b-0cc3-4db4-b592-b2362389d0c2'::uuid, 'LEVOFLOX 750 MG', 'Levofloxacin', false, true),
  ('8eb1c9be-009a-4f86-8573-b83af169b6f5'::uuid, 'LOXOF 500MG TAB', 'Levofloxacin', false, true),
  ('231edd39-025c-46bd-b7d5-3c6b6973fc56'::uuid, 'MOXIF 400 MG ', 'Moxifloxacin', false, true),
  ('f7915217-d67a-4728-864f-d7d55482eea6'::uuid, 'MOXIF EYE DROP 10 ML ', 'Moxifloxacin', false, true),
  ('5a2278f3-0a0b-4194-b15b-58239cb7a03c'::uuid, 'NEXITO PLUS TAB', 'Escitalopram + Clonazepam', true, false),
  ('139987de-2ced-4a66-a524-7a7774478baf'::uuid, 'PETRIL 0.5', 'Clonazepam', true, false),
  ('5e0072f0-f04e-49c0-9f59-59050936f3b4'::uuid, 'PETRIL BETA', 'Clonazepam + Propranolol', true, false),
  ('4c02caa2-650e-4568-bb5f-b4416db0c916'::uuid, 'PREGABID 75 CAP', 'PREGABALIN', false, true),
  ('d7861019-2960-46dc-b6dd-06646fdc2f2f'::uuid, 'PREGABID NT TAB', 'PREGABALIN+NORTRIPTYLINE', false, true),
  ('ee2efa72-da33-433d-8135-95f1dcddb06d'::uuid, 'PREGASON 75MG CAP 1X10', 'PREGABALIN', false, true),
  ('acc757f7-ba99-4795-91b7-3a669c865c11'::uuid, 'PREGASON M XR TAB', 'PREGABALIN+METHYLCOBALAMIN', false, true),
  ('783d227a-3b6e-42ef-9e52-dd5b56171af9'::uuid, 'PREGASON NT TAB', 'PREGABALIN + NORTRIPTYLINE ', false, true),
  ('496561ed-558c-4cbb-868b-adb07f1fcd14'::uuid, 'PREGASON TOTAL XR TAB', 'PREGABALINE + METHYLCOBALMINE + NORTRIPTILINE ', false, true),
  ('7cc7fea6-d28e-49e9-a6d1-155f69ac14fe'::uuid, 'TEXIDEP 0.25 TAB', 'ALPRAZOLAM', true, true),
  ('f0cfd18e-ee24-45ed-a619-1c83366d49f3'::uuid, 'ULTRACET SEMI TAB', 'TRAMADOL+ACETAMINOPHEN', true, true),
  ('779894a3-5fa4-4199-9b58-3753d1905249'::uuid, 'ULTRACET TAB', 'PARACETAMOL+TRAMADOL', true, true),
  ('8690ce5f-ee16-4ff6-b1e2-81559f6c7e9e'::uuid, 'ZAPIZ 0.25MG TAB', 'CLONAZEPAM', true, false),
  ('dedd358b-d440-4001-9152-9807b6bc1390'::uuid, 'ZIFI 100  MG TAB', 'CEFIXIME', false, true),
  ('48f48ce0-51bb-4da5-ac05-79e49d04b188'::uuid, 'ZIFI DT 50 TAB', 'CEFIXIME', false, true),
  ('acac4d60-0b41-401c-b84c-a5e9ea166560'::uuid, 'ZIFI O 200MG TAB', 'CEFIXIME+OFLOXACIN', false, true),
  ('c475ba4d-92aa-4526-b959-efb4e5c1850f'::uuid, 'ZIFI Oral Drops 10ML', 'CEFIXIME', false, true),
  ('63315153-a487-4551-ab7b-e9f1075ae207'::uuid, 'ZIFI REDYMIX 50MG SYRUP 60ML', 'CEFIXIME ORAL SUSPENSION', false, true),
  ('4fbfcec5-e1fc-4a93-a1da-4663bd6b7278'::uuid, 'ZOLFRESH 5 MG TAB ', 'ZOLPIDEM', true, true)
)
UPDATE public.medicines_master m
SET is_nrx = m.is_nrx OR r.nrx,
    is_schedule_h1 = m.is_schedule_h1 OR r.h1,
    updated_at = now()
FROM reviewed r
WHERE m.id = r.id AND m.name = r.name AND m.generic_name = r.generic_name
  AND m.is_active
  AND m.clinic_id = '238307be-362b-4fff-bb9a-3f2f9ff44519'::uuid
  AND EXISTS (SELECT 1 FROM public.clinic_settings c WHERE c.id=m.clinic_id
    AND c.clinic_name='Meditrust Clinics' AND c.drug_license_number='GJ-ADR-272601')
  AND ((r.nrx AND NOT m.is_nrx) OR (r.h1 AND NOT m.is_schedule_h1));
COMMIT;
