-- ============================================================================
-- IPD Migration 022: Performed-by doctor flows into bills
-- charge_postings.performing_doctor_id existed since 007 but never reached the
-- bill. Bill lines now carry the doctor id (doctor-share engine seed) and the
-- line description gets a " — Dr. X" suffix so every printed/PDF bill shows
-- who performed the surgery/procedure/consultation.
-- ============================================================================

BEGIN;

ALTER TABLE public.ipd_bill_lines
  ADD COLUMN IF NOT EXISTS performing_doctor_id uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.generate_ipd_bill(
  p_admission_id uuid,
  p_bill_type text DEFAULT 'interim',
  p_created_by uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id uuid;
  v_bill_id uuid;
  v_bill_number text;
  v_deposits numeric;
  v_applied numeric;
  v_gross numeric; v_disc numeric; v_tax numeric; v_net numeric;
  v_pkg record;
  v_pkg_total numeric := 0;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.ipd_admissions WHERE id = p_admission_id;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Admission % not found', p_admission_id;
  END IF;

  v_bill_number := public.next_document_number(v_clinic_id, 'ipd_bill');

  INSERT INTO public.ipd_bills (clinic_id, admission_id, bill_number, bill_type, created_by)
  VALUES (v_clinic_id, p_admission_id, v_bill_number, p_bill_type, p_created_by)
  RETURNING id INTO v_bill_id;

  FOR v_pkg IN
    SELECT ap.id, ap.agreed_price, p.name
      FROM public.admission_packages ap
      JOIN public.packages p ON p.id = ap.package_id
     WHERE ap.admission_id = p_admission_id
       AND ap.status IN ('active', 'closed')
       AND ap.billed_bill_id IS NULL
  LOOP
    INSERT INTO public.ipd_bill_lines
      (clinic_id, bill_id, line_type, description, quantity, unit_rate, gross, discount, tax, net)
    VALUES
      (v_clinic_id, v_bill_id, 'package', v_pkg.name || ' (package)', 1,
       v_pkg.agreed_price, v_pkg.agreed_price, 0, 0, v_pkg.agreed_price);
    UPDATE public.admission_packages SET billed_bill_id = v_bill_id, updated_at = now()
     WHERE id = v_pkg.id;
    v_pkg_total := v_pkg_total + v_pkg.agreed_price;
  END LOOP;

  WITH pending AS (
    SELECT cp.*,
           COALESCE(cp.description, s.name)
             || CASE WHEN pd.name IS NOT NULL
                THEN ' — Dr. ' || regexp_replace(pd.name, '^[Dd][Rr]\.?\s*', '')
                ELSE '' END AS line_description
      FROM public.charge_postings cp
      JOIN public.services_master s ON s.id = cp.service_id
      LEFT JOIN public.profiles pd ON pd.id = cp.performing_doctor_id
     WHERE cp.admission_id = p_admission_id
       AND cp.status = 'pending'
       AND cp.covered_by_package = false
     ORDER BY cp.service_date, cp.created_at
  ), lines AS (
    INSERT INTO public.ipd_bill_lines
      (clinic_id, bill_id, charge_posting_id, line_type, description,
       quantity, unit_rate, gross, discount, tax, net,
       charge_group_id, charge_group_path, performing_doctor_id)
    SELECT clinic_id, v_bill_id, id, 'charge', line_description,
           quantity, unit_rate, gross_amount, discount_amount, tax_amount, net_amount,
           charge_group_id, charge_group_path, performing_doctor_id
      FROM pending
    RETURNING charge_posting_id, id
  )
  UPDATE public.charge_postings cp
     SET status = 'billed', bill_line_id = l.id, updated_at = now()
    FROM lines l
   WHERE cp.id = l.charge_posting_id;

  UPDATE public.charge_postings
     SET status = 'billed', updated_at = now()
   WHERE admission_id = p_admission_id
     AND status = 'pending'
     AND covered_by_package = true
     AND package_assignment_id IN (
       SELECT id FROM public.admission_packages WHERE billed_bill_id = v_bill_id
     );

  SELECT COALESCE(SUM(gross),0), COALESCE(SUM(discount),0),
         COALESCE(SUM(tax),0), COALESCE(SUM(net),0)
    INTO v_gross, v_disc, v_tax, v_net
    FROM public.ipd_bill_lines WHERE bill_id = v_bill_id;

  SELECT COALESCE(SUM(CASE entry_type
           WHEN 'deposit' THEN amount
           WHEN 'refund' THEN -amount
           WHEN 'applied_to_bill' THEN -amount
         END), 0)
    INTO v_deposits
    FROM public.ipd_deposits WHERE admission_id = p_admission_id;

  v_applied := LEAST(GREATEST(v_deposits, 0), v_net);

  IF v_applied > 0 THEN
    INSERT INTO public.ipd_deposits
      (clinic_id, admission_id, receipt_number, amount, entry_type, applied_bill_id, notes)
    VALUES
      (v_clinic_id, p_admission_id,
       public.next_document_number(v_clinic_id, 'deposit'),
       v_applied, 'applied_to_bill', v_bill_id,
       'Applied to bill ' || v_bill_number);
  END IF;

  UPDATE public.ipd_bills b
     SET gross_total = v_gross, discount_total = v_disc,
         tax_total = v_tax, net_total = v_net,
         package_total = v_pkg_total,
         patient_payable = v_net,
         deposits_applied = v_applied,
         balance_amount = v_net - v_applied,
         status = CASE WHEN v_net - v_applied <= 0 AND v_net > 0 THEN 'settled' ELSE 'issued' END,
         updated_at = now()
   WHERE b.id = v_bill_id;

  RETURN v_bill_id;
END;
$$;

COMMIT;
