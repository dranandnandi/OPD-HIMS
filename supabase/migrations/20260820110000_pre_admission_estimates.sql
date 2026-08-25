-- ============================================================================
-- Pre-admission ("free") estimates.
--
-- A cost estimate is the one IPD document that is normally written BEFORE the
-- patient is admitted — the family and the TPA both want the number first.
-- Until now every ipd_documents row had to hang off an admission, so an
-- estimate could only be produced for someone already occupying a bed.
--
-- ipd_documents therefore gains a patient_id, and admission_id becomes
-- optional: a row must be anchored to one or the other (or both, for the
-- normal in-admission case).
-- ============================================================================

BEGIN;

ALTER TABLE public.ipd_documents ALTER COLUMN admission_id DROP NOT NULL;

ALTER TABLE public.ipd_documents
  ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL;

-- Never orphan a document: it belongs to an admission, a patient, or both.
ALTER TABLE public.ipd_documents
  DROP CONSTRAINT IF EXISTS ipd_documents_subject_ck;
ALTER TABLE public.ipd_documents
  ADD CONSTRAINT ipd_documents_subject_ck
  CHECK (admission_id IS NOT NULL OR patient_id IS NOT NULL);

-- What the estimate was quoted against — patient, consultant, bed class, payer
-- and tariff plan. An admission carries all of that on the chart; a
-- pre-admission estimate has nowhere else to keep it, and without it reopening
-- a saved estimate would re-price it against the wrong class.
ALTER TABLE public.ipd_documents
  ADD COLUMN IF NOT EXISTS subject_context jsonb;

-- The pre-admission worklist: estimates with no admission behind them yet.
CREATE INDEX IF NOT EXISTS idx_documents_pre_admission
  ON public.ipd_documents (clinic_id, doc_type, created_at DESC)
  WHERE admission_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_patient
  ON public.ipd_documents (patient_id)
  WHERE patient_id IS NOT NULL;

COMMIT;
