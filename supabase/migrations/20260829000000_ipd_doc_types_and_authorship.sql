-- ============================================================================
-- IPD clinical paperwork: three new document types + per-type authorship
--
-- 1. New doc types, taken from the sheets hospitals actually run in the ward:
--
--      initial_assessment  Initial Doctor Assessment (admission work-up:
--                          complaints, HPI, past/personal history, general and
--                          systemic examination, local examination, provisional
--                          diagnosis, treatment plan)
--      case_sheet          IPD Case Sheet / Order Sheet (dated Details vs
--                          Management entries -- the doctor's running orders)
--      nursing_chart       Nursing Sheet (timed vitals blocks with a nurse sign
--                          against each round)
--
-- 2. Authorship stops being a single hard-coded doctor/not-doctor split.
--    Until now ipd_is_clinical_doc_type() decided, in code, which types needed
--    'ipd_documents_clinical'. A nursing sheet is a nurse's document and a case
--    sheet is a doctor's, and no clinic could change that mapping. Now every
--    doc type resolves to a required permission key:
--
--      ipd_documents           front desk / ward paperwork (default)
--      ipd_documents_nursing   nursing chart (NEW key)
--      ipd_documents_clinical  the treating doctor's documents
--
--    with a per-clinic override table (ipd_doc_type_access) editable from
--    Masters -> Document Templates. RLS reads the same mapping, so the UI is
--    not the only lock. Doctors may always author a nursing document; nurses
--    never gain a doctor's.
--
-- Safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Doc type vocabulary
-- ---------------------------------------------------------------------------

ALTER TABLE public.ipd_document_templates
  DROP CONSTRAINT IF EXISTS ipd_document_templates_doc_type_check;

ALTER TABLE public.ipd_document_templates
  ADD CONSTRAINT ipd_document_templates_doc_type_check CHECK (doc_type IN (
    'discharge_summary', 'discharge_medication', 'admission_sheet', 'consent',
    'final_bill', 'interim_bill', 'ot_note', 'death_summary', 'dama_form',
    'referral_letter', 'estimate',
    'initial_assessment', 'case_sheet', 'nursing_chart'
  ));

-- ---------------------------------------------------------------------------
-- 2. Per-clinic authorship map
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ipd_doc_type_access (
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  required_permission text NOT NULL CHECK (required_permission IN (
    'ipd_documents', 'ipd_documents_nursing', 'ipd_documents_clinical'
  )),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),
  PRIMARY KEY (clinic_id, doc_type)
);

ALTER TABLE public.ipd_doc_type_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ipd_doc_access_select ON public.ipd_doc_type_access;
DROP POLICY IF EXISTS ipd_doc_access_write  ON public.ipd_doc_type_access;

-- Everyone in the clinic reads it: the Documents tab needs the map to know
-- which types to offer.
CREATE POLICY ipd_doc_access_select ON public.ipd_doc_type_access
  FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- Changing who may write a document type is a Masters decision.
CREATE POLICY ipd_doc_access_write ON public.ipd_doc_type_access
  FOR ALL TO authenticated
  USING (
    clinic_id IN (SELECT public.user_clinic_ids())
    AND public.user_has_permission('ipd_masters')
  )
  WITH CHECK (
    clinic_id IN (SELECT public.user_clinic_ids())
    AND public.user_has_permission('ipd_masters')
  );

-- Built-in mapping, used whenever a clinic has no override row.
-- Keep in sync with DEFAULT_DOC_TYPE_PERMISSION in
-- src/modules/ipd/services/documentService.ts.
CREATE OR REPLACE FUNCTION public.ipd_default_doc_permission(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN t IN (
      'discharge_summary', 'discharge_medication', 'ot_note', 'death_summary',
      'referral_letter', 'initial_assessment', 'case_sheet'
    ) THEN 'ipd_documents_clinical'
    WHEN t = 'nursing_chart' THEN 'ipd_documents_nursing'
    ELSE 'ipd_documents'
  END;
$fn$;

GRANT EXECUTE ON FUNCTION public.ipd_default_doc_permission(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ipd_doc_type_permission(p_clinic uuid, t text)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(
    (SELECT a.required_permission
       FROM public.ipd_doc_type_access a
      WHERE a.clinic_id = p_clinic AND a.doc_type = t),
    public.ipd_default_doc_permission(t)
  );
$fn$;

GRANT EXECUTE ON FUNCTION public.ipd_doc_type_permission(uuid, text) TO authenticated;

-- May the CALLING user author this document type in this clinic?
CREATE OR REPLACE FUNCTION public.ipd_can_author_doc(p_clinic uuid, t text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT public.user_has_permission(q.perm)
      -- the treating doctor writes anything a nurse can; not the reverse
      OR (q.perm = 'ipd_documents_nursing'
          AND public.user_has_permission('ipd_documents_clinical'))
  FROM (SELECT public.ipd_doc_type_permission(p_clinic, t) AS perm) q;
$fn$;

REVOKE ALL ON FUNCTION public.ipd_can_author_doc(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ipd_can_author_doc(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hand out the new nursing key
--
--    Whoever charts vitals under Nursing & Medications keeps charting them on
--    the printed nursing sheet, and doctors/admins get it outright.
-- ---------------------------------------------------------------------------

UPDATE roles
SET permissions = array_append(permissions, 'ipd_documents_nursing')
WHERE NOT ('ipd_documents_nursing' = ANY(COALESCE(permissions, '{}')))
  AND (
    'ipd_clinical'              = ANY(COALESCE(permissions, '{}'))
    OR 'ipd_documents_clinical' = ANY(COALESCE(permissions, '{}'))
    OR lower(name) IN ('admin', 'super_admin')
  );

UPDATE profiles p
SET permissions = array_append(p.permissions, 'ipd_documents_nursing')
FROM roles r
WHERE p.role_id = r.id
  AND 'ipd_documents_nursing' = ANY(COALESCE(r.permissions, '{}'))
  AND NOT ('ipd_documents_nursing' = ANY(COALESCE(p.permissions, '{}')));

-- Per-user grants made in IPD -> Masters -> Users never touch the role row.
UPDATE profiles
SET permissions = array_append(permissions, 'ipd_documents_nursing')
WHERE NOT ('ipd_documents_nursing' = ANY(COALESCE(permissions, '{}')))
  AND (
    'ipd_clinical'              = ANY(COALESCE(permissions, '{}'))
    OR 'ipd_documents_clinical' = ANY(COALESCE(permissions, '{}'))
  );

-- ---------------------------------------------------------------------------
-- 4. RLS on ipd_documents now asks the map, not the hard-coded list
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS ipd_doc_insert ON public.ipd_documents;
DROP POLICY IF EXISTS ipd_doc_update ON public.ipd_documents;
DROP POLICY IF EXISTS ipd_doc_delete ON public.ipd_documents;

CREATE POLICY ipd_doc_insert ON public.ipd_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    clinic_id IN (SELECT public.user_clinic_ids())
    AND public.ipd_can_author_doc(clinic_id, doc_type)
  );

-- Only drafts may be changed, and only by someone entitled to that type. The
-- finalize step is an update on a draft row, so signing still works.
CREATE POLICY ipd_doc_update ON public.ipd_documents
  FOR UPDATE TO authenticated
  USING (
    clinic_id IN (SELECT public.user_clinic_ids())
    AND status = 'draft'
    AND public.ipd_can_author_doc(clinic_id, doc_type)
  )
  WITH CHECK (
    clinic_id IN (SELECT public.user_clinic_ids())
    AND public.ipd_can_author_doc(clinic_id, doc_type)
  );

CREATE POLICY ipd_doc_delete ON public.ipd_documents
  FOR DELETE TO authenticated
  USING (
    clinic_id IN (SELECT public.user_clinic_ids())
    AND status = 'draft'
    AND public.ipd_can_author_doc(clinic_id, doc_type)
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- Effective authorship map for a clinic:
--   SELECT t AS doc_type, public.ipd_doc_type_permission('<clinic_id>', t)
--   FROM unnest(ARRAY['discharge_summary','discharge_medication','admission_sheet',
--     'consent','ot_note','death_summary','dama_form','referral_letter','estimate',
--     'initial_assessment','case_sheet','nursing_chart']) t;
--
-- Who holds the nursing key:
--   SELECT name, 'ipd_documents_nursing' = ANY(permissions) FROM roles ORDER BY name;
--
-- Staff must sign out and back in -- profiles.permissions is read at login.
--
-- ROLLBACK:
--   Recreate the ipd_is_clinical_doc_type() based policies from
--   20260824000000_ipd_clinical_document_permission.sql, then
--   DROP TABLE public.ipd_doc_type_access;
