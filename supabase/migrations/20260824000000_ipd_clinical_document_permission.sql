-- ============================================================================
-- Clinical documents belong to the treating doctor.
--
-- Until now the Documents tab was gated on a single key, 'ipd_documents',
-- which meant view + create + edit + sign + delete. Nurses and receptionists
-- hold that key (they legitimately raise consents, admission sheets and
-- estimates), so they could also open an unsigned OT note or discharge
-- summary and rewrite it. RLS on ipd_documents was clinic-scoped only, so the
-- database did not stop it either.
--
-- This splits authoring of CLINICAL document types onto its own key,
-- 'ipd_documents_clinical', and enforces it in RLS as well as in the UI:
--
--   ipd_documents           -> see, print and PDF every document; author the
--                              administrative types (consent, admission sheet,
--                              DAMA, estimate)
--   ipd_documents_clinical  -> author and sign OT notes, discharge summaries,
--                              discharge medication, death summaries and
--                              referral letters
--
-- It also closes a second hole: a signed document could still be UPDATEd or
-- DELETEd straight through the API. Only the app's own .eq('status','draft')
-- filter was stopping that. Now the policy does.
--
-- Safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- Permission check for the CALLING user, mirroring the app's rule in
-- src/modules/ipd/contexts/AuthContext.tsx: an explicit grant, or the
-- 'all'/'admin' wildcards, or an admin role name.
-- SECURITY DEFINER so the policy can read profiles.permissions without the
-- caller needing a SELECT policy on their own profile row.
CREATE OR REPLACE FUNCTION public.user_has_permission(perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        perm       = ANY(COALESCE(p.permissions, '{}'))
        OR 'all'   = ANY(COALESCE(p.permissions, '{}'))
        OR 'admin' = ANY(COALESCE(p.permissions, '{}'))
        OR lower(COALESCE(p.role_name, '')) IN ('admin', 'super_admin')
      )
  );
$fn$;

REVOKE ALL ON FUNCTION public.user_has_permission(text) FROM public;
GRANT EXECUTE ON FUNCTION public.user_has_permission(text) TO authenticated;

-- Which document types are the doctor's to write. Keep in sync with
-- CLINICAL_DOC_TYPES in src/modules/ipd/services/documentService.ts.
CREATE OR REPLACE FUNCTION public.ipd_is_clinical_doc_type(t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT t IN (
    'discharge_summary',
    'discharge_medication',
    'ot_note',
    'death_summary',
    'referral_letter'
  );
$fn$;

GRANT EXECUTE ON FUNCTION public.ipd_is_clinical_doc_type(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Grant the new key to everyone who should keep authoring clinical docs.
--
--    Rule of thumb: whoever may write the treatment plan may write the
--    clinical documents. Nursing lost the plan in
--    20260818210000_ipd_treatment_plan_permission.sql, so nursing loses this
--    too -- which is the entire point.
-- ---------------------------------------------------------------------------

-- 2a. Roles that hold the plan key, plus doctors and admins outright.
UPDATE roles
SET permissions = array_append(permissions, 'ipd_documents_clinical')
WHERE NOT ('ipd_documents_clinical' = ANY(COALESCE(permissions, '{}')))
  AND (
    'ipd_treatment_plan' = ANY(COALESCE(permissions, '{}'))
    OR lower(name) ~ '(doctor|consultant|physician|surgeon|rmo|registrar|medical.?officer)'
    OR lower(name) IN ('admin', 'super_admin')
  );

-- 2b. Fan out to the denormalized copy on profiles, for roles that have it.
UPDATE profiles p
SET permissions = array_append(p.permissions, 'ipd_documents_clinical')
FROM roles r
WHERE p.role_id = r.id
  AND 'ipd_documents_clinical' = ANY(COALESCE(r.permissions, '{}'))
  AND NOT ('ipd_documents_clinical' = ANY(COALESCE(p.permissions, '{}')));

-- 2c. Per-user grants made through IPD -> Masters -> Users write to
--     profiles.permissions directly and never touch the role. Anyone holding
--     the plan key that way is a doctor in this clinic's setup, so keep them.
UPDATE profiles
SET permissions = array_append(permissions, 'ipd_documents_clinical')
WHERE 'ipd_treatment_plan' = ANY(COALESCE(permissions, '{}'))
  AND NOT ('ipd_documents_clinical' = ANY(COALESCE(permissions, '{}')));

-- ---------------------------------------------------------------------------
-- 3. RLS -- replace the blanket FOR ALL write policy on ipd_documents.
--
--    SELECT is untouched: every clinic user keeps read access, so nursing can
--    still open and print the OT note they must act on.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_write   ON public.ipd_documents;
DROP POLICY IF EXISTS ipd_doc_insert ON public.ipd_documents;
DROP POLICY IF EXISTS ipd_doc_update ON public.ipd_documents;
DROP POLICY IF EXISTS ipd_doc_delete ON public.ipd_documents;

CREATE POLICY ipd_doc_insert ON public.ipd_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    clinic_id IN (SELECT public.user_clinic_ids())
    AND (
      NOT public.ipd_is_clinical_doc_type(doc_type)
      OR public.user_has_permission('ipd_documents_clinical')
    )
  );

-- Only drafts may be changed (USING sees the row as it is now), and only by
-- someone entitled to that document type. The finalize step is an update on a
-- draft row, so signing still works.
CREATE POLICY ipd_doc_update ON public.ipd_documents
  FOR UPDATE TO authenticated
  USING (
    clinic_id IN (SELECT public.user_clinic_ids())
    AND status = 'draft'
    AND (
      NOT public.ipd_is_clinical_doc_type(doc_type)
      OR public.user_has_permission('ipd_documents_clinical')
    )
  )
  WITH CHECK (
    clinic_id IN (SELECT public.user_clinic_ids())
    AND (
      NOT public.ipd_is_clinical_doc_type(doc_type)
      OR public.user_has_permission('ipd_documents_clinical')
    )
  );

CREATE POLICY ipd_doc_delete ON public.ipd_documents
  FOR DELETE TO authenticated
  USING (
    clinic_id IN (SELECT public.user_clinic_ids())
    AND status = 'draft'
    AND (
      NOT public.ipd_is_clinical_doc_type(doc_type)
      OR public.user_has_permission('ipd_documents_clinical')
    )
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- Who may author clinical documents:
--   SELECT name,
--          'ipd_documents'          = ANY(permissions) AS documents_view,
--          'ipd_documents_clinical' = ANY(permissions) AS clinical_author
--   FROM roles ORDER BY name;
--
-- One user (the nursing login that triggered this):
--   SELECT p.email, p.role_name, p.permissions
--   FROM profiles p WHERE p.email = 'yankeelama017@gmail.com';
--
-- Staff must sign out and back in -- profiles.permissions is read at login.
--
-- ROLLBACK (if this ever needs undoing):
--   DROP POLICY ipd_doc_insert ON public.ipd_documents;
--   DROP POLICY ipd_doc_update ON public.ipd_documents;
--   DROP POLICY ipd_doc_delete ON public.ipd_documents;
--   CREATE POLICY tenant_write ON public.ipd_documents FOR ALL TO authenticated
--     USING (clinic_id IN (SELECT public.user_clinic_ids()))
--     WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));
