-- ============================================================================
-- Verification script for split-capable package caps + claim break-up.
--
--   psql "$DATABASE_URL" -f supabase/tests/package_split_caps_test.sql
--
-- Runs inside a transaction and ROLLS BACK — nothing is left behind. It needs
-- a clinic that has already been through seed_ipd_masters() and
-- seed_ipd_standard_heads(), plus at least one patient and one profile.
--
-- Any assertion failure aborts with a message naming the case.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_clinic uuid; v_patient uuid; v_doctor uuid;
  g_path uuid; g_bed uuid;
  s_lab uuid; s_room uuid;
  v_pkg uuid; v_adm uuid; v_ap uuid;
  v_covered numeric; v_patient_pays numeric; v_n integer;
  v_consumed_1 numeric; v_consumed_2 numeric;
  v_total numeric; v_residual numeric;
  v_child uuid; v_surgeon uuid;
BEGIN
  SELECT c.id INTO v_clinic
    FROM public.clinic_settings c
   WHERE EXISTS (SELECT 1 FROM public.charge_groups g WHERE g.clinic_id = c.id AND g.code = 'INV-PATH')
   LIMIT 1;
  IF v_clinic IS NULL THEN
    RAISE EXCEPTION 'No clinic with seeded charge groups — run seed_ipd_masters() first';
  END IF;

  SELECT id INTO v_patient FROM public.patients WHERE clinic_id = v_clinic LIMIT 1;
  SELECT id INTO v_doctor  FROM public.profiles WHERE clinic_id = v_clinic LIMIT 1;
  IF v_patient IS NULL OR v_doctor IS NULL THEN
    RAISE EXCEPTION 'Clinic % needs at least one patient and one profile', v_clinic;
  END IF;

  SELECT id INTO g_path FROM public.charge_groups WHERE clinic_id = v_clinic AND code = 'INV-PATH';
  SELECT id INTO g_bed  FROM public.charge_groups WHERE clinic_id = v_clinic AND code = 'BED';

  INSERT INTO public.services_master
    (clinic_id, service_code, name, charge_group_id, service_type, base_price, unit)
  VALUES (v_clinic, 'ZZTEST-LAB', 'Test Lab Panel', g_path, 'lab', 1000, 'per test')
  RETURNING id INTO s_lab;

  INSERT INTO public.services_master
    (clinic_id, service_code, name, charge_group_id, service_type, base_price, unit)
  VALUES (v_clinic, 'ZZTEST-ROOM', 'Test Room Rent', g_bed, 'bed', 6000, 'per day')
  RETURNING id INTO s_room;

  -- =========================================================================
  -- Case 1 — amount cap, SPLIT: ₹2,000 cap, ₹1,500 then ₹6,000
  --          expect ₹2,000 absorbed, ₹5,500 to the patient
  -- =========================================================================
  INSERT INTO public.packages (clinic_id, name, package_price, default_cap_mode)
  VALUES (v_clinic, 'ZZTEST Split Package', 100000, 'split') RETURNING id INTO v_pkg;

  INSERT INTO public.package_items (clinic_id, package_id, item_kind, charge_group_id, max_amount)
  VALUES (v_clinic, v_pkg, 'inclusion', g_path, 2000);

  INSERT INTO public.ipd_admissions
    (clinic_id, admission_number, patient_id, admitting_doctor_id)
  VALUES (v_clinic, 'ZZTEST-1', v_patient, v_doctor) RETURNING id INTO v_adm;

  INSERT INTO public.admission_packages (clinic_id, admission_id, package_id, agreed_price)
  VALUES (v_clinic, v_adm, v_pkg, 100000) RETURNING id INTO v_ap;

  INSERT INTO public.charge_postings (clinic_id, admission_id, service_id, quantity, unit_rate)
  VALUES (v_clinic, v_adm, s_lab, 1, 1500);
  INSERT INTO public.charge_postings (clinic_id, admission_id, service_id, quantity, unit_rate)
  VALUES (v_clinic, v_adm, s_lab, 1, 6000);

  SELECT COALESCE(SUM(net_amount) FILTER (WHERE covered_by_package), 0),
         COALESCE(SUM(net_amount) FILTER (WHERE NOT covered_by_package), 0)
    INTO v_covered, v_patient_pays
    FROM public.charge_postings WHERE admission_id = v_adm AND status <> 'cancelled';

  IF v_covered <> 2000 OR v_patient_pays <> 5500 THEN
    RAISE EXCEPTION 'case 1 (amount cap split): expected 2000 in / 5500 out, got % / %',
      v_covered, v_patient_pays;
  END IF;

  SELECT consumed_amount INTO v_consumed_1 FROM public.admission_packages WHERE id = v_ap;
  IF v_consumed_1 <> 2000 THEN
    RAISE EXCEPTION 'case 1: consumed_amount should be 2000, got %', v_consumed_1;
  END IF;

  -- Case 1b — re-applying rules must be idempotent (merge back, re-resolve, re-split)
  PERFORM public.reapply_package_coverage(v_adm);
  PERFORM public.reapply_package_coverage(v_adm);

  SELECT COALESCE(SUM(net_amount) FILTER (WHERE covered_by_package), 0),
         COALESCE(SUM(net_amount) FILTER (WHERE NOT covered_by_package), 0)
    INTO v_covered, v_patient_pays
    FROM public.charge_postings WHERE admission_id = v_adm AND status <> 'cancelled';
  SELECT consumed_amount INTO v_consumed_2 FROM public.admission_packages WHERE id = v_ap;

  IF v_covered <> 2000 OR v_patient_pays <> 5500 OR v_consumed_2 <> v_consumed_1 THEN
    RAISE EXCEPTION 'case 1b (reapply idempotent): got % in / % out, consumed % (was %)',
      v_covered, v_patient_pays, v_consumed_2, v_consumed_1;
  END IF;

  SELECT COUNT(*) INTO v_n
    FROM public.charge_postings WHERE admission_id = v_adm AND split_parent_id IS NOT NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'case 1b: expected exactly 1 split child after two re-applies, got %', v_n;
  END IF;

  -- Case 1c — cancelling the covered half cancels its excess half
  SELECT id INTO v_child
    FROM public.charge_postings WHERE admission_id = v_adm AND split_parent_id IS NOT NULL;
  UPDATE public.charge_postings SET status = 'cancelled'
   WHERE id = (SELECT split_parent_id FROM public.charge_postings WHERE id = v_child);

  IF (SELECT status FROM public.charge_postings WHERE id = v_child) <> 'cancelled' THEN
    RAISE EXCEPTION 'case 1c (cancel cascade): excess half was not cancelled with its parent';
  END IF;

  -- =========================================================================
  -- Case 2 — same cap in BLOCK mode: the whole ₹6,000 falls out
  -- =========================================================================
  UPDATE public.packages SET default_cap_mode = 'block' WHERE id = v_pkg;

  INSERT INTO public.ipd_admissions
    (clinic_id, admission_number, patient_id, admitting_doctor_id)
  VALUES (v_clinic, 'ZZTEST-2', v_patient, v_doctor) RETURNING id INTO v_adm;
  INSERT INTO public.admission_packages (clinic_id, admission_id, package_id, agreed_price)
  VALUES (v_clinic, v_adm, v_pkg, 100000);

  INSERT INTO public.charge_postings (clinic_id, admission_id, service_id, quantity, unit_rate)
  VALUES (v_clinic, v_adm, s_lab, 1, 1500);
  INSERT INTO public.charge_postings (clinic_id, admission_id, service_id, quantity, unit_rate)
  VALUES (v_clinic, v_adm, s_lab, 1, 6000);

  SELECT COALESCE(SUM(net_amount) FILTER (WHERE covered_by_package), 0),
         COALESCE(SUM(net_amount) FILTER (WHERE NOT covered_by_package), 0)
    INTO v_covered, v_patient_pays
    FROM public.charge_postings WHERE admission_id = v_adm AND status <> 'cancelled';

  IF v_covered <> 1500 OR v_patient_pays <> 6000 THEN
    RAISE EXCEPTION 'case 2 (amount cap block): expected 1500 in / 6000 out, got % / %',
      v_covered, v_patient_pays;
  END IF;

  -- =========================================================================
  -- Case 3 — quantity cap: max 2 units, a 3-unit charge arrives
  -- =========================================================================
  UPDATE public.packages SET default_cap_mode = 'split' WHERE id = v_pkg;
  DELETE FROM public.package_items WHERE package_id = v_pkg;
  INSERT INTO public.package_items (clinic_id, package_id, item_kind, charge_group_id, max_quantity)
  VALUES (v_clinic, v_pkg, 'inclusion', g_path, 2);

  INSERT INTO public.ipd_admissions
    (clinic_id, admission_number, patient_id, admitting_doctor_id)
  VALUES (v_clinic, 'ZZTEST-3', v_patient, v_doctor) RETURNING id INTO v_adm;
  INSERT INTO public.admission_packages (clinic_id, admission_id, package_id, agreed_price)
  VALUES (v_clinic, v_adm, v_pkg, 100000);

  INSERT INTO public.charge_postings (clinic_id, admission_id, service_id, quantity, unit_rate)
  VALUES (v_clinic, v_adm, s_lab, 3, 1000);

  SELECT COALESCE(SUM(net_amount) FILTER (WHERE covered_by_package), 0),
         COALESCE(SUM(net_amount) FILTER (WHERE NOT covered_by_package), 0)
    INTO v_covered, v_patient_pays
    FROM public.charge_postings WHERE admission_id = v_adm AND status <> 'cancelled';

  IF v_covered <> 2000 OR v_patient_pays <> 1000 THEN
    RAISE EXCEPTION 'case 3 (qty cap split): expected 2 units in / 1 out, got % / %',
      v_covered, v_patient_pays;
  END IF;

  -- =========================================================================
  -- Case 4 — bed cap: ₹6,000/day against a ₹5,000 cap over 4 days
  --          expect 4 x ₹5,000 covered and 4 x ₹1,000 to the patient
  -- =========================================================================
  DELETE FROM public.package_items WHERE package_id = v_pkg;
  INSERT INTO public.package_items (clinic_id, package_id, item_kind, charge_group_id)
  VALUES (v_clinic, v_pkg, 'inclusion', g_bed);
  UPDATE public.packages SET per_day_bed_cap = 5000 WHERE id = v_pkg;

  INSERT INTO public.ipd_admissions
    (clinic_id, admission_number, patient_id, admitting_doctor_id)
  VALUES (v_clinic, 'ZZTEST-4', v_patient, v_doctor) RETURNING id INTO v_adm;
  INSERT INTO public.admission_packages (clinic_id, admission_id, package_id, agreed_price)
  VALUES (v_clinic, v_adm, v_pkg, 100000);

  INSERT INTO public.charge_postings (clinic_id, admission_id, service_id, quantity, unit_rate)
  VALUES (v_clinic, v_adm, s_room, 4, 6000);

  SELECT COALESCE(SUM(net_amount) FILTER (WHERE covered_by_package), 0),
         COALESCE(SUM(net_amount) FILTER (WHERE NOT covered_by_package), 0)
    INTO v_covered, v_patient_pays
    FROM public.charge_postings WHERE admission_id = v_adm AND status <> 'cancelled';

  IF v_covered <> 20000 OR v_patient_pays <> 4000 THEN
    RAISE EXCEPTION 'case 4 (bed cap split): expected 20000 in / 4000 out, got % / %',
      v_covered, v_patient_pays;
  END IF;

  -- both halves must keep the 4 days, only the rate differs
  SELECT COUNT(*) INTO v_n
    FROM public.charge_postings
   WHERE admission_id = v_adm AND split_reason = 'bed_cap' AND quantity = 4;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'case 4: both halves should keep quantity 4, got % such rows', v_n;
  END IF;

  -- =========================================================================
  -- Case 5 — break-up: components from actuals + auto residual, totals the price
  -- =========================================================================
  SELECT id INTO v_ap FROM public.admission_packages WHERE admission_id = v_adm;
  PERFORM public.fn_generate_package_breakup(v_ap);

  SELECT COALESCE(SUM(net), 0) INTO v_total
    FROM public.admission_package_breakup_lines WHERE assignment_id = v_ap;
  SELECT net INTO v_residual
    FROM public.admission_package_breakup_lines WHERE assignment_id = v_ap AND is_residual;

  IF v_total <> 100000 THEN
    RAISE EXCEPTION 'case 5 (break-up total): expected 100000, got %', v_total;
  END IF;
  -- ₹20,000 of covered room rent → residual absorbs the other ₹80,000
  IF v_residual <> 80000 THEN
    RAISE EXCEPTION 'case 5 (residual): expected 80000, got %', v_residual;
  END IF;

  -- Case 5b — adding a component rebalances the residual by itself
  SELECT id INTO v_surgeon
    FROM public.services_master
   WHERE clinic_id = v_clinic AND service_code = 'PF-SURGEON';
  IF v_surgeon IS NULL THEN
    RAISE EXCEPTION 'case 5b: PF-SURGEON missing — run seed_ipd_standard_heads() for clinic %', v_clinic;
  END IF;

  INSERT INTO public.admission_package_breakup_lines
    (clinic_id, assignment_id, service_id, description, quantity, unit_rate, net, source)
  VALUES (v_clinic, v_ap, v_surgeon, 'Surgeon Fee', 1, 10000, 10000, 'manual');

  SELECT net INTO v_residual
    FROM public.admission_package_breakup_lines WHERE assignment_id = v_ap AND is_residual;
  SELECT COALESCE(SUM(net), 0) INTO v_total
    FROM public.admission_package_breakup_lines WHERE assignment_id = v_ap;

  IF v_residual <> 70000 OR v_total <> 100000 THEN
    RAISE EXCEPTION 'case 5b (residual rebalance): expected residual 70000 and total 100000, got % / %',
      v_residual, v_total;
  END IF;

  -- Case 5c — renegotiating the agreed price rebalances it too
  UPDATE public.admission_packages SET agreed_price = 120000 WHERE id = v_ap;
  SELECT net INTO v_residual
    FROM public.admission_package_breakup_lines WHERE assignment_id = v_ap AND is_residual;
  IF v_residual <> 90000 THEN
    RAISE EXCEPTION 'case 5c (price change): expected residual 90000, got %', v_residual;
  END IF;

  RAISE NOTICE 'All package split-cap and break-up cases passed.';
END;
$$;

ROLLBACK;
