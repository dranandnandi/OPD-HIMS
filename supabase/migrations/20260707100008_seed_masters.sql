-- ============================================================================
-- IPD Migration 008: Seed function for IPD masters
-- Call once per clinic:  SELECT public.seed_ipd_masters('<clinic_id>');
-- Idempotent — safe to re-run (ON CONFLICT DO NOTHING on coded uniques).
-- Prices are sensible mid-hospital defaults; edit in Masters UI afterwards.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.seed_ipd_masters(p_clinic_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- charge group ids
  g_bed uuid; g_cons uuid; g_inv uuid; g_inv_path uuid; g_inv_rad uuid;
  g_proc uuid; g_proc_dress uuid; g_proc_minor uuid; g_proc_ot uuid;
  g_pharm uuid; g_pharm_drug uuid; g_pharm_consum uuid; g_pharm_implant uuid;
  g_support uuid; g_misc uuid;
  -- service ids
  s_rent_gen uuid; s_rent_semi uuid; s_rent_priv uuid; s_rent_icu uuid;
  s_nursing uuid; s_nursing_icu uuid;
  -- others
  v_payer_cash uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clinic_settings WHERE id = p_clinic_id) THEN
    RAISE EXCEPTION 'clinic % not found', p_clinic_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- Charge groups (tree)
  -- -------------------------------------------------------------------------
  INSERT INTO public.charge_groups (clinic_id, code, name) VALUES
    (p_clinic_id, 'BED', 'Bed & Nursing Charges'),
    (p_clinic_id, 'CONS', 'Consultations & Rounds'),
    (p_clinic_id, 'INV', 'Investigations'),
    (p_clinic_id, 'PROC', 'Procedures'),
    (p_clinic_id, 'PHARM', 'Pharmacy & Consumables'),
    (p_clinic_id, 'SUPPORT', 'Support Services'),
    (p_clinic_id, 'MISC', 'Miscellaneous')
  ON CONFLICT (clinic_id, code) DO NOTHING;

  SELECT id INTO g_bed FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'BED';
  SELECT id INTO g_cons FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'CONS';
  SELECT id INTO g_inv FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'INV';
  SELECT id INTO g_proc FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PROC';
  SELECT id INTO g_pharm FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PHARM';
  SELECT id INTO g_support FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'SUPPORT';
  SELECT id INTO g_misc FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'MISC';

  INSERT INTO public.charge_groups (clinic_id, parent_id, code, name) VALUES
    (p_clinic_id, g_inv, 'INV-PATH', 'Pathology'),
    (p_clinic_id, g_inv, 'INV-RAD', 'Radiology'),
    (p_clinic_id, g_proc, 'PROC-DRESS', 'Dressing & Wound Care'),
    (p_clinic_id, g_proc, 'PROC-MINOR', 'Minor Procedures'),
    (p_clinic_id, g_proc, 'PROC-OT', 'Surgeries / OT'),
    (p_clinic_id, g_pharm, 'PHARM-DRUG', 'Drugs'),
    (p_clinic_id, g_pharm, 'PHARM-CONSUM', 'Consumables'),
    (p_clinic_id, g_pharm, 'PHARM-IMPLANT', 'Implants')
  ON CONFLICT (clinic_id, code) DO NOTHING;

  SELECT id INTO g_inv_path FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'INV-PATH';
  SELECT id INTO g_inv_rad FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'INV-RAD';
  SELECT id INTO g_proc_dress FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PROC-DRESS';
  SELECT id INTO g_proc_minor FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PROC-MINOR';
  SELECT id INTO g_proc_ot FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PROC-OT';
  SELECT id INTO g_pharm_drug FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PHARM-DRUG';
  SELECT id INTO g_pharm_consum FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PHARM-CONSUM';
  SELECT id INTO g_pharm_implant FROM public.charge_groups WHERE clinic_id = p_clinic_id AND code = 'PHARM-IMPLANT';

  -- -------------------------------------------------------------------------
  -- Core services
  -- -------------------------------------------------------------------------
  INSERT INTO public.services_master
    (clinic_id, service_code, name, charge_group_id, service_type, base_price, base_cost, unit, is_sharable, requires_doctor)
  VALUES
    (p_clinic_id, 'BED-GEN', 'Room Rent — General Ward', g_bed, 'bed', 1500, 600, 'per day', false, false),
    (p_clinic_id, 'BED-SEMI', 'Room Rent — Semi Private', g_bed, 'bed', 2500, 900, 'per day', false, false),
    (p_clinic_id, 'BED-PRIV', 'Room Rent — Private', g_bed, 'bed', 4000, 1400, 'per day', false, false),
    (p_clinic_id, 'BED-ICU', 'Room Rent — ICU', g_bed, 'bed', 7500, 3000, 'per day', false, false),
    (p_clinic_id, 'NUR-GEN', 'Nursing Charges — Ward', g_bed, 'nursing', 400, 200, 'per day', false, false),
    (p_clinic_id, 'NUR-ICU', 'Nursing Charges — ICU', g_bed, 'nursing', 1000, 500, 'per day', false, false),
    (p_clinic_id, 'CONS-ROUND', 'Doctor Round / Daily Visit', g_cons, 'consultation', 500, 0, 'per visit', true, true),
    (p_clinic_id, 'CONS-CROSS', 'Cross Consultation', g_cons, 'consultation', 800, 0, 'per visit', true, true),
    (p_clinic_id, 'CONS-ICU', 'Intensivist Visit — ICU', g_cons, 'consultation', 1200, 0, 'per visit', true, true),
    (p_clinic_id, 'DRS-SMALL', 'Dressing — Small', g_proc_dress, 'procedure', 300, 100, 'per session', true, false),
    (p_clinic_id, 'DRS-LARGE', 'Dressing — Large', g_proc_dress, 'procedure', 700, 250, 'per session', true, false),
    (p_clinic_id, 'PRC-CATH', 'Urinary Catheterization', g_proc_minor, 'procedure', 800, 300, 'per procedure', true, true),
    (p_clinic_id, 'PRC-RYLES', 'Ryles Tube Insertion', g_proc_minor, 'procedure', 600, 200, 'per procedure', true, true),
    (p_clinic_id, 'PRC-IVCAN', 'IV Cannulation', g_proc_minor, 'procedure', 250, 100, 'per procedure', false, false),
    (p_clinic_id, 'SUP-AMB', 'Ambulance — Local', g_support, 'misc', 1500, 800, 'per trip', false, false),
    (p_clinic_id, 'SUP-DIET', 'Dietician Consultation', g_support, 'consultation', 500, 0, 'per visit', true, true),
    (p_clinic_id, 'MISC-ADM', 'Admission / Registration Fee', g_misc, 'misc', 500, 0, 'unit', false, false)
  ON CONFLICT (clinic_id, service_code) DO NOTHING;

  SELECT id INTO s_rent_gen FROM public.services_master WHERE clinic_id = p_clinic_id AND service_code = 'BED-GEN';
  SELECT id INTO s_rent_semi FROM public.services_master WHERE clinic_id = p_clinic_id AND service_code = 'BED-SEMI';
  SELECT id INTO s_rent_priv FROM public.services_master WHERE clinic_id = p_clinic_id AND service_code = 'BED-PRIV';
  SELECT id INTO s_rent_icu FROM public.services_master WHERE clinic_id = p_clinic_id AND service_code = 'BED-ICU';
  SELECT id INTO s_nursing FROM public.services_master WHERE clinic_id = p_clinic_id AND service_code = 'NUR-GEN';
  SELECT id INTO s_nursing_icu FROM public.services_master WHERE clinic_id = p_clinic_id AND service_code = 'NUR-ICU';

  -- -------------------------------------------------------------------------
  -- Bed types
  -- -------------------------------------------------------------------------
  INSERT INTO public.bed_types
    (clinic_id, code, name, room_rent_service_id, nursing_service_id, is_critical_care)
  VALUES
    (p_clinic_id, 'GEN', 'General Ward', s_rent_gen, s_nursing, false),
    (p_clinic_id, 'SEMI', 'Semi Private', s_rent_semi, s_nursing, false),
    (p_clinic_id, 'PRIV', 'Private', s_rent_priv, s_nursing, false),
    (p_clinic_id, 'ICU', 'ICU', s_rent_icu, s_nursing_icu, true)
  ON CONFLICT (clinic_id, code) DO NOTHING;

  -- -------------------------------------------------------------------------
  -- Sample wards + beds (only if the clinic has none yet)
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.ipd_wards WHERE clinic_id = p_clinic_id) THEN
    INSERT INTO public.ipd_wards (clinic_id, name, floor, ward_type) VALUES
      (p_clinic_id, 'General Ward A', '1', 'general'),
      (p_clinic_id, 'Private Wing', '2', 'private'),
      (p_clinic_id, 'ICU', '1', 'icu');

    INSERT INTO public.ipd_beds (clinic_id, ward_id, bed_number, bed_type_id)
    SELECT p_clinic_id, w.id, 'A-' || n, bt.id
      FROM public.ipd_wards w
      JOIN public.bed_types bt ON bt.clinic_id = p_clinic_id AND bt.code = 'GEN'
      CROSS JOIN generate_series(1, 10) n
     WHERE w.clinic_id = p_clinic_id AND w.name = 'General Ward A';

    INSERT INTO public.ipd_beds (clinic_id, ward_id, bed_number, bed_type_id)
    SELECT p_clinic_id, w.id, 'P-' || n, bt.id
      FROM public.ipd_wards w
      JOIN public.bed_types bt ON bt.clinic_id = p_clinic_id AND bt.code = 'PRIV'
      CROSS JOIN generate_series(1, 6) n
     WHERE w.clinic_id = p_clinic_id AND w.name = 'Private Wing';

    INSERT INTO public.ipd_beds (clinic_id, ward_id, bed_number, bed_type_id)
    SELECT p_clinic_id, w.id, 'ICU-' || n, bt.id
      FROM public.ipd_wards w
      JOIN public.bed_types bt ON bt.clinic_id = p_clinic_id AND bt.code = 'ICU'
      CROSS JOIN generate_series(1, 4) n
     WHERE w.clinic_id = p_clinic_id AND w.name = 'ICU';
  END IF;

  -- -------------------------------------------------------------------------
  -- Payers + default cash tariff plan
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.payers WHERE clinic_id = p_clinic_id AND payer_type = 'cash') THEN
    INSERT INTO public.payers (clinic_id, code, name, payer_type)
    VALUES (p_clinic_id, 'CASH', 'Self Pay / Cash', 'cash')
    RETURNING id INTO v_payer_cash;

    INSERT INTO public.tariff_plans (clinic_id, name, payer_id)
    VALUES (p_clinic_id, 'Standard (Cash)', v_payer_cash);
  END IF;

  RETURN 'IPD masters seeded for clinic ' || p_clinic_id;
END;
$$;

COMMIT;
