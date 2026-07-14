-- ============================================================================
-- IPD Migration 023: 'discharge_medication' document type
-- Printable discharge medication sheet (eMAR handover to patient) joins the
-- template-driven document types. RBAC needs no migration — IPD reuses the
-- OPD roles/profiles.permissions model with ipd_* permission keys.
-- ============================================================================

BEGIN;

ALTER TABLE public.ipd_document_templates
  DROP CONSTRAINT IF EXISTS ipd_document_templates_doc_type_check;

ALTER TABLE public.ipd_document_templates
  ADD CONSTRAINT ipd_document_templates_doc_type_check CHECK (doc_type IN (
    'discharge_summary', 'admission_sheet', 'consent', 'final_bill', 'interim_bill',
    'ot_note', 'death_summary', 'dama_form', 'referral_letter', 'estimate',
    'discharge_medication'
  ));

COMMIT;
