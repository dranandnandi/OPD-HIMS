-- ============================================================================
-- IPD Migration 018: One-off data fix — deposit over-credit on ADM-000001
--
-- The first test bill was generated BEFORE migration 014 recorded deposit
-- applications in the ledger, so the second bill re-applied the same deposit.
-- Tightly guarded: only touches the specific admission/bill amounts observed,
-- no-ops everywhere else and on re-run.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_adm public.ipd_admissions%ROWTYPE;
  v_b1 public.ipd_bills%ROWTYPE;   -- ₹4,800 settled interim (pre-fix)
  v_b2 public.ipd_bills%ROWTYPE;   -- ₹45,000 issued (double-applied deposits)
BEGIN
  SELECT * INTO v_adm FROM public.ipd_admissions
   WHERE admission_number = 'ADM-000001'
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_b1 FROM public.ipd_bills
   WHERE admission_id = v_adm.id AND net_total = 4800 AND deposits_applied = 4800
   ORDER BY created_at LIMIT 1;

  SELECT * INTO v_b2 FROM public.ipd_bills
   WHERE admission_id = v_adm.id AND net_total = 45000 AND deposits_applied = 5200
   ORDER BY created_at LIMIT 1;
  IF v_b1.id IS NULL OR v_b2.id IS NULL THEN RETURN; END IF;

  -- 1. Record bill 1's missing deposit application (only if absent)
  IF NOT EXISTS (
    SELECT 1 FROM public.ipd_deposits
     WHERE admission_id = v_adm.id AND entry_type = 'applied_to_bill' AND applied_bill_id = v_b1.id
  ) THEN
    INSERT INTO public.ipd_deposits
      (clinic_id, admission_id, receipt_number, amount, entry_type, applied_bill_id, notes)
    VALUES
      (v_adm.clinic_id, v_adm.id,
       public.next_document_number(v_adm.clinic_id, 'deposit'),
       4800, 'applied_to_bill', v_b1.id,
       'Data fix: retroactive record of deposit applied to ' || v_b1.bill_number);
  END IF;

  -- 2. Correct bill 2: only ₹400 of deposit was genuinely available
  UPDATE public.ipd_bills
     SET deposits_applied = 400,
         balance_amount = net_total - 400 - paid_amount,
         status = CASE WHEN net_total - 400 - paid_amount <= 0 THEN 'settled'
                       WHEN paid_amount > 0 THEN 'partially_paid'
                       ELSE 'issued' END,
         updated_at = now()
   WHERE id = v_b2.id AND deposits_applied = 5200;

  -- 3. Shrink bill 2's ledger application from 5200 to 400
  UPDATE public.ipd_deposits
     SET amount = 400,
         notes = COALESCE(notes, '') || ' (data fix: corrected from 5200)'
   WHERE admission_id = v_adm.id
     AND entry_type = 'applied_to_bill'
     AND applied_bill_id = v_b2.id
     AND amount = 5200;

  RAISE NOTICE 'ADM-000001 deposit ledger corrected';
END $$;

COMMIT;
