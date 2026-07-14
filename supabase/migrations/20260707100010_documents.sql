-- ============================================================================
-- IPD Migration 010: Document templates + generated documents
-- CKE-style HTML templates with {{placeholders}} (pattern ported from the
-- LIMS Template Studio), resolved into per-admission documents that are
-- drafted, finalized, signed, and printed with the admission barcode.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ipd_document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'discharge_summary', 'admission_sheet', 'consent', 'final_bill', 'interim_bill',
    'ot_note', 'death_summary', 'dama_form', 'referral_letter', 'estimate'
  )),
  name text NOT NULL,
  html_template text NOT NULL,
  placeholders jsonb NOT NULL DEFAULT '[]'::jsonb,
  page_size text NOT NULL DEFAULT 'A4',
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, doc_type, name)
);

CREATE TABLE IF NOT EXISTS public.ipd_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.ipd_document_templates(id) ON DELETE SET NULL,
  doc_type text NOT NULL,
  document_number text,
  content_html text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'signed')),
  signed_by uuid REFERENCES public.profiles(id),
  signed_at timestamptz,
  pdf_url text,
  generated_at timestamptz,
  scanned_upload_id uuid REFERENCES public.ocr_uploads(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_templates_clinic ON public.ipd_document_templates (clinic_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_admission ON public.ipd_documents (admission_id);
CREATE INDEX IF NOT EXISTS idx_documents_clinic_type ON public.ipd_documents (clinic_id, doc_type);

ALTER TABLE public.ipd_document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_documents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ipd_document_templates', 'ipd_documents'] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))', t);
    EXECUTE format(
      'CREATE POLICY tenant_write ON public.%I FOR ALL TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))
         WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()))', t);
  END LOOP;
END $$;

COMMIT;
