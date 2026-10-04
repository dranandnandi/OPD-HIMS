-- ============================================================================
-- Rate card load — clinic 8e34f380-dafe-4848-8bda-640834e9e94a
--
-- Source: the clinic's printed tariff (bed/nursing, doctor fees, IPD
-- procedures, two laboratory sheets, radiology).
--
-- STRICTLY CLINIC-SCOPED. Every write carries clinic_id = this clinic:
-- charge_groups, services_master, bed_types. It does NOT touch tests_master
-- (a global catalog with no clinic_id, shared by every clinic), does not
-- create or alter any function, trigger or table, and does not change the
-- room-rent auto-posting job — only this clinic's bed_types rows, which is
-- what that job reads for this clinic's admissions.
--
-- Routing decisions:
--   * Sections 1-3 (bed, doctor, IPD procedure) are IPD charge heads and go
--     into services_master, reusing the codes seed_ipd_masters() and
--     seed_ipd_standard_heads() already create where one exists.
--   * Sections 4-6 (lab + radiology) also go into services_master, under
--     INV-PATH / INV-RAD. They are billable on IPD admissions but will not
--     appear in the OPD test picker, which would require global tests_master
--     rows.
--   * Nursing stays a separate bill line (bed_types.nursing_service_id left
--     wired) with NUR-GEN / NUR-ICU repriced to 0, because the bed rates on
--     the card are "including nursing charges".
--
-- Idempotent: safe to re-run. Run in the Supabase SQL editor.
-- ============================================================================

BEGIN;

DO $rc$
DECLARE
  c_clinic  CONSTANT uuid := '8e34f380-dafe-4848-8bda-640834e9e94a';

  g_bed uuid; g_cons uuid; g_inv uuid; g_path uuid; g_rad uuid;
  g_proc uuid; g_proc_minor uuid; g_support uuid; g_equip uuid; g_blood uuid;

  s_bed_icu uuid; s_bed_semiicu uuid; s_bed_gen uuid; s_bed_semi uuid;
  s_nur_gen uuid; s_nur_icu uuid;

  v_created int := 0; v_repriced int := 0; v_skipped int := 0;
  v_seq_path int; v_seq_rad int; v_seq int; v_prefix text;
  v_group uuid; v_stype text; v_svc_id uuid;
  rt record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clinic_settings WHERE id = c_clinic) THEN
    RAISE EXCEPTION 'clinic % not found', c_clinic;
  END IF;

  -- =========================================================================
  -- 0. Charge groups. Created only if missing; never touches demo wards/beds,
  --    so this is safe on a clinic that has never run "Seed defaults".
  -- =========================================================================
  INSERT INTO public.charge_groups (clinic_id, code, name) VALUES
    (c_clinic, 'BED',     'Bed & Nursing Charges'),
    (c_clinic, 'CONS',    'Consultations & Rounds'),
    (c_clinic, 'INV',     'Investigations'),
    (c_clinic, 'PROC',    'Procedures'),
    (c_clinic, 'SUPPORT', 'Support Services'),
    (c_clinic, 'MISC',    'Miscellaneous')
  ON CONFLICT (clinic_id, code) DO NOTHING;

  SELECT id INTO g_bed     FROM public.charge_groups WHERE clinic_id = c_clinic AND code = 'BED';
  SELECT id INTO g_cons    FROM public.charge_groups WHERE clinic_id = c_clinic AND code = 'CONS';
  SELECT id INTO g_inv     FROM public.charge_groups WHERE clinic_id = c_clinic AND code = 'INV';
  SELECT id INTO g_proc    FROM public.charge_groups WHERE clinic_id = c_clinic AND code = 'PROC';
  SELECT id INTO g_support FROM public.charge_groups WHERE clinic_id = c_clinic AND code = 'SUPPORT';

  INSERT INTO public.charge_groups (clinic_id, parent_id, code, name) VALUES
    (c_clinic, g_inv,     'INV-PATH',   'Pathology'),
    (c_clinic, g_inv,     'INV-RAD',    'Radiology'),
    (c_clinic, g_proc,    'PROC-MINOR', 'Minor Procedures'),
    (c_clinic, g_support, 'SUP-EQUIP',  'Oxygen & Equipment'),
    (c_clinic, g_support, 'SUP-BLOOD',  'Blood Bank')
  ON CONFLICT (clinic_id, code) DO NOTHING;

  SELECT id INTO g_path       FROM public.charge_groups WHERE clinic_id = c_clinic AND code = 'INV-PATH';
  SELECT id INTO g_rad        FROM public.charge_groups WHERE clinic_id = c_clinic AND code = 'INV-RAD';
  SELECT id INTO g_proc_minor FROM public.charge_groups WHERE clinic_id = c_clinic AND code = 'PROC-MINOR';
  SELECT id INTO g_equip      FROM public.charge_groups WHERE clinic_id = c_clinic AND code = 'SUP-EQUIP';
  SELECT id INTO g_blood      FROM public.charge_groups WHERE clinic_id = c_clinic AND code = 'SUP-BLOOD';

  -- =========================================================================
  -- 1-3. IPD charge heads (bed, nursing, doctor fees, procedures)
  --
  -- ON CONFLICT updates name/price/unit/group but deliberately leaves
  -- is_sharable, requires_doctor and base_cost alone: those carry the clinic's
  -- doctor-share and costing configuration, which this rate card says nothing
  -- about.
  -- =========================================================================
  INSERT INTO public.services_master
    (clinic_id, service_code, name, charge_group_id, service_type,
     base_price, base_cost, unit, is_sharable, requires_doctor)
  VALUES
    -- 1. Bed charges (rates are inclusive of nursing; see NUR-* below)
    (c_clinic, 'BED-ICU',     'ICU Bed Charges',                     g_bed, 'bed', 3800, 0, 'per day', false, false),
    (c_clinic, 'BED-SEMIICU', 'Semi ICU Bed Charges',                g_bed, 'bed', 1500, 0, 'per day', false, false),
    (c_clinic, 'BED-GEN',     'General Ward / Day Care Bed Charges', g_bed, 'bed', 1000, 0, 'per day', false, false),
    (c_clinic, 'BED-SEMI',    'Twin Sharing (AC) Bed Charges',       g_bed, 'bed', 1500, 0, 'per day', false, false),
    -- Nursing kept as its own bill line but at nil value: the bed rate already
    -- includes it, so posting it above 0 would double-charge.
    (c_clinic, 'NUR-GEN',     'Nursing Charges (included in bed rate)',       g_bed, 'nursing', 0, 0, 'per day', false, false),
    (c_clinic, 'NUR-ICU',     'Nursing Charges - ICU (included in bed rate)', g_bed, 'nursing', 0, 0, 'per day', false, false),

    -- 2. Doctor / consultation charges
    (c_clinic, 'CONS-ICU',   'ICU Doctor Fee',                     g_cons, 'consultation', 1000, 0, 'per day', true, true),
    (c_clinic, 'CONS-ROUND', 'General Ward / Day Care Doctor Fee', g_cons, 'consultation',  700, 0, 'per day', true, true),
    (c_clinic, 'CONS-SEMI',  'Semi ICU / Twin Sharing Doctor Fee', g_cons, 'consultation',  700, 0, 'per day', true, true),
    (c_clinic, 'CONS-SUPER', 'Super-Speciality Consultation',      g_cons, 'consultation',  800, 0, 'per day', true, true),

    -- 3. IPD procedure / service charges
    (c_clinic, 'SUP-OXYGEN', 'Oxygen (O2) Charges',                  g_equip,      'equipment', 1200, 0, 'per day',       false, false),
    (c_clinic, 'PRC-NEB',    'Nebulization',                         g_proc_minor, 'procedure',   50, 0, 'per time',      false, false),
    (c_clinic, 'SUP-BIPAP',  'BiPAP Charges',                        g_equip,      'equipment', 2000, 0, 'per day',       false, false),
    (c_clinic, 'PRC-INFUS',  'One Infusion Charge',                  g_proc_minor, 'procedure',  150, 0, 'per day',       false, false),
    (c_clinic, 'SUP-VENT',   'Ventilator with O2',                   g_equip,      'equipment', 2800, 0, 'per day',       false, false),
    (c_clinic, 'BLD-TRANSF', 'Blood / Platelet Transfusion Charges', g_blood,      'procedure', 1500, 0, 'per unit',      false, false),
    (c_clinic, 'PRC-CATH',   'Indwelling Catheter',                  g_proc_minor, 'procedure',  100, 0, 'per procedure', true,  false),
    (c_clinic, 'PRC-RYLES',  'Indwelling RT (Ryles Tube)',           g_proc_minor, 'procedure',  200, 0, 'per procedure', true,  false)
  ON CONFLICT (clinic_id, service_code) DO UPDATE SET
    name            = EXCLUDED.name,
    charge_group_id = EXCLUDED.charge_group_id,
    service_type    = EXCLUDED.service_type,
    base_price      = EXCLUDED.base_price,
    unit            = EXCLUDED.unit,
    is_active       = true,
    updated_at      = now();

  SELECT id INTO s_bed_icu     FROM public.services_master WHERE clinic_id = c_clinic AND service_code = 'BED-ICU';
  SELECT id INTO s_bed_semiicu FROM public.services_master WHERE clinic_id = c_clinic AND service_code = 'BED-SEMIICU';
  SELECT id INTO s_bed_gen     FROM public.services_master WHERE clinic_id = c_clinic AND service_code = 'BED-GEN';
  SELECT id INTO s_bed_semi    FROM public.services_master WHERE clinic_id = c_clinic AND service_code = 'BED-SEMI';
  SELECT id INTO s_nur_gen     FROM public.services_master WHERE clinic_id = c_clinic AND service_code = 'NUR-GEN';
  SELECT id INTO s_nur_icu     FROM public.services_master WHERE clinic_id = c_clinic AND service_code = 'NUR-ICU';

  -- Bed classes. Nursing stays wired so post_room_rent_for_date() keeps
  -- emitting the (now nil-value) nursing line alongside room rent.
  INSERT INTO public.bed_types
    (clinic_id, code, name, room_rent_service_id, nursing_service_id, is_critical_care)
  VALUES
    (c_clinic, 'ICU',     'ICU',                     s_bed_icu,     s_nur_icu, true),
    (c_clinic, 'SEMIICU', 'Semi ICU',                s_bed_semiicu, s_nur_icu, true),
    (c_clinic, 'GEN',     'General Ward / Day Care', s_bed_gen,     s_nur_gen, false),
    (c_clinic, 'SEMI',    'Twin Sharing (AC)',       s_bed_semi,    s_nur_gen, false)
  ON CONFLICT (clinic_id, code) DO UPDATE SET
    name                 = EXCLUDED.name,
    room_rent_service_id = EXCLUDED.room_rent_service_id,
    nursing_service_id   = EXCLUDED.nursing_service_id,
    is_critical_care     = EXCLUDED.is_critical_care,
    is_active            = true,
    updated_at           = now();

  -- The card has no private-room rate. PRIV is left exactly as it is rather
  -- than guessed at; flag it so it gets priced or retired deliberately.
  IF EXISTS (SELECT 1 FROM public.bed_types
              WHERE clinic_id = c_clinic AND code = 'PRIV' AND is_active) THEN
    RAISE NOTICE 'bed class PRIV is still active and is NOT on this rate card - price or deactivate it manually';
  END IF;

  -- =========================================================================
  -- 4-6. Lab + radiology, into this clinic's price book
  --
  -- These land in services_master only. tests_master is a GLOBAL catalog (no
  -- clinic_id, UNIQUE name) shared by every clinic on the project, so nothing
  -- here writes to it — that is also why clinic_test_prices is untouched: a
  -- price row there needs a tests_master id, and creating those ids would mean
  -- adding global rows.
  --
  -- Consequence to be aware of: these rates are billable on IPD admissions but
  -- will NOT appear in the OPD test picker. Making them OPD-orderable requires
  -- global tests_master names, which is deliberately out of scope here.
  -- =========================================================================

  -- Codes continue whatever INV-PATH-### / INV-RAD-### series already exists
  -- for this clinic.
  SELECT COALESCE(MAX(substring(service_code from '([0-9]+)$')::int), 0) INTO v_seq_path
    FROM public.services_master WHERE clinic_id = c_clinic AND service_code LIKE 'INV-PATH-%';
  SELECT COALESCE(MAX(substring(service_code from '([0-9]+)$')::int), 0) INTO v_seq_rad
    FROM public.services_master WHERE clinic_id = c_clinic AND service_code LIKE 'INV-RAD-%';

  -- ------------------------------------------------------------------------
  -- Rate-card source data. Edit prices HERE and re-run; the logic below is
  -- generic. It is an inline VALUES list rather than a temp table because the
  -- Supabase SQL editor does not reliably keep a temp table alive between the
  -- statements of one script.
  -- ------------------------------------------------------------------------
  FOR rt IN
    SELECT t.name::text AS name, t.price::numeric AS price, t.ttype::text AS ttype
      FROM (VALUES
        -- --- Laboratory sheet 1 ---------------------------------------------------
        ('Alkaline Phosphatase',                                    100, 'lab'),
        ('Anti CCP (Cyclic Citrullinated Peptide)',                 900, 'lab'),
        ('Anti Dengue Antibody - IgG, IgM, NS1 Antigen (Package)', 1100, 'lab'),
        ('APT Test',                                                400, 'lab'),
        ('Arterial Blood Gas (ABG)',                               1700, 'lab'),
        ('ASO',                                                     300, 'lab'),
        ('Bilirubin Total',                                         200, 'lab'),
        ('Blood Group ABO & Rh',                                    200, 'lab'),
        ('BUN (Blood Urea Nitrogen)',                               200, 'lab'),
        ('BT/CT (Bleeding Time / Clotting Time)',                   200, 'lab'),
        ('Calcium',                                                 200, 'lab'),
        ('CBC / CBC with ESR',                                      300, 'lab'),
        ('Chikungunya - IgG, IgM',                                  500, 'lab'),
        ('Chloride (Cl)',                                           200, 'lab'),
        ('CPK-MB',                                                  400, 'lab'),
        ('Creatinine',                                              200, 'lab'),
        ('hs-CRP',                                                  600, 'lab'),
        ('CRP (Quantitative)',                                      300, 'lab'),
        ('D-Dimer',                                                1000, 'lab'),
        ('Dengue - IgG, IgM',                                       600, 'lab'),
        ('E2 (Estradiol)',                                          600, 'lab'),
        ('Electrolytes',                                            400, 'lab'),
        ('ESR / HB / TRBC / TLC / Platelet Count',                  200, 'lab'),
        ('FBS / PLBS / RBS / HbA1c',                                100, 'lab'),
        ('FSH + LH + Prolactin',                                   1100, 'lab'),
        ('HBsAg',                                                   400, 'lab'),
        ('HCV',                                                     600, 'lab'),
        ('HDL Cholesterol',                                         200, 'lab'),
        ('HIV I & II (Tri-Dot)',                                    400, 'lab'),
        ('Holter Monitoring',                                      1700, 'radiology'),
        ('Kidney Function Test (KFT)',                              500, 'lab'),
        ('LDL Cholesterol',                                         300, 'lab'),
        ('Lipid Profile',                                           500, 'lab'),
        ('Liver Function Test',                                     500, 'lab'),
        ('Magnesium',                                               300, 'lab'),
        ('Malaria Antigen',                                         200, 'lab'),
        ('Peripheral Smear Study',                                  200, 'lab'),
        ('Potassium (K)',                                           200, 'lab'),
        ('Procalcitonin',                                          2200, 'lab'),
        ('PSA Free',                                                900, 'lab'),
        -- --- Laboratory sheet 2 ---------------------------------------------------
        ('PSA Total',                                               400, 'lab'),
        ('PSA Total + Free',                                       1000, 'lab'),
        ('PT (Prothrombin Time)',                                   500, 'lab'),
        ('RA Factor',                                               300, 'lab'),
        ('Routine Urine Analysis',                                  100, 'lab'),
        ('Serum Albumin',                                           300, 'lab'),
        ('SGOT (AST)',                                              200, 'lab'),
        ('SGPT (ALT)',                                              200, 'lab'),
        ('Smear for MP (Rapid)',                                    200, 'lab'),
        ('Sodium (Na)',                                             200, 'lab'),
        ('Serum Calcium',                                           200, 'lab'),
        ('Stool Occult Blood',                                      100, 'lab'),
        ('T3/T4',                                                   300, 'lab'),
        ('Testosterone',                                            600, 'lab'),
        ('Thyroid Profile',                                         500, 'lab'),
        ('Total Cholesterol',                                       200, 'lab'),
        ('Total Protein',                                           200, 'lab'),
        ('Triglycerides',                                           200, 'lab'),
        ('TSH',                                                     300, 'lab'),
        ('Typhi Dot',                                               600, 'lab'),
        ('Urea',                                                    200, 'lab'),
        ('Uric Acid',                                               200, 'lab'),
        ('Urine C/S',                                               500, 'lab'),
        ('Urine Occult Blood',                                      200, 'lab'),
        ('VDRL',                                                    200, 'lab'),
        ('Widal Test (Slide Method)',                               200, 'lab'),
        -- Bedside sugar sits in the card's IPD-procedure block but is a test, so it
        -- is filed under Pathology rather than Minor Procedures.
        ('Blood Sugar',                                              50, 'lab'),
        -- --- Radiology / diagnostics ---------------------------------------------
        ('2D Echo',                                                1400, 'radiology'),
        ('ECG',                                                     250, 'radiology'),
        ('USG Abdomen / Pelvis',                                   1000, 'radiology'),
        ('X-Ray Chest PA/AP View',                                  200, 'radiology')
      ) AS t(name, price, ttype)
     ORDER BY ttype, name
  LOOP
    IF rt.ttype = 'radiology' THEN
      v_group := g_rad; v_stype := 'imaging';
    ELSE
      v_group := g_path; v_stype := 'lab';
    END IF;

    -- Match an existing service of this clinic by name, the same rule the
    -- Masters import uses, so re-running only reprices.
    v_svc_id := NULL;
    SELECT id INTO v_svc_id FROM public.services_master
     WHERE clinic_id = c_clinic AND lower(name) = lower(rt.name)
     LIMIT 1;

    IF v_svc_id IS NOT NULL THEN
      UPDATE public.services_master
         SET base_price = rt.price,
             is_active  = true,
             updated_at = now()
       WHERE id = v_svc_id
         AND clinic_id = c_clinic
         AND (base_price IS DISTINCT FROM rt.price OR is_active IS NOT TRUE);
      IF FOUND THEN v_repriced := v_repriced + 1; ELSE v_skipped := v_skipped + 1; END IF;
      CONTINUE;
    END IF;

    IF rt.ttype = 'radiology' THEN
      v_seq_rad := v_seq_rad + 1; v_seq := v_seq_rad; v_prefix := 'INV-RAD-';
    ELSE
      v_seq_path := v_seq_path + 1; v_seq := v_seq_path; v_prefix := 'INV-PATH-';
    END IF;
    WHILE EXISTS (SELECT 1 FROM public.services_master
                   WHERE clinic_id = c_clinic
                     AND upper(service_code) = v_prefix || lpad(v_seq::text, 3, '0')) LOOP
      v_seq := v_seq + 1;
    END LOOP;
    IF rt.ttype = 'radiology' THEN v_seq_rad := v_seq; ELSE v_seq_path := v_seq; END IF;

    INSERT INTO public.services_master
      (clinic_id, service_code, name, charge_group_id, service_type,
       base_price, base_cost, unit, is_sharable)
    VALUES
      (c_clinic, v_prefix || lpad(v_seq::text, 3, '0'), rt.name, v_group,
       v_stype::public.ipd_service_type_enum, rt.price, 0, 'per test', true);
    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE 'rate card loaded for clinic % - no rows written outside this clinic', c_clinic;
  RAISE NOTICE '  bed / doctor / procedure heads: 18 upserted, 4 bed classes set';
  RAISE NOTICE '  lab + radiology: % created, % repriced, % already correct',
    v_created, v_repriced, v_skipped;
END
$rc$;

COMMIT;

-- ============================================================================
-- Verification (run separately after the COMMIT above)
-- ============================================================================
-- \set c '8e34f380-dafe-4848-8bda-640834e9e94a'
--
-- -- Bed classes and the room rent / nursing pair the nightly job will post
-- SELECT bt.code, bt.name, rr.base_price AS bed_rate, nu.base_price AS nursing_rate
--   FROM bed_types bt
--   JOIN services_master rr ON rr.id = bt.room_rent_service_id
--   LEFT JOIN services_master nu ON nu.id = bt.nursing_service_id
--  WHERE bt.clinic_id = '8e34f380-dafe-4848-8bda-640834e9e94a' AND bt.is_active
--  ORDER BY bt.code;
--
-- -- Full IPD price book, by charge group
-- SELECT g.path, s.service_code, s.name, s.base_price, s.unit
--   FROM services_master s JOIN charge_groups g ON g.id = s.charge_group_id
--  WHERE s.clinic_id = '8e34f380-dafe-4848-8bda-640834e9e94a' AND s.is_active
--  ORDER BY g.path, s.name;
--
-- -- Proof that nothing leaked to another clinic: both counts must be 0
-- SELECT (SELECT count(*) FROM services_master WHERE clinic_id <> '8e34f380-dafe-4848-8bda-640834e9e94a'
--           AND updated_at > now() - interval '10 minutes') AS other_clinic_services,
--        (SELECT count(*) FROM bed_types WHERE clinic_id <> '8e34f380-dafe-4848-8bda-640834e9e94a'
--           AND updated_at > now() - interval '10 minutes') AS other_clinic_bed_types;
