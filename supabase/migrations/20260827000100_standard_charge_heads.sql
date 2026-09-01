-- ============================================================================
-- IPD Migration 024: Standard charge heads for package break-ups
--
-- A TPA package break-up is built from real service codes, not free text, and
-- the codes it needs were mostly absent: there was no surgeon fee, assistant
-- surgeon, anaesthetist, OT/theatre charge, blood bank, oxygen/equipment or
-- physiotherapy head. PROC-OT existed as an empty group. Nursing existed only
-- as the per-day NUR-GEN / NUR-ICU room add-ons.
--
-- Also introduces the RESIDUAL head (PKG-RESID): the balancing line whose
-- amount is always package price − sum(all other break-up lines). It is
-- deliberately is_package_eligible = false so the coverage engine can never
-- absorb it as an ordinary charge.
--
-- Idempotent; run per clinic:  SELECT public.seed_ipd_standard_heads('<id>');
-- ============================================================================

BEGIN;

-- Flag identifying a clinic's residual head. Only one per clinic.
ALTER TABLE public.services_master
  ADD COLUMN IF NOT EXISTS is_package_residual boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_residual_service_per_clinic
  ON public.services_master (clinic_id) WHERE is_package_residual;

CREATE OR REPLACE FUNCTION public.seed_ipd_standard_heads(p_clinic_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g_bed uuid; g_support uuid; g_misc uuid;
  g_prof uuid; g_prof_surg uuid; g_prof_anaes uuid; g_ot uuid;
  g_sup_blood uuid; g_sup_physio uuid; g_sup_equip uuid; g_misc_pkg uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clinic_settings WHERE id = p_clinic_id) THEN
    RAISE EXCEPTION 'clinic % not found', p_clinic_id;
  END IF;

  SELECT id INTO g_bed     FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'BED';
  SELECT id INTO g_support FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'SUPPORT';
  SELECT id INTO g_misc    FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'MISC';

  IF g_bed IS NULL OR g_support IS NULL OR g_misc IS NULL THEN
    RAISE EXCEPTION 'Base charge groups missing for clinic % — run seed_ipd_masters() first', p_clinic_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- Charge groups
  -- -------------------------------------------------------------------------
  INSERT INTO public.charge_groups (clinic_id, code, name) VALUES
    (p_clinic_id, 'PROF', 'Professional Fees'),
    (p_clinic_id, 'OT',   'Operation Theatre')
  ON CONFLICT (clinic_id, code) DO NOTHING;

  SELECT id INTO g_prof FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PROF';
  SELECT id INTO g_ot   FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'OT';

  INSERT INTO public.charge_groups (clinic_id, parent_id, code, name) VALUES
    (p_clinic_id, g_prof,    'PROF-SURG',   'Surgeon & Assistant'),
    (p_clinic_id, g_prof,    'PROF-ANAES',  'Anaesthesia'),
    (p_clinic_id, g_support, 'SUP-BLOOD',   'Blood Bank'),
    (p_clinic_id, g_support, 'SUP-PHYSIO',  'Physiotherapy'),
    (p_clinic_id, g_support, 'SUP-EQUIP',   'Oxygen & Equipment'),
    (p_clinic_id, g_misc,    'MISC-PKG',    'Package Adjustments')
  ON CONFLICT (clinic_id, code) DO NOTHING;

  SELECT id INTO g_prof_surg  FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PROF-SURG';
  SELECT id INTO g_prof_anaes FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PROF-ANAES';
  SELECT id INTO g_sup_blood  FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'SUP-BLOOD';
  SELECT id INTO g_sup_physio FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'SUP-PHYSIO';
  SELECT id INTO g_sup_equip  FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'SUP-EQUIP';
  SELECT id INTO g_misc_pkg   FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'MISC-PKG';

  -- -------------------------------------------------------------------------
  -- Services. Prices are mid-hospital defaults — edit in Masters afterwards.
  -- -------------------------------------------------------------------------
  INSERT INTO public.services_master
    (clinic_id, service_code, name, charge_group_id, service_type,
     base_price, base_cost, unit, is_sharable, requires_doctor)
  VALUES
    (p_clinic_id, 'PF-SURGEON',  'Surgeon Fee',                      g_prof_surg,  'surgery',    25000, 0, 'per surgery',   true,  true),
    (p_clinic_id, 'PF-ASSTSURG', 'Assistant Surgeon Fee',            g_prof_surg,  'surgery',     6000, 0, 'per surgery',   true,  true),
    (p_clinic_id, 'PF-ANAESTH',  'Anaesthetist Fee',                 g_prof_anaes, 'surgery',     8000, 0, 'per surgery',   true,  true),
    (p_clinic_id, 'OT-MAJOR',    'OT Charges — Major',               g_ot,         'procedure',  15000, 5000, 'per surgery', false, false),
    (p_clinic_id, 'OT-MINOR',    'OT Charges — Minor',               g_ot,         'procedure',   6000, 2000, 'per surgery', false, false),
    (p_clinic_id, 'OT-EQUIP',    'OT Equipment / Instrument Charges', g_ot,        'equipment',   5000, 1500, 'per surgery', false, false),
    (p_clinic_id, 'NUR-CARE',    'Nursing Care Charges',             g_bed,        'nursing',        0, 0, 'lump sum',      false, false),
    (p_clinic_id, 'BLD-TRANSF',  'Blood Transfusion Charges',        g_sup_blood,  'procedure',   1500, 500, 'per unit',     false, false),
    (p_clinic_id, 'BLD-CROSSM',  'Blood Grouping & Cross-matching',  g_sup_blood,  'lab',          800, 300, 'per sample',   false, false),
    (p_clinic_id, 'SUP-OXYGEN',  'Oxygen Charges',                   g_sup_equip,  'equipment',   1200, 400, 'per day',      false, false),
    (p_clinic_id, 'SUP-MONITOR', 'Monitor / Equipment Charges',      g_sup_equip,  'equipment',   1000, 300, 'per day',      false, false),
    (p_clinic_id, 'SUP-PHYSIO',  'Physiotherapy Session',            g_sup_physio, 'procedure',    600, 200, 'per session',  true,  false)
  ON CONFLICT (clinic_id, service_code) DO NOTHING;

  -- -------------------------------------------------------------------------
  -- The residual head. Never package-eligible: it is a balancing figure, not a
  -- charge the coverage engine may absorb, and it is excluded from doctor share.
  --
  -- The NAME is deliberately neutral — it prints on TPA annexures, where
  -- "residual" would flag the line as a balancing figure. The service_code
  -- PKG-RESID and the is_package_residual flag carry that meaning internally.
  -- -------------------------------------------------------------------------
  INSERT INTO public.services_master
    (clinic_id, service_code, name, charge_group_id, service_type,
     base_price, base_cost, unit, is_sharable, requires_doctor,
     is_package_eligible, is_insurance_eligible, is_package_residual)
  VALUES
    (p_clinic_id, 'PKG-RESID', 'Hospital & Nursing Services',
     g_misc_pkg, 'misc', 0, 0, 'lump sum', false, false, false, true, true)
  ON CONFLICT (clinic_id, service_code) DO NOTHING;

  -- Rename any head seeded before the name was made annexure-safe.
  UPDATE public.services_master
     SET name = 'Hospital & Nursing Services', updated_at = now()
   WHERE clinic_id = p_clinic_id
     AND service_code = 'PKG-RESID'
     AND name = 'Package Residual — Hospital Services';

  RETURN 'standard charge heads seeded for clinic ' || p_clinic_id;
END;
$$;

-- Seed every existing clinic now.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id FROM public.clinic_settings LOOP
    BEGIN
      PERFORM public.seed_ipd_standard_heads(c.id);
    EXCEPTION WHEN OTHERS THEN
      -- clinics that never ran seed_ipd_masters() have no base groups; skip.
      RAISE NOTICE 'skipped clinic %: %', c.id, SQLERRM;
    END;
  END LOOP;
END $$;

COMMIT;
