-- ============================================================================
-- DEMO SEED — PART 1 : Masters, EMR templates, prescription presets,
--                      IPD document templates
--
-- Target clinic : e9106ae7-98b5-44a5-9f57-98c480b34f30  (demo OPD + IPD)
-- Run in        : Supabase Dashboard → SQL Editor (runs as postgres, bypasses RLS)
-- Idempotent    : safe to re-run — every insert is ON CONFLICT DO NOTHING
-- Run order     : this file first, then demo_seed_2_patients_ipd.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: clinic must exist
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clinic_settings
                  WHERE id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30') THEN
    RAISE EXCEPTION 'Clinic e9106ae7-98b5-44a5-9f57-98c480b34f30 not found';
  END IF;
END $$;

-- Make sure IPD is switched on for the demo clinic
UPDATE public.clinic_settings
   SET ipd_enabled = true
 WHERE id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
   AND COALESCE(ipd_enabled, false) = false;

-- ---------------------------------------------------------------------------
-- 1. Built-in seeders (idempotent by design)
--    charge groups, core services, bed types, wards + beds, cash payer,
--    standard tariff plan, and the 5 stock prescription presets
-- ---------------------------------------------------------------------------
SELECT public.seed_ipd_masters('e9106ae7-98b5-44a5-9f57-98c480b34f30');
SELECT public.seed_default_presets('e9106ae7-98b5-44a5-9f57-98c480b34f30');

-- ---------------------------------------------------------------------------
-- 1b. Demo wards + beds
--     seed_ipd_masters() only creates its sample wards when the clinic has
--     NONE, so a clinic that already has its own wards gets nothing. These
--     three wards are what demo_seed_2 admits patients into — created here
--     explicitly, without touching any ward the clinic already has.
-- ---------------------------------------------------------------------------
INSERT INTO public.ipd_wards (clinic_id, name, floor, ward_type) VALUES
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'General Ward A', '1', 'general'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'Private Wing',   '2', 'private'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'ICU',            '1', 'icu')
ON CONFLICT (clinic_id, name) DO NOTHING;

INSERT INTO public.ipd_beds (clinic_id, ward_id, bed_number, bed_type_id)
SELECT 'e9106ae7-98b5-44a5-9f57-98c480b34f30', w.id, v.prefix || n, bt.id
  FROM (VALUES
    ('General Ward A', 'A-',   'GEN',  10),
    ('Private Wing',   'P-',   'PRIV',  6),
    ('ICU',            'ICU-', 'ICU',   4)
  ) AS v(ward, prefix, bt_code, count)
  JOIN public.ipd_wards w
    ON w.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND w.name = v.ward
  JOIN public.bed_types bt
    ON bt.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND bt.code = v.bt_code
  CROSS JOIN LATERAL generate_series(1, v.count) AS n
ON CONFLICT (clinic_id, ward_id, bed_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Departments
-- ---------------------------------------------------------------------------
INSERT INTO public.departments (clinic_id, code, name, type) VALUES
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'MED',   'General Medicine',      'clinical'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'SURG',  'General Surgery',       'clinical'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'ORTHO', 'Orthopaedics',          'clinical'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'OBG',   'Obstetrics & Gynaecology','clinical'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'PAED',  'Paediatrics',           'clinical'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'ANAES', 'Anaesthesiology',       'clinical'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'ICU',   'Critical Care',         'clinical'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'RAD',   'Radiology',             'diagnostic'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'PATH',  'Pathology',             'diagnostic'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'OT',    'Operation Theatre',     'support'),
  ('e9106ae7-98b5-44a5-9f57-98c480b34f30', 'DIET',  'Dietetics',             'support')
ON CONFLICT (clinic_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Extra services — surgery / OT, lab, imaging, drugs, consumables,
--    implants and critical-care support so postings look real
-- ---------------------------------------------------------------------------
INSERT INTO public.services_master
  (clinic_id, service_code, name, charge_group_id, department_id, service_type,
   base_price, base_cost, unit, is_sharable, requires_doctor)
SELECT 'e9106ae7-98b5-44a5-9f57-98c480b34f30', v.code, v.name,
       g.id, d.id, v.stype::public.ipd_service_type_enum,
       v.price, v.cost, v.unit, v.sharable, v.needs_doc
  FROM (VALUES
  -- ---- Surgeries / OT -----------------------------------------------------
  ('OT-APPY',    'Laparoscopic Appendicectomy',        'PROC-OT',      'SURG',  'surgery',    35000, 12000, 'per procedure', true,  true),
  ('OT-CHOLE',   'Laparoscopic Cholecystectomy',       'PROC-OT',      'SURG',  'surgery',    48000, 17000, 'per procedure', true,  true),
  ('OT-HERNIA',  'Laparoscopic Hernia Repair',         'PROC-OT',      'SURG',  'surgery',    45000, 16000, 'per procedure', true,  true),
  ('OT-LSCS',    'LSCS — Lower Segment Caesarean',     'PROC-OT',      'OBG',   'surgery',    32000, 11000, 'per procedure', true,  true),
  ('OT-ORIF',    'ORIF with Plating — Long Bone',      'PROC-OT',      'ORTHO', 'surgery',    55000, 20000, 'per procedure', true,  true),
  ('OT-DJSTENT', 'Cystoscopy + DJ Stenting',           'PROC-OT',      'SURG',  'surgery',    25000,  9000, 'per procedure', true,  true),
  ('OT-INCDR',   'Incision & Drainage — Abscess',      'PROC-MINOR',   'SURG',  'procedure',   4500,  1500, 'per procedure', true,  true),
  ('OT-CHARGE',  'OT Charges',                         'PROC-OT',      'OT',    'procedure',   8000,  3000, 'per procedure', false, false),
  ('ANAES-GA',   'Anaesthesia — General',              'PROC-OT',      'ANAES', 'procedure',   8000,     0, 'per procedure', true,  true),
  ('ANAES-SA',   'Anaesthesia — Spinal',               'PROC-OT',      'ANAES', 'procedure',   5000,     0, 'per procedure', true,  true),
  -- ---- Pathology ----------------------------------------------------------
  ('LAB-CBC',    'Complete Blood Count (CBC)',         'INV-PATH',     'PATH',  'lab',          350,   120, 'per test', false, false),
  ('LAB-LFT',    'Liver Function Test',                'INV-PATH',     'PATH',  'lab',          700,   250, 'per test', false, false),
  ('LAB-KFT',    'Kidney Function Test',               'INV-PATH',     'PATH',  'lab',          650,   230, 'per test', false, false),
  ('LAB-RBS',    'Random Blood Sugar',                 'INV-PATH',     'PATH',  'lab',          100,    30, 'per test', false, false),
  ('LAB-HBA1C',  'HbA1c',                              'INV-PATH',     'PATH',  'lab',          550,   200, 'per test', false, false),
  ('LAB-LIPID',  'Lipid Profile',                      'INV-PATH',     'PATH',  'lab',          650,   220, 'per test', false, false),
  ('LAB-TFT',    'Thyroid Profile (T3 T4 TSH)',        'INV-PATH',     'PATH',  'lab',          700,   250, 'per test', false, false),
  ('LAB-URINE',  'Urine Routine & Microscopy',         'INV-PATH',     'PATH',  'lab',          200,    60, 'per test', false, false),
  ('LAB-DENGUE', 'Dengue NS1 + IgM / IgG',             'INV-PATH',     'PATH',  'lab',          900,   350, 'per test', false, false),
  ('LAB-COAG',   'PT / INR',                           'INV-PATH',     'PATH',  'lab',          450,   160, 'per test', false, false),
  ('LAB-CULT',   'Blood Culture & Sensitivity',        'INV-PATH',     'PATH',  'lab',         1200,   450, 'per test', false, false),
  ('LAB-ELEC',   'Serum Electrolytes',                 'INV-PATH',     'PATH',  'lab',          450,   150, 'per test', false, false),
  ('LAB-ABG',    'Arterial Blood Gas (ABG)',           'INV-PATH',     'PATH',  'lab',          900,   350, 'per test', false, false),
  -- ---- Radiology / cardiology ---------------------------------------------
  ('RAD-XRAY',   'X-Ray — Single View',                'INV-RAD',      'RAD',   'imaging',      400,   120, 'per film', false, false),
  ('RAD-USG',    'Ultrasound Abdomen & Pelvis',        'INV-RAD',      'RAD',   'imaging',     1200,   350, 'per scan', true,  true),
  ('RAD-USGOBS', 'Ultrasound — Obstetric',             'INV-RAD',      'RAD',   'imaging',     1400,   400, 'per scan', true,  true),
  ('RAD-CTABD',  'CT Scan — Abdomen & Pelvis',         'INV-RAD',      'RAD',   'imaging',     4500,  1600, 'per scan', false, false),
  ('RAD-CTHEAD', 'CT Scan — Brain (Plain)',            'INV-RAD',      'RAD',   'imaging',     3200,  1100, 'per scan', false, false),
  ('RAD-ECG',    'ECG — 12 Lead',                      'INV-RAD',      'MED',   'imaging',      250,    60, 'per test', false, false),
  ('RAD-ECHO',   '2D Echocardiography',                'INV-RAD',      'MED',   'imaging',     2000,   600, 'per test', true,  true),
  -- ---- Drugs --------------------------------------------------------------
  ('PH-RL500',   'IV Fluid — Ringer Lactate 500ml',    'PHARM-DRUG',   NULL,    'pharmacy',      65,    40, 'per bottle', false, false),
  ('PH-NS500',   'IV Fluid — Normal Saline 500ml',     'PHARM-DRUG',   NULL,    'pharmacy',      60,    38, 'per bottle', false, false),
  ('PH-DNS500',  'IV Fluid — DNS 500ml',               'PHARM-DRUG',   NULL,    'pharmacy',      68,    42, 'per bottle', false, false),
  ('PH-CEFTRI',  'Inj Ceftriaxone 1g',                 'PHARM-DRUG',   NULL,    'pharmacy',     120,    70, 'per vial', false, false),
  ('PH-PIPTAZ',  'Inj Piperacillin-Tazobactam 4.5g',   'PHARM-DRUG',   NULL,    'pharmacy',     420,   260, 'per vial', false, false),
  ('PH-PAN',     'Inj Pantoprazole 40mg',              'PHARM-DRUG',   NULL,    'pharmacy',      55,    30, 'per vial', false, false),
  ('PH-EMESET',  'Inj Ondansetron 4mg',                'PHARM-DRUG',   NULL,    'pharmacy',      35,    18, 'per amp', false, false),
  ('PH-TRAMA',   'Inj Tramadol 50mg',                  'PHARM-DRUG',   NULL,    'pharmacy',      40,    22, 'per amp', false, false),
  ('PH-PCM100',  'Inj Paracetamol 1g IV',              'PHARM-DRUG',   NULL,    'pharmacy',      95,    55, 'per bottle', false, false),
  ('PH-INSULIN', 'Inj Human Actrapid Insulin',         'PHARM-DRUG',   NULL,    'pharmacy',     280,   170, 'per vial', false, false),
  ('PH-ENOXA',   'Inj Enoxaparin 40mg',                'PHARM-DRUG',   NULL,    'pharmacy',     380,   240, 'per syringe', false, false),
  -- ---- Consumables --------------------------------------------------------
  ('CON-IVSET',  'IV Set + Cannula',                   'PHARM-CONSUM', NULL,    'consumable',   120,    65, 'per set', false, false),
  ('CON-DRESS',  'Surgical Dressing Kit',              'PHARM-CONSUM', NULL,    'consumable',   450,   200, 'per kit', false, false),
  ('CON-FOLEY',  'Foleys Catheter + Urobag',           'PHARM-CONSUM', NULL,    'consumable',   380,   180, 'per set', false, false),
  ('CON-SYRINGE','Disposable Syringes (pack)',         'PHARM-CONSUM', NULL,    'consumable',    90,    45, 'per pack', false, false),
  ('CON-GLOVE',  'Sterile Gloves (pair)',              'PHARM-CONSUM', NULL,    'consumable',    45,    22, 'per pair', false, false),
  ('CON-LAPKIT', 'Laparoscopy Disposable Kit',         'PHARM-CONSUM', NULL,    'consumable',  6500,  3200, 'per kit', false, false),
  -- ---- Implants -----------------------------------------------------------
  ('IMP-MESH',   'Hernia Mesh — Polypropylene',        'PHARM-IMPLANT',NULL,    'implant',     6500,  3800, 'per unit', false, false),
  ('IMP-PLATE',  'Locking Plate + Screws',             'PHARM-IMPLANT',NULL,    'implant',    22000, 13000, 'per set', false, false),
  ('IMP-DJ',     'DJ Stent',                           'PHARM-IMPLANT',NULL,    'implant',     4200,  2400, 'per unit', false, false),
  -- ---- Support / critical care --------------------------------------------
  ('SUP-O2',     'Oxygen — per hour',                  'SUPPORT',      NULL,    'equipment',    150,    60, 'per hour', false, false),
  ('SUP-VENT',   'Ventilator Support — per day',       'SUPPORT',      NULL,    'equipment',   6000,  2400, 'per day', false, false),
  ('SUP-MONITOR','Cardiac Monitor — per day',          'SUPPORT',      NULL,    'equipment',    800,   300, 'per day', false, false),
  ('SUP-PHYSIO', 'Physiotherapy Session',              'SUPPORT',      NULL,    'procedure',    500,   200, 'per session', true, false),
  ('SUP-BIOMED', 'Biomedical Waste Charges',           'SUPPORT',      NULL,    'misc',         250,   100, 'unit', false, false),
  ('MISC-MLC',   'MLC / Medico-Legal Documentation',   'MISC',         NULL,    'misc',         500,     0, 'unit', false, false)
  ) AS v(code, name, grp, dept, stype, price, cost, unit, sharable, needs_doc)
  JOIN public.charge_groups g
    ON g.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND g.code = v.grp
  LEFT JOIN public.departments d
    ON d.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND d.code = v.dept
ON CONFLICT (clinic_id, service_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Payers + tariff plans (cash plan already created by seed_ipd_masters)
-- ---------------------------------------------------------------------------
INSERT INTO public.payers (clinic_id, code, name, payer_type, credit_days, default_deduction_buffer_pct, contact)
SELECT 'e9106ae7-98b5-44a5-9f57-98c480b34f30', v.code, v.name, v.ptype, v.days, v.buf,
       jsonb_build_object('person', v.person, 'phone', v.phone, 'email', v.email)
  FROM (VALUES
  ('STAR',  'Star Health Insurance',        'insurer',            45, 8.0,  'Mr. Nikhil Rao',   '9820011223', 'claims@starhealth.demo'),
  ('MEDIA', 'Medi Assist TPA',              'tpa',                60, 10.0, 'Ms. Sneha Kulkarni','9820022334', 'preauth@mediassist.demo'),
  ('BAJAJ', 'Bajaj Allianz Health',         'insurer',            45, 7.5,  'Mr. Arif Shaikh',  '9820033445', 'claims@bajajhealth.demo'),
  ('CORP1', 'Infotech Solutions Pvt Ltd',   'corporate',          30, 0.0,  'HR Desk',          '9820044556', 'hr@infotech.demo'),
  ('AB-PMJ','Ayushman Bharat PM-JAY',       'government_scheme',  90, 0.0,  'Scheme Desk',      '1800111565', 'pmjay@nha.demo')
  ) AS v(code, name, ptype, days, buf, person, phone, email)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.payers p
    WHERE p.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND p.code = v.code);

INSERT INTO public.tariff_plans (clinic_id, name, payer_id, valid_from, is_active)
SELECT 'e9106ae7-98b5-44a5-9f57-98c480b34f30', v.plan, p.id, CURRENT_DATE - 365, true
  FROM (VALUES
  ('Star Health — Tariff 2026',  'STAR'),
  ('Medi Assist TPA — Tariff',   'MEDIA'),
  ('Corporate — Infotech',       'CORP1'),
  ('PM-JAY Package Rates',       'AB-PMJ')
  ) AS v(plan, payer_code)
  JOIN public.payers p
    ON p.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND p.code = v.payer_code
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tariff_plans t
    WHERE t.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND t.name = v.plan);

-- Insurer rates: bed group at a 15% uplift, investigations at a 10% discount
INSERT INTO public.tariff_rates (clinic_id, tariff_plan_id, charge_group_id, multiplier)
SELECT 'e9106ae7-98b5-44a5-9f57-98c480b34f30', t.id, g.id, v.mult
  FROM (VALUES
  ('Star Health — Tariff 2026', 'BED',  1.150),
  ('Star Health — Tariff 2026', 'INV',  0.900),
  ('Medi Assist TPA — Tariff',  'BED',  1.100),
  ('Medi Assist TPA — Tariff',  'INV',  0.850),
  ('Corporate — Infotech',      'CONS', 0.900),
  ('PM-JAY Package Rates',      'BED',  0.700),
  ('PM-JAY Package Rates',      'INV',  0.600)
  ) AS v(plan, grp, mult)
  JOIN public.tariff_plans t
    ON t.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND t.name = v.plan
  JOIN public.charge_groups g
    ON g.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND g.code = v.grp
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tariff_rates r
    WHERE r.tariff_plan_id = t.id AND r.charge_group_id = g.id);

-- ---------------------------------------------------------------------------
-- 5. Order sets (quick-pick bundles on the IPD Orders tab)
-- ---------------------------------------------------------------------------
INSERT INTO public.order_sets (clinic_id, name, specialty)
SELECT 'e9106ae7-98b5-44a5-9f57-98c480b34f30', v.name, v.spec
  FROM (VALUES
  ('Admission Baseline Workup',      'general'),
  ('Fever Workup — Tropical',        'medicine'),
  ('Pre-operative Workup',           'surgery'),
  ('Acute Abdomen Workup',           'surgery'),
  ('Diabetes / DKA Monitoring',      'medicine'),
  ('Antenatal Admission Workup',     'obg')
  ) AS v(name, spec)
ON CONFLICT (clinic_id, name) DO NOTHING;

INSERT INTO public.order_set_items (clinic_id, order_set_id, service_id, default_qty)
SELECT 'e9106ae7-98b5-44a5-9f57-98c480b34f30', os.id, s.id, v.qty
  FROM (VALUES
  ('Admission Baseline Workup',  'LAB-CBC',    1),
  ('Admission Baseline Workup',  'LAB-RBS',    1),
  ('Admission Baseline Workup',  'LAB-URINE',  1),
  ('Admission Baseline Workup',  'RAD-ECG',    1),
  ('Fever Workup — Tropical',    'LAB-CBC',    1),
  ('Fever Workup — Tropical',    'LAB-DENGUE', 1),
  ('Fever Workup — Tropical',    'LAB-LFT',    1),
  ('Fever Workup — Tropical',    'LAB-URINE',  1),
  ('Pre-operative Workup',       'LAB-CBC',    1),
  ('Pre-operative Workup',       'LAB-COAG',   1),
  ('Pre-operative Workup',       'LAB-KFT',    1),
  ('Pre-operative Workup',       'RAD-ECG',    1),
  ('Pre-operative Workup',       'RAD-XRAY',   1),
  ('Acute Abdomen Workup',       'LAB-CBC',    1),
  ('Acute Abdomen Workup',       'RAD-USG',    1),
  ('Acute Abdomen Workup',       'LAB-LFT',    1),
  ('Diabetes / DKA Monitoring',  'LAB-RBS',    4),
  ('Diabetes / DKA Monitoring',  'LAB-ELEC',   2),
  ('Diabetes / DKA Monitoring',  'LAB-ABG',    2),
  ('Diabetes / DKA Monitoring',  'LAB-KFT',    1),
  ('Antenatal Admission Workup', 'LAB-CBC',    1),
  ('Antenatal Admission Workup', 'RAD-USGOBS', 1),
  ('Antenatal Admission Workup', 'LAB-URINE',  1)
  ) AS v(setname, svc, qty)
  JOIN public.order_sets os
    ON os.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND os.name = v.setname
  JOIN public.services_master s
    ON s.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30' AND s.service_code = v.svc
 WHERE NOT EXISTS (
   SELECT 1 FROM public.order_set_items i
    WHERE i.order_set_id = os.id AND i.service_id = s.id);

-- ---------------------------------------------------------------------------
-- 6. EMR examination templates for the OPD visit screen
--    template_data matches PhysicalExamination { sections[].fields[] }
--    field.type ∈ text | textarea | select | toggle
-- ---------------------------------------------------------------------------
INSERT INTO public.examination_templates (clinic_id, name, description, specialization, template_data)
VALUES
-- 6.1 General OPD ------------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30',
 'General Physical Examination',
 'Standard head-to-toe OPD examination — the everyday default',
 'General Medicine',
 '{"sections":[
   {"id":"general","title":"General Examination","fields":[
     {"key":"appearance","label":"General Appearance","type":"select","value":"Comfortable","options":["Comfortable","Ill looking","Toxic","In distress"]},
     {"key":"pallor","label":"Pallor","type":"toggle","value":false},
     {"key":"icterus","label":"Icterus","type":"toggle","value":false},
     {"key":"cyanosis","label":"Cyanosis","type":"toggle","value":false},
     {"key":"clubbing","label":"Clubbing","type":"toggle","value":false},
     {"key":"lymphadenopathy","label":"Lymphadenopathy","type":"toggle","value":false},
     {"key":"edema","label":"Pedal Edema","type":"toggle","value":false},
     {"key":"hydration","label":"Hydration","type":"select","value":"Adequate","options":["Adequate","Mild dehydration","Moderate dehydration","Severe dehydration"]}
   ]},
   {"id":"cvs","title":"Cardiovascular System","fields":[
     {"key":"s1s2","label":"Heart Sounds","type":"select","value":"S1 S2 normal","options":["S1 S2 normal","S3 present","S4 present","Muffled"]},
     {"key":"murmur","label":"Murmur","type":"text","value":"","placeholder":"None / describe"},
     {"key":"jvp","label":"JVP","type":"select","value":"Not raised","options":["Not raised","Raised"]}
   ]},
   {"id":"rs","title":"Respiratory System","fields":[
     {"key":"air_entry","label":"Air Entry","type":"select","value":"Bilateral equal","options":["Bilateral equal","Reduced right","Reduced left","Reduced bilateral"]},
     {"key":"breath_sounds","label":"Breath Sounds","type":"select","value":"Vesicular","options":["Vesicular","Bronchial","Diminished"]},
     {"key":"added_sounds","label":"Added Sounds","type":"text","value":"","placeholder":"Crepitations / rhonchi / none"}
   ]},
   {"id":"pa","title":"Per Abdomen","fields":[
     {"key":"inspection","label":"Inspection","type":"text","value":"Soft, no distension"},
     {"key":"tenderness","label":"Tenderness","type":"text","value":"","placeholder":"Site / none"},
     {"key":"organomegaly","label":"Organomegaly","type":"toggle","value":false},
     {"key":"bowel_sounds","label":"Bowel Sounds","type":"select","value":"Present","options":["Present","Exaggerated","Absent"]}
   ]},
   {"id":"cns","title":"Central Nervous System","fields":[
     {"key":"conscious","label":"Consciousness","type":"select","value":"Conscious, oriented","options":["Conscious, oriented","Drowsy","Confused","Unconscious"]},
     {"key":"gcs","label":"GCS","type":"text","value":"15/15"},
     {"key":"focal_deficit","label":"Focal Neurological Deficit","type":"toggle","value":false}
   ]}
 ]}'::jsonb),

-- 6.2 Orthopaedics -----------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30',
 'Orthopaedic — Joint & Spine',
 'Local examination for joint pain, back pain and trauma follow-up',
 'Orthopaedics',
 '{"sections":[
   {"id":"local","title":"Local Examination","fields":[
     {"key":"site","label":"Site / Joint","type":"text","value":"","placeholder":"e.g. Right knee"},
     {"key":"swelling","label":"Swelling","type":"toggle","value":false},
     {"key":"deformity","label":"Deformity","type":"toggle","value":false},
     {"key":"local_rise","label":"Local Rise of Temperature","type":"toggle","value":false},
     {"key":"tenderness","label":"Tenderness","type":"select","value":"Nil","options":["Nil","Mild","Moderate","Severe"]},
     {"key":"effusion","label":"Joint Effusion","type":"toggle","value":false}
   ]},
   {"id":"rom","title":"Range of Movement","fields":[
     {"key":"active_rom","label":"Active ROM","type":"text","value":"","placeholder":"e.g. 0-110 degrees"},
     {"key":"passive_rom","label":"Passive ROM","type":"text","value":""},
     {"key":"painful_arc","label":"Painful Arc","type":"toggle","value":false},
     {"key":"crepitus","label":"Crepitus","type":"toggle","value":false}
   ]},
   {"id":"special","title":"Special Tests","fields":[
     {"key":"slr","label":"Straight Leg Raise","type":"text","value":"","placeholder":"Right / Left degrees"},
     {"key":"mcmurray","label":"McMurray Test","type":"select","value":"Not done","options":["Not done","Negative","Positive"]},
     {"key":"anterior_drawer","label":"Anterior Drawer","type":"select","value":"Not done","options":["Not done","Negative","Positive"]},
     {"key":"lachman","label":"Lachman Test","type":"select","value":"Not done","options":["Not done","Negative","Positive"]}
   ]},
   {"id":"neurovascular","title":"Neurovascular Status","fields":[
     {"key":"distal_pulses","label":"Distal Pulses","type":"select","value":"Well felt","options":["Well felt","Feeble","Absent"]},
     {"key":"sensation","label":"Sensation","type":"select","value":"Intact","options":["Intact","Diminished","Absent"]},
     {"key":"power","label":"Power","type":"text","value":"5/5"},
     {"key":"gait","label":"Gait","type":"select","value":"Normal","options":["Normal","Antalgic","Waddling","Unable to bear weight"]}
   ]}
 ]}'::jsonb),

-- 6.3 ENT --------------------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30',
 'ENT Examination',
 'Ear, nose, throat and neck examination',
 'ENT',
 '{"sections":[
   {"id":"ear","title":"Ear","fields":[
     {"key":"pinna","label":"Pinna","type":"select","value":"Normal","options":["Normal","Swollen","Deformed"]},
     {"key":"eac","label":"External Auditory Canal","type":"select","value":"Clear","options":["Clear","Wax","Discharge","Oedematous"]},
     {"key":"tm","label":"Tympanic Membrane","type":"select","value":"Intact, normal","options":["Intact, normal","Congested","Retracted","Perforated","Not visualised"]},
     {"key":"hearing","label":"Hearing (gross)","type":"select","value":"Normal","options":["Normal","Reduced right","Reduced left","Reduced bilateral"]}
   ]},
   {"id":"nose","title":"Nose & PNS","fields":[
     {"key":"septum","label":"Nasal Septum","type":"select","value":"Central","options":["Central","Deviated right","Deviated left"]},
     {"key":"turbinates","label":"Turbinates","type":"select","value":"Normal","options":["Normal","Hypertrophied","Congested","Pale boggy"]},
     {"key":"discharge","label":"Nasal Discharge","type":"text","value":"","placeholder":"Nil / watery / purulent"},
     {"key":"pns_tender","label":"PNS Tenderness","type":"toggle","value":false}
   ]},
   {"id":"throat","title":"Oral Cavity & Throat","fields":[
     {"key":"tonsils","label":"Tonsils","type":"select","value":"Normal","options":["Normal","Grade I","Grade II","Grade III","Grade IV","Congested with exudate"]},
     {"key":"pharynx","label":"Posterior Pharyngeal Wall","type":"select","value":"Normal","options":["Normal","Congested","Post-nasal drip","Granular"]},
     {"key":"oral_hygiene","label":"Oral Hygiene","type":"select","value":"Fair","options":["Good","Fair","Poor"]}
   ]},
   {"id":"neck","title":"Neck","fields":[
     {"key":"nodes","label":"Cervical Lymph Nodes","type":"text","value":"Not palpable"},
     {"key":"thyroid","label":"Thyroid","type":"select","value":"Not enlarged","options":["Not enlarged","Diffusely enlarged","Nodular"]}
   ]}
 ]}'::jsonb),

-- 6.4 Paediatrics ------------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30',
 'Paediatric Examination',
 'Under-12 assessment with growth, hydration and systemic review',
 'Paediatrics',
 '{"sections":[
   {"id":"growth","title":"Growth & Development","fields":[
     {"key":"weight_centile","label":"Weight for Age","type":"select","value":"Normal","options":["Normal","Below 3rd centile","3rd-10th centile","Above 97th centile"]},
     {"key":"height_centile","label":"Height for Age","type":"select","value":"Normal","options":["Normal","Below 3rd centile","3rd-10th centile","Above 97th centile"]},
     {"key":"milestones","label":"Developmental Milestones","type":"select","value":"Age appropriate","options":["Age appropriate","Delayed gross motor","Delayed speech","Global delay"]},
     {"key":"immunisation","label":"Immunisation","type":"select","value":"Up to date","options":["Up to date","Partially immunised","Not immunised"]}
   ]},
   {"id":"general","title":"General Examination","fields":[
     {"key":"activity","label":"Activity","type":"select","value":"Active, playful","options":["Active, playful","Irritable","Lethargic","Unresponsive"]},
     {"key":"hydration","label":"Hydration","type":"select","value":"Well hydrated","options":["Well hydrated","Some dehydration","Severe dehydration"]},
     {"key":"fontanelle","label":"Anterior Fontanelle","type":"select","value":"Not applicable","options":["Not applicable","Normal","Bulging","Sunken","Closed"]},
     {"key":"pallor","label":"Pallor","type":"toggle","value":false},
     {"key":"rash","label":"Skin Rash","type":"text","value":"","placeholder":"Nil / describe"}
   ]},
   {"id":"systemic","title":"Systemic Examination","fields":[
     {"key":"chest","label":"Chest","type":"select","value":"Clear","options":["Clear","Crepitations","Wheeze","Reduced air entry"]},
     {"key":"retractions","label":"Chest Retractions","type":"toggle","value":false},
     {"key":"cvs","label":"CVS","type":"text","value":"S1 S2 normal, no murmur"},
     {"key":"abdomen","label":"Abdomen","type":"text","value":"Soft, non-tender"},
     {"key":"ent","label":"Throat / Ears","type":"text","value":"","placeholder":"Congested throat / normal"}
   ]}
 ]}'::jsonb),

-- 6.5 Obstetrics -------------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30',
 'Antenatal Examination',
 'Routine ANC visit — obstetric and general assessment',
 'Obstetrics & Gynaecology',
 '{"sections":[
   {"id":"obs_history","title":"Obstetric Summary","fields":[
     {"key":"gpal","label":"G / P / L / A","type":"text","value":"","placeholder":"e.g. G2 P1 L1 A0"},
     {"key":"pog","label":"Period of Gestation","type":"text","value":"","placeholder":"e.g. 32 weeks 4 days"},
     {"key":"lmp","label":"LMP","type":"text","value":""},
     {"key":"edd","label":"EDD","type":"text","value":""}
   ]},
   {"id":"general","title":"General Examination","fields":[
     {"key":"pallor","label":"Pallor","type":"toggle","value":false},
     {"key":"edema","label":"Pedal Edema","type":"select","value":"Nil","options":["Nil","Mild","Moderate","Severe"]},
     {"key":"bp_trend","label":"BP Trend","type":"select","value":"Normotensive","options":["Normotensive","Borderline","Hypertensive"]},
     {"key":"weight_gain","label":"Weight Gain","type":"text","value":"","placeholder":"kg since last visit"}
   ]},
   {"id":"per_abdomen","title":"Per Abdomen (Obstetric)","fields":[
     {"key":"fundal_height","label":"Fundal Height","type":"text","value":"","placeholder":"cm / weeks"},
     {"key":"lie","label":"Lie","type":"select","value":"Longitudinal","options":["Longitudinal","Transverse","Oblique"]},
     {"key":"presentation","label":"Presentation","type":"select","value":"Cephalic","options":["Cephalic","Breech","Shoulder","Not determined"]},
     {"key":"fhs","label":"Foetal Heart Sounds","type":"text","value":"","placeholder":"e.g. 142 bpm, regular"},
     {"key":"contractions","label":"Uterine Contractions","type":"select","value":"Absent","options":["Absent","Irregular","Regular"]},
     {"key":"movements","label":"Foetal Movements","type":"select","value":"Well perceived","options":["Well perceived","Reduced","Not perceived"]}
   ]},
   {"id":"plan","title":"Assessment","fields":[
     {"key":"risk","label":"Risk Category","type":"select","value":"Low risk","options":["Low risk","High risk"]},
     {"key":"notes","label":"Remarks","type":"textarea","value":""}
   ]}
 ]}'::jsonb),

-- 6.6 Dermatology ------------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30',
 'Dermatology — Skin Lesion',
 'Morphology-led examination for rashes and skin lesions',
 'Dermatology',
 '{"sections":[
   {"id":"lesion","title":"Lesion Description","fields":[
     {"key":"site","label":"Site / Distribution","type":"text","value":"","placeholder":"e.g. Flexural, symmetrical"},
     {"key":"morphology","label":"Primary Morphology","type":"select","value":"Papule","options":["Macule","Papule","Plaque","Vesicle","Pustule","Nodule","Wheal","Ulcer"]},
     {"key":"secondary","label":"Secondary Change","type":"text","value":"","placeholder":"Scaling / crusting / lichenification"},
     {"key":"size","label":"Size","type":"text","value":""},
     {"key":"colour","label":"Colour","type":"text","value":""},
     {"key":"itching","label":"Pruritus","type":"select","value":"Nil","options":["Nil","Mild","Moderate","Severe"]}
   ]},
   {"id":"appendages","title":"Hair, Nails & Mucosa","fields":[
     {"key":"hair","label":"Scalp / Hair","type":"text","value":"Normal"},
     {"key":"nails","label":"Nails","type":"text","value":"Normal"},
     {"key":"mucosa","label":"Mucosal Involvement","type":"toggle","value":false}
   ]},
   {"id":"tests","title":"Bedside Tests","fields":[
     {"key":"koh","label":"KOH Mount","type":"select","value":"Not done","options":["Not done","Negative","Positive"]},
     {"key":"dermoscopy","label":"Dermoscopy Findings","type":"textarea","value":""}
   ]}
 ]}'::jsonb),

-- 6.7 Diabetes / metabolic ---------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30',
 'Diabetes Review & Foot Check',
 'Follow-up template for type 2 diabetes with complication screening',
 'General Medicine',
 '{"sections":[
   {"id":"control","title":"Glycaemic Control","fields":[
     {"key":"fbs","label":"Fasting Blood Sugar","type":"text","value":"","placeholder":"mg/dL"},
     {"key":"ppbs","label":"Post Prandial","type":"text","value":"","placeholder":"mg/dL"},
     {"key":"hba1c","label":"HbA1c","type":"text","value":"","placeholder":"%"},
     {"key":"hypo","label":"Hypoglycaemic Episodes","type":"toggle","value":false},
     {"key":"compliance","label":"Drug Compliance","type":"select","value":"Good","options":["Good","Irregular","Poor"]}
   ]},
   {"id":"foot","title":"Diabetic Foot Check","fields":[
     {"key":"monofilament","label":"10g Monofilament","type":"select","value":"Sensation intact","options":["Sensation intact","Reduced","Absent"]},
     {"key":"pulses","label":"Peripheral Pulses","type":"select","value":"Well felt","options":["Well felt","Feeble","Absent"]},
     {"key":"ulcer","label":"Foot Ulcer","type":"toggle","value":false},
     {"key":"skin","label":"Skin / Nail Changes","type":"text","value":"","placeholder":"Dryness, callus, fungal"}
   ]},
   {"id":"complications","title":"Complication Screening","fields":[
     {"key":"fundus","label":"Fundus Examination","type":"select","value":"Not done","options":["Not done","Normal","NPDR","PDR","Maculopathy"]},
     {"key":"microalbumin","label":"Urine Microalbumin","type":"select","value":"Not done","options":["Not done","Negative","Positive"]},
     {"key":"bp","label":"Blood Pressure","type":"text","value":""},
     {"key":"neuropathy","label":"Neuropathic Symptoms","type":"text","value":"","placeholder":"Burning / tingling / nil"}
   ]}
 ]}'::jsonb),

-- 6.8 Ophthalmology ----------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30',
 'Ophthalmology — Anterior Segment',
 'Vision, anterior segment and pressure check',
 'Ophthalmology',
 '{"sections":[
   {"id":"vision","title":"Visual Acuity","fields":[
     {"key":"va_re","label":"VA — Right Eye","type":"text","value":"","placeholder":"6/6"},
     {"key":"va_le","label":"VA — Left Eye","type":"text","value":"","placeholder":"6/6"},
     {"key":"glasses","label":"With Correction","type":"toggle","value":false}
   ]},
   {"id":"anterior","title":"Anterior Segment","fields":[
     {"key":"lids","label":"Lids & Adnexa","type":"text","value":"Normal"},
     {"key":"conjunctiva","label":"Conjunctiva","type":"select","value":"Normal","options":["Normal","Congested","Chemosis","Discharge"]},
     {"key":"cornea","label":"Cornea","type":"select","value":"Clear","options":["Clear","Hazy","Ulcer","Opacity"]},
     {"key":"ac","label":"Anterior Chamber","type":"select","value":"Normal depth","options":["Normal depth","Shallow","Cells / flare"]},
     {"key":"lens","label":"Lens","type":"select","value":"Clear","options":["Clear","Early cataract","Immature cataract","Mature cataract","Pseudophakia"]},
     {"key":"pupil","label":"Pupil","type":"select","value":"Round, reactive","options":["Round, reactive","Sluggish","Fixed dilated","RAPD present"]}
   ]},
   {"id":"posterior","title":"Fundus & IOP","fields":[
     {"key":"iop","label":"IOP (mmHg)","type":"text","value":"","placeholder":"RE / LE"},
     {"key":"disc","label":"Optic Disc","type":"text","value":"Normal, CDR 0.3"},
     {"key":"retina","label":"Retina","type":"textarea","value":""}
   ]}
 ]}'::jsonb),

-- 6.9 Emergency / casualty ---------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30',
 'Emergency / Casualty Assessment',
 'ABCDE primary survey for walk-in emergencies and pre-admission triage',
 'Emergency Medicine',
 '{"sections":[
   {"id":"primary","title":"Primary Survey (ABCDE)","fields":[
     {"key":"airway","label":"Airway","type":"select","value":"Patent","options":["Patent","Partially obstructed","Obstructed","Secured"]},
     {"key":"breathing","label":"Breathing","type":"select","value":"Spontaneous, adequate","options":["Spontaneous, adequate","Laboured","Assisted","Apnoeic"]},
     {"key":"circulation","label":"Circulation","type":"select","value":"Stable","options":["Stable","Compensated shock","Decompensated shock"]},
     {"key":"disability","label":"Disability (AVPU)","type":"select","value":"Alert","options":["Alert","Responds to voice","Responds to pain","Unresponsive"]},
     {"key":"exposure","label":"Exposure Findings","type":"textarea","value":""}
   ]},
   {"id":"triage","title":"Triage & Access","fields":[
     {"key":"triage_level","label":"Triage Category","type":"select","value":"Yellow","options":["Red","Yellow","Green"]},
     {"key":"iv_access","label":"IV Access Secured","type":"toggle","value":true},
     {"key":"o2","label":"Oxygen Started","type":"toggle","value":false},
     {"key":"monitor","label":"On Cardiac Monitor","type":"toggle","value":false}
   ]},
   {"id":"disposition","title":"Disposition","fields":[
     {"key":"plan","label":"Plan","type":"select","value":"Observe in casualty","options":["Discharge with advice","Observe in casualty","Admit to ward","Admit to ICU","Refer out"]},
     {"key":"mlc","label":"Medico-Legal Case","type":"toggle","value":false},
     {"key":"notes","label":"Casualty Notes","type":"textarea","value":""}
   ]}
 ]}'::jsonb)
ON CONFLICT (clinic_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Prescription presets (in addition to the 5 stock ones)
-- ---------------------------------------------------------------------------
INSERT INTO public.prescription_presets (clinic_id, name, description, condition, tags, preset_data)
VALUES
('e9106ae7-98b5-44a5-9f57-98c480b34f30','Type 2 Diabetes — Starter','First-line oral therapy for newly detected T2DM','Endocrine',
 ARRAY['diabetes','t2dm','sugar','metformin'],
 '{"medicines":[
   {"medicine":"Metformin SR","dosage":"500mg","frequency":"OD","duration":"30 days","instructions":"after dinner"},
   {"medicine":"Glimepiride","dosage":"1mg","frequency":"OD","duration":"30 days","instructions":"before breakfast"},
   {"medicine":"Tab Vitamin D3 60000 IU","dosage":"60000 IU","frequency":"OD","duration":"4 weeks","instructions":"once weekly with milk"}],
  "advice":["Walk 30-40 minutes daily","Avoid sugar, sweets and refined flour","Split meals into 5 small portions","Check fasting and post-meal sugar weekly","Annual eye and foot check"],
  "followUpDays":30}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Hypertension — Stage 1','Single-drug control for uncomplicated hypertension','Cardiovascular',
 ARRAY['hypertension','bp','amlodipine'],
 '{"medicines":[
   {"medicine":"Telmisartan","dosage":"40mg","frequency":"OD","duration":"30 days","instructions":"morning, empty stomach"},
   {"medicine":"Amlodipine","dosage":"5mg","frequency":"OD","duration":"30 days","instructions":"at night"}],
  "advice":["Restrict salt to under 5g per day","Home BP monitoring twice weekly","Avoid pickles, papad and processed food","Regular brisk walking","Do not stop medication on your own"],
  "followUpDays":30}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Urinary Tract Infection','Uncomplicated lower UTI in adults','Genitourinary',
 ARRAY['uti','burning micturition','infection'],
 '{"medicines":[
   {"medicine":"Nitrofurantoin","dosage":"100mg","frequency":"BD","duration":"5 days","instructions":"after food"},
   {"medicine":"Alkaline Citrate Syrup","dosage":"10ml","frequency":"TID","duration":"5 days","instructions":"in half a glass of water"},
   {"medicine":"Drotaverine","dosage":"80mg","frequency":"BD","duration":"3 days","instructions":"if pain"}],
  "advice":["Drink at least 3 litres of water a day","Do not hold urine","Maintain perineal hygiene","Repeat urine test after completing the course"],
  "followUpDays":7}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Acute Gastroenteritis','Loose motions with vomiting — ORS-first management','Gastrointestinal',
 ARRAY['diarrhoea','vomiting','loose motion','ors'],
 '{"medicines":[
   {"medicine":"ORS Sachet","dosage":"1 sachet","frequency":"PRN","duration":"3 days","instructions":"in 1 litre water, after every loose stool"},
   {"medicine":"Ofloxacin + Ornidazole","dosage":"200mg+500mg","frequency":"BD","duration":"3 days","instructions":"after food"},
   {"medicine":"Racecadotril","dosage":"100mg","frequency":"TID","duration":"3 days","instructions":"before food"},
   {"medicine":"Ondansetron","dosage":"4mg","frequency":"PRN","duration":"2 days","instructions":"if vomiting"},
   {"medicine":"Probiotic Sachet","dosage":"1 sachet","frequency":"OD","duration":"5 days","instructions":"after food"}],
  "advice":["Continue ORS after every loose stool","Take light, bland food — khichdi, curd rice","Avoid milk, oily and spicy food","Return immediately if there is blood in stool, no urine or persistent vomiting"],
  "followUpDays":3}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Migraine — Acute & Prophylaxis','Abortive plus preventive regimen','Neurology',
 ARRAY['migraine','headache'],
 '{"medicines":[
   {"medicine":"Naproxen + Domperidone","dosage":"500mg+10mg","frequency":"PRN","duration":"as needed","instructions":"at onset of headache, after food"},
   {"medicine":"Sumatriptan","dosage":"50mg","frequency":"PRN","duration":"as needed","instructions":"if no relief in 2 hours, max 2 per day"},
   {"medicine":"Propranolol","dosage":"20mg","frequency":"BD","duration":"30 days","instructions":"after food"}],
  "advice":["Identify and avoid triggers — skipped meals, lack of sleep, bright light","Keep a headache diary","Regular sleep and meal timings","Reduce screen time and caffeine"],
  "followUpDays":30}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Iron Deficiency Anaemia','Oral iron replacement for adults','Haematology',
 ARRAY['anaemia','iron','weakness','haemoglobin'],
 '{"medicines":[
   {"medicine":"Ferrous Ascorbate + Folic Acid","dosage":"100mg+1.5mg","frequency":"OD","duration":"60 days","instructions":"empty stomach with lemon water"},
   {"medicine":"Vitamin B12","dosage":"1500mcg","frequency":"OD","duration":"30 days","instructions":"after food"},
   {"medicine":"Lactulose Syrup","dosage":"15ml","frequency":"OD","duration":"15 days","instructions":"at bedtime if constipated"}],
  "advice":["Take iron with citrus juice, never with tea, coffee or milk","Include green leafy vegetables, dates, jaggery","Deworming tablet as advised","Repeat haemogram after 4 weeks"],
  "followUpDays":30}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Bronchial Asthma — Maintenance','Inhaled controller plus reliever','Respiratory',
 ARRAY['asthma','wheeze','inhaler','breathlessness'],
 '{"medicines":[
   {"medicine":"Budesonide + Formoterol Inhaler","dosage":"200/6 mcg","frequency":"BD","duration":"30 days","instructions":"2 puffs with spacer, rinse mouth after use"},
   {"medicine":"Salbutamol Inhaler","dosage":"100mcg","frequency":"PRN","duration":"as needed","instructions":"2 puffs when breathless"},
   {"medicine":"Montelukast + Levocetirizine","dosage":"10mg+5mg","frequency":"OD","duration":"30 days","instructions":"at night"}],
  "advice":["Always carry the reliever inhaler","Use a spacer for correct technique","Avoid dust, smoke, cold air and strong perfumes","Annual influenza vaccination","Report if reliever is needed more than twice a week"],
  "followUpDays":30}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Acute Tonsillitis / Pharyngitis','Bacterial sore throat with fever','ENT',
 ARRAY['throat pain','tonsillitis','fever','ent'],
 '{"medicines":[
   {"medicine":"Amoxicillin + Clavulanic Acid","dosage":"625mg","frequency":"BD","duration":"5 days","instructions":"after food"},
   {"medicine":"Paracetamol","dosage":"650mg","frequency":"TID","duration":"3 days","instructions":"after food if fever or pain"},
   {"medicine":"Chlorhexidine Gargle","dosage":"10ml","frequency":"TID","duration":"5 days","instructions":"gargle, do not swallow"},
   {"medicine":"Serratiopeptidase","dosage":"10mg","frequency":"BD","duration":"5 days","instructions":"before food"}],
  "advice":["Warm saline gargles three times a day","Plenty of warm fluids","Avoid cold drinks, ice cream and fried food","Complete the antibiotic course"],
  "followUpDays":5}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Paediatric Fever (Weight-based)','Under-12 symptomatic care — confirm dose against weight','Paediatrics',
 ARRAY['fever','child','paediatric','syrup'],
 '{"medicines":[
   {"medicine":"Syrup Paracetamol (250mg/5ml)","dosage":"15mg/kg/dose","frequency":"QID","duration":"3 days","instructions":"if temperature above 100F"},
   {"medicine":"Syrup Cetirizine","dosage":"2.5ml","frequency":"OD","duration":"5 days","instructions":"at night"},
   {"medicine":"ORS Sachet","dosage":"1 sachet","frequency":"PRN","duration":"3 days","instructions":"sip through the day"},
   {"medicine":"Syrup Zinc","dosage":"5ml","frequency":"OD","duration":"14 days","instructions":"after food"}],
  "advice":["Tepid sponging if the fever is high","Encourage fluids and light food","Watch for lethargy, refusal to feed, rash or breathing difficulty","Do not give aspirin"],
  "followUpDays":3}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Antenatal Supplements','Routine second and third trimester supplementation','Obstetrics',
 ARRAY['pregnancy','anc','antenatal','iron','calcium'],
 '{"medicines":[
   {"medicine":"Folic Acid + Iron","dosage":"5mg+100mg","frequency":"OD","duration":"30 days","instructions":"after lunch"},
   {"medicine":"Calcium + Vitamin D3","dosage":"500mg+250 IU","frequency":"BD","duration":"30 days","instructions":"after food, not with iron"},
   {"medicine":"Tab Doxylamine + Pyridoxine","dosage":"10mg+10mg","frequency":"PRN","duration":"as needed","instructions":"at bedtime if nausea"}],
  "advice":["Take iron and calcium at least 2 hours apart","Protein-rich diet with pulses, eggs and milk","Foetal movement count daily after 28 weeks","Report bleeding, leaking, severe headache or reduced movements immediately","Next scan and ANC visit as scheduled"],
  "followUpDays":28}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Post-operative Pain & Antibiotic','Standard 5-day cover after a minor or day-care procedure','Surgery',
 ARRAY['post-op','surgery','pain','antibiotic'],
 '{"medicines":[
   {"medicine":"Cefuroxime","dosage":"500mg","frequency":"BD","duration":"5 days","instructions":"after food"},
   {"medicine":"Aceclofenac + Paracetamol","dosage":"100mg+325mg","frequency":"BD","duration":"5 days","instructions":"after food"},
   {"medicine":"Pantoprazole","dosage":"40mg","frequency":"OD","duration":"7 days","instructions":"before breakfast"},
   {"medicine":"Serratiopeptidase","dosage":"10mg","frequency":"BD","duration":"5 days","instructions":"before food"}],
  "advice":["Keep the wound clean and dry","Dressing change as scheduled","No heavy lifting for 2 weeks","Report fever, redness, swelling or discharge from the wound","Suture removal on day 8-10"],
  "followUpDays":7}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Dyslipidaemia','Statin therapy with lifestyle advice','Cardiovascular',
 ARRAY['cholesterol','lipid','statin'],
 '{"medicines":[
   {"medicine":"Atorvastatin","dosage":"20mg","frequency":"OD","duration":"30 days","instructions":"at bedtime"},
   {"medicine":"Omega-3 Fatty Acid","dosage":"1000mg","frequency":"OD","duration":"30 days","instructions":"after food"}],
  "advice":["Reduce fried food, ghee, butter and red meat","30 minutes of aerobic exercise five days a week","Repeat lipid profile after 8 weeks","Report unexplained muscle pain"],
  "followUpDays":56}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Hypothyroidism','Levothyroxine replacement and monitoring','Endocrine',
 ARRAY['thyroid','tsh','hypothyroid'],
 '{"medicines":[
   {"medicine":"Levothyroxine","dosage":"50mcg","frequency":"OD","duration":"60 days","instructions":"empty stomach, 45 minutes before breakfast"}],
  "advice":["Take the tablet at the same time daily on an empty stomach","Do not take with calcium or iron within 4 hours","Repeat TSH after 6-8 weeks","Do not change the dose on your own"],
  "followUpDays":56}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Vertigo — Acute','Vestibular sedation for acute peripheral vertigo','Neurology',
 ARRAY['vertigo','giddiness','dizziness'],
 '{"medicines":[
   {"medicine":"Betahistine","dosage":"16mg","frequency":"TID","duration":"7 days","instructions":"after food"},
   {"medicine":"Cinnarizine","dosage":"25mg","frequency":"BD","duration":"5 days","instructions":"after food"},
   {"medicine":"Prochlorperazine","dosage":"5mg","frequency":"PRN","duration":"3 days","instructions":"if severe spinning or vomiting"}],
  "advice":["Get up from bed slowly in stages","Avoid driving and working at heights until symptoms settle","Epley manoeuvre exercises as demonstrated","Adequate hydration and sleep"],
  "followUpDays":7}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Dengue — Home Care','Warning-sign-led outpatient management of dengue fever','Infectious',
 ARRAY['dengue','fever','platelets','viral'],
 '{"medicines":[
   {"medicine":"Paracetamol","dosage":"650mg","frequency":"QID","duration":"5 days","instructions":"if fever above 100F, maximum 4 doses a day"},
   {"medicine":"ORS Sachet","dosage":"1 sachet","frequency":"PRN","duration":"5 days","instructions":"sip through the day"},
   {"medicine":"Papaya Leaf Extract","dosage":"1 tablet","frequency":"BD","duration":"5 days","instructions":"after food"}],
  "advice":["Strictly no ibuprofen, aspirin or other painkillers","Minimum 3 litres of fluid a day","Daily platelet count until the fever settles","Report immediately for bleeding gums, black stools, severe abdominal pain, restlessness or reduced urine","Use mosquito nets and repellents"],
  "followUpDays":1}'::jsonb),

('e9106ae7-98b5-44a5-9f57-98c480b34f30','Low Back Ache — Mechanical','Conservative care for acute mechanical back pain','Musculoskeletal',
 ARRAY['back pain','lumbar','spine','physiotherapy'],
 '{"medicines":[
   {"medicine":"Etoricoxib","dosage":"90mg","frequency":"OD","duration":"5 days","instructions":"after food"},
   {"medicine":"Thiocolchicoside","dosage":"4mg","frequency":"BD","duration":"5 days","instructions":"after food"},
   {"medicine":"Pantoprazole","dosage":"40mg","frequency":"OD","duration":"7 days","instructions":"before breakfast"},
   {"medicine":"Methylcobalamin + Pregabalin","dosage":"750mcg+75mg","frequency":"OD","duration":"10 days","instructions":"at bedtime"}],
  "advice":["Firm mattress, avoid soft sofas","No forward bending or heavy lifting","Hot fomentation twice daily","Core strengthening physiotherapy after pain settles","MRI only if pain radiates below the knee or weakness develops"],
  "followUpDays":7}'::jsonb)
ON CONFLICT (clinic_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. IPD document templates
--    {{placeholders}} are resolved by documentService.ts against the chart
-- ---------------------------------------------------------------------------
INSERT INTO public.ipd_document_templates (clinic_id, doc_type, name, html_template, placeholders, page_size)
VALUES

-- 8.1 Discharge summary — medical ---------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','discharge_summary','Discharge Summary — Medical',
'<h2 style="text-align:center;margin:0 0 4px">DISCHARGE SUMMARY</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Discharged:</b> {{discharge.date}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}} &middot; Stay: {{admission.los}} day(s)</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Blood Group:</b> {{patient.blood_group}}</td>
    <td style="padding:2px 4px"><b>Allergies:</b> {{patient.allergies}}</td>
  </tr>
</table>

<h3>Final Diagnosis</h3>
<p>{{admission.diagnosis}}</p>
<p style="font-size:12px;color:#555">ICD-10: {{admission.icd_codes}}</p>

<h3>Presenting Complaints</h3>
<p>{{admission.reason}}</p>

<h3>Course in Hospital</h3>
{{narrative.course}}

<h3>Investigations</h3>
{{investigations.list}}

<h3>Reports Filed</h3>
{{reports.list}}

<h3>Cross Consultations</h3>
{{consultations.list}}

<h3>Condition at Discharge</h3>
<p>{{narrative.condition}}</p>
<p><b>Vitals at discharge:</b> {{vitals.latest}}</p>

<h3>Treatment Given During Stay</h3>
{{medications.course}}

<h3>Medications on Discharge</h3>
{{medications.discharge}}

<h3>Diet Advice</h3>
<p>{{diet.current}}</p>

<h3>Advice &amp; Follow-up</h3>
{{narrative.advice}}

<h3>When to Report Back Immediately</h3>
<ul>
  <li>Fever above 101&deg;F not settling with medication</li>
  <li>Severe pain, breathlessness or chest discomfort</li>
  <li>Persistent vomiting or inability to take orally</li>
  <li>Reduced urine output, giddiness or altered behaviour</li>
  <li>Any bleeding from any site</li>
</ul>

<br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","patient.blood_group","patient.allergies","admission.number","admission.date","admission.bed","admission.los","admission.diagnosis","admission.icd_codes","admission.reason","doctor.name","discharge.date","narrative.course","narrative.condition","narrative.advice","investigations.list","reports.list","consultations.list","vitals.latest","medications.course","medications.discharge","diet.current"]'::jsonb,
'A4'),

-- 8.2 Discharge summary — surgical --------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','discharge_summary','Discharge Summary — Surgical',
'<h2 style="text-align:center;margin:0 0 4px">DISCHARGE SUMMARY (SURGICAL)</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Discharged:</b> {{discharge.date}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Surgeon:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}} &middot; Stay: {{admission.los}} day(s)</td>
  </tr>
</table>

<h3>Pre-operative Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Procedure Performed</h3>
<p></p>

<h3>Date of Surgery / Anaesthesia</h3>
<p></p>

<h3>Operative Findings</h3>
<p></p>

<h3>Implants / Specimen Sent</h3>
<p></p>

<h3>Post-operative Course</h3>
{{narrative.course}}

<h3>Investigations</h3>
{{investigations.list}}

<h3>Condition at Discharge</h3>
<p>{{narrative.condition}}</p>
<p><b>Wound status:</b> Healthy, dressing dry, no discharge.</p>

<h3>Medications on Discharge</h3>
{{medications.discharge}}

<h3>Diet Advice</h3>
<p>{{diet.current}}</p>

<h3>Wound Care &amp; Follow-up</h3>
{{narrative.advice}}
<ul>
  <li>Keep the wound clean and dry; sponge bath until suture removal</li>
  <li>Dressing change as advised by the ward</li>
  <li>Suture / staple removal on the scheduled day</li>
  <li>No heavy lifting or straining for 4 weeks</li>
</ul>

<br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant Surgeon</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","admission.number","admission.date","admission.bed","admission.los","admission.diagnosis","doctor.name","discharge.date","narrative.course","narrative.condition","narrative.advice","investigations.list","medications.discharge","diet.current"]'::jsonb,
'A4'),

-- 8.3 OT note — general surgery -----------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','ot_note','OT Note — General Surgery',
'<h2 style="text-align:center;margin:0 0 4px">OPERATION THEATRE NOTE</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Surgeon:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Blood Group:</b> {{patient.blood_group}}</td>
  </tr>
</table>

<h3>Pre-operative Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Post-operative Diagnosis</h3>
<p></p>

<h3>Procedure Performed</h3>
<p></p>

<h3>Date &amp; Time of Surgery</h3>
<p>Start: &nbsp;&nbsp;&nbsp;&nbsp; End: </p>

<h3>Surgical Team</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="35%"><b>Surgeon</b></td><td>Dr. {{doctor.name}}</td></tr>
  <tr><td><b>Assistant</b></td><td></td></tr>
  <tr><td><b>Anaesthetist</b></td><td></td></tr>
  <tr><td><b>Scrub Nurse</b></td><td></td></tr>
</table>

<h3>Anaesthesia</h3>
<p>Type: &nbsp; General / Spinal / Local &nbsp;&nbsp; ASA Grade: </p>

<h3>Position &amp; Incision</h3>
<p></p>

<h3>Operative Findings</h3>
<p></p>

<h3>Procedure in Detail</h3>
<p></p>

<h3>Specimen / Implants</h3>
<p>Specimen sent for histopathology: Yes / No</p>

<h3>Blood Loss &amp; Fluids</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="35%"><b>Estimated blood loss</b></td><td>ml</td></tr>
  <tr><td><b>IV fluids given</b></td><td>ml</td></tr>
  <tr><td><b>Blood products</b></td><td>Nil</td></tr>
  <tr><td><b>Urine output</b></td><td>ml</td></tr>
</table>

<h3>Counts &amp; Closure</h3>
<p>Sponge, instrument and needle counts correct at the end of the procedure. Drain: Yes / No.</p>

<h3>Post-operative Instructions</h3>
<ul>
  <li>Nil by mouth for 6 hours, then sips of water if tolerated</li>
  <li>Monitor vitals every 2 hours for the first 12 hours</li>
  <li>IV fluids and antibiotics as charted</li>
  <li>Analgesia as prescribed; watch for pain score above 4</li>
  <li>Early ambulation from the evening of surgery</li>
  <li>Inform the surgeon if there is tachycardia, fever, abdominal distension or soakage of the dressing</li>
</ul>

<br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Operating Surgeon</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","patient.blood_group","admission.number","admission.date","admission.bed","admission.diagnosis","doctor.name","discharge.date"]'::jsonb,
'A4'),

-- 8.4 OT note — LSCS -----------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','ot_note','OT Note — LSCS (Caesarean)',
'<h2 style="text-align:center;margin:0 0 4px">OT NOTE — LOWER SEGMENT CAESAREAN SECTION</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y)</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Obstetrician:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Blood Group:</b> {{patient.blood_group}}</td>
  </tr>
</table>

<h3>Pre-operative Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Indication for LSCS</h3>
<p></p>

<h3>Procedure Performed</h3>
<p>Emergency / Elective Lower Segment Caesarean Section under spinal anaesthesia.</p>

<h3>Surgical Team</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="35%"><b>Obstetrician</b></td><td>Dr. {{doctor.name}}</td></tr>
  <tr><td><b>Assistant</b></td><td></td></tr>
  <tr><td><b>Anaesthetist</b></td><td></td></tr>
  <tr><td><b>Paediatrician</b></td><td></td></tr>
</table>

<h3>Operative Findings</h3>
<p>Uterus: &nbsp; Liquor: &nbsp; Cord: &nbsp; Placenta: </p>

<h3>Baby Details</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="35%"><b>Time of delivery</b></td><td></td></tr>
  <tr><td><b>Sex</b></td><td></td></tr>
  <tr><td><b>Birth weight</b></td><td>kg</td></tr>
  <tr><td><b>APGAR (1 / 5 min)</b></td><td></td></tr>
  <tr><td><b>Resuscitation needed</b></td><td>Nil</td></tr>
</table>

<h3>Procedure in Detail</h3>
<p>Pfannenstiel incision, layers opened, lower segment transverse uterine incision, baby delivered by cephalic/breech extraction, placenta and membranes delivered complete, uterus closed in two layers, haemostasis secured, counts correct, layers closed.</p>

<h3>Blood Loss &amp; Fluids</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="35%"><b>Estimated blood loss</b></td><td>ml</td></tr>
  <tr><td><b>IV fluids</b></td><td>ml</td></tr>
  <tr><td><b>Oxytocics given</b></td><td>Inj Oxytocin 10 IU IV</td></tr>
</table>

<h3>Post-operative Instructions</h3>
<ul>
  <li>Monitor vitals, uterine tone and per-vaginal bleeding every 15 minutes for 2 hours, then hourly</li>
  <li>Nil by mouth for 4 hours, then sips of water</li>
  <li>IV fluids, antibiotics and analgesia as charted</li>
  <li>Encourage early breastfeeding and skin-to-skin contact</li>
  <li>Catheter removal after 12 hours; ambulate thereafter</li>
  <li>Inform if there is heavy bleeding, boggy uterus, fever or reduced urine output</li>
</ul>

<br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant Obstetrician</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>',
'["patient.name","patient.age","patient.blood_group","admission.number","admission.date","admission.bed","admission.diagnosis","doctor.name","discharge.date"]'::jsonb,
'A4'),

-- 8.5 OT note — orthopaedic implant --------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','ot_note','OT Note — Orthopaedic (Implant)',
'<h2 style="text-align:center;margin:0 0 4px">OT NOTE — ORTHOPAEDIC PROCEDURE</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Surgeon:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Diagnosis:</b> {{admission.diagnosis}}</td>
  </tr>
</table>

<h3>Pre-operative Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Procedure Performed</h3>
<p>Side (Right / Left) marked and confirmed before induction. Procedure: </p>

<h3>Anaesthesia &amp; Position</h3>
<p>Spinal / General. Position: Supine / Lateral. Tourniquet time: &nbsp; minutes.</p>

<h3>Operative Findings</h3>
<p></p>

<h3>Implant Details</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="30%"><b>Implant</b></td><td></td></tr>
  <tr><td><b>Make / Company</b></td><td></td></tr>
  <tr><td><b>Size</b></td><td></td></tr>
  <tr><td><b>Batch / Lot No</b></td><td></td></tr>
  <tr><td><b>Sticker pasted</b></td><td>Yes</td></tr>
</table>

<h3>Procedure in Detail</h3>
<p></p>

<h3>Fluoroscopy / C-Arm</h3>
<p>Check films taken in AP and lateral views — reduction and implant position satisfactory.</p>

<h3>Blood Loss &amp; Counts</h3>
<p>Estimated blood loss: &nbsp; ml. Sponge, instrument and needle counts correct. Drain: Yes / No.</p>

<h3>Post-operative Instructions</h3>
<ul>
  <li>Limb elevation and neurovascular check every 2 hours for 24 hours</li>
  <li>Check X-ray on post-operative day 1</li>
  <li>IV antibiotics for 48 hours, then oral as charted</li>
  <li>DVT prophylaxis as prescribed</li>
  <li>Static quadriceps and ankle pump exercises from day 1</li>
  <li>Weight bearing: Non / Partial / Full — as advised by the surgeon</li>
  <li>Physiotherapy referral</li>
</ul>

<br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant Orthopaedic Surgeon</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","admission.number","admission.date","admission.bed","admission.diagnosis","doctor.name","discharge.date"]'::jsonb,
'A4'),

-- 8.6 Admission sheet ----------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','admission_sheet','Admission Sheet — General',
'<h2 style="text-align:center;margin:0 0 4px">ADMISSION / CASE SHEET</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Phone:</b> {{patient.phone}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Blood Group:</b> {{patient.blood_group}}</td>
    <td style="padding:2px 4px"><b>Allergies:</b> {{patient.allergies}}</td>
  </tr>
</table>

<h3>Presenting Complaints</h3>
<p>{{admission.reason}}</p>

<h3>History of Present Illness</h3>
<p></p>

<h3>Past History</h3>
<p>Diabetes / Hypertension / IHD / Asthma / TB / Thyroid / Surgery — </p>

<h3>Personal &amp; Family History</h3>
<p>Diet: &nbsp; Sleep: &nbsp; Bowel/Bladder: &nbsp; Addictions: &nbsp; Family history: </p>

<h3>General Examination</h3>
<p>Pallor / Icterus / Cyanosis / Clubbing / Lymphadenopathy / Oedema: </p>
<p><b>Vitals on admission:</b> {{vitals.latest}}</p>

<h3>Systemic Examination</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="20%"><b>CVS</b></td><td></td></tr>
  <tr><td><b>RS</b></td><td></td></tr>
  <tr><td><b>P/A</b></td><td></td></tr>
  <tr><td><b>CNS</b></td><td></td></tr>
</table>

<h3>Provisional Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Plan of Management</h3>
<p></p>

<br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Admitting Consultant</td>
    <td style="text-align:right">Date: {{admission.date}}</td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","patient.phone","patient.blood_group","patient.allergies","admission.number","admission.date","admission.bed","admission.reason","admission.diagnosis","doctor.name","vitals.latest"]'::jsonb,
'A4'),

-- 8.7 Consent — surgery / anaesthesia ------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','consent','Consent — Surgery & Anaesthesia',
'<h2 style="text-align:center;margin:0 0 4px">CONSENT FOR SURGERY AND ANAESTHESIA</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Diagnosis:</b> {{admission.diagnosis}}</td>
  </tr>
</table>

<h3>Procedure / Treatment Proposed</h3>
<p></p>

<h3>Explanation Given</h3>
<p>The nature of the illness, the proposed procedure, the expected benefit and the likely course of recovery have been explained to me in a language I understand (Marathi / Hindi / English).</p>

<h3>Risks &amp; Complications Explained</h3>
<ul>
  <li>Risks of anaesthesia including reaction to drugs</li>
  <li>Bleeding requiring blood transfusion</li>
  <li>Infection of the wound or chest</li>
  <li>Injury to adjacent organs or structures</li>
  <li>Need to change or extend the procedure based on operative findings</li>
  <li>Deep vein thrombosis, embolism and other unforeseen complications</li>
  <li>Possibility of ICU care, prolonged stay or a second procedure</li>
</ul>

<h3>Alternatives Discussed</h3>
<p>Conservative management, alternative procedures and the consequences of refusing treatment have been explained.</p>

<h3>Consent Declaration</h3>
<p>I, the undersigned, give my free and informed consent for the above procedure and for anaesthesia. I authorise the treating team to perform any additional procedure that becomes necessary in my interest during surgery. I consent to the use of anonymised photographs and records for teaching and documentation.</p>

<br/>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="6">
  <tr>
    <td width="50%"><b>Patient / Guardian signature</b><br/><br/><br/>Name:<br/>Relation:</td>
    <td><b>Witness signature</b><br/><br/><br/>Name:<br/>Relation:</td>
  </tr>
  <tr>
    <td><b>Doctor</b><br/><br/>Dr. {{doctor.name}}</td>
    <td><b>Date &amp; Time</b><br/><br/></td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","admission.number","admission.date","admission.bed","admission.diagnosis","doctor.name"]'::jsonb,
'A4'),

-- 8.8 Consent — high risk -------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','consent','Consent — High Risk',
'<h2 style="text-align:center;margin:0 0 4px">HIGH RISK CONSENT</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
  </tr>
</table>

<h3>Diagnosis &amp; Current Condition</h3>
<p>{{admission.diagnosis}}</p>
<p><b>Latest vitals:</b> {{vitals.latest}}</p>

<h3>Why This Patient Is High Risk</h3>
<ul>
  <li>Severity of the present illness</li>
  <li>Associated co-morbid conditions</li>
  <li>Age and general condition</li>
  <li>Haemodynamic instability / organ dysfunction</li>
</ul>

<h3>Explanation Given</h3>
<p>The treating team has explained that despite the best available treatment, the condition may deteriorate and may result in complications, need for ventilator support, or death. No guarantee of outcome has been given or implied.</p>

<h3>Consent Declaration</h3>
<p>I have understood the above explanation in my own language. I give consent for continued treatment, including intensive care, intubation, ventilation, dialysis, blood transfusion and resuscitation as required, at my own risk.</p>

<br/>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="6">
  <tr>
    <td width="50%"><b>Relative signature</b><br/><br/><br/>Name:<br/>Relation:</td>
    <td><b>Witness signature</b><br/><br/><br/>Name:</td>
  </tr>
  <tr>
    <td><b>Doctor</b><br/><br/>Dr. {{doctor.name}}</td>
    <td><b>Date &amp; Time</b><br/><br/></td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","admission.number","admission.bed","admission.diagnosis","doctor.name","vitals.latest"]'::jsonb,
'A4'),

-- 8.9 Discharge medication sheet ------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','discharge_medication','Discharge Medication Sheet',
'<h2 style="text-align:center;margin:0 0 4px">DISCHARGE MEDICATION SHEET</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Discharged:</b> {{discharge.date}}</td>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
  </tr>
</table>

<h3>Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Medications on Discharge</h3>
{{medications.discharge}}

<h3>Diet Advice</h3>
<p>{{diet.current}}</p>

<h3>Advice &amp; Follow-up</h3>
{{narrative.advice}}

<h3>Important Instructions</h3>
<ul>
  <li>Take medicines exactly as written — do not skip or stop early</li>
  <li>Keep this sheet with you at every follow-up visit</li>
  <li>Bring all medicine strips to the next visit</li>
  <li>Contact the hospital immediately for any new or worsening symptom</li>
</ul>

<br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","admission.number","admission.diagnosis","doctor.name","discharge.date","medications.discharge","diet.current","narrative.advice"]'::jsonb,
'A4'),

-- 8.10 Estimate -----------------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','estimate','Treatment Cost Estimate',
'<h2 style="text-align:center;margin:0 0 4px">ESTIMATED COST OF TREATMENT</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
  </tr>
</table>

<h3>Provisional Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Proposed Treatment / Procedure</h3>
<p></p>

<h3>Estimated Length of Stay</h3>
<p>&nbsp; day(s), including &nbsp; day(s) in ICU if required.</p>

<h3>Estimated Cost Breakup</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr style="background:#f2f2f2"><th align="left">Head</th><th align="right">Amount (Rs.)</th></tr>
  <tr><td>Room rent &amp; nursing</td><td align="right"></td></tr>
  <tr><td>Consultant / visiting charges</td><td align="right"></td></tr>
  <tr><td>Investigations (lab &amp; imaging)</td><td align="right"></td></tr>
  <tr><td>OT &amp; anaesthesia charges</td><td align="right"></td></tr>
  <tr><td>Implants &amp; consumables</td><td align="right"></td></tr>
  <tr><td>Pharmacy</td><td align="right"></td></tr>
  <tr><td>Other / support services</td><td align="right"></td></tr>
  <tr style="background:#f2f2f2"><td><b>Estimated total</b></td><td align="right"><b></b></td></tr>
</table>

<h3>Notes &amp; Disclaimer</h3>
<p>This is only an approximate estimate based on the expected course of treatment. The final bill may vary depending on the patient''s clinical progress, complications, additional investigations, extended stay or ICU care. Implant and high-end drug costs are billed at actuals.</p>

<br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Billing Executive</b><br/><br/>Signature</td>
    <td style="text-align:right"><b>Patient / Relative</b><br/><br/>Signature</td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","admission.number","admission.bed","admission.diagnosis","doctor.name"]'::jsonb,
'A4'),

-- 8.11 DAMA form ------------------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','dama_form','DAMA — Discharge Against Medical Advice',
'<h2 style="text-align:center;margin:0 0 4px">DISCHARGE AGAINST MEDICAL ADVICE</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Stay:</b> {{admission.los}} day(s)</td>
  </tr>
</table>

<h3>Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Condition at Time of Leaving</h3>
<p>{{vitals.latest}}</p>

<h3>Treatment Given So Far</h3>
{{medications.course}}

<h3>Advice Given</h3>
{{narrative.advice}}

<h3>Risks Explained</h3>
<p>The treating team has explained that leaving the hospital at this stage may lead to worsening of the illness, complications, permanent disability or death, and that the hospital cannot be held responsible for the consequences.</p>

<h3>Reason Stated by Patient / Relative</h3>
<p></p>

<h3>Declaration</h3>
<p>I am taking the patient home against the advice of the treating doctor, on my own responsibility and at my own risk. The risks have been explained to me in a language I understand.</p>

<br/>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="6">
  <tr>
    <td width="50%"><b>Patient / Relative signature</b><br/><br/><br/>Name:<br/>Relation:</td>
    <td><b>Witness signature</b><br/><br/><br/>Name:</td>
  </tr>
  <tr>
    <td><b>Doctor</b><br/><br/>Dr. {{doctor.name}}</td>
    <td><b>Date &amp; Time</b><br/><br/></td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","admission.number","admission.date","admission.bed","admission.los","admission.diagnosis","doctor.name","vitals.latest","medications.course","narrative.advice"]'::jsonb,
'A4'),

-- 8.12 Referral letter -------------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','referral_letter','Referral Letter',
'<h2 style="text-align:center;margin:0 0 4px">REFERRAL LETTER</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Referring Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Blood Group:</b> {{patient.blood_group}}</td>
  </tr>
</table>

<p><b>To,</b><br/>Dr. ____________________<br/>____________________ Hospital</p>

<h3>Reason for Referral</h3>
<p>{{admission.reason}}</p>

<h3>Clinical Summary</h3>
{{notes.course}}

<h3>Investigations</h3>
{{investigations.list}}

<h3>Reports Filed</h3>
{{reports.list}}

<h3>Treatment Given So Far</h3>
{{medications.course}}

<h3>Condition at Referral</h3>
<p>{{vitals.latest}}</p>

<h3>Advice / Request</h3>
<p>Kindly do the needful and oblige. The patient and relatives have been counselled about the reason for referral. Copies of all reports are enclosed.</p>

<br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","patient.blood_group","admission.number","admission.date","admission.bed","admission.reason","doctor.name","discharge.date","notes.course","investigations.list","reports.list","medications.course","vitals.latest"]'::jsonb,
'A4'),

-- 8.13 Death summary ----------------------------------------------------------------
('e9106ae7-98b5-44a5-9f57-98c480b34f30','death_summary','Death Summary',
'<h2 style="text-align:center;margin:0 0 4px">DEATH SUMMARY</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Stay:</b> {{admission.los}} day(s)</td>
  </tr>
</table>

<h3>Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Hospital Course</h3>
{{notes.course}}

<h3>Investigations</h3>
{{investigations.list}}

<h3>Treatment Given</h3>
{{medications.course}}

<h3>Events Leading to Death</h3>
<p></p>

<h3>Resuscitation</h3>
<p>CPR started at ______ and continued for ______ minutes as per ACLS protocol. Relatives were kept informed throughout.</p>

<h3>Cause of Death</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse" border="1" cellpadding="4">
  <tr><td width="30%"><b>Immediate cause</b></td><td></td></tr>
  <tr><td><b>Antecedent cause</b></td><td></td></tr>
  <tr><td><b>Underlying cause</b></td><td></td></tr>
  <tr><td><b>Other significant conditions</b></td><td></td></tr>
</table>

<h3>Time of Death</h3>
<p>Date: ____________ Time: ____________ &nbsp; Declared by: Dr. {{doctor.name}}</p>

<br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>',
'["patient.name","patient.age","patient.gender","admission.number","admission.date","admission.bed","admission.los","admission.diagnosis","doctor.name","discharge.date","notes.course","investigations.list","medications.course"]'::jsonb,
'A4')

ON CONFLICT (clinic_id, doc_type, name) DO NOTHING;

-- Link the surgery services to their OT note template so ordering a surgery
-- offers the right document
UPDATE public.services_master s
   SET document_template_id = t.id
  FROM public.ipd_document_templates t
 WHERE s.clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
   AND t.clinic_id = s.clinic_id
   AND s.document_template_id IS NULL
   AND (
     (s.service_code IN ('OT-APPY','OT-CHOLE','OT-HERNIA','OT-DJSTENT','OT-INCDR')
      AND t.name = 'OT Note — General Surgery')
     OR (s.service_code = 'OT-LSCS'  AND t.name = 'OT Note — LSCS (Caesarean)')
     OR (s.service_code = 'OT-ORIF'  AND t.name = 'OT Note — Orthopaedic (Implant)')
   );

COMMIT;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
SELECT 'examination_templates' AS object, count(*) AS rows FROM public.examination_templates WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'prescription_presets',   count(*) FROM public.prescription_presets    WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_document_templates', count(*) FROM public.ipd_document_templates  WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'services_master',        count(*) FROM public.services_master         WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'departments',            count(*) FROM public.departments             WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'payers',                 count(*) FROM public.payers                  WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_wards',              count(*) FROM public.ipd_wards               WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'ipd_beds',               count(*) FROM public.ipd_beds                WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
UNION ALL SELECT 'order_sets',             count(*) FROM public.order_sets              WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30';
