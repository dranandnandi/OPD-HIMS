-- ============================================================================
-- DEMO SEED — PART 2 : Patients, OPD appointments & visits, IPD admissions,
--                      clinical chart, charge postings, bills, documents
--
-- Target clinic : e9106ae7-98b5-44a5-9f57-98c480b34f30
-- Run in        : Supabase Dashboard → SQL Editor
-- Prerequisite  : demo_seed_1_masters_templates.sql must be run first
-- Idempotent    : every row carries a fixed UUID + ON CONFLICT DO NOTHING,
--                 so re-running does not duplicate anything
--
-- All dates are relative to the run date, so the demo always looks current.
-- Demo rows are tagged: patients.referred_by = 'Demo Seed'
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Patients
-- ---------------------------------------------------------------------------
INSERT INTO public.patients
  (id, clinic_id, name, phone, age, gender, address, emergency_contact,
   blood_group, allergies, referred_by, created_at)
VALUES
 ('e9d00001-0000-4000-8000-000000000001','e9106ae7-98b5-44a5-9f57-98c480b34f30','Ramesh Deshpande','9822010001',58,'male','Flat 4, Shivneri Apartments, Kothrud, Pune','9822010101','O+',ARRAY['Sulfa drugs'],'Demo Seed', now() - interval '400 days'),
 ('e9d00001-0000-4000-8000-000000000002','e9106ae7-98b5-44a5-9f57-98c480b34f30','Sunita Kulkarni','9822010002',34,'female','12 Sahyadri Colony, Karve Nagar, Pune','9822010102','B+',ARRAY[]::text[],'Demo Seed', now() - interval '320 days'),
 ('e9d00001-0000-4000-8000-000000000003','e9106ae7-98b5-44a5-9f57-98c480b34f30','Arjun Patil','9822010003',27,'male','Room 8, Sai Residency, Hinjewadi, Pune','9822010103','A+',ARRAY[]::text[],'Demo Seed', now() - interval '90 days'),
 ('e9d00001-0000-4000-8000-000000000004','e9106ae7-98b5-44a5-9f57-98c480b34f30','Fatima Shaikh','9822010004',45,'female','23 Nasreen Manzil, Camp, Pune','9822010104','AB+',ARRAY['Penicillin'],'Demo Seed', now() - interval '260 days'),
 ('e9d00001-0000-4000-8000-000000000005','e9106ae7-98b5-44a5-9f57-98c480b34f30','Vikram Joshi','9822010005',62,'male','Bungalow 3, Model Colony, Pune','9822010105','B-',ARRAY['Iodine contrast'],'Demo Seed', now() - interval '540 days'),
 ('e9d00001-0000-4000-8000-000000000006','e9106ae7-98b5-44a5-9f57-98c480b34f30','Aarav Mehta','9822010006',6,'male','5 Vrindavan Society, Baner, Pune','9822010106','O+',ARRAY[]::text[],'Demo Seed', now() - interval '150 days'),
 ('e9d00001-0000-4000-8000-000000000007','e9106ae7-98b5-44a5-9f57-98c480b34f30','Priya Nair','9822010007',29,'female','A-701 Green Meadows, Wakad, Pune','9822010107','A-',ARRAY[]::text[],'Demo Seed', now() - interval '280 days'),
 ('e9d00001-0000-4000-8000-000000000008','e9106ae7-98b5-44a5-9f57-98c480b34f30','Mohan Gaikwad','9822010008',71,'male','Gaikwad Wada, Hadapsar, Pune','9822010108','O-',ARRAY[]::text[],'Demo Seed', now() - interval '600 days'),
 ('e9d00001-0000-4000-8000-000000000009','e9106ae7-98b5-44a5-9f57-98c480b34f30','Sneha Rane','9822010009',22,'female','Hostel Block C, Viman Nagar, Pune','9822010109','B+',ARRAY[]::text[],'Demo Seed', now() - interval '45 days'),
 ('e9d00001-0000-4000-8000-000000000010','e9106ae7-98b5-44a5-9f57-98c480b34f30','Imran Qureshi','9822010010',39,'male','17 Rehmat Nagar, Kondhwa, Pune','9822010110','A+',ARRAY['Dust, pollen'],'Demo Seed', now() - interval '210 days'),
 ('e9d00001-0000-4000-8000-000000000011','e9106ae7-98b5-44a5-9f57-98c480b34f30','Lata Bhosale','9822010011',55,'female','9 Jijamata Chowk, Pimpri, Pune','9822010111','O+',ARRAY[]::text[],'Demo Seed', now() - interval '365 days'),
 ('e9d00001-0000-4000-8000-000000000012','e9106ae7-98b5-44a5-9f57-98c480b34f30','Rohit Sawant','9822010012',44,'male','Plot 21, Sinhagad Road, Pune','9822010112','AB-',ARRAY[]::text[],'Demo Seed', now() - interval '120 days')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Everything else runs inside one block so it can resolve doctors,
--    beds and services by lookup
-- ---------------------------------------------------------------------------
DO $seed$
DECLARE
  c        uuid := 'e9106ae7-98b5-44a5-9f57-98c480b34f30';
  v_docs   uuid[];
  n        integer;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid;
  today    date := CURRENT_DATE;
  bed_p1 uuid; bed_p2 uuid; bed_a1 uuid; bed_a2 uuid; bed_a3 uuid; bed_icu1 uuid;
  tp_cash uuid; py_cash uuid; py_star uuid; tp_star uuid;
  -- admissions
  adm1 uuid := 'e9d00004-0000-4000-8000-000000000001';  -- appendicectomy, active
  adm2 uuid := 'e9d00004-0000-4000-8000-000000000002';  -- DKA + LRTI, ICU, active
  adm3 uuid := 'e9d00004-0000-4000-8000-000000000003';  -- dengue, active
  adm4 uuid := 'e9d00004-0000-4000-8000-000000000004';  -- LSCS, discharged
  adm5 uuid := 'e9d00004-0000-4000-8000-000000000005';  -- DJ stenting, discharged
  adm6 uuid := 'e9d00004-0000-4000-8000-000000000006';  -- RTA / ORIF femur, MLC, active
  v_bill uuid;
BEGIN
  -- -------------------------------------------------------------------------
  -- 2.0 Resolve staff, beds, payer/tariff
  -- -------------------------------------------------------------------------
  SELECT array_agg(id ORDER BY created_at) INTO v_docs
    FROM public.profiles WHERE clinic_id = c AND COALESCE(is_active, true);

  n := COALESCE(array_length(v_docs, 1), 0);
  IF n = 0 THEN
    RAISE EXCEPTION 'No profiles found for clinic % — create at least one staff/doctor login first', c;
  END IF;

  d1 := v_docs[1];
  d2 := v_docs[LEAST(2, n)];
  d3 := v_docs[LEAST(3, n)];
  d4 := v_docs[LEAST(4, n)];
  d5 := v_docs[LEAST(5, n)];

  SELECT b.id INTO bed_p1   FROM public.ipd_beds b JOIN public.ipd_wards w ON w.id = b.ward_id
    WHERE b.clinic_id = c AND w.name = 'Private Wing'   AND b.bed_number = 'P-1';
  SELECT b.id INTO bed_p2   FROM public.ipd_beds b JOIN public.ipd_wards w ON w.id = b.ward_id
    WHERE b.clinic_id = c AND w.name = 'Private Wing'   AND b.bed_number = 'P-2';
  SELECT b.id INTO bed_a1   FROM public.ipd_beds b JOIN public.ipd_wards w ON w.id = b.ward_id
    WHERE b.clinic_id = c AND w.name = 'General Ward A' AND b.bed_number = 'A-1';
  SELECT b.id INTO bed_a2   FROM public.ipd_beds b JOIN public.ipd_wards w ON w.id = b.ward_id
    WHERE b.clinic_id = c AND w.name = 'General Ward A' AND b.bed_number = 'A-2';
  SELECT b.id INTO bed_a3   FROM public.ipd_beds b JOIN public.ipd_wards w ON w.id = b.ward_id
    WHERE b.clinic_id = c AND w.name = 'General Ward A' AND b.bed_number = 'A-3';
  SELECT b.id INTO bed_icu1 FROM public.ipd_beds b JOIN public.ipd_wards w ON w.id = b.ward_id
    WHERE b.clinic_id = c AND w.name = 'ICU'            AND b.bed_number = 'ICU-1';

  IF bed_p1 IS NULL OR bed_icu1 IS NULL THEN
    RAISE EXCEPTION 'Demo wards/beds missing — run demo_seed_1_masters_templates.sql first';
  END IF;

  SELECT id INTO py_cash FROM public.payers WHERE clinic_id = c AND payer_type = 'cash' LIMIT 1;
  SELECT id INTO tp_cash FROM public.tariff_plans WHERE clinic_id = c AND payer_id = py_cash LIMIT 1;
  SELECT id INTO py_star FROM public.payers WHERE clinic_id = c AND code = 'STAR' LIMIT 1;
  SELECT id INTO tp_star FROM public.tariff_plans WHERE clinic_id = c AND payer_id = py_star LIMIT 1;

  -- =========================================================================
  -- 3. OPD — appointments (today + tomorrow, mixed statuses)
  -- =========================================================================
  INSERT INTO public.appointments (id, clinic_id, patient_id, doctor_id, appointment_date, duration, status, appointment_type, notes)
  VALUES
   ('e9d00002-0000-4000-8000-000000000001', c,'e9d00001-0000-4000-8000-000000000001', d1, today + time '09:15', 20,'Completed','Follow_Up','Diabetes + BP review'),
   ('e9d00002-0000-4000-8000-000000000002', c,'e9d00001-0000-4000-8000-000000000006', d2, today + time '09:45', 20,'Completed','Consultation','Fever with cold, 3 days'),
   ('e9d00002-0000-4000-8000-000000000003', c,'e9d00001-0000-4000-8000-000000000010', d1, today + time '10:30', 20,'In_Progress','Follow_Up','Asthma review, inhaler technique'),
   ('e9d00002-0000-4000-8000-000000000004', c,'e9d00001-0000-4000-8000-000000000004', d2, today + time '11:00', 20,'Arrived','Consultation','Burning micturition since 2 days'),
   ('e9d00002-0000-4000-8000-000000000005', c,'e9d00001-0000-4000-8000-000000000012', d1, today + time '11:45', 20,'Confirmed','Consultation','Low back ache after lifting weight'),
   ('e9d00002-0000-4000-8000-000000000006', c,'e9d00001-0000-4000-8000-000000000002', d2, today + time '12:15', 20,'Scheduled','Routine_Checkup','Annual health check'),
   ('e9d00002-0000-4000-8000-000000000007', c,'e9d00001-0000-4000-8000-000000000009', d1, today + time '17:00', 20,'Scheduled','Follow_Up','Post-discharge dengue review'),
   ('e9d00002-0000-4000-8000-000000000008', c,'e9d00001-0000-4000-8000-000000000011', d2,(today + 1) + time '10:00', 20,'Confirmed','Follow_Up','DJ stent removal planning'),
   ('e9d00002-0000-4000-8000-000000000009', c,'e9d00001-0000-4000-8000-000000000007', d3,(today + 1) + time '11:30', 30,'Confirmed','Follow_Up','Post-LSCS suture check'),
   ('e9d00002-0000-4000-8000-000000000010', c,'e9d00001-0000-4000-8000-000000000005', d1,(today + 1) + time '12:00', 20,'Scheduled','Follow_Up','Post-ICU diabetes review'),
   ('e9d00002-0000-4000-8000-000000000011', c,'e9d00001-0000-4000-8000-000000000003', d4,(today + 2) + time '10:15', 20,'Scheduled','Follow_Up','Suture removal'),
   ('e9d00002-0000-4000-8000-000000000012', c,'e9d00001-0000-4000-8000-000000000008', d5,(today - 1) + time '15:00', 20,'No_Show','Consultation','Did not report')
  ON CONFLICT (id) DO NOTHING;

  -- =========================================================================
  -- 4. OPD — visits with full EMR (vitals, examination, advice)
  -- =========================================================================
  INSERT INTO public.visits
    (id, clinic_id, patient_id, doctor_id, appointment_id, date, visit_date, chief_complaint,
     vitals, physical_examination, advice, advice_language, follow_up_date, doctor_notes)
  VALUES

  -- 4.1 Ramesh Deshpande — diabetes + hypertension review (today)
  ('e9d00003-0000-4000-8000-000000000001', c,'e9d00001-0000-4000-8000-000000000001', d1,
   'e9d00002-0000-4000-8000-000000000001', today + time '09:20', today + time '09:20',
   'Routine review for diabetes and blood pressure; occasional tingling in both feet',
   '{"temperature":98.4,"bloodPressure":"146/88","pulse":82,"weight":78,"height":170,"respiratoryRate":16,"oxygenSaturation":98}'::jsonb,
   '{"templateName":"Diabetes Review & Foot Check","sections":[
     {"id":"control","title":"Glycaemic Control","fields":[
       {"key":"fbs","label":"Fasting Blood Sugar","type":"text","value":"148 mg/dL"},
       {"key":"ppbs","label":"Post Prandial","type":"text","value":"212 mg/dL"},
       {"key":"hba1c","label":"HbA1c","type":"text","value":"8.1%"},
       {"key":"hypo","label":"Hypoglycaemic Episodes","type":"toggle","value":false},
       {"key":"compliance","label":"Drug Compliance","type":"select","value":"Irregular"}]},
     {"id":"foot","title":"Diabetic Foot Check","fields":[
       {"key":"monofilament","label":"10g Monofilament","type":"select","value":"Reduced"},
       {"key":"pulses","label":"Peripheral Pulses","type":"select","value":"Well felt"},
       {"key":"ulcer","label":"Foot Ulcer","type":"toggle","value":false},
       {"key":"skin","label":"Skin / Nail Changes","type":"text","value":"Dry skin, callus over right heel"}]},
     {"id":"complications","title":"Complication Screening","fields":[
       {"key":"fundus","label":"Fundus Examination","type":"select","value":"Not done"},
       {"key":"microalbumin","label":"Urine Microalbumin","type":"select","value":"Not done"},
       {"key":"bp","label":"Blood Pressure","type":"text","value":"146/88 mmHg"},
       {"key":"neuropathy","label":"Neuropathic Symptoms","type":"text","value":"Tingling both feet, worse at night"}]}]}'::jsonb,
   ARRAY['Walk 30-40 minutes daily','Strictly avoid sugar, sweets and refined flour','Split meals into five small portions','Check fasting and post-meal sugar twice a week and maintain a chart','Use soft footwear, inspect feet daily','Restrict salt to less than 5g per day'],
   'english', today + 30,
   'T2DM for 9 years, hypertension for 5 years. Compliance irregular over the last 2 months. Early peripheral neuropathy — monofilament sensation reduced. Metformin stepped up and Telmisartan added. Fundus and microalbumin advised.'),

  -- 4.2 Aarav Mehta (6y) — paediatric fever (today)
  ('e9d00003-0000-4000-8000-000000000002', c,'e9d00001-0000-4000-8000-000000000006', d2,
   'e9d00002-0000-4000-8000-000000000002', today + time '09:50', today + time '09:50',
   'Fever with running nose and cough since 3 days',
   '{"temperature":101.2,"bloodPressure":"","pulse":118,"weight":19,"height":112,"respiratoryRate":26,"oxygenSaturation":98}'::jsonb,
   '{"templateName":"Paediatric Examination","sections":[
     {"id":"growth","title":"Growth & Development","fields":[
       {"key":"weight_centile","label":"Weight for Age","type":"select","value":"Normal"},
       {"key":"milestones","label":"Developmental Milestones","type":"select","value":"Age appropriate"},
       {"key":"immunisation","label":"Immunisation","type":"select","value":"Up to date"}]},
     {"id":"general","title":"General Examination","fields":[
       {"key":"activity","label":"Activity","type":"select","value":"Active, playful"},
       {"key":"hydration","label":"Hydration","type":"select","value":"Well hydrated"},
       {"key":"pallor","label":"Pallor","type":"toggle","value":false},
       {"key":"rash","label":"Skin Rash","type":"text","value":"Nil"}]},
     {"id":"systemic","title":"Systemic Examination","fields":[
       {"key":"chest","label":"Chest","type":"select","value":"Clear"},
       {"key":"retractions","label":"Chest Retractions","type":"toggle","value":false},
       {"key":"cvs","label":"CVS","type":"text","value":"S1 S2 normal, no murmur"},
       {"key":"abdomen","label":"Abdomen","type":"text","value":"Soft, non-tender"},
       {"key":"ent","label":"Throat / Ears","type":"text","value":"Throat congested, tonsils normal, ears normal"}]}]}'::jsonb,
   ARRAY['Tepid sponging if temperature is above 100F','Plenty of fluids and light home food','Steam inhalation with supervision','Return if lethargic, refusing feeds, breathing fast or rash appears','Do not give aspirin'],
   'english', today + 3,
   'Viral upper respiratory infection. Chest clear, no red flags. Weight-based paracetamol dosing explained to mother. Reviewed in 3 days if fever persists.'),

  -- 4.3 Imran Qureshi — asthma review (today)
  ('e9d00003-0000-4000-8000-000000000003', c,'e9d00001-0000-4000-8000-000000000010', d1,
   'e9d00002-0000-4000-8000-000000000003', today + time '10:35', today + time '10:35',
   'Breathlessness and night-time cough, using reliever inhaler almost daily',
   '{"temperature":98.2,"bloodPressure":"124/78","pulse":88,"weight":72,"height":174,"respiratoryRate":20,"oxygenSaturation":96}'::jsonb,
   '{"templateName":"General Physical Examination","sections":[
     {"id":"general","title":"General Examination","fields":[
       {"key":"appearance","label":"General Appearance","type":"select","value":"Comfortable"},
       {"key":"pallor","label":"Pallor","type":"toggle","value":false},
       {"key":"cyanosis","label":"Cyanosis","type":"toggle","value":false},
       {"key":"edema","label":"Pedal Edema","type":"toggle","value":false}]},
     {"id":"rs","title":"Respiratory System","fields":[
       {"key":"air_entry","label":"Air Entry","type":"select","value":"Bilateral equal"},
       {"key":"breath_sounds","label":"Breath Sounds","type":"select","value":"Vesicular"},
       {"key":"added_sounds","label":"Added Sounds","type":"text","value":"Bilateral scattered rhonchi"}]},
     {"id":"cvs","title":"Cardiovascular System","fields":[
       {"key":"s1s2","label":"Heart Sounds","type":"select","value":"S1 S2 normal"},
       {"key":"murmur","label":"Murmur","type":"text","value":"None"}]}]}'::jsonb,
   ARRAY['Always carry the reliever inhaler','Use the spacer — technique demonstrated today','Avoid dust, smoke, cold air and strong perfumes','Annual influenza vaccination','Report if the reliever is needed more than twice a week'],
   'english', today + 30,
   'Partly controlled asthma. Reliever overuse noted. Started on Budesonide/Formoterol maintenance with spacer. Inhaler technique corrected in clinic — patient demonstrated back correctly. PEFR diary advised.'),

  -- 4.4 Fatima Shaikh — UTI (today)
  ('e9d00003-0000-4000-8000-000000000004', c,'e9d00001-0000-4000-8000-000000000004', d2,
   'e9d00002-0000-4000-8000-000000000004', today + time '11:05', today + time '11:05',
   'Burning micturition and increased frequency since 2 days',
   '{"temperature":99.6,"bloodPressure":"118/76","pulse":86,"weight":64,"height":158,"respiratoryRate":16,"oxygenSaturation":99}'::jsonb,
   '{"templateName":"General Physical Examination","sections":[
     {"id":"general","title":"General Examination","fields":[
       {"key":"appearance","label":"General Appearance","type":"select","value":"Comfortable"},
       {"key":"hydration","label":"Hydration","type":"select","value":"Adequate"}]},
     {"id":"pa","title":"Per Abdomen","fields":[
       {"key":"inspection","label":"Inspection","type":"text","value":"Soft, no distension"},
       {"key":"tenderness","label":"Tenderness","type":"text","value":"Suprapubic tenderness present, no renal angle tenderness"},
       {"key":"organomegaly","label":"Organomegaly","type":"toggle","value":false},
       {"key":"bowel_sounds","label":"Bowel Sounds","type":"select","value":"Present"}]}]}'::jsonb,
   ARRAY['Drink at least 3 litres of water a day','Do not hold urine','Maintain perineal hygiene','Complete the full antibiotic course','Repeat urine test after the course'],
   'english', today + 7,
   'Uncomplicated lower UTI. Penicillin allergy on record — Nitrofurantoin chosen. Urine routine and culture sent.'),

  -- 4.5 Sunita Kulkarni — acidity (12 days ago)
  ('e9d00003-0000-4000-8000-000000000005', c,'e9d00001-0000-4000-8000-000000000002', d1, NULL,
   now() - interval '12 days', now() - interval '12 days',
   'Burning sensation in upper abdomen and sour belching for 3 weeks',
   '{"temperature":98.4,"bloodPressure":"116/74","pulse":78,"weight":58,"height":160,"respiratoryRate":16,"oxygenSaturation":99}'::jsonb,
   '{"templateName":"General Physical Examination","sections":[
     {"id":"pa","title":"Per Abdomen","fields":[
       {"key":"inspection","label":"Inspection","type":"text","value":"Soft, no distension"},
       {"key":"tenderness","label":"Tenderness","type":"text","value":"Mild epigastric tenderness"},
       {"key":"organomegaly","label":"Organomegaly","type":"toggle","value":false},
       {"key":"bowel_sounds","label":"Bowel Sounds","type":"select","value":"Present"}]}]}'::jsonb,
   ARRAY['Avoid spicy and oily food','Eat small frequent meals','Do not lie down for 2 hours after meals','Raise the head end of the bed','Avoid tea on an empty stomach'],
   'english', now()::date + 2,
   'Clinical GERD / gastritis. No alarm features. Started on PPI for 14 days. Endoscopy only if symptoms persist beyond 4 weeks.'),

  -- 4.6 Rohit Sawant — low back ache (20 days ago)
  ('e9d00003-0000-4000-8000-000000000006', c,'e9d00001-0000-4000-8000-000000000012', d4, NULL,
   now() - interval '20 days', now() - interval '20 days',
   'Low back pain after lifting a heavy suitcase, 5 days',
   '{"temperature":98.2,"bloodPressure":"128/82","pulse":76,"weight":84,"height":176,"respiratoryRate":16,"oxygenSaturation":98}'::jsonb,
   '{"templateName":"Orthopaedic — Joint & Spine","sections":[
     {"id":"local","title":"Local Examination","fields":[
       {"key":"site","label":"Site / Joint","type":"text","value":"Lumbosacral spine"},
       {"key":"swelling","label":"Swelling","type":"toggle","value":false},
       {"key":"deformity","label":"Deformity","type":"toggle","value":false},
       {"key":"tenderness","label":"Tenderness","type":"select","value":"Moderate"}]},
     {"id":"rom","title":"Range of Movement","fields":[
       {"key":"active_rom","label":"Active ROM","type":"text","value":"Flexion restricted and painful"},
       {"key":"painful_arc","label":"Painful Arc","type":"toggle","value":false}]},
     {"id":"special","title":"Special Tests","fields":[
       {"key":"slr","label":"Straight Leg Raise","type":"text","value":"Right 70 degrees, Left 80 degrees — negative"}]},
     {"id":"neurovascular","title":"Neurovascular Status","fields":[
       {"key":"sensation","label":"Sensation","type":"select","value":"Intact"},
       {"key":"power","label":"Power","type":"text","value":"5/5 both lower limbs"},
       {"key":"gait","label":"Gait","type":"select","value":"Antalgic"}]}]}'::jsonb,
   ARRAY['Firm mattress, avoid soft sofas','No forward bending or heavy lifting','Hot fomentation twice daily','Start core strengthening physiotherapy once the pain settles','MRI only if pain radiates below the knee or weakness develops'],
   'english', now()::date - 13,
   'Acute mechanical low back ache, no red flags and no radiculopathy. Conservative management with short NSAID course and physiotherapy referral.'),

  -- 4.7 Priya Nair — antenatal visit (35 days ago)
  ('e9d00003-0000-4000-8000-000000000007', c,'e9d00001-0000-4000-8000-000000000007', d3, NULL,
   now() - interval '35 days', now() - interval '35 days',
   'Routine antenatal visit at 34 weeks',
   '{"temperature":98.4,"bloodPressure":"122/78","pulse":88,"weight":68,"height":162,"respiratoryRate":18,"oxygenSaturation":99}'::jsonb,
   '{"templateName":"Antenatal Examination","sections":[
     {"id":"obs_history","title":"Obstetric Summary","fields":[
       {"key":"gpal","label":"G / P / L / A","type":"text","value":"G1 P0 L0 A0"},
       {"key":"pog","label":"Period of Gestation","type":"text","value":"34 weeks 2 days"}]},
     {"id":"general","title":"General Examination","fields":[
       {"key":"pallor","label":"Pallor","type":"toggle","value":false},
       {"key":"edema","label":"Pedal Edema","type":"select","value":"Mild"},
       {"key":"bp_trend","label":"BP Trend","type":"select","value":"Normotensive"},
       {"key":"weight_gain","label":"Weight Gain","type":"text","value":"1.5 kg since last visit"}]},
     {"id":"per_abdomen","title":"Per Abdomen (Obstetric)","fields":[
       {"key":"fundal_height","label":"Fundal Height","type":"text","value":"33 cm, corresponds to dates"},
       {"key":"lie","label":"Lie","type":"select","value":"Longitudinal"},
       {"key":"presentation","label":"Presentation","type":"select","value":"Cephalic"},
       {"key":"fhs","label":"Foetal Heart Sounds","type":"text","value":"144 bpm, regular"},
       {"key":"movements","label":"Foetal Movements","type":"select","value":"Well perceived"}]},
     {"id":"plan","title":"Assessment","fields":[
       {"key":"risk","label":"Risk Category","type":"select","value":"Low risk"}]}]}'::jsonb,
   ARRAY['Take iron and calcium at least 2 hours apart','Protein-rich diet with pulses, eggs and milk','Daily foetal movement count','Report bleeding, leaking, severe headache or reduced movements immediately','Growth scan and next ANC visit in 2 weeks'],
   'english', now()::date - 21,
   'G1 at 34 weeks, single live intrauterine cephalic foetus, adequate growth. Blood pressure normal, mild physiological pedal oedema. Supplements continued.'),

  -- 4.8 Mohan Gaikwad — pre-fall knee pain (60 days ago)
  ('e9d00003-0000-4000-8000-000000000008', c,'e9d00001-0000-4000-8000-000000000008', d4, NULL,
   now() - interval '60 days', now() - interval '60 days',
   'Right knee pain on walking and climbing stairs for 8 months',
   '{"temperature":98.0,"bloodPressure":"138/84","pulse":74,"weight":76,"height":168,"respiratoryRate":16,"oxygenSaturation":97}'::jsonb,
   '{"templateName":"Orthopaedic — Joint & Spine","sections":[
     {"id":"local","title":"Local Examination","fields":[
       {"key":"site","label":"Site / Joint","type":"text","value":"Right knee"},
       {"key":"swelling","label":"Swelling","type":"toggle","value":true},
       {"key":"deformity","label":"Deformity","type":"toggle","value":true},
       {"key":"tenderness","label":"Tenderness","type":"select","value":"Moderate"},
       {"key":"effusion","label":"Joint Effusion","type":"toggle","value":false}]},
     {"id":"rom","title":"Range of Movement","fields":[
       {"key":"active_rom","label":"Active ROM","type":"text","value":"0-110 degrees"},
       {"key":"crepitus","label":"Crepitus","type":"toggle","value":true}]},
     {"id":"neurovascular","title":"Neurovascular Status","fields":[
       {"key":"distal_pulses","label":"Distal Pulses","type":"select","value":"Well felt"},
       {"key":"gait","label":"Gait","type":"select","value":"Antalgic"}]}]}'::jsonb,
   ARRAY['Quadriceps strengthening exercises daily','Avoid squatting, cross-legged sitting and stairs','Weight reduction','Use a walking stick in the opposite hand','Knee cap support while walking outdoors'],
   'english', now()::date - 30,
   'Bilateral primary osteoarthritis knees, right worse than left, with varus deformity. X-ray shows Kellgren-Lawrence grade 3 changes. Conservative management; joint replacement discussed for later.'),

  -- 4.9 Sneha Rane — fever, pre-admission (5 days ago)
  ('e9d00003-0000-4000-8000-000000000009', c,'e9d00001-0000-4000-8000-000000000009', d1, NULL,
   now() - interval '5 days', now() - interval '5 days',
   'High grade fever with severe body ache and headache since 4 days',
   '{"temperature":102.6,"bloodPressure":"104/68","pulse":102,"weight":52,"height":158,"respiratoryRate":20,"oxygenSaturation":98}'::jsonb,
   '{"templateName":"General Physical Examination","sections":[
     {"id":"general","title":"General Examination","fields":[
       {"key":"appearance","label":"General Appearance","type":"select","value":"Ill looking"},
       {"key":"pallor","label":"Pallor","type":"toggle","value":false},
       {"key":"hydration","label":"Hydration","type":"select","value":"Mild dehydration"},
       {"key":"lymphadenopathy","label":"Lymphadenopathy","type":"toggle","value":false}]},
     {"id":"pa","title":"Per Abdomen","fields":[
       {"key":"tenderness","label":"Tenderness","type":"text","value":"Mild right hypochondrial tenderness"},
       {"key":"organomegaly","label":"Organomegaly","type":"toggle","value":false}]}]}'::jsonb,
   ARRAY['Strictly no ibuprofen or aspirin','Minimum 3 litres of fluid a day','Daily platelet count until the fever settles','Report immediately for bleeding, black stools, severe abdominal pain or reduced urine'],
   'english', now()::date - 4,
   'Fourth day of febrile illness in a dengue-endemic area. NS1 sent. Counselled about warning signs; advised admission if platelets fall or warning signs appear.'),

  -- 4.10 Arjun Patil — abdominal pain, pre-admission (4 days ago)
  ('e9d00003-0000-4000-8000-000000000010', c,'e9d00001-0000-4000-8000-000000000003', d5, NULL,
   now() - interval '4 days', now() - interval '4 days',
   'Pain around the umbilicus shifting to the right lower abdomen since 1 day, with vomiting',
   '{"temperature":100.8,"bloodPressure":"122/78","pulse":98,"weight":70,"height":172,"respiratoryRate":18,"oxygenSaturation":98}'::jsonb,
   '{"templateName":"Emergency / Casualty Assessment","sections":[
     {"id":"primary","title":"Primary Survey (ABCDE)","fields":[
       {"key":"airway","label":"Airway","type":"select","value":"Patent"},
       {"key":"breathing","label":"Breathing","type":"select","value":"Spontaneous, adequate"},
       {"key":"circulation","label":"Circulation","type":"select","value":"Stable"},
       {"key":"disability","label":"Disability (AVPU)","type":"select","value":"Alert"},
       {"key":"exposure","label":"Exposure Findings","type":"textarea","value":"Tenderness and guarding at McBurney point, rebound tenderness positive"}]},
     {"id":"triage","title":"Triage & Access","fields":[
       {"key":"triage_level","label":"Triage Category","type":"select","value":"Yellow"},
       {"key":"iv_access","label":"IV Access Secured","type":"toggle","value":true},
       {"key":"o2","label":"Oxygen Started","type":"toggle","value":false}]},
     {"id":"disposition","title":"Disposition","fields":[
       {"key":"plan","label":"Plan","type":"select","value":"Admit to ward"},
       {"key":"mlc","label":"Medico-Legal Case","type":"toggle","value":false},
       {"key":"notes","label":"Casualty Notes","type":"textarea","value":"Alvarado score 8. Surgery referral taken. Nil by mouth, IV fluids started, admitted for appendicectomy."}]}]}'::jsonb,
   ARRAY['Nil by mouth from now','IV fluids started in casualty','Surgical opinion taken — admission advised','Consent for surgery explained to patient and relatives'],
   'english', NULL,
   'Classic history and signs of acute appendicitis with an Alvarado score of 8. Ultrasound confirms a non-compressible blind-ending tubular structure. Admitted for laparoscopic appendicectomy.')
  ON CONFLICT (id) DO NOTHING;

  -- 4.11 Visit symptoms -----------------------------------------------------
  -- severity is an enum column, so these are written as literal VALUES rows
  -- (an unknown-typed literal coerces; a text-typed subquery column would not)
  INSERT INTO public.symptoms (id, clinic_id, visit_id, name, severity, duration)
  VALUES
  ('e9d00011-0000-4000-8000-000000000001', c,'e9d00003-0000-4000-8000-000000000001','Tingling in feet','mild','3 months'),
  ('e9d00011-0000-4000-8000-000000000002', c,'e9d00003-0000-4000-8000-000000000001','Increased thirst','mild','1 month'),
  ('e9d00011-0000-4000-8000-000000000003', c,'e9d00003-0000-4000-8000-000000000002','Fever','moderate','3 days'),
  ('e9d00011-0000-4000-8000-000000000004', c,'e9d00003-0000-4000-8000-000000000002','Running nose','mild','3 days'),
  ('e9d00011-0000-4000-8000-000000000005', c,'e9d00003-0000-4000-8000-000000000002','Cough','mild','2 days'),
  ('e9d00011-0000-4000-8000-000000000006', c,'e9d00003-0000-4000-8000-000000000003','Breathlessness','moderate','2 weeks'),
  ('e9d00011-0000-4000-8000-000000000007', c,'e9d00003-0000-4000-8000-000000000003','Night cough','moderate','2 weeks'),
  ('e9d00011-0000-4000-8000-000000000008', c,'e9d00003-0000-4000-8000-000000000004','Burning micturition','moderate','2 days'),
  ('e9d00011-0000-4000-8000-000000000009', c,'e9d00003-0000-4000-8000-000000000004','Increased frequency','moderate','2 days'),
  ('e9d00011-0000-4000-8000-00000000000a', c,'e9d00003-0000-4000-8000-000000000005','Heartburn','moderate','3 weeks'),
  ('e9d00011-0000-4000-8000-00000000000b', c,'e9d00003-0000-4000-8000-000000000005','Sour belching','mild','3 weeks'),
  ('e9d00011-0000-4000-8000-00000000000c', c,'e9d00003-0000-4000-8000-000000000006','Low back pain','severe','5 days'),
  ('e9d00011-0000-4000-8000-00000000000d', c,'e9d00003-0000-4000-8000-000000000007','Pedal oedema','mild','1 week'),
  ('e9d00011-0000-4000-8000-00000000000e', c,'e9d00003-0000-4000-8000-000000000008','Right knee pain','moderate','8 months'),
  ('e9d00011-0000-4000-8000-00000000000f', c,'e9d00003-0000-4000-8000-000000000008','Difficulty climbing stairs','moderate','6 months'),
  ('e9d00011-0000-4000-8000-000000000010', c,'e9d00003-0000-4000-8000-000000000009','High grade fever','severe','4 days'),
  ('e9d00011-0000-4000-8000-000000000011', c,'e9d00003-0000-4000-8000-000000000009','Severe body ache','severe','4 days'),
  ('e9d00011-0000-4000-8000-000000000012', c,'e9d00003-0000-4000-8000-000000000009','Retro-orbital headache','moderate','3 days'),
  ('e9d00011-0000-4000-8000-000000000013', c,'e9d00003-0000-4000-8000-000000000010','Right iliac fossa pain','severe','1 day'),
  ('e9d00011-0000-4000-8000-000000000014', c,'e9d00003-0000-4000-8000-000000000010','Vomiting','moderate','1 day'),
  ('e9d00011-0000-4000-8000-000000000015', c,'e9d00003-0000-4000-8000-000000000010','Loss of appetite','moderate','1 day')
  ON CONFLICT (id) DO NOTHING;

  -- 4.12 Visit diagnoses ----------------------------------------------------
  INSERT INTO public.diagnoses (clinic_id, visit_id, name, icd10_code, is_primary)
  SELECT c, v.vid::uuid, v.nm, v.icd, v.prim
    FROM (VALUES
    ('e9d00003-0000-4000-8000-000000000001','Type 2 Diabetes Mellitus with peripheral neuropathy','E11.42', true),
    ('e9d00003-0000-4000-8000-000000000001','Essential Hypertension','I10', false),
    ('e9d00003-0000-4000-8000-000000000002','Acute Upper Respiratory Tract Infection, viral','J06.9', true),
    ('e9d00003-0000-4000-8000-000000000003','Bronchial Asthma, partly controlled','J45.909', true),
    ('e9d00003-0000-4000-8000-000000000004','Acute Cystitis','N30.0', true),
    ('e9d00003-0000-4000-8000-000000000005','Gastro-oesophageal Reflux Disease','K21.9', true),
    ('e9d00003-0000-4000-8000-000000000006','Acute Mechanical Low Back Pain','M54.5', true),
    ('e9d00003-0000-4000-8000-000000000007','Single live intrauterine pregnancy, 34 weeks','Z34.83', true),
    ('e9d00003-0000-4000-8000-000000000008','Primary Osteoarthritis, right knee','M17.11', true),
    ('e9d00003-0000-4000-8000-000000000009','Dengue Fever','A90', true),
    ('e9d00003-0000-4000-8000-000000000010','Acute Appendicitis','K35.80', true)
    ) AS v(vid, nm, icd, prim)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.diagnoses d WHERE d.visit_id = v.vid::uuid AND d.name = v.nm);

  -- 4.13 Visit prescriptions ------------------------------------------------
  INSERT INTO public.prescriptions (clinic_id, visit_id, medicine, dosage, frequency, duration, instructions)
  SELECT c, v.vid::uuid, v.med, v.dose, v.freq, v.dur, v.instr
    FROM (VALUES
    ('e9d00003-0000-4000-8000-000000000001','Metformin SR','1000mg','OD','30 days','after dinner'),
    ('e9d00003-0000-4000-8000-000000000001','Glimepiride','2mg','OD','30 days','before breakfast'),
    ('e9d00003-0000-4000-8000-000000000001','Telmisartan','40mg','OD','30 days','morning, empty stomach'),
    ('e9d00003-0000-4000-8000-000000000001','Methylcobalamin + Alpha Lipoic Acid','1500mcg','OD','60 days','after food'),
    ('e9d00003-0000-4000-8000-000000000002','Syrup Paracetamol (250mg/5ml)','5ml','QID','3 days','if temperature above 100F'),
    ('e9d00003-0000-4000-8000-000000000002','Syrup Cetirizine','2.5ml','OD','5 days','at night'),
    ('e9d00003-0000-4000-8000-000000000002','Syrup Zinc','5ml','OD','14 days','after food'),
    ('e9d00003-0000-4000-8000-000000000003','Budesonide + Formoterol Inhaler','200/6 mcg','BD','30 days','2 puffs with spacer, rinse mouth after use'),
    ('e9d00003-0000-4000-8000-000000000003','Salbutamol Inhaler','100mcg','PRN','as needed','2 puffs when breathless'),
    ('e9d00003-0000-4000-8000-000000000003','Montelukast + Levocetirizine','10mg+5mg','OD','30 days','at night'),
    ('e9d00003-0000-4000-8000-000000000004','Nitrofurantoin','100mg','BD','5 days','after food'),
    ('e9d00003-0000-4000-8000-000000000004','Alkaline Citrate Syrup','10ml','TID','5 days','in half a glass of water'),
    ('e9d00003-0000-4000-8000-000000000004','Drotaverine','80mg','BD','3 days','if pain'),
    ('e9d00003-0000-4000-8000-000000000005','Pantoprazole','40mg','OD','14 days','before breakfast'),
    ('e9d00003-0000-4000-8000-000000000005','Domperidone','10mg','TID','7 days','before meals'),
    ('e9d00003-0000-4000-8000-000000000005','Sucralfate Suspension','10ml','TID','7 days','1 hour before food'),
    ('e9d00003-0000-4000-8000-000000000006','Etoricoxib','90mg','OD','5 days','after food'),
    ('e9d00003-0000-4000-8000-000000000006','Thiocolchicoside','4mg','BD','5 days','after food'),
    ('e9d00003-0000-4000-8000-000000000006','Pantoprazole','40mg','OD','7 days','before breakfast'),
    ('e9d00003-0000-4000-8000-000000000007','Folic Acid + Iron','5mg+100mg','OD','30 days','after lunch'),
    ('e9d00003-0000-4000-8000-000000000007','Calcium + Vitamin D3','500mg+250 IU','BD','30 days','after food, not with iron'),
    ('e9d00003-0000-4000-8000-000000000008','Aceclofenac + Paracetamol','100mg+325mg','BD','7 days','after food'),
    ('e9d00003-0000-4000-8000-000000000008','Glucosamine + Chondroitin','750mg','BD','60 days','after food'),
    ('e9d00003-0000-4000-8000-000000000008','Calcium + Vitamin D3','500mg+250 IU','OD','60 days','after dinner'),
    ('e9d00003-0000-4000-8000-000000000009','Paracetamol','650mg','QID','5 days','if fever above 100F, maximum 4 doses a day'),
    ('e9d00003-0000-4000-8000-000000000009','ORS Sachet','1 sachet','PRN','5 days','sip through the day'),
    ('e9d00003-0000-4000-8000-000000000010','Inj Pantoprazole','40mg','OD','till surgery','IV, nil by mouth'),
    ('e9d00003-0000-4000-8000-000000000010','Inj Ondansetron','4mg','TID','till surgery','IV, if vomiting')
    ) AS v(vid, med, dose, freq, dur, instr)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.prescriptions p WHERE p.visit_id = v.vid::uuid AND p.medicine = v.med);

  -- 4.14 Tests ordered from OPD ---------------------------------------------
  -- test_type / urgency are enum columns — literal VALUES rows again
  INSERT INTO public.tests_ordered (id, clinic_id, visit_id, "testName", test_type, urgency, instructions)
  VALUES
  ('e9d00012-0000-4000-8000-000000000001', c,'e9d00003-0000-4000-8000-000000000001','HbA1c','lab','routine','Fasting not required'),
  ('e9d00012-0000-4000-8000-000000000002', c,'e9d00003-0000-4000-8000-000000000001','Lipid Profile','lab','routine','12 hours fasting'),
  ('e9d00012-0000-4000-8000-000000000003', c,'e9d00003-0000-4000-8000-000000000001','Urine Microalbumin','lab','routine','First morning sample'),
  ('e9d00012-0000-4000-8000-000000000004', c,'e9d00003-0000-4000-8000-000000000004','Urine Routine & Microscopy','lab','urgent','Midstream clean catch sample'),
  ('e9d00012-0000-4000-8000-000000000005', c,'e9d00003-0000-4000-8000-000000000004','Urine Culture & Sensitivity','lab','routine','Before starting antibiotics'),
  ('e9d00012-0000-4000-8000-000000000006', c,'e9d00003-0000-4000-8000-000000000008','X-Ray Both Knees — Standing AP/Lateral','radiology','routine','Weight bearing views'),
  ('e9d00012-0000-4000-8000-000000000007', c,'e9d00003-0000-4000-8000-000000000009','Complete Blood Count','lab','urgent','Daily platelet count'),
  ('e9d00012-0000-4000-8000-000000000008', c,'e9d00003-0000-4000-8000-000000000009','Dengue NS1 + IgM / IgG','lab','urgent',''),
  ('e9d00012-0000-4000-8000-000000000009', c,'e9d00003-0000-4000-8000-000000000010','Ultrasound Abdomen & Pelvis','radiology','urgent','Rule out appendicitis'),
  ('e9d00012-0000-4000-8000-00000000000a', c,'e9d00003-0000-4000-8000-000000000010','Complete Blood Count','lab','urgent','Pre-operative')
  ON CONFLICT (id) DO NOTHING;

  -- =========================================================================
  -- 5. IPD — admissions
  -- =========================================================================
  INSERT INTO public.ipd_admissions
    (id, clinic_id, admission_number, patient_id, admitting_doctor_id, treating_doctor_id,
     admission_datetime, admission_type, source_visit_id, provisional_diagnosis, icd10_codes,
     reason_for_admission, payer_id, tariff_plan_id, estimated_cost, estimated_stay_days,
     is_mlc, mlc_number, status, discharge_datetime, discharge_type,
     attendant_name, attendant_phone, attendant_relation, notes, created_by)
  VALUES
  (adm1, c, 'ADM-DEMO-001','e9d00001-0000-4000-8000-000000000003', d5, d5,
   now() - interval '3 days' + interval '4 hours','emergency','e9d00003-0000-4000-8000-000000000010',
   'Acute Appendicitis', ARRAY['K35.80'],
   'Right iliac fossa pain with vomiting; Alvarado score 8. Admitted for laparoscopic appendicectomy.',
   py_cash, tp_cash, 78000, 4, false, NULL,'admitted', NULL, NULL,
   'Sunil Patil','9822010203','Brother','Post-operative day 2. Tolerating orally, ambulating.', d1),

  (adm2, c, 'ADM-DEMO-002','e9d00001-0000-4000-8000-000000000005', d1, d1,
   now() - interval '4 days' + interval '2 hours','emergency', NULL,
   'Diabetic Ketoacidosis with Lower Respiratory Tract Infection', ARRAY['E11.10','J18.9'],
   'Drowsiness, vomiting and fever; blood sugar 486 mg/dL with ketonuria.',
   py_star, tp_star, 165000, 6, false, NULL,'admitted', NULL, NULL,
   'Anjali Joshi','9822010205','Daughter','Shifted to ICU on day 1. Insulin infusion protocol. Now on subcutaneous insulin.', d1),

  (adm3, c, 'ADM-DEMO-003','e9d00001-0000-4000-8000-000000000009', d1, d1,
   now() - interval '2 days' + interval '11 hours','planned','e9d00003-0000-4000-8000-000000000009',
   'Dengue Fever with Thrombocytopenia', ARRAY['A90'],
   'Persistent fever with falling platelet count (68,000) and warning signs.',
   py_cash, tp_cash, 32000, 3, false, NULL,'admitted', NULL, NULL,
   'Manisha Rane','9822010209','Mother','Platelets trending up. No bleeding manifestations.', d1),

  (adm4, c, 'ADM-DEMO-004','e9d00001-0000-4000-8000-000000000007', d3, d3,
   now() - interval '6 days' + interval '3 hours','emergency', NULL,
   'Primigravida at 39 weeks with foetal distress — Emergency LSCS', ARRAY['O82','Z37.0'],
   'Term pregnancy in labour with non-reassuring foetal heart rate pattern.',
   py_cash, tp_cash, 62000, 4, false, NULL,'discharged', now() - interval '2 days' + interval '11 hours','routine',
   'Rajesh Nair','9822010207','Husband','Mother and baby stable at discharge. Baby: female, 2.9 kg, APGAR 8/9.', d3),

  (adm5, c, 'ADM-DEMO-005','e9d00001-0000-4000-8000-000000000011', d5, d5,
   now() - interval '9 days' + interval '8 hours','planned', NULL,
   'Right Ureteric Calculus — Cystoscopy with DJ Stenting', ARRAY['N20.1'],
   'Recurrent right flank pain with hydronephrosis on ultrasound.',
   py_cash, tp_cash, 45000, 2, false, NULL,'discharged', now() - interval '7 days' + interval '12 hours','routine',
   'Sagar Bhosale','9822010211','Son','Stent in situ. Planned for removal after 3 weeks.', d5),

  (adm6, c, 'ADM-DEMO-006','e9d00001-0000-4000-8000-000000000008', d4, d4,
   now() - interval '5 days' + interval '21 hours','mlc', NULL,
   'Closed Fracture Shaft of Right Femur — Road Traffic Accident', ARRAY['S72.301A'],
   'Brought by relatives after a two-wheeler accident; unable to bear weight on the right leg.',
   py_cash, tp_cash, 145000, 8, true,'MLC/2026/0141','admitted', NULL, NULL,
   'Prakash Gaikwad','9822010208','Son','ORIF with locking plate done on day 2. Physiotherapy started.', d4)
  ON CONFLICT (id) DO NOTHING;

  -- 5.1 Bed allocations (adm2 shows a ward → ICU transfer) -------------------
  INSERT INTO public.ipd_bed_allocations (id, clinic_id, admission_id, bed_id, from_datetime, to_datetime, reason, notes, created_by)
  VALUES
   ('e9d0000f-0000-4000-8000-000000000001', c, adm1, bed_p1,   now() - interval '3 days' + interval '4 hours', NULL, 'admission', 'Admitted to private room on relatives'' request', d1),
   ('e9d0000f-0000-4000-8000-000000000002', c, adm2, bed_a3,   now() - interval '4 days' + interval '2 hours', now() - interval '3 days' + interval '20 hours', 'admission', 'Initial ward admission from casualty', d1),
   ('e9d0000f-0000-4000-8000-000000000003', c, adm2, bed_icu1, now() - interval '3 days' + interval '20 hours', NULL, 'icu_shift', 'Shifted to ICU for insulin infusion and monitoring', d1),
   ('e9d0000f-0000-4000-8000-000000000004', c, adm3, bed_a1,   now() - interval '2 days' + interval '11 hours', NULL, 'admission', NULL, d1),
   ('e9d0000f-0000-4000-8000-000000000005', c, adm4, bed_p2,   now() - interval '6 days' + interval '3 hours', now() - interval '2 days' + interval '11 hours', 'admission', 'Discharged after suture check', d3),
   ('e9d0000f-0000-4000-8000-000000000006', c, adm5, bed_p1,   now() - interval '9 days' + interval '8 hours', now() - interval '7 days' + interval '12 hours', 'admission', 'Day-care style stay, discharged on POD 1', d5),
   ('e9d0000f-0000-4000-8000-000000000007', c, adm6, bed_a2,   now() - interval '5 days' + interval '21 hours', NULL, 'admission', 'MLC — police intimation done', d4)
  ON CONFLICT (id) DO NOTHING;

  -- Beds released by discharged patients go back to available
  UPDATE public.ipd_beds SET status = 'available', updated_at = now()
   WHERE clinic_id = c AND status = 'cleaning'
     AND id IN (bed_p2)
     AND NOT EXISTS (SELECT 1 FROM public.ipd_bed_allocations a
                      WHERE a.bed_id = public.ipd_beds.id AND a.to_datetime IS NULL);

  -- 5.2 MLC particulars ------------------------------------------------------
  INSERT INTO public.ipd_mlc_details
    (id, clinic_id, admission_id, incident_datetime, incident_place, incident_description,
     brought_by, injuries_description, alcohol_suspected, police_station, fir_number,
     police_informed_at, informed_officer, belongings, identification_marks, created_by)
  VALUES
   ('e9d0000e-0000-4000-8000-000000000001', c, adm6,
    now() - interval '5 days' + interval '20 hours','Katraj Highway, near Bharati Vidyapeeth, Pune',
    'Two-wheeler skidded after being hit from behind by a four-wheeler. Patient was wearing a helmet.',
    'Son and a bystander',
    'Deformity and swelling of the right thigh; abrasions over the right elbow and knee. No head or chest injury.',
    false,'Bharati Vidyapeeth Police Station','FIR pending',
    now() - interval '5 days' + interval '22 hours','PSI R. Kamble',
    'One mobile phone, wallet with Rs. 1,200, one wrist watch — handed over to son',
    'Mole over left cheek; surgical scar over the abdomen', d4)
  ON CONFLICT (id) DO NOTHING;

  -- 5.3 Discharge checklist for the discharged admissions --------------------
  INSERT INTO public.ipd_discharge_checklist
    (clinic_id, admission_id, bill_cleared, summary_signed, meds_reconciled, implants_documented, followup_booked, cleared_by, cleared_at)
  SELECT c, v.adm, true, true, true, v.impl, true, d1, v.at
    FROM (VALUES
      (adm4, false, now() - interval '2 days' + interval '10 hours'),
      (adm5, true,  now() - interval '7 days' + interval '11 hours')
    ) AS v(adm, impl, at)
   WHERE NOT EXISTS (SELECT 1 FROM public.ipd_discharge_checklist x WHERE x.admission_id = v.adm);

  -- =========================================================================
  -- 6. IPD chart — round notes (treatment plans)
  -- =========================================================================
  INSERT INTO public.ipd_treatment_plans
    (id, clinic_id, admission_id, plan_date, recorded_at, doctor_id, subjective, objective, assessment, plan, advice, status, created_by)
  VALUES
  ('e9d00006-0000-4000-8000-000000000001', c, adm1, (now() - interval '3 days')::date, now() - interval '3 days' + interval '5 hours', d5,
   'Pain in the right lower abdomen since yesterday, vomited twice, no passage of flatus since morning.',
   'Temp 100.8F, PR 98/min, BP 122/78. Tenderness and guarding at McBurney point, rebound positive. USG suggestive of acute appendicitis.',
   'Acute appendicitis. Fit for surgery, ASA I.',
   'Nil by mouth. IV fluids RL 100 ml/hr. Inj Ceftriaxone 1g IV BD, Inj Pantoprazole 40mg IV OD, Inj Ondansetron 4mg IV TDS. Posted for emergency laparoscopic appendicectomy this evening. Consent taken, parts prepared, blood grouping done.',
   'Explain the procedure and post-operative course to the patient and relatives.','superseded', d5),
  ('e9d00006-0000-4000-8000-000000000002', c, adm1, (now() - interval '2 days')::date, now() - interval '2 days' + interval '9 hours', d5,
   'Post-operative day 1. Pain at port sites, tolerable. Passed flatus this morning.',
   'Afebrile. PR 84/min, BP 118/76. Abdomen soft, port sites clean and dry. Bowel sounds present.',
   'Post laparoscopic appendicectomy day 1 — uneventful recovery.',
   'Start sips of clear liquids, step up to soft diet by evening. Continue IV antibiotics for 24 more hours, then switch to oral. Ambulate with support. Continue analgesia as charted.',
   'Encourage deep breathing exercises and early walking.','superseded', d5),
  ('e9d00006-0000-4000-8000-000000000003', c, adm1, today, now() - interval '4 hours', d5,
   'Post-operative day 2. No pain at rest, taking soft diet well, passed stool once.',
   'Afebrile. PR 78/min, BP 120/78. Abdomen soft and non-tender. Port sites healthy, no discharge.',
   'Recovering well. Fit for discharge tomorrow if the night is uneventful.',
   'Switch to oral antibiotics and analgesics. Remove IV cannula. Full normal diet. Plan discharge tomorrow morning with a follow-up in one week for suture inspection.',
   'Advise no heavy lifting for 2 weeks. Keep port sites dry.','active', d5),

  ('e9d00006-0000-4000-8000-000000000004', c, adm2, (now() - interval '4 days')::date, now() - interval '4 days' + interval '3 hours', d1,
   'Brought in drowsy with vomiting and fever for 2 days. Has skipped insulin for the past week.',
   'Drowsy but arousable, GCS 14. Dehydrated. PR 118/min, BP 96/62, RR 26, SpO2 93% on room air. RBS 486 mg/dL, urine ketones 3+, ABG pH 7.18, HCO3 11.',
   'Diabetic ketoacidosis with a probable lower respiratory tract infection as the precipitant.',
   'Shift to ICU. Start DKA protocol — IV fluids as per deficit, insulin infusion 0.1 units/kg/hr, hourly GRBS, 2-hourly electrolytes and ABG. Inj Piperacillin-Tazobactam 4.5g IV TDS. Oxygen by mask to keep SpO2 above 94%. Strict input-output charting, catheterise.',
   'High-risk consent taken from the daughter. Explain the need for ICU care and the guarded prognosis.','superseded', d1),
  ('e9d00006-0000-4000-8000-000000000005', c, adm2, (now() - interval '2 days')::date, now() - interval '2 days' + interval '10 hours', d1,
   'More alert today, accepting orally, no vomiting.',
   'GCS 15. PR 92/min, BP 112/70, RR 20, SpO2 96% on 2L. RBS 214 mg/dL, ketones negative, ABG pH 7.36, HCO3 20.',
   'DKA resolved. LRTI improving on antibiotics.',
   'Stop insulin infusion, start subcutaneous basal-bolus insulin with a sliding scale. Step down oxygen. Continue antibiotics to complete 7 days. Dietician referral for a diabetic diet. Chest physiotherapy.',
   'Counsel about insulin compliance and sick-day rules before discharge.','superseded', d1),
  ('e9d00006-0000-4000-8000-000000000006', c, adm2, today, now() - interval '5 hours', d1,
   'Comfortable, no fresh complaints, appetite improving.',
   'Afebrile. PR 84/min, BP 118/74, SpO2 97% on room air. Chest — occasional crepitations at the right base. RBS 168 mg/dL.',
   'Recovering. Glycaemic control improving on subcutaneous insulin.',
   'Continue subcutaneous insulin as charted with pre-meal GRBS. Complete the antibiotic course. Plan step-down to the ward tomorrow. Repeat chest X-ray before discharge.',
   'Diabetes educator session scheduled for tomorrow.','active', d1),

  ('e9d00006-0000-4000-8000-000000000007', c, adm3, (now() - interval '2 days')::date, now() - interval '2 days' + interval '12 hours', d1,
   'Fever for 5 days, severe body ache and headache. No bleeding from any site.',
   'Temp 102.2F, PR 104/min, BP 100/64. No rash, no bleeding. Abdomen soft, mild right hypochondrial tenderness. Platelets 68,000, Hct 41%, NS1 positive.',
   'Dengue fever with thrombocytopenia and warning signs.',
   'Admit for observation. IV fluids as per the dengue fluid chart. Inj Paracetamol 1g IV SOS — strictly no NSAIDs. Six-hourly vitals, twice-daily platelet count and haematocrit. Watch for warning signs.',
   'Explain warning signs to the patient and mother.','superseded', d1),
  ('e9d00006-0000-4000-8000-000000000008', c, adm3, today, now() - interval '6 hours', d1,
   'Fever settling, took breakfast today, no bleeding.',
   'Temp 99.2F, PR 88/min, BP 108/70. Platelets 94,000 and rising, Hct 39%. No third-space fluid loss.',
   'Dengue fever in the recovery phase. Platelet count improving.',
   'Continue oral fluids, reduce IV fluids. Repeat CBC tomorrow morning. Plan discharge tomorrow if the platelet trend continues upward and she stays afebrile.',
   'Advise mosquito precautions at home; review after 3 days.','active', d1),

  ('e9d00006-0000-4000-8000-000000000009', c, adm6, (now() - interval '5 days')::date, now() - interval '5 days' + interval '22 hours', d4,
   'Road traffic accident 2 hours ago. Pain and inability to move the right lower limb.',
   'Conscious, oriented. PR 96/min, BP 128/84. Deformity and swelling of the right thigh, tenderness with abnormal mobility. Distal pulses well felt, sensation intact. X-ray — transverse fracture of the shaft of the right femur.',
   'Closed fracture of the shaft of the right femur. MLC registered.',
   'Skin traction 5 kg. IV analgesia and antibiotics. Pre-operative workup — CBC, PT/INR, KFT, ECG, physician clearance. Plan ORIF with a locking plate after 24-48 hours. Police intimation done.',
   'Explain the surgery, implant cost and recovery timeline to the son.','superseded', d4),
  ('e9d00006-0000-4000-8000-000000000010', c, adm6, today, now() - interval '3 hours', d4,
   'Post-operative day 2. Pain well controlled, sleeping better.',
   'Afebrile. PR 80/min, BP 132/80. Wound dressing dry, no soakage. Distal neurovascular status intact. Check X-ray — reduction and implant position satisfactory.',
   'Post ORIF with locking plate, right femur — satisfactory progress.',
   'Continue IV antibiotics to complete 48 hours, then switch to oral. Continue DVT prophylaxis. Static quadriceps and ankle pump exercises. Non-weight bearing mobilisation with a walker from tomorrow. Dressing on post-operative day 3.',
   'Physiotherapy twice a day. Explain non-weight bearing precautions to the family.','active', d4)
  ON CONFLICT (id) DO NOTHING;

  -- =========================================================================
  -- 7. Vitals (6-hourly through each stay)
  -- =========================================================================
  INSERT INTO public.ipd_vitals
    (clinic_id, admission_id, recorded_at, recorded_by, temperature, pulse, resp_rate,
     bp_systolic, bp_diastolic, spo2, pain_score, blood_sugar)
  -- NOTE: ipd_vitals.temperature is stored in °C (CHECK 30-45)
  SELECT c, a.id, g.ts, d2,
         ROUND((36.5 + (extract(epoch from g.ts)::bigint % 22) / 10.0)::numeric, 1),
         72 + (extract(epoch from g.ts)::bigint % 26)::int,
         16 + (extract(epoch from g.ts)::bigint % 6)::int,
         106 + (extract(epoch from g.ts)::bigint % 28)::int,
         66 + (extract(epoch from g.ts)::bigint % 18)::int,
         95 + (extract(epoch from g.ts)::bigint % 5)::int,
         (extract(epoch from g.ts)::bigint % 5)::int,
         ROUND((96 + (extract(epoch from g.ts)::bigint % 120))::numeric, 1)
    FROM public.ipd_admissions a
    CROSS JOIN LATERAL generate_series(
      a.admission_datetime + interval '2 hours',
      COALESCE(a.discharge_datetime, now()),
      interval '6 hours') AS g(ts)
   WHERE a.id IN (adm1, adm2, adm3, adm4, adm5, adm6)
     AND NOT EXISTS (SELECT 1 FROM public.ipd_vitals v WHERE v.admission_id = a.id);

  -- =========================================================================
  -- 8. Nursing notes
  -- =========================================================================
  INSERT INTO public.ipd_nursing_notes (id, clinic_id, admission_id, note_type, note, created_by, created_at)
  VALUES
   ('e9d0000d-0000-4000-8000-000000000001', c, adm1,'nursing','Patient shifted from OT at 20:40. Vitals stable, conscious and oriented. IV fluids running, urine output adequate. Port site dressings dry.', d2, now() - interval '3 days' + interval '13 hours'),
   ('e9d0000d-0000-4000-8000-000000000002', c, adm1,'handover','Night shift handover — afebrile through the night, passed urine twice, pain score 3/10, one dose of analgesia given at 02:00. Sips of water started at 06:00 and tolerated.', d2, now() - interval '2 days' + interval '7 hours'),
   ('e9d0000d-0000-4000-8000-000000000003', c, adm1,'nursing','Ambulated to the toilet with support. Soft diet given and tolerated well. Port sites inspected — clean and dry.', d2, now() - interval '1 day' + interval '11 hours'),
   ('e9d0000d-0000-4000-8000-000000000004', c, adm2,'nursing','Insulin infusion started as per protocol. Hourly GRBS charted. Foleys catheter inserted, hourly urine output charting started. Oxygen by face mask at 6 L/min.', d2, now() - interval '3 days' + interval '21 hours'),
   ('e9d0000d-0000-4000-8000-000000000005', c, adm2,'progress','GRBS trend improving — 486 to 214 over 24 hours. Ketones cleared. Patient more alert, taking orally. Oxygen stepped down to 2 L/min by nasal prongs.', d2, now() - interval '2 days' + interval '9 hours'),
   ('e9d0000d-0000-4000-8000-000000000006', c, adm2,'handover','Off oxygen since morning, saturating 97% on room air. Pre-meal GRBS charted, subcutaneous insulin given as per the sliding scale. Chest physiotherapy done twice.', d2, now() - interval '10 hours'),
   ('e9d0000d-0000-4000-8000-000000000007', c, adm3,'nursing','Six-hourly vitals charted. Encouraged oral fluids — 2.5 litres in 24 hours. No bleeding manifestations. Tourniquet test not repeated.', d2, now() - interval '1 day' + interval '9 hours'),
   ('e9d0000d-0000-4000-8000-000000000008', c, adm3,'progress','Afebrile since last night. Platelet report 94,000 informed to the doctor. Patient took full breakfast. Mother counselled about warning signs.', d2, now() - interval '7 hours'),
   ('e9d0000d-0000-4000-8000-000000000009', c, adm6,'procedure','Skin traction 5 kg applied to the right lower limb. Limb elevated on a pillow. Neurovascular check 2-hourly — distal pulses well felt, sensation intact, capillary refill under 2 seconds.', d2, now() - interval '5 days' + interval '23 hours'),
   ('e9d0000d-0000-4000-8000-00000000000a', c, adm6,'nursing','Shifted back from OT. Dressing dry, drain not kept. Limb elevated. Pain score 4/10, analgesia given. Started static quadriceps exercises as advised by physiotherapy.', d2, now() - interval '3 days' + interval '14 hours'),
   ('e9d0000d-0000-4000-8000-00000000000b', c, adm6,'handover','Slept well. Wound dressing dry. Ankle pump and quadriceps exercises done twice. Enoxaparin given at 20:00. Non-weight bearing precautions explained again to the son.', d2, now() - interval '8 hours')
  ON CONFLICT (id) DO NOTHING;

  -- Nursing tasks (open + done)
  INSERT INTO public.ipd_nursing_tasks (id, clinic_id, admission_id, task, due_at, recurrence, status, done_by, done_at, created_by)
  VALUES
   ('e9d00010-0000-4000-8000-000000000001', c, adm1,'Port site dressing check', now() + interval '3 hours','od','pending', NULL, NULL, d5),
   ('e9d00010-0000-4000-8000-000000000002', c, adm1,'Encourage ambulation and deep breathing', now() + interval '1 hour','q4h','pending', NULL, NULL, d5),
   ('e9d00010-0000-4000-8000-000000000003', c, adm2,'Pre-meal GRBS charting', now() + interval '2 hours','qid','pending', NULL, NULL, d1),
   ('e9d00010-0000-4000-8000-000000000004', c, adm2,'Chest physiotherapy', now() - interval '2 hours','bd','done', d2, now() - interval '2 hours', d1),
   ('e9d00010-0000-4000-8000-000000000005', c, adm2,'Input-output charting', now() + interval '4 hours','q4h','pending', NULL, NULL, d1),
   ('e9d00010-0000-4000-8000-000000000006', c, adm3,'Six-hourly vitals and bleeding check', now() + interval '2 hours','q6h','pending', NULL, NULL, d1),
   ('e9d00010-0000-4000-8000-000000000007', c, adm3,'Morning CBC sample collection', (today + 1) + time '06:30','od','pending', NULL, NULL, d1),
   ('e9d00010-0000-4000-8000-000000000008', c, adm6,'Neurovascular check of right lower limb', now() + interval '1 hour','q4h','pending', NULL, NULL, d4),
   ('e9d00010-0000-4000-8000-000000000009', c, adm6,'Physiotherapy session', now() + interval '5 hours','bd','pending', NULL, NULL, d4),
   ('e9d00010-0000-4000-8000-00000000000a', c, adm6,'Wound dressing (POD 3)', (today + 1) + time '10:00','od','pending', NULL, NULL, d4)
  ON CONFLICT (id) DO NOTHING;

  -- =========================================================================
  -- 9. Medication orders (eMAR)
  -- =========================================================================
  INSERT INTO public.ipd_medication_orders
    (id, clinic_id, admission_id, medicine_name, dose, route, frequency_code, start_at, end_at, instructions, ordered_by, status)
  VALUES
   ('e9d00009-0000-4000-8000-000000000001', c, adm1,'Inj Ceftriaxone','1 g','iv','bd', now() - interval '3 days', now() - interval '1 day','Post-operative cover', d5,'completed'),
   ('e9d00009-0000-4000-8000-000000000002', c, adm1,'Inj Pantoprazole','40 mg','iv','od', now() - interval '3 days', now() - interval '1 day','Before breakfast', d5,'completed'),
   ('e9d00009-0000-4000-8000-000000000003', c, adm1,'Tab Cefuroxime','500 mg','oral','bd', now() - interval '1 day', NULL,'After food', d5,'active'),
   ('e9d00009-0000-4000-8000-000000000004', c, adm1,'Tab Aceclofenac + Paracetamol','100/325 mg','oral','bd', now() - interval '1 day', NULL,'After food, for pain', d5,'active'),
   ('e9d00009-0000-4000-8000-000000000005', c, adm1,'Inj Tramadol','50 mg','iv','sos', now() - interval '3 days', NULL,'If pain score above 5', d5,'active'),

   ('e9d00009-0000-4000-8000-000000000006', c, adm2,'Inj Piperacillin-Tazobactam','4.5 g','iv','tid', now() - interval '4 days', NULL,'Complete 7 days', d1,'active'),
   ('e9d00009-0000-4000-8000-000000000007', c, adm2,'Inj Human Actrapid Insulin','As per sliding scale','sc','tid', now() - interval '2 days', NULL,'Pre-meal, check GRBS first', d1,'active'),
   ('e9d00009-0000-4000-8000-000000000008', c, adm2,'Inj Insulin Glargine','14 units','sc','od', now() - interval '2 days', NULL,'At 22:00', d1,'active'),
   ('e9d00009-0000-4000-8000-000000000009', c, adm2,'Inj Pantoprazole','40 mg','iv','od', now() - interval '4 days', NULL,'Before breakfast', d1,'active'),
   ('e9d00009-0000-4000-8000-00000000000a', c, adm2,'Nebulisation Ipratropium + Levosalbutamol','1 respule','inhalation','qid', now() - interval '4 days', NULL,'6-hourly', d1,'active'),

   ('e9d00009-0000-4000-8000-00000000000b', c, adm3,'Inj Paracetamol','1 g','iv','sos', now() - interval '2 days', NULL,'If temperature above 100F — no NSAIDs', d1,'active'),
   ('e9d00009-0000-4000-8000-00000000000c', c, adm3,'Inj Pantoprazole','40 mg','iv','od', now() - interval '2 days', NULL,'Before breakfast', d1,'active'),
   ('e9d00009-0000-4000-8000-00000000000d', c, adm3,'IV Fluid Ringer Lactate','500 ml','iv','q6h', now() - interval '2 days', NULL,'As per dengue fluid chart', d1,'active'),

   ('e9d00009-0000-4000-8000-00000000000e', c, adm6,'Inj Ceftriaxone','1 g','iv','bd', now() - interval '3 days', now() - interval '1 day','Surgical prophylaxis', d4,'completed'),
   ('e9d00009-0000-4000-8000-00000000000f', c, adm6,'Inj Enoxaparin','40 mg','sc','od', now() - interval '3 days', NULL,'At 20:00 — DVT prophylaxis', d4,'active'),
   ('e9d00009-0000-4000-8000-000000000010', c, adm6,'Inj Tramadol','50 mg','iv','tid', now() - interval '3 days', NULL,'For pain', d4,'active'),
   ('e9d00009-0000-4000-8000-000000000011', c, adm6,'Tab Cefuroxime','500 mg','oral','bd', now() - interval '1 day', NULL,'After food', d4,'active'),
   ('e9d00009-0000-4000-8000-000000000012', c, adm6,'Tab Calcium + Vitamin D3','500 mg','oral','od', now() - interval '3 days', NULL,'After dinner', d4,'active'),

   ('e9d00009-0000-4000-8000-000000000013', c, adm4,'Inj Ceftriaxone','1 g','iv','bd', now() - interval '6 days', now() - interval '3 days','Post-LSCS cover', d3,'completed'),
   ('e9d00009-0000-4000-8000-000000000014', c, adm4,'Inj Tramadol','50 mg','iv','tid', now() - interval '6 days', now() - interval '4 days','For pain', d3,'completed'),
   ('e9d00009-0000-4000-8000-000000000015', c, adm4,'Tab Cefixime','200 mg','oral','bd', now() - interval '3 days', now() - interval '2 days','After food', d3,'completed'),
   ('e9d00009-0000-4000-8000-000000000016', c, adm4,'Tab Ferrous Ascorbate + Folic Acid','100 mg','oral','od', now() - interval '5 days', now() - interval '2 days','After lunch', d3,'completed'),

   ('e9d00009-0000-4000-8000-000000000017', c, adm5,'Inj Ceftriaxone','1 g','iv','bd', now() - interval '9 days', now() - interval '7 days','Peri-procedure cover', d5,'completed'),
   ('e9d00009-0000-4000-8000-000000000018', c, adm5,'Tab Tamsulosin','0.4 mg','oral','od', now() - interval '8 days', now() - interval '7 days','At night, for stent symptoms', d5,'completed')
  ON CONFLICT (id) DO NOTHING;

  -- =========================================================================
  -- 10. Orders and order items
  -- =========================================================================
  INSERT INTO public.ipd_orders (id, clinic_id, admission_id, ordered_by, order_datetime, priority, clinical_notes, status)
  VALUES
   ('e9d00007-0000-4000-8000-000000000001', c, adm1, d5, now() - interval '3 days' + interval '5 hours','urgent','Pre-operative workup for emergency appendicectomy','completed'),
   ('e9d00007-0000-4000-8000-000000000002', c, adm2, d1, now() - interval '4 days' + interval '3 hours','stat','DKA admission workup and monitoring','completed'),
   ('e9d00007-0000-4000-8000-000000000003', c, adm2, d1, now() - interval '1 day','routine','Repeat monitoring before step-down','in_progress'),
   ('e9d00007-0000-4000-8000-000000000004', c, adm3, d1, now() - interval '2 days' + interval '12 hours','urgent','Dengue workup with serial platelet monitoring','in_progress'),
   ('e9d00007-0000-4000-8000-000000000005', c, adm6, d4, now() - interval '5 days' + interval '22 hours','urgent','Trauma and pre-operative workup','completed'),
   ('e9d00007-0000-4000-8000-000000000006', c, adm4, d3, now() - interval '6 days' + interval '4 hours','stat','Emergency LSCS workup','completed'),
   ('e9d00007-0000-4000-8000-000000000007', c, adm5, d5, now() - interval '9 days' + interval '9 hours','routine','Pre-procedure workup for DJ stenting','completed')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.ipd_order_items (clinic_id, order_id, admission_id, service_id, quantity, performing_doctor_id, status)
  SELECT c, v.ord::uuid, v.adm, s.id, v.qty, d1, v.st
    FROM (VALUES
    ('e9d00007-0000-4000-8000-000000000001', adm1,'LAB-CBC',   1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000001', adm1,'LAB-COAG',  1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000001', adm1,'LAB-KFT',   1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000001', adm1,'RAD-USG',   1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000001', adm1,'RAD-ECG',   1,'done'),
    ('e9d00007-0000-4000-8000-000000000002', adm2,'LAB-ABG',   2,'resulted'),
    ('e9d00007-0000-4000-8000-000000000002', adm2,'LAB-ELEC',  2,'resulted'),
    ('e9d00007-0000-4000-8000-000000000002', adm2,'LAB-KFT',   1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000002', adm2,'LAB-CBC',   1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000002', adm2,'RAD-XRAY',  1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000002', adm2,'LAB-CULT',  1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000003', adm2,'LAB-CBC',   1,'pending'),
    ('e9d00007-0000-4000-8000-000000000003', adm2,'LAB-HBA1C', 1,'pending'),
    ('e9d00007-0000-4000-8000-000000000003', adm2,'RAD-XRAY',  1,'pending'),
    ('e9d00007-0000-4000-8000-000000000004', adm3,'LAB-CBC',   3,'resulted'),
    ('e9d00007-0000-4000-8000-000000000004', adm3,'LAB-DENGUE',1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000004', adm3,'LAB-LFT',   1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000004', adm3,'LAB-URINE', 1,'pending'),
    ('e9d00007-0000-4000-8000-000000000005', adm6,'RAD-XRAY',  3,'resulted'),
    ('e9d00007-0000-4000-8000-000000000005', adm6,'LAB-CBC',   2,'resulted'),
    ('e9d00007-0000-4000-8000-000000000005', adm6,'LAB-COAG',  1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000005', adm6,'LAB-KFT',   1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000005', adm6,'RAD-ECG',   1,'done'),
    ('e9d00007-0000-4000-8000-000000000006', adm4,'LAB-CBC',   2,'resulted'),
    ('e9d00007-0000-4000-8000-000000000006', adm4,'RAD-USGOBS',1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000006', adm4,'LAB-URINE', 1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000007', adm5,'LAB-CBC',   1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000007', adm5,'LAB-KFT',   1,'resulted'),
    ('e9d00007-0000-4000-8000-000000000007', adm5,'RAD-CTABD', 1,'resulted')
    ) AS v(ord, adm, svc, qty, st)
    JOIN public.services_master s ON s.clinic_id = c AND s.service_code = v.svc
   WHERE NOT EXISTS (
     SELECT 1 FROM public.ipd_order_items i
      WHERE i.order_id = v.ord::uuid AND i.service_id = s.id);

  -- =========================================================================
  -- 11. Reports filed against the chart
  -- =========================================================================
  INSERT INTO public.ipd_reports
    (id, clinic_id, admission_id, report_type, title, report_date, performed_at,
     findings, impression, is_abnormal, status, reviewed_by, reviewed_at, uploaded_by)
  VALUES
   ('e9d0000a-0000-4000-8000-000000000001', c, adm1,'radiology','Ultrasound Abdomen & Pelvis',(now() - interval '3 days')::date,'In-house Radiology',
    'Blind-ending, non-compressible tubular structure in the right iliac fossa measuring 9 mm in diameter with probe tenderness. Minimal free fluid in the pelvis.',
    'Features suggestive of acute appendicitis.', true,'reviewed', d5, now() - interval '3 days' + interval '6 hours', d2),
   ('e9d0000a-0000-4000-8000-000000000002', c, adm1,'pathology','Complete Blood Count',(now() - interval '3 days')::date,'In-house Laboratory',
    'Hb 13.8 g/dL, TLC 14,600/cumm with 82% neutrophils, platelets 2.4 lakh/cumm.',
    'Neutrophilic leucocytosis consistent with acute inflammation.', true,'reviewed', d5, now() - interval '3 days' + interval '6 hours', d2),
   ('e9d0000a-0000-4000-8000-000000000003', c, adm2,'pathology','Arterial Blood Gas — on admission',(now() - interval '4 days')::date,'ICU Point of Care',
    'pH 7.18, pCO2 26 mmHg, HCO3 11 mEq/L, anion gap 24, lactate 2.1 mmol/L.',
    'High anion gap metabolic acidosis consistent with diabetic ketoacidosis.', true,'reviewed', d1, now() - interval '4 days' + interval '4 hours', d2),
   ('e9d0000a-0000-4000-8000-000000000004', c, adm2,'radiology','Chest X-Ray PA View',(now() - interval '4 days')::date,'In-house Radiology',
    'Patchy non-homogeneous opacity in the right lower zone. Cardiac size normal. Costophrenic angles clear.',
    'Right lower zone consolidation — consistent with lower respiratory tract infection.', true,'reviewed', d1, now() - interval '4 days' + interval '5 hours', d2),
   ('e9d0000a-0000-4000-8000-000000000005', c, adm2,'pathology','Blood Culture & Sensitivity',(now() - interval '2 days')::date,'In-house Laboratory',
    'No growth after 48 hours of aerobic incubation.',
    'Sterile. Continue empirical antibiotics as per clinical response.', false,'reviewed', d1, now() - interval '2 days' + interval '11 hours', d2),
   ('e9d0000a-0000-4000-8000-000000000006', c, adm3,'pathology','Dengue NS1 + IgM / IgG',(now() - interval '2 days')::date,'In-house Laboratory',
    'NS1 antigen positive. IgM positive, IgG negative.',
    'Acute primary dengue infection.', true,'reviewed', d1, now() - interval '2 days' + interval '13 hours', d2),
   ('e9d0000a-0000-4000-8000-000000000007', c, adm3,'pathology','Serial Platelet Count',(now())::date,'In-house Laboratory',
    'Day 1: 68,000/cumm. Day 2: 74,000/cumm. Day 3: 94,000/cumm. Haematocrit stable at 39-41%.',
    'Platelet count recovering. No evidence of plasma leakage.', true,'reviewed', d1, now() - interval '6 hours', d2),
   ('e9d0000a-0000-4000-8000-000000000008', c, adm6,'radiology','X-Ray Right Femur AP & Lateral',(now() - interval '5 days')::date,'In-house Radiology',
    'Transverse fracture of the shaft of the right femur at the junction of the middle and lower third with lateral displacement. No other bony injury seen.',
    'Closed transverse fracture, shaft of right femur.', true,'reviewed', d4, now() - interval '5 days' + interval '23 hours', d2),
   ('e9d0000a-0000-4000-8000-000000000009', c, adm6,'radiology','Check X-Ray Right Femur — Post-operative',(now() - interval '2 days')::date,'In-house Radiology',
    'Locking plate in situ along the lateral cortex with screws in good purchase. Fracture reduction anatomical. No implant loosening.',
    'Satisfactory reduction and implant position.', false,'reviewed', d4, now() - interval '2 days' + interval '10 hours', d2),
   ('e9d0000a-0000-4000-8000-00000000000a', c, adm5,'radiology','CT KUB',(now() - interval '9 days')::date,'In-house Radiology',
    'A 9 mm calculus in the right mid-ureter with proximal hydroureteronephrosis. Left kidney normal. No other calculi.',
    'Obstructing right mid-ureteric calculus with moderate hydronephrosis.', true,'reviewed', d5, now() - interval '9 days' + interval '10 hours', d2),
   ('e9d0000a-0000-4000-8000-00000000000b', c, adm4,'radiology','Obstetric Ultrasound with Doppler',(now() - interval '6 days')::date,'In-house Radiology',
    'Single live intrauterine foetus, cephalic presentation, estimated foetal weight 2.85 kg. AFI 8.2 cm. Umbilical artery Doppler shows raised S/D ratio.',
    'Term pregnancy with borderline Doppler — correlate with CTG.', true,'reviewed', d3, now() - interval '6 days' + interval '4 hours', d2)
  ON CONFLICT (id) DO NOTHING;

  -- =========================================================================
  -- 12. Cross consultations
  -- =========================================================================
  INSERT INTO public.ipd_consultations
    (id, clinic_id, admission_id, specialty, doctor_id, external_doctor_name, reason, urgency, status, opinion, requested_by, requested_at, seen_by, seen_at)
  VALUES
   ('e9d0000b-0000-4000-8000-000000000001', c, adm2,'cardiology', d3, NULL,
    'Sinus tachycardia with a history of type 2 diabetes — rule out silent ischaemia','urgent','seen',
    'ECG shows sinus tachycardia with no ischaemic changes. 2D Echo — normal LV function, EF 58%, no regional wall motion abnormality. No evidence of acute coronary syndrome. Continue current management; start a statin at discharge.',
    d1, now() - interval '3 days' + interval '6 hours', d3, now() - interval '3 days' + interval '10 hours'),
   ('e9d0000b-0000-4000-8000-000000000002', c, adm2,'dietetics', NULL,'Ms. Kavita Deshmukh, Clinical Dietician',
    'Diabetic diet planning and counselling before discharge','routine','seen',
    'Prescribed a 1600 kcal diabetic diet split into three meals and two snacks, with 60 g protein. Carbohydrate counting explained to the patient and daughter. Advised to avoid fruit juices and to take a bedtime snack when on basal insulin.',
    d1, now() - interval '2 days' + interval '11 hours', NULL, now() - interval '2 days' + interval '14 hours'),
   ('e9d0000b-0000-4000-8000-000000000003', c, adm6,'medicine', d1, NULL,
    'Pre-operative fitness for a 71-year-old with hypertension','urgent','seen',
    'Blood pressure controlled on current medication. ECG and chest X-ray acceptable. Renal function normal. Fit for surgery under spinal anaesthesia — moderate risk. Advised DVT prophylaxis and early mobilisation.',
    d4, now() - interval '5 days' + interval '23 hours', d1, now() - interval '4 days' + interval '9 hours'),
   ('e9d0000b-0000-4000-8000-000000000004', c, adm6,'physiotherapy', NULL,'Mr. Sameer Wagh, Physiotherapist',
    'Post-operative rehabilitation after femoral plating','routine','seen',
    'Started static quadriceps, ankle pump and hip abduction exercises. Non-weight bearing walker mobilisation planned from post-operative day 3. Chest physiotherapy twice daily. Home exercise programme to be taught before discharge.',
    d4, now() - interval '2 days' + interval '9 hours', NULL, now() - interval '2 days' + interval '12 hours'),
   ('e9d0000b-0000-4000-8000-000000000005', c, adm4,'paediatrics', d2, NULL,
    'Newborn assessment after emergency LSCS','stat','seen',
    'Female baby, birth weight 2.9 kg, APGAR 8 at 1 minute and 9 at 5 minutes. No resuscitation required. Vitals stable, reflexes normal, no congenital anomaly detected. Breastfeeding established. Vitamin K given. Newborn screening sent.',
    d3, now() - interval '6 days' + interval '7 hours', d2, now() - interval '6 days' + interval '8 hours')
  ON CONFLICT (id) DO NOTHING;

  -- =========================================================================
  -- 13. Diet orders and diet chart
  -- =========================================================================
  INSERT INTO public.ipd_diet_orders
    (id, clinic_id, admission_id, diet_type, route, calories_kcal, protein_g,
     special_instructions, restrictions, start_date, end_date, status, ordered_by)
  VALUES
   ('e9d0000c-0000-4000-8000-000000000001', c, adm1,'liquid','oral', 800, 25,'Clear liquids only on the day of surgery','Nil by mouth till 6 hours post-op',(now() - interval '3 days')::date,(now() - interval '2 days')::date,'stopped', d5),
   ('e9d0000c-0000-4000-8000-000000000002', c, adm1,'soft','oral',1800, 60,'Step up to a normal diet as tolerated','Avoid spicy and fried food',(now() - interval '2 days')::date, NULL,'active', d5),
   ('e9d0000c-0000-4000-8000-000000000003', c, adm2,'diabetic','oral',1600, 60,'Three meals and two snacks, carbohydrate counting explained. Bedtime snack when on basal insulin.','No sugar, sweets, fruit juices or refined flour',(now() - interval '2 days')::date, NULL,'active', d1),
   ('e9d0000c-0000-4000-8000-000000000004', c, adm3,'normal','oral',2000, 65,'Encourage oral fluids, at least 3 litres a day','Avoid very hot food if there is mouth soreness',(now() - interval '2 days')::date, NULL,'active', d1),
   ('e9d0000c-0000-4000-8000-000000000005', c, adm6,'high_protein','oral',2200, 90,'High protein for fracture healing; calcium-rich foods','Low salt — patient is hypertensive',(now() - interval '4 days')::date, NULL,'active', d4),
   ('e9d0000c-0000-4000-8000-000000000006', c, adm4,'normal','oral',2400, 75,'Lactation diet — extra fluids and protein','Nil',(now() - interval '5 days')::date,(now() - interval '2 days')::date,'stopped', d3)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.ipd_diet_chart_entries
    (clinic_id, admission_id, diet_order_id, entry_date, meal, items, status, intake_percent, served_by, served_at, created_by)
  SELECT c, v.adm, v.dord::uuid, today, v.meal, v.items, v.st, v.pct, d2, now() - interval '3 hours', d2
    FROM (VALUES
    (adm1,'e9d0000c-0000-4000-8000-000000000002','breakfast','Upma, banana, milk without sugar','served', 90),
    (adm1,'e9d0000c-0000-4000-8000-000000000002','mid_morning','Coconut water','served',100),
    (adm1,'e9d0000c-0000-4000-8000-000000000002','lunch','Soft chapati, dal, rice, bottle gourd sabzi, curd','served', 80),
    (adm1,'e9d0000c-0000-4000-8000-000000000002','evening','Vegetable soup and biscuits','planned', NULL),
    (adm2,'e9d0000c-0000-4000-8000-000000000003','breakfast','2 idli with sambar, sugar-free tea','served', 75),
    (adm2,'e9d0000c-0000-4000-8000-000000000003','mid_morning','Roasted chana, buttermilk','served',100),
    (adm2,'e9d0000c-0000-4000-8000-000000000003','lunch','2 multigrain chapati, dal, palak sabzi, salad, curd','served', 85),
    (adm2,'e9d0000c-0000-4000-8000-000000000003','evening','Sprouts salad, sugar-free tea','planned', NULL),
    (adm3,'e9d0000c-0000-4000-8000-000000000004','breakfast','Poha, boiled egg, milk','served', 70),
    (adm3,'e9d0000c-0000-4000-8000-000000000004','mid_morning','Tender coconut water, papaya','served',100),
    (adm3,'e9d0000c-0000-4000-8000-000000000004','lunch','Rice, dal, mixed vegetable, curd','served', 60),
    (adm3,'e9d0000c-0000-4000-8000-000000000004','evening','Fruit juice and khakhra','planned', NULL),
    (adm6,'e9d0000c-0000-4000-8000-000000000005','breakfast','3 idli, sambar, 2 egg whites, milk','served', 95),
    (adm6,'e9d0000c-0000-4000-8000-000000000005','lunch','2 chapati, dal, paneer sabzi, curd, salad','served', 90),
    (adm6,'e9d0000c-0000-4000-8000-000000000005','evening','Sprouts chaat and milk','planned', NULL)
    ) AS v(adm, dord, meal, items, st, pct)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.ipd_diet_chart_entries e
      WHERE e.admission_id = v.adm AND e.entry_date = today AND e.meal = v.meal);

  -- =========================================================================
  -- 14. Charge postings — room rent + nursing, per bed-day
  -- =========================================================================
  INSERT INTO public.charge_postings
    (clinic_id, admission_id, service_id, charge_group_id, source, service_date,
     quantity, unit_rate, gross_amount, net_amount)
  SELECT c, ba.admission_id, sv.id, sv.charge_group_id,'room_rent_job', g.d::date, 1,
         public.resolve_tariff_rate(sv.id, a.tariff_plan_id), 0, 0
    FROM public.ipd_bed_allocations ba
    JOIN public.ipd_admissions a  ON a.id = ba.admission_id
    JOIN public.ipd_beds b        ON b.id = ba.bed_id
    JOIN public.bed_types bt      ON bt.id = b.bed_type_id
    CROSS JOIN LATERAL (VALUES (bt.room_rent_service_id), (bt.nursing_service_id)) AS svc(sid)
    JOIN public.services_master sv ON sv.id = svc.sid
    CROSS JOIN LATERAL generate_series(
      ba.from_datetime::date,
      LEAST(COALESCE(ba.to_datetime, now()), now())::date,
      interval '1 day') AS g(d)
   WHERE ba.admission_id IN (adm1, adm2, adm3, adm4, adm5, adm6)
     AND NOT EXISTS (
       SELECT 1 FROM public.charge_postings cp
        WHERE cp.admission_id = ba.admission_id
          AND cp.service_id = sv.id
          AND cp.service_date = g.d::date
          AND cp.source = 'room_rent_job');

  -- 14.1 Daily consultant rounds --------------------------------------------
  INSERT INTO public.charge_postings
    (clinic_id, admission_id, service_id, charge_group_id, source, service_date,
     quantity, unit_rate, gross_amount, net_amount, ordering_doctor_id, performing_doctor_id)
  SELECT c, a.id, sv.id, sv.charge_group_id,'manual', g.d::date, 1,
         public.resolve_tariff_rate(sv.id, a.tariff_plan_id), 0, 0,
         a.treating_doctor_id, a.treating_doctor_id
    FROM public.ipd_admissions a
    JOIN public.services_master sv
      ON sv.clinic_id = c
     AND sv.service_code = CASE WHEN a.id = adm2 THEN 'CONS-ICU' ELSE 'CONS-ROUND' END
    CROSS JOIN LATERAL generate_series(
      a.admission_datetime::date,
      LEAST(COALESCE(a.discharge_datetime, now()), now())::date,
      interval '1 day') AS g(d)
   WHERE a.id IN (adm1, adm2, adm3, adm4, adm5, adm6)
     AND NOT EXISTS (
       SELECT 1 FROM public.charge_postings cp
        WHERE cp.admission_id = a.id AND cp.service_id = sv.id AND cp.service_date = g.d::date);

  -- 14.2 Everything else: procedures, investigations, drugs, consumables ----
  INSERT INTO public.charge_postings
    (clinic_id, admission_id, service_id, charge_group_id, source, service_date,
     quantity, unit_rate, gross_amount, net_amount, ordering_doctor_id, performing_doctor_id)
  SELECT c, v.adm, s.id, s.charge_group_id, v.src::public.charge_source_enum,
         (a.admission_datetime + (v.dayoff || ' days')::interval)::date,
         v.qty, public.resolve_tariff_rate(s.id, a.tariff_plan_id), 0, 0,
         a.treating_doctor_id, a.treating_doctor_id
    FROM (VALUES
    -- ---- adm1 : laparoscopic appendicectomy --------------------------------
    (adm1,'MISC-ADM',   0, 1,'manual'),
    (adm1,'LAB-CBC',    0, 1,'order'),
    (adm1,'LAB-COAG',   0, 1,'order'),
    (adm1,'LAB-KFT',    0, 1,'order'),
    (adm1,'RAD-USG',    0, 1,'order'),
    (adm1,'RAD-ECG',    0, 1,'order'),
    (adm1,'OT-APPY',    0, 1,'ot'),
    (adm1,'ANAES-GA',   0, 1,'ot'),
    (adm1,'OT-CHARGE',  0, 1,'ot'),
    (adm1,'CON-LAPKIT', 0, 1,'ot'),
    (adm1,'PH-CEFTRI',  0, 2,'pharmacy'),
    (adm1,'PH-CEFTRI',  1, 2,'pharmacy'),
    (adm1,'PH-CEFTRI',  2, 2,'pharmacy'),
    (adm1,'PH-PAN',     0, 1,'pharmacy'),
    (adm1,'PH-PAN',     1, 1,'pharmacy'),
    (adm1,'PH-PAN',     2, 1,'pharmacy'),
    (adm1,'PH-RL500',   0, 3,'pharmacy'),
    (adm1,'PH-RL500',   1, 3,'pharmacy'),
    (adm1,'PH-TRAMA',   0, 2,'emar'),
    (adm1,'PH-TRAMA',   1, 1,'emar'),
    (adm1,'CON-IVSET',  0, 2,'pharmacy'),
    (adm1,'DRS-SMALL',  1, 1,'manual'),
    (adm1,'DRS-SMALL',  2, 1,'manual'),
    (adm1,'SUP-BIOMED', 0, 1,'manual'),
    -- ---- adm2 : DKA + LRTI in ICU ------------------------------------------
    (adm2,'MISC-ADM',   0, 1,'manual'),
    (adm2,'LAB-ABG',    0, 2,'order'),
    (adm2,'LAB-ABG',    1, 2,'order'),
    (adm2,'LAB-ELEC',   0, 2,'order'),
    (adm2,'LAB-ELEC',   1, 2,'order'),
    (adm2,'LAB-RBS',    0, 8,'order'),
    (adm2,'LAB-RBS',    1, 6,'order'),
    (adm2,'LAB-RBS',    2, 4,'order'),
    (adm2,'LAB-RBS',    3, 4,'order'),
    (adm2,'LAB-KFT',    0, 1,'order'),
    (adm2,'LAB-CBC',    0, 1,'order'),
    (adm2,'LAB-CBC',    2, 1,'order'),
    (adm2,'LAB-CULT',   0, 1,'order'),
    (adm2,'RAD-XRAY',   0, 1,'order'),
    (adm2,'RAD-ECG',    0, 1,'order'),
    (adm2,'RAD-ECHO',   1, 1,'order'),
    (adm2,'PRC-CATH',   0, 1,'manual'),
    (adm2,'CON-FOLEY',  0, 1,'pharmacy'),
    (adm2,'PH-INSULIN', 0, 1,'emar'),
    (adm2,'PH-INSULIN', 2, 1,'emar'),
    (adm2,'PH-NS500',   0, 6,'pharmacy'),
    (adm2,'PH-NS500',   1, 4,'pharmacy'),
    (adm2,'PH-PIPTAZ',  0, 3,'emar'),
    (adm2,'PH-PIPTAZ',  1, 3,'emar'),
    (adm2,'PH-PIPTAZ',  2, 3,'emar'),
    (adm2,'PH-PIPTAZ',  3, 3,'emar'),
    (adm2,'PH-PAN',     0, 1,'emar'),
    (adm2,'PH-PAN',     1, 1,'emar'),
    (adm2,'PH-PAN',     2, 1,'emar'),
    (adm2,'SUP-O2',     0,18,'manual'),
    (adm2,'SUP-O2',     1,14,'manual'),
    (adm2,'SUP-MONITOR',0, 1,'manual'),
    (adm2,'SUP-MONITOR',1, 1,'manual'),
    (adm2,'SUP-MONITOR',2, 1,'manual'),
    (adm2,'SUP-MONITOR',3, 1,'manual'),
    (adm2,'CON-IVSET',  0, 3,'pharmacy'),
    (adm2,'SUP-DIET',   2, 1,'manual'),
    (adm2,'CONS-CROSS', 1, 1,'manual'),
    -- ---- adm3 : dengue -------------------------------------------------------
    (adm3,'MISC-ADM',   0, 1,'manual'),
    (adm3,'LAB-CBC',    0, 2,'order'),
    (adm3,'LAB-CBC',    1, 2,'order'),
    (adm3,'LAB-CBC',    2, 1,'order'),
    (adm3,'LAB-DENGUE', 0, 1,'order'),
    (adm3,'LAB-LFT',    0, 1,'order'),
    (adm3,'LAB-URINE',  0, 1,'order'),
    (adm3,'PH-RL500',   0, 4,'pharmacy'),
    (adm3,'PH-RL500',   1, 3,'pharmacy'),
    (adm3,'PH-PCM100',  0, 3,'emar'),
    (adm3,'PH-PCM100',  1, 2,'emar'),
    (adm3,'PH-PAN',     0, 1,'emar'),
    (adm3,'PH-PAN',     1, 1,'emar'),
    (adm3,'CON-IVSET',  0, 1,'pharmacy'),
    -- ---- adm4 : LSCS -----------------------------------------------------------
    (adm4,'MISC-ADM',   0, 1,'manual'),
    (adm4,'LAB-CBC',    0, 1,'order'),
    (adm4,'LAB-CBC',    3, 1,'order'),
    (adm4,'LAB-URINE',  0, 1,'order'),
    (adm4,'RAD-USGOBS', 0, 1,'order'),
    (adm4,'OT-LSCS',    0, 1,'ot'),
    (adm4,'ANAES-SA',   0, 1,'ot'),
    (adm4,'OT-CHARGE',  0, 1,'ot'),
    (adm4,'CON-FOLEY',  0, 1,'pharmacy'),
    (adm4,'CON-DRESS',  1, 1,'pharmacy'),
    (adm4,'CON-DRESS',  3, 1,'pharmacy'),
    (adm4,'PH-CEFTRI',  0, 2,'emar'),
    (adm4,'PH-CEFTRI',  1, 2,'emar'),
    (adm4,'PH-CEFTRI',  2, 2,'emar'),
    (adm4,'PH-TRAMA',   0, 3,'emar'),
    (adm4,'PH-TRAMA',   1, 2,'emar'),
    (adm4,'PH-PAN',     0, 1,'emar'),
    (adm4,'PH-PAN',     1, 1,'emar'),
    (adm4,'PH-RL500',   0, 4,'pharmacy'),
    (adm4,'CONS-CROSS', 0, 1,'manual'),
    (adm4,'SUP-BIOMED', 0, 1,'manual'),
    -- ---- adm5 : DJ stenting ------------------------------------------------------
    (adm5,'MISC-ADM',   0, 1,'manual'),
    (adm5,'LAB-CBC',    0, 1,'order'),
    (adm5,'LAB-KFT',    0, 1,'order'),
    (adm5,'RAD-CTABD',  0, 1,'order'),
    (adm5,'OT-DJSTENT', 0, 1,'ot'),
    (adm5,'IMP-DJ',     0, 1,'ot'),
    (adm5,'ANAES-SA',   0, 1,'ot'),
    (adm5,'OT-CHARGE',  0, 1,'ot'),
    (adm5,'PH-CEFTRI',  0, 2,'emar'),
    (adm5,'PH-CEFTRI',  1, 1,'emar'),
    (adm5,'PH-TRAMA',   0, 2,'emar'),
    (adm5,'CON-IVSET',  0, 1,'pharmacy'),
    (adm5,'SUP-BIOMED', 0, 1,'manual'),
    -- ---- adm6 : ORIF femur (MLC) -------------------------------------------------
    (adm6,'MISC-ADM',   0, 1,'manual'),
    (adm6,'MISC-MLC',   0, 1,'manual'),
    (adm6,'RAD-XRAY',   0, 2,'order'),
    (adm6,'RAD-XRAY',   3, 1,'order'),
    (adm6,'LAB-CBC',    0, 1,'order'),
    (adm6,'LAB-CBC',    3, 1,'order'),
    (adm6,'LAB-COAG',   0, 1,'order'),
    (adm6,'LAB-KFT',    0, 1,'order'),
    (adm6,'RAD-ECG',    0, 1,'order'),
    (adm6,'CONS-CROSS', 1, 1,'manual'),
    (adm6,'OT-ORIF',    2, 1,'ot'),
    (adm6,'IMP-PLATE',  2, 1,'ot'),
    (adm6,'ANAES-SA',   2, 1,'ot'),
    (adm6,'OT-CHARGE',  2, 1,'ot'),
    (adm6,'PH-CEFTRI',  2, 2,'emar'),
    (adm6,'PH-CEFTRI',  3, 2,'emar'),
    (adm6,'PH-CEFTRI',  4, 2,'emar'),
    (adm6,'PH-ENOXA',   2, 1,'emar'),
    (adm6,'PH-ENOXA',   3, 1,'emar'),
    (adm6,'PH-ENOXA',   4, 1,'emar'),
    (adm6,'PH-TRAMA',   2, 3,'emar'),
    (adm6,'PH-TRAMA',   3, 3,'emar'),
    (adm6,'PH-TRAMA',   4, 2,'emar'),
    (adm6,'PH-PAN',     2, 1,'emar'),
    (adm6,'PH-PAN',     3, 1,'emar'),
    (adm6,'PH-PAN',     4, 1,'emar'),
    (adm6,'PH-RL500',   2, 3,'pharmacy'),
    (adm6,'CON-IVSET',  0, 2,'pharmacy'),
    (adm6,'CON-DRESS',  2, 1,'pharmacy'),
    (adm6,'CON-DRESS',  4, 1,'pharmacy'),
    (adm6,'SUP-PHYSIO', 3, 1,'manual'),
    (adm6,'SUP-PHYSIO', 4, 1,'manual'),
    (adm6,'SUP-BIOMED', 0, 1,'manual')
    ) AS v(adm, svc, dayoff, qty, src)
    JOIN public.ipd_admissions a   ON a.id = v.adm
    JOIN public.services_master s  ON s.clinic_id = c AND s.service_code = v.svc
   WHERE NOT EXISTS (
     SELECT 1 FROM public.charge_postings cp
      WHERE cp.admission_id = v.adm
        AND cp.service_id = s.id
        AND cp.service_date = (a.admission_datetime + (v.dayoff || ' days')::interval)::date
        AND cp.source = v.src::public.charge_source_enum);

  -- =========================================================================
  -- 15. Deposits
  -- =========================================================================
  INSERT INTO public.ipd_deposits
    (clinic_id, admission_id, receipt_number, amount, entry_type, payment_method, reference, received_by, received_at, notes)
  SELECT c, v.adm, v.rcpt, v.amt,'deposit', v.method, v.ref, d1, v.at, v.note
    FROM (VALUES
    (adm1,'DEP-DEMO-001', 25000::numeric,'upi', 'UPI/4471820011', now() - interval '3 days' + interval '5 hours','Advance on admission'),
    (adm1,'DEP-DEMO-002', 30000::numeric,'card','HDFC/XXXX4412',  now() - interval '2 days' + interval '10 hours','Top-up after surgery'),
    (adm2,'DEP-DEMO-003', 50000::numeric,'neft','NEFT/SBIN9902',  now() - interval '4 days' + interval '6 hours','ICU advance'),
    (adm2,'DEP-DEMO-004', 40000::numeric,'upi', 'UPI/4471820188', now() - interval '2 days' + interval '9 hours','Top-up — insurance pre-auth pending'),
    (adm3,'DEP-DEMO-005', 15000::numeric,'cash', NULL,            now() - interval '2 days' + interval '12 hours','Advance on admission'),
    (adm4,'DEP-DEMO-006', 40000::numeric,'card','ICICI/XXXX8890', now() - interval '6 days' + interval '4 hours','LSCS advance'),
    (adm4,'DEP-DEMO-007', 25000::numeric,'upi', 'UPI/4471820245', now() - interval '4 days' + interval '11 hours','Top-up'),
    (adm5,'DEP-DEMO-008', 35000::numeric,'upi', 'UPI/4471820301', now() - interval '9 days' + interval '9 hours','Procedure advance'),
    (adm6,'DEP-DEMO-009', 60000::numeric,'neft','NEFT/HDFC7741',  now() - interval '5 days' + interval '23 hours','Advance including implant'),
    (adm6,'DEP-DEMO-010', 50000::numeric,'cash', NULL,            now() - interval '2 days' + interval '10 hours','Top-up after surgery')
    ) AS v(adm, rcpt, amt, method, ref, at, note)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.ipd_deposits x WHERE x.clinic_id = c AND x.receipt_number = v.rcpt);

  -- =========================================================================
  -- 16. Bills — final for the discharged, interim for one active admission
  -- =========================================================================
  IF NOT EXISTS (SELECT 1 FROM public.ipd_bills WHERE admission_id = adm4) THEN
    v_bill := public.generate_ipd_bill(adm4,'final', d3);
    UPDATE public.ipd_bills SET bill_datetime = now() - interval '2 days' + interval '9 hours' WHERE id = v_bill;
    INSERT INTO public.ipd_payments (clinic_id, bill_id, receipt_number, amount, payer_kind, payment_method, reference, received_by, received_at)
    SELECT c, v_bill,'RCP-DEMO-001', b.balance_amount,'patient','upi','UPI/4471820399', d1, now() - interval '2 days' + interval '10 hours'
      FROM public.ipd_bills b WHERE b.id = v_bill AND b.balance_amount > 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ipd_bills WHERE admission_id = adm5) THEN
    v_bill := public.generate_ipd_bill(adm5,'final', d5);
    UPDATE public.ipd_bills SET bill_datetime = now() - interval '7 days' + interval '10 hours' WHERE id = v_bill;
    INSERT INTO public.ipd_payments (clinic_id, bill_id, receipt_number, amount, payer_kind, payment_method, reference, received_by, received_at)
    SELECT c, v_bill,'RCP-DEMO-002', b.balance_amount,'patient','card','HDFC/XXXX7723', d1, now() - interval '7 days' + interval '11 hours'
      FROM public.ipd_bills b WHERE b.id = v_bill AND b.balance_amount > 0;
  END IF;

  -- Interim bill on the ICU admission so the billing screen has a live example
  IF NOT EXISTS (SELECT 1 FROM public.ipd_bills WHERE admission_id = adm2) THEN
    v_bill := public.generate_ipd_bill(adm2,'interim', d1);
  END IF;

  -- =========================================================================
  -- 17. Generated IPD documents (resolved content, ready to preview or print)
  -- =========================================================================
  INSERT INTO public.ipd_documents
    (id, clinic_id, admission_id, template_id, doc_type, document_number, content_html,
     status, signed_by, signed_at, created_by, created_at)
  VALUES

  -- 17.1 adm1 — admission sheet (finalized)
  ('e9d00005-0000-4000-8000-000000000001', c, adm1,
   (SELECT id FROM public.ipd_document_templates WHERE clinic_id = c AND name = 'Admission Sheet — General'),
   'admission_sheet','DOC-DEMO-0001',
   '<h2 style="text-align:center;margin:0 0 4px">ADMISSION / CASE SHEET</h2>
<p><b>Patient:</b> Arjun Patil (27y / male) &nbsp; <b>Admission No:</b> ADM-DEMO-001 &nbsp; <b>Ward/Bed:</b> Private Wing / P-1</p>
<h3>Presenting Complaints</h3>
<p>Pain around the umbilicus shifting to the right lower abdomen since 1 day, associated with two episodes of vomiting and loss of appetite.</p>
<h3>History of Present Illness</h3>
<p>Pain started as a dull ache around the umbilicus yesterday morning, became sharp and localised to the right iliac fossa by evening. Aggravated by movement and coughing. No urinary symptoms, no loose motions, no similar episodes in the past.</p>
<h3>Past History</h3>
<p>No diabetes, hypertension, tuberculosis or asthma. No previous surgery. No known drug allergy.</p>
<h3>General Examination</h3>
<p>Conscious, oriented, mildly dehydrated. Temp 100.8F, PR 98/min, BP 122/78 mmHg, RR 18/min, SpO2 98% on room air. No pallor, icterus or lymphadenopathy.</p>
<h3>Systemic Examination</h3>
<p><b>P/A:</b> Tenderness and guarding at McBurney point, rebound tenderness positive, Rovsing sign positive, bowel sounds present. <b>CVS:</b> S1 S2 normal. <b>RS:</b> Bilateral air entry equal, clear. <b>CNS:</b> No focal deficit.</p>
<h3>Provisional Diagnosis</h3>
<p>Acute appendicitis (Alvarado score 8).</p>
<h3>Plan of Management</h3>
<p>Nil by mouth, IV fluids, IV antibiotics and analgesia. Pre-operative workup sent. Posted for emergency laparoscopic appendicectomy. Consent taken, parts prepared, blood grouping done.</p>',
   'finalized', NULL, NULL, d5, now() - interval '3 days' + interval '5 hours'),

  -- 17.2 adm1 — surgical consent (signed)
  ('e9d00005-0000-4000-8000-000000000002', c, adm1,
   (SELECT id FROM public.ipd_document_templates WHERE clinic_id = c AND name = 'Consent — Surgery & Anaesthesia'),
   'consent','DOC-DEMO-0002',
   '<h2 style="text-align:center;margin:0 0 4px">CONSENT FOR SURGERY AND ANAESTHESIA</h2>
<p><b>Patient:</b> Arjun Patil (27y / male) &nbsp; <b>Admission No:</b> ADM-DEMO-001</p>
<h3>Procedure / Treatment Proposed</h3>
<p>Emergency laparoscopic appendicectomy under general anaesthesia.</p>
<h3>Explanation Given</h3>
<p>The nature of the illness, the proposed procedure, the expected benefit and the likely course of recovery have been explained to the patient and his brother in Marathi.</p>
<h3>Risks &amp; Complications Explained</h3>
<ul><li>Risks of general anaesthesia</li><li>Bleeding, infection and port site hernia</li><li>Injury to adjacent bowel or vessels</li><li>Conversion to open surgery if required</li><li>Prolonged stay or a second procedure if complications occur</li></ul>
<h3>Alternatives Discussed</h3>
<p>Conservative antibiotic management and open appendicectomy were discussed along with their consequences.</p>
<h3>Consent Declaration</h3>
<p>Free and informed consent given for the procedure and anaesthesia, including any additional procedure that becomes necessary during surgery.</p>
<p><b>Signed by:</b> Arjun Patil (self) &nbsp;&nbsp; <b>Witness:</b> Sunil Patil (brother)</p>',
   'signed', d5, now() - interval '3 days' + interval '6 hours', d5, now() - interval '3 days' + interval '6 hours'),

  -- 17.3 adm1 — OT note (signed)
  ('e9d00005-0000-4000-8000-000000000003', c, adm1,
   (SELECT id FROM public.ipd_document_templates WHERE clinic_id = c AND name = 'OT Note — General Surgery'),
   'ot_note','DOC-DEMO-0003',
   '<h2 style="text-align:center;margin:0 0 4px">OPERATION THEATRE NOTE</h2>
<p><b>Patient:</b> Arjun Patil (27y / male) &nbsp; <b>Admission No:</b> ADM-DEMO-001 &nbsp; <b>Blood Group:</b> A+</p>
<h3>Pre-operative Diagnosis</h3><p>Acute appendicitis</p>
<h3>Post-operative Diagnosis</h3><p>Acute suppurative appendicitis, non-perforated</p>
<h3>Procedure Performed</h3><p>Laparoscopic appendicectomy (three-port technique)</p>
<h3>Date &amp; Time of Surgery</h3><p>Start: 19:10 &nbsp;&nbsp; End: 19:55 &nbsp;&nbsp; Duration: 45 minutes</p>
<h3>Surgical Team</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="35%"><b>Surgeon</b></td><td>Consultant General Surgeon</td></tr>
  <tr><td><b>Assistant</b></td><td>Surgical Registrar</td></tr>
  <tr><td><b>Anaesthetist</b></td><td>Consultant Anaesthesiologist</td></tr>
  <tr><td><b>Scrub Nurse</b></td><td>Sr. Anita More</td></tr>
</table>
<h3>Anaesthesia</h3><p>General anaesthesia with endotracheal intubation. ASA Grade I.</p>
<h3>Position &amp; Incision</h3><p>Supine with left tilt. Ports: 10 mm umbilical (camera), 5 mm left iliac fossa, 5 mm suprapubic.</p>
<h3>Operative Findings</h3><p>Inflamed, oedematous retrocaecal appendix measuring about 8 cm with fibrinous exudate over the serosa. Minimal turbid free fluid in the pelvis. No perforation. Caecum and terminal ileum normal.</p>
<h3>Procedure in Detail</h3><p>Pneumoperitoneum created by the closed technique to 12 mmHg. Ports placed under vision. Adhesions released. Mesoappendix cauterised and divided. Base of the appendix secured with two endoloops and divided. Appendix retrieved in an endobag through the umbilical port. Peritoneal lavage with warm saline. Haemostasis confirmed. Ports removed under vision, fascia at the umbilical port closed with Vicryl 1-0, skin closed with subcuticular Monocryl 3-0.</p>
<h3>Specimen / Implants</h3><p>Appendix sent for histopathology. No implants used.</p>
<h3>Blood Loss &amp; Fluids</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="35%"><b>Estimated blood loss</b></td><td>Under 30 ml</td></tr>
  <tr><td><b>IV fluids given</b></td><td>1000 ml Ringer Lactate</td></tr>
  <tr><td><b>Blood products</b></td><td>Nil</td></tr>
  <tr><td><b>Urine output</b></td><td>250 ml</td></tr>
</table>
<h3>Counts &amp; Closure</h3><p>Sponge, instrument and needle counts correct. No drain kept.</p>
<h3>Post-operative Instructions</h3>
<ul><li>Nil by mouth for 6 hours, then sips of water</li><li>Vitals 2-hourly for 12 hours</li><li>Inj Ceftriaxone 1g IV BD, Inj Pantoprazole 40mg IV OD, Inj Tramadol 50mg IV SOS</li><li>Early ambulation from this evening</li><li>Inform if there is tachycardia, fever, abdominal distension or port site soakage</li></ul>',
   'signed', d5, now() - interval '3 days' + interval '13 hours', d5, now() - interval '3 days' + interval '12 hours'),

  -- 17.4 adm2 — high risk consent (signed)
  ('e9d00005-0000-4000-8000-000000000004', c, adm2,
   (SELECT id FROM public.ipd_document_templates WHERE clinic_id = c AND name = 'Consent — High Risk'),
   'consent','DOC-DEMO-0004',
   '<h2 style="text-align:center;margin:0 0 4px">HIGH RISK CONSENT</h2>
<p><b>Patient:</b> Vikram Joshi (62y / male) &nbsp; <b>Admission No:</b> ADM-DEMO-002 &nbsp; <b>Ward/Bed:</b> ICU / ICU-1</p>
<h3>Diagnosis &amp; Current Condition</h3>
<p>Diabetic ketoacidosis with lower respiratory tract infection. Patient drowsy on admission with GCS 14, dehydrated, blood sugar 486 mg/dL, urine ketones 3+, arterial pH 7.18.</p>
<h3>Why This Patient Is High Risk</h3>
<ul><li>Severe metabolic derangement requiring insulin infusion</li><li>Long-standing poorly controlled type 2 diabetes</li><li>Age 62 with an active chest infection</li><li>Risk of cerebral oedema, arrhythmia and sepsis</li></ul>
<h3>Explanation Given</h3>
<p>Explained to the daughter in Marathi that despite the best available treatment the condition may deteriorate and may require ventilator support, dialysis or may result in death. No guarantee of outcome has been given.</p>
<h3>Consent Declaration</h3>
<p>Consent given for ICU care including intubation, ventilation, central line insertion, dialysis, blood transfusion and resuscitation as required.</p>
<p><b>Signed by:</b> Anjali Joshi (daughter) &nbsp;&nbsp; <b>Witness:</b> Ward Sister</p>',
   'signed', d1, now() - interval '3 days' + interval '21 hours', d1, now() - interval '3 days' + interval '21 hours'),

  -- 17.5 adm4 — LSCS OT note (signed)
  ('e9d00005-0000-4000-8000-000000000005', c, adm4,
   (SELECT id FROM public.ipd_document_templates WHERE clinic_id = c AND name = 'OT Note — LSCS (Caesarean)'),
   'ot_note','DOC-DEMO-0005',
   '<h2 style="text-align:center;margin:0 0 4px">OT NOTE — LOWER SEGMENT CAESAREAN SECTION</h2>
<p><b>Patient:</b> Priya Nair (29y) &nbsp; <b>Admission No:</b> ADM-DEMO-004 &nbsp; <b>Blood Group:</b> A-</p>
<h3>Pre-operative Diagnosis</h3><p>Primigravida at 39 weeks in labour with foetal distress</p>
<h3>Indication for LSCS</h3><p>Non-reassuring foetal heart rate pattern (recurrent late decelerations) with thick meconium-stained liquor.</p>
<h3>Procedure Performed</h3><p>Emergency Lower Segment Caesarean Section under spinal anaesthesia.</p>
<h3>Surgical Team</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="35%"><b>Obstetrician</b></td><td>Consultant Obstetrician</td></tr>
  <tr><td><b>Assistant</b></td><td>Registrar, Obs &amp; Gynae</td></tr>
  <tr><td><b>Anaesthetist</b></td><td>Consultant Anaesthesiologist</td></tr>
  <tr><td><b>Paediatrician</b></td><td>Consultant Paediatrician</td></tr>
</table>
<h3>Operative Findings</h3><p>Uterus term size. Liquor thick meconium-stained. Cord around the neck once, loose — reduced. Placenta anterior, delivered complete with membranes. Both tubes and ovaries normal.</p>
<h3>Baby Details</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="35%"><b>Time of delivery</b></td><td>07:42</td></tr>
  <tr><td><b>Sex</b></td><td>Female</td></tr>
  <tr><td><b>Birth weight</b></td><td>2.9 kg</td></tr>
  <tr><td><b>APGAR (1 / 5 min)</b></td><td>8 / 9</td></tr>
  <tr><td><b>Resuscitation needed</b></td><td>Oropharyngeal suction only</td></tr>
</table>
<h3>Procedure in Detail</h3><p>Pfannenstiel incision, layers opened, bladder flap raised, lower segment transverse uterine incision made, baby delivered by cephalic extraction, cord clamped and cut, handed over to the paediatrician. Placenta and membranes delivered complete. Uterine cavity cleaned. Uterus closed in two layers with Vicryl 1-0. Haemostasis secured. Counts correct. Layers closed, skin with subcuticular Monocryl.</p>
<h3>Blood Loss &amp; Fluids</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="35%"><b>Estimated blood loss</b></td><td>600 ml</td></tr>
  <tr><td><b>IV fluids</b></td><td>1500 ml</td></tr>
  <tr><td><b>Oxytocics given</b></td><td>Inj Oxytocin 10 IU IV followed by 20 IU in drip</td></tr>
</table>
<h3>Post-operative Instructions</h3>
<ul><li>Monitor vitals, uterine tone and per-vaginal bleeding 15-minutely for 2 hours, then hourly</li><li>Nil by mouth for 4 hours, then sips of water</li><li>IV fluids, antibiotics and analgesia as charted</li><li>Encourage early breastfeeding and skin-to-skin contact</li><li>Catheter removal after 12 hours</li></ul>',
   'signed', d3, now() - interval '6 days' + interval '10 hours', d3, now() - interval '6 days' + interval '9 hours'),

  -- 17.6 adm4 — discharge summary (signed)
  ('e9d00005-0000-4000-8000-000000000006', c, adm4,
   (SELECT id FROM public.ipd_document_templates WHERE clinic_id = c AND name = 'Discharge Summary — Surgical'),
   'discharge_summary','DOC-DEMO-0006',
   '<h2 style="text-align:center;margin:0 0 4px">DISCHARGE SUMMARY (SURGICAL)</h2>
<p><b>Patient:</b> Priya Nair (29y / female) &nbsp; <b>Admission No:</b> ADM-DEMO-004 &nbsp; <b>Stay:</b> 4 days</p>
<h3>Final Diagnosis</h3><p>Primigravida at 39 weeks with foetal distress — delivered by emergency LSCS. Live female baby, 2.9 kg.</p>
<h3>Procedure Performed</h3><p>Emergency Lower Segment Caesarean Section under spinal anaesthesia.</p>
<h3>Post-operative Course</h3>
<p>The post-operative period was uneventful. Vitals remained stable and the uterus stayed well contracted. Oral feeds were started after 4 hours and stepped up to a normal diet by day 1. The catheter was removed after 12 hours and the patient was ambulated. Breastfeeding was established on day 1 with lactation counselling. The wound was inspected on day 3 and found healthy. Haemoglobin at discharge was 10.8 g/dL. The baby was reviewed daily by the paediatrician, is feeding well and has passed urine and stool normally.</p>
<h3>Investigations</h3>
<p>CBC on admission: Hb 11.4 g/dL, TLC 11,200, platelets 2.6 lakh. CBC on day 3: Hb 10.8 g/dL. Urine routine normal. Obstetric ultrasound with Doppler — term single live foetus with borderline umbilical artery Doppler.</p>
<h3>Condition at Discharge</h3>
<p>Afebrile, haemodynamically stable, wound healthy with no discharge, uterus well contracted, lochia normal. Baby active, feeding well.</p>
<h3>Medications on Discharge</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr style="background:#f2f2f2"><th align="left">Medicine</th><th align="left">Dose</th><th align="left">Frequency</th><th align="left">Duration</th></tr>
  <tr><td>Tab Cefixime</td><td>200 mg</td><td>BD</td><td>5 days</td></tr>
  <tr><td>Tab Paracetamol</td><td>650 mg</td><td>TID</td><td>5 days</td></tr>
  <tr><td>Tab Ferrous Ascorbate + Folic Acid</td><td>100 mg</td><td>OD</td><td>3 months</td></tr>
  <tr><td>Tab Calcium + Vitamin D3</td><td>500 mg</td><td>BD</td><td>3 months</td></tr>
</table>
<h3>Diet Advice</h3><p>Normal lactation diet with extra fluids and protein. At least 3 litres of fluid a day.</p>
<h3>Wound Care &amp; Follow-up</h3>
<ul><li>Keep the wound clean and dry; sponge bath until suture inspection</li><li>Review in the OPD after 5 days for wound check</li><li>Exclusive breastfeeding for 6 months</li><li>Baby immunisation as per schedule</li><li>No heavy lifting for 6 weeks; contraception advice at the 6-week visit</li><li>Report immediately for fever, heavy bleeding, foul discharge or wound gaping</li></ul>',
   'signed', d3, now() - interval '2 days' + interval '10 hours', d3, now() - interval '2 days' + interval '9 hours'),

  -- 17.7 adm5 — discharge summary (signed)
  ('e9d00005-0000-4000-8000-000000000007', c, adm5,
   (SELECT id FROM public.ipd_document_templates WHERE clinic_id = c AND name = 'Discharge Summary — Surgical'),
   'discharge_summary','DOC-DEMO-0007',
   '<h2 style="text-align:center;margin:0 0 4px">DISCHARGE SUMMARY (SURGICAL)</h2>
<p><b>Patient:</b> Lata Bhosale (55y / female) &nbsp; <b>Admission No:</b> ADM-DEMO-005 &nbsp; <b>Stay:</b> 2 days</p>
<h3>Final Diagnosis</h3><p>Obstructing right mid-ureteric calculus (9 mm) with moderate hydroureteronephrosis.</p>
<h3>Procedure Performed</h3><p>Cystoscopy with right DJ stenting under spinal anaesthesia.</p>
<h3>Post-operative Course</h3>
<p>The procedure was uneventful. Urine cleared by the evening of surgery. Flank pain settled completely. The patient passed urine freely, took orally well and was ambulated the same evening. Renal function remained normal.</p>
<h3>Investigations</h3><p>CT KUB: 9 mm calculus in the right mid-ureter with moderate hydronephrosis. CBC normal. Serum creatinine 0.9 mg/dL.</p>
<h3>Condition at Discharge</h3><p>Comfortable, afebrile, passing clear urine, no flank pain. DJ stent in situ.</p>
<h3>Medications on Discharge</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr style="background:#f2f2f2"><th align="left">Medicine</th><th align="left">Dose</th><th align="left">Frequency</th><th align="left">Duration</th></tr>
  <tr><td>Tab Cefuroxime</td><td>500 mg</td><td>BD</td><td>5 days</td></tr>
  <tr><td>Tab Tamsulosin</td><td>0.4 mg</td><td>OD</td><td>21 days</td></tr>
  <tr><td>Tab Aceclofenac + Paracetamol</td><td>100/325 mg</td><td>BD</td><td>3 days</td></tr>
  <tr><td>Alkaline Citrate Syrup</td><td>10 ml</td><td>TID</td><td>15 days</td></tr>
</table>
<h3>Diet Advice</h3><p>At least 3 litres of water a day. Reduce salt, oxalate-rich foods (spinach, beetroot) and non-vegetarian protein.</p>
<h3>Wound Care &amp; Follow-up</h3>
<ul><li>DJ stent is in place — mild burning and urgency are expected</li><li>Review after 3 weeks for ESWL / stent removal planning — <b>the stent must not be forgotten</b></li><li>Report for fever with chills, inability to pass urine or frank blood in urine</li></ul>',
   'signed', d5, now() - interval '7 days' + interval '11 hours', d5, now() - interval '7 days' + interval '10 hours'),

  -- 17.8 adm6 — OT note (signed)
  ('e9d00005-0000-4000-8000-000000000008', c, adm6,
   (SELECT id FROM public.ipd_document_templates WHERE clinic_id = c AND name = 'OT Note — Orthopaedic (Implant)'),
   'ot_note','DOC-DEMO-0008',
   '<h2 style="text-align:center;margin:0 0 4px">OT NOTE — ORTHOPAEDIC PROCEDURE</h2>
<p><b>Patient:</b> Mohan Gaikwad (71y / male) &nbsp; <b>Admission No:</b> ADM-DEMO-006 &nbsp; <b>MLC No:</b> MLC/2026/0141</p>
<h3>Pre-operative Diagnosis</h3><p>Closed transverse fracture, shaft of right femur (RTA)</p>
<h3>Procedure Performed</h3><p>Right side marked and confirmed before induction. Open reduction and internal fixation of the right femoral shaft with a broad locking compression plate.</p>
<h3>Anaesthesia &amp; Position</h3><p>Spinal anaesthesia. Lateral position on a radiolucent table. Tourniquet not used.</p>
<h3>Operative Findings</h3><p>Transverse fracture at the junction of the middle and lower third of the femoral shaft with a small butterfly fragment. Haematoma evacuated. Bone quality osteopenic. No neurovascular injury.</p>
<h3>Implant Details</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="30%"><b>Implant</b></td><td>Broad Locking Compression Plate, 10 holes</td></tr>
  <tr><td><b>Make / Company</b></td><td>Stainless steel, 316L</td></tr>
  <tr><td><b>Size</b></td><td>10 holes with 8 locking screws</td></tr>
  <tr><td><b>Batch / Lot No</b></td><td>LOT-2026-DEMO-4471</td></tr>
  <tr><td><b>Sticker pasted</b></td><td>Yes — in the case sheet and OT register</td></tr>
</table>
<h3>Procedure in Detail</h3><p>Lateral approach to the femur. Vastus lateralis elevated. Fracture exposed and haematoma evacuated. Anatomical reduction achieved and held with reduction clamps. Broad LCP applied laterally and fixed with four bicortical locking screws proximally and four distally. Butterfly fragment secured with a lag screw. Reduction and implant position checked under the C-arm in AP and lateral views — satisfactory. Wound washed, haemostasis secured, closed in layers over no drain.</p>
<h3>Blood Loss &amp; Counts</h3><p>Estimated blood loss 350 ml. No transfusion required. Sponge, instrument and needle counts correct.</p>
<h3>Post-operative Instructions</h3>
<ul><li>Limb elevation and neurovascular check 2-hourly for 24 hours</li><li>Check X-ray on post-operative day 1</li><li>Inj Ceftriaxone 1g IV BD for 48 hours, then oral Cefuroxime</li><li>Inj Enoxaparin 40 mg SC OD for DVT prophylaxis</li><li>Static quadriceps and ankle pump exercises from day 1</li><li><b>Non-weight bearing</b> walker mobilisation from post-operative day 3</li><li>Physiotherapy twice daily</li></ul>',
   'signed', d4, now() - interval '3 days' + interval '13 hours', d4, now() - interval '3 days' + interval '13 hours'),

  -- 17.9 adm6 — estimate (finalized)
  ('e9d00005-0000-4000-8000-000000000009', c, adm6,
   (SELECT id FROM public.ipd_document_templates WHERE clinic_id = c AND name = 'Treatment Cost Estimate'),
   'estimate','DOC-DEMO-0009',
   '<h2 style="text-align:center;margin:0 0 4px">ESTIMATED COST OF TREATMENT</h2>
<p><b>Patient:</b> Mohan Gaikwad (71y / male) &nbsp; <b>Admission No:</b> ADM-DEMO-006 &nbsp; <b>Ward/Bed:</b> General Ward A / A-2</p>
<h3>Provisional Diagnosis</h3><p>Closed fracture shaft of right femur</p>
<h3>Proposed Treatment / Procedure</h3><p>Open reduction and internal fixation with a locking plate under spinal anaesthesia.</p>
<h3>Estimated Length of Stay</h3><p>7 to 8 days in the general ward. ICU care not anticipated.</p>
<h3>Estimated Cost Breakup</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr style="background:#f2f2f2"><th align="left">Head</th><th align="right">Amount (Rs.)</th></tr>
  <tr><td>Room rent &amp; nursing (8 days, general ward)</td><td align="right">15,200</td></tr>
  <tr><td>Consultant &amp; cross-consultation charges</td><td align="right">4,800</td></tr>
  <tr><td>Investigations (lab &amp; imaging)</td><td align="right">4,300</td></tr>
  <tr><td>Surgery, OT &amp; anaesthesia charges</td><td align="right">68,000</td></tr>
  <tr><td>Implant (locking plate + screws)</td><td align="right">22,000</td></tr>
  <tr><td>Pharmacy &amp; consumables</td><td align="right">12,500</td></tr>
  <tr><td>Physiotherapy &amp; support services</td><td align="right">2,200</td></tr>
  <tr style="background:#f2f2f2"><td><b>Estimated total</b></td><td align="right"><b>1,29,000</b></td></tr>
</table>
<h3>Notes &amp; Disclaimer</h3>
<p>This is an approximate estimate. The final bill may vary depending on the clinical course, additional investigations, extended stay or complications. Implant and high-end drug costs are billed at actuals.</p>',
   'finalized', NULL, NULL, d1, now() - interval '5 days' + interval '23 hours'),

  -- 17.10 adm3 — draft discharge summary (shows the draft state)
  ('e9d00005-0000-4000-8000-00000000000a', c, adm3,
   (SELECT id FROM public.ipd_document_templates WHERE clinic_id = c AND name = 'Discharge Summary — Medical'),
   'discharge_summary','DOC-DEMO-0010',
   '<h2 style="text-align:center;margin:0 0 4px">DISCHARGE SUMMARY</h2>
<p><b>Patient:</b> Sneha Rane (22y / female) &nbsp; <b>Admission No:</b> ADM-DEMO-003 &nbsp; <b>Ward/Bed:</b> General Ward A / A-1</p>
<h3>Final Diagnosis</h3><p>Dengue fever with thrombocytopenia (ICD-10: A90)</p>
<h3>Presenting Complaints</h3><p>High grade fever with severe body ache and retro-orbital headache for 5 days.</p>
<h3>Course in Hospital</h3>
<p>Admitted with a platelet count of 68,000 and warning signs. Managed with the dengue fluid protocol and paracetamol; NSAIDs were strictly avoided. The platelet count reached a nadir of 68,000 on day 1 and has trended upward to 94,000. The haematocrit stayed stable with no evidence of plasma leakage and there were no bleeding manifestations. The patient became afebrile from last night and is accepting a normal diet.</p>
<h3>Investigations</h3>
<p>Dengue NS1 positive, IgM positive. Serial platelets 68,000 → 74,000 → 94,000. Haematocrit 39-41%. LFT mildly raised transaminases. Urine routine normal.</p>
<h3>Condition at Discharge</h3><p>To be completed at discharge.</p>
<h3>Medications on Discharge</h3><p>To be completed at discharge.</p>
<h3>Advice &amp; Follow-up</h3>
<ul><li>Repeat CBC after 2 days</li><li>Plenty of oral fluids</li><li>No NSAIDs for 2 weeks</li><li>Mosquito precautions at home</li><li>Report for bleeding, severe abdominal pain, persistent vomiting or reduced urine output</li></ul>',
   'draft', NULL, NULL, d1, now() - interval '4 hours')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Demo data seeded for clinic %', c;
END
$seed$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
SELECT 'patients (demo)'   AS object, count(*) AS rows FROM public.patients          WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND referred_by = 'Demo Seed'
UNION ALL SELECT 'appointments',      count(*) FROM public.appointments        WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'visits',            count(*) FROM public.visits              WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'prescriptions',     count(*) FROM public.prescriptions       WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_admissions',    count(*) FROM public.ipd_admissions      WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_treatment_plans',count(*) FROM public.ipd_treatment_plans WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_vitals',        count(*) FROM public.ipd_vitals          WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_medication_orders', count(*) FROM public.ipd_medication_orders WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_order_items',   count(*) FROM public.ipd_order_items     WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_reports',       count(*) FROM public.ipd_reports         WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'charge_postings',   count(*) FROM public.charge_postings     WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_deposits',      count(*) FROM public.ipd_deposits        WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_bills',         count(*) FROM public.ipd_bills           WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_documents',     count(*) FROM public.ipd_documents       WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30';
