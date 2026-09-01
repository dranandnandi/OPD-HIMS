-- ============================================================================
-- IPD Migration 025: Provisional interim statement + consolidated final bill
--
-- THE BUG
-- -------
-- generate_ipd_bill() only ever swept charge_postings with status='pending',
-- flipping them to 'billed'. So an interim bill on day 3 consumed days 1-3,
-- and the FINAL bill on day 7 contained days 4-7 ONLY -- no package line
-- either, because admission_packages.billed_bill_id was already taken by the
-- interim. The document the patient carries home was a delta, not a bill, and
-- its grand total was not what the episode cost.
--
-- Three symptoms of the same root:
--   * the Final button was disabled once an interim had swept everything
--     (nothingToBill), so a final could not be produced at all;
--   * markAsFinal() only relabelled an interim -- no re-sweep, no
--     consolidation (removed in this change);
--   * the discharge guard never required a final bill to exist.
--
-- THE MODEL (standard Indian hospital / NABH / TPA practice)
-- ---------------------------------------------------------
--   interim       provisional running statement. Prints everything charged to
--                 date, consumes NOTHING: postings stay 'pending', packages
--                 stay unclaimed, no deposit is applied, no money is owed
--                 against it. Reprintable any day. is_provisional = true.
--                 Numbered from its own INT- series so the ipd_bill series
--                 (the real, taxable documents) has no gaps.
--   final         the ONE consolidated document for the whole episode. Sweeps
--                 every non-cancelled posting and every package, supersedes
--                 all earlier bills, and carries their receipts and applied
--                 deposits onto itself so nothing is double-counted.
--   supplementary unchanged -- pending-only sweep, for charges that land after
--                 the final (late lab, pharmacy return).
--
-- Money is receipts, not bills: cash taken during the stay belongs in
-- ipd_deposits and nets against the final. Only the final is payable.
--
-- Every ledger reader must ignore provisional and superseded rows. Updated
-- here: guard_ipd_discharge_billing(). Updated in app code:
-- billingService.getBillingOverview(), the payment picker, getActivity().
--
-- Safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.ipd_bills
  ADD COLUMN IF NOT EXISTS is_provisional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS superseded_by_bill_id uuid
    REFERENCES public.ipd_bills(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ipd_bills.is_provisional IS
  'Interim running statement: display-only, never payable, consumes no charge/package/deposit. Exclude from every ledger total.';

-- A bill retired by the consolidated final keeps its lines and history but
-- carries no money: 'superseded'. The old CHECK was declared inline on the
-- column, so drop it by definition rather than by an assumed name.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.ipd_bills'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%partially_paid%'
  LOOP
    EXECUTE format('ALTER TABLE public.ipd_bills DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.ipd_bills
  ADD CONSTRAINT ipd_bills_status_check CHECK (status IN (
    'draft', 'issued', 'partially_paid', 'settled', 'superseded', 'cancelled'
  ));

-- Receipts are re-parented onto the final bill so paid_amount/balance stay
-- correct on the one payable document; this remembers which bill the receipt
-- was originally raised against (the printed copy says so).
ALTER TABLE public.ipd_payments
  ADD COLUMN IF NOT EXISTS original_bill_id uuid
    REFERENCES public.ipd_bills(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ipd_bills_admission_live
  ON public.ipd_bills (admission_id)
  WHERE NOT is_provisional AND status NOT IN ('cancelled', 'superseded');

-- ---------------------------------------------------------------------------
-- 2. generate_ipd_bill()
-- ---------------------------------------------------------------------------

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
  v_provisional boolean := (p_bill_type = 'interim');
  v_consolidating boolean := (p_bill_type = 'final');
  v_deposits numeric;      -- pool still free
  v_carried numeric := 0;  -- deposits already applied, moved onto the final
  v_applied numeric := 0;  -- newly applied now
  v_paid numeric := 0;     -- receipts sitting on this bill
  v_balance numeric;
  v_gross numeric; v_disc numeric; v_tax numeric; v_net numeric;
  v_pkg record;
  v_pkg_total numeric := 0;
BEGIN
  IF p_bill_type NOT IN ('interim', 'final', 'supplementary') THEN
    RAISE EXCEPTION 'Invalid bill type %', p_bill_type;
  END IF;

  SELECT clinic_id INTO v_clinic_id FROM public.ipd_admissions WHERE id = p_admission_id;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Admission % not found', p_admission_id;
  END IF;

  IF v_provisional THEN
    -- own series, so the taxable ipd_bill series stays gap-free
    INSERT INTO public.document_number_sequences (clinic_id, doc_type, prefix)
    VALUES (v_clinic_id, 'ipd_interim', 'INT-')
    ON CONFLICT (clinic_id, doc_type) DO NOTHING;
    v_bill_number := public.next_document_number(v_clinic_id, 'ipd_interim');
  ELSE
    v_bill_number := public.next_document_number(v_clinic_id, 'ipd_bill');
  END IF;

  INSERT INTO public.ipd_bills
    (clinic_id, admission_id, bill_number, bill_type, is_provisional, created_by)
  VALUES
    (v_clinic_id, p_admission_id, v_bill_number, p_bill_type, v_provisional, p_created_by)
  RETURNING id INTO v_bill_id;

  -- A stay can be quoted many times; only the newest statement is current, so
  -- the earlier ones retire (they stay readable — the relative was given them).
  IF v_provisional THEN
    UPDATE public.ipd_bills
       SET status = 'superseded', superseded_by_bill_id = v_bill_id, updated_at = now()
     WHERE admission_id = p_admission_id AND id <> v_bill_id
       AND is_provisional AND status <> 'superseded';
  END IF;

  -- -------------------------------------------------------------------------
  -- 2a. The final absorbs every earlier bill: receipts and applied deposits
  --     move onto it, then those bills are retired at zero.
  -- -------------------------------------------------------------------------
  IF v_consolidating THEN
    UPDATE public.ipd_payments
       SET original_bill_id = COALESCE(original_bill_id, bill_id),
           bill_id = v_bill_id
     WHERE bill_id IN (
       SELECT id FROM public.ipd_bills
        WHERE admission_id = p_admission_id AND id <> v_bill_id AND status <> 'cancelled'
     );

    UPDATE public.ipd_deposits
       SET applied_bill_id = v_bill_id
     WHERE admission_id = p_admission_id
       AND entry_type = 'applied_to_bill'
       AND applied_bill_id IN (
         SELECT id FROM public.ipd_bills
          WHERE admission_id = p_admission_id AND id <> v_bill_id AND status <> 'cancelled'
       );

    SELECT COALESCE(SUM(amount), 0) INTO v_carried
      FROM public.ipd_deposits
     WHERE admission_id = p_admission_id
       AND entry_type = 'applied_to_bill'
       AND applied_bill_id = v_bill_id;

    -- ipd_payments_rollup() only recomputes the row's NEW bill, so the old
    -- ones are zeroed explicitly here.
    UPDATE public.ipd_bills
       SET status = 'superseded', superseded_by_bill_id = v_bill_id,
           paid_amount = 0, deposits_applied = 0, balance_amount = 0,
           patient_payable = 0, updated_at = now()
     WHERE admission_id = p_admission_id AND id <> v_bill_id AND status <> 'cancelled';
  END IF;

  -- -------------------------------------------------------------------------
  -- 2b. Package lines. The final claims every package; the provisional lists
  --     them without claiming; supplementary keeps the unclaimed-only rule.
  -- -------------------------------------------------------------------------
  FOR v_pkg IN
    SELECT ap.id, ap.agreed_price, p.name
      FROM public.admission_packages ap
      JOIN public.packages p ON p.id = ap.package_id
     WHERE ap.admission_id = p_admission_id
       AND ap.status IN ('active', 'closed')
       AND (v_consolidating OR v_provisional OR ap.billed_bill_id IS NULL)
     ORDER BY ap.created_at
  LOOP
    INSERT INTO public.ipd_bill_lines
      (clinic_id, bill_id, line_type, description, quantity, unit_rate, gross, discount, tax, net)
    VALUES
      (v_clinic_id, v_bill_id, 'package', v_pkg.name || ' (package)', 1,
       v_pkg.agreed_price, v_pkg.agreed_price, 0, 0, v_pkg.agreed_price);
    IF NOT v_provisional THEN
      UPDATE public.admission_packages SET billed_bill_id = v_bill_id, updated_at = now()
       WHERE id = v_pkg.id;
    END IF;
    v_pkg_total := v_pkg_total + v_pkg.agreed_price;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 2c. Charge lines. Final and provisional take the WHOLE episode; a
  --     supplementary takes only what is still pending.
  -- -------------------------------------------------------------------------
  WITH sweep AS (
    SELECT cp.*,
           COALESCE(cp.description, s.name)
             || CASE WHEN pd.name IS NOT NULL
                THEN ' — Dr. ' || regexp_replace(pd.name, '^[Dd][Rr]\.?\s*', '')
                ELSE '' END AS line_description
      FROM public.charge_postings cp
      JOIN public.services_master s ON s.id = cp.service_id
      LEFT JOIN public.profiles pd ON pd.id = cp.performing_doctor_id
     WHERE cp.admission_id = p_admission_id
       AND cp.covered_by_package = false
       AND CASE WHEN v_consolidating OR v_provisional
                THEN cp.status <> 'cancelled'
                ELSE cp.status = 'pending' END
     ORDER BY cp.service_date, cp.created_at
  ), lines AS (
    INSERT INTO public.ipd_bill_lines
      (clinic_id, bill_id, charge_posting_id, line_type, description,
       quantity, unit_rate, gross, discount, tax, net,
       charge_group_id, charge_group_path, performing_doctor_id)
    SELECT clinic_id, v_bill_id, id, 'charge', line_description,
           quantity, unit_rate, gross_amount, discount_amount, tax_amount, net_amount,
           charge_group_id, charge_group_path, performing_doctor_id
      FROM sweep
    RETURNING charge_posting_id, id
  )
  UPDATE public.charge_postings cp
     SET status = 'billed', bill_line_id = l.id, updated_at = now()
    FROM lines l
   WHERE cp.id = l.charge_posting_id
     AND NOT v_provisional;   -- a statement consumes nothing

  IF NOT v_provisional THEN
    UPDATE public.charge_postings
       SET status = 'billed', updated_at = now()
     WHERE admission_id = p_admission_id
       AND covered_by_package = true
       AND CASE WHEN v_consolidating THEN status <> 'cancelled' ELSE status = 'pending' END
       AND package_assignment_id IN (
         SELECT id FROM public.admission_packages WHERE billed_bill_id = v_bill_id
       );
  END IF;

  -- -------------------------------------------------------------------------
  -- 2d. Totals
  -- -------------------------------------------------------------------------
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

  IF v_provisional THEN
    -- Display only: no ledger row is written. Receipts already taken against
    -- real bills are shown so the running balance the relative is quoted is
    -- the true one.
    SELECT COALESCE(SUM(CASE WHEN p.record_type = 'payment' THEN p.amount ELSE -p.amount END), 0)
      INTO v_paid
      FROM public.ipd_payments p
      JOIN public.ipd_bills b ON b.id = p.bill_id
     WHERE b.admission_id = p_admission_id AND NOT b.is_provisional AND b.status <> 'cancelled';
    v_applied := LEAST(GREATEST(v_deposits, 0), GREATEST(v_net - v_paid, 0));
  ELSE
    SELECT paid_amount INTO v_paid FROM public.ipd_bills WHERE id = v_bill_id;
    v_applied := LEAST(GREATEST(v_deposits, 0), GREATEST(v_net - v_carried - v_paid, 0));
    IF v_applied > 0 THEN
      INSERT INTO public.ipd_deposits
        (clinic_id, admission_id, receipt_number, amount, entry_type, applied_bill_id, notes)
      VALUES
        (v_clinic_id, p_admission_id,
         public.next_document_number(v_clinic_id, 'deposit'),
         v_applied, 'applied_to_bill', v_bill_id,
         'Applied to bill ' || v_bill_number);
    END IF;
    v_applied := v_carried + v_applied;
  END IF;

  v_balance := v_net - v_applied - v_paid;

  UPDATE public.ipd_bills b
     SET gross_total = v_gross, discount_total = v_disc,
         tax_total = v_tax, net_total = v_net,
         package_total = v_pkg_total,
         patient_payable = v_net,
         deposits_applied = v_applied,
         paid_amount = v_paid,
         balance_amount = v_balance,
         status = CASE
           WHEN v_provisional THEN 'draft'
           WHEN v_balance <= 0 AND v_net > 0 THEN 'settled'
           WHEN v_paid > 0 THEN 'partially_paid'
           ELSE 'issued'
         END,
         updated_at = now()
   WHERE b.id = v_bill_id;

  RETURN v_bill_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Discharge guard: ignore provisional/superseded money, and demand a final
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_ipd_discharge_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_run uuid; v_through timestamptz; v_latest_note timestamptz;
  v_open integer; v_pending integer; v_balance numeric; v_final integer;
BEGIN
  IF OLD.status='admitted' AND NEW.status IN ('discharged','dama','expired','transferred_out') THEN
    SELECT id,notes_through INTO v_run,v_through FROM ipd_billing_audit_runs
     WHERE admission_id=NEW.id AND run_type='discharge' AND status='completed'
     ORDER BY completed_at DESC LIMIT 1;
    SELECT greatest(
      COALESCE((SELECT max(updated_at) FROM ipd_treatment_plans WHERE admission_id=NEW.id AND status='active'),'-infinity'),
      COALESCE((SELECT max(created_at) FROM ipd_nursing_notes WHERE admission_id=NEW.id),'-infinity')
    ) INTO v_latest_note;
    IF v_run IS NULL OR v_through < v_latest_note THEN RAISE EXCEPTION 'A fresh discharge billing audit is required'; END IF;

    SELECT count(*) INTO v_open FROM ipd_billing_audit_findings WHERE audit_run_id=v_run AND status='unresolved';
    SELECT count(*) INTO v_pending FROM charge_postings WHERE admission_id=NEW.id AND status='pending';
    SELECT count(*) INTO v_final FROM ipd_bills
     WHERE admission_id=NEW.id AND bill_type='final' AND NOT is_provisional
       AND status NOT IN ('cancelled','superseded');
    SELECT COALESCE(sum(greatest(balance_amount,0)),0) INTO v_balance FROM ipd_bills
     WHERE admission_id=NEW.id AND NOT is_provisional AND status NOT IN ('cancelled','superseded');

    IF v_open>0 THEN RAISE EXCEPTION '% billing-audit finding(s) remain unresolved',v_open; END IF;
    IF v_pending>0 THEN RAISE EXCEPTION '% charge(s) remain unbilled',v_pending; END IF;
    IF v_final=0 THEN RAISE EXCEPTION 'No final bill has been generated for this admission'; END IF;
    IF v_balance>0 THEN RAISE EXCEPTION 'Outstanding bill balance is %',v_balance; END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- Interim consumes nothing (pending count must be unchanged):
--   SELECT count(*) FROM charge_postings WHERE admission_id='<id>' AND status='pending';
--   SELECT public.generate_ipd_bill('<id>','interim');
--   SELECT count(*) FROM charge_postings WHERE admission_id='<id>' AND status='pending';
--
-- Final carries the whole episode -- these two must match:
--   SELECT public.generate_ipd_bill('<id>','final');
--   SELECT sum(net) FROM ipd_bill_lines WHERE bill_id='<final>';
--   SELECT (SELECT COALESCE(sum(net_amount),0) FROM charge_postings
--            WHERE admission_id='<id>' AND status<>'cancelled' AND NOT covered_by_package)
--        + (SELECT COALESCE(sum(agreed_price),0) FROM admission_packages
--            WHERE admission_id='<id>' AND status IN ('active','closed'));
--
-- Nothing double-counted after supersede:
--   SELECT bill_number,bill_type,is_provisional,status,net_total,deposits_applied,
--          paid_amount,balance_amount FROM ipd_bills WHERE admission_id='<id>';
--
-- ROLLBACK:
--   Restore generate_ipd_bill() from 20260709100022_performed_by_in_bills.sql and
--   guard_ipd_discharge_billing() from 20260820180000_ipd_note_billing_audit.sql;
--   UPDATE ipd_bills SET status='issued' WHERE status='superseded';
--   ALTER TABLE ipd_bills DROP COLUMN is_provisional, DROP COLUMN superseded_by_bill_id;
--   ALTER TABLE ipd_payments DROP COLUMN original_bill_id;
