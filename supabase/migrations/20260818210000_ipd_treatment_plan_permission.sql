-- Split the IPD Treatment Plan tab off `ipd_clinical` onto its own key.
--
-- The admission chart gated Plan, Orders, Nursing and Meds all on 'ipd_clinical'
-- (src/modules/ipd/pages/AdmissionDetailsPage.tsx). Nursing staff need Nursing
-- and Meds, so granting ipd_clinical also handed them the plan of care, which
-- belongs to the treating doctor. The app now reads 'ipd_treatment_plan' for
-- that tab; this migration decides who keeps it.
--
-- Standalone (not folded into 20260818200000) so it applies whether or not the
-- module-permissions migration has already run.

-- ---------------------------------------------------------------------------
-- 1. Preserve access for everyone who legitimately has it today.
--
--    Any role currently holding ipd_clinical keeps the plan tab UNLESS it is a
--    nursing role. Matching on shape rather than an exact name list so custom
--    clinical roles (RMO, Medical Officer, Registrar, "Duty Doctor") do not
--    silently lose the tab on deploy — only nursing loses it, which is the
--    entire point of the split.
-- ---------------------------------------------------------------------------
UPDATE roles
SET permissions = array_append(permissions, 'ipd_treatment_plan')
WHERE 'ipd_clinical' = ANY(COALESCE(permissions, '{}'))
  AND NOT ('ipd_treatment_plan' = ANY(COALESCE(permissions, '{}')))
  AND lower(name) !~ '(nurse|nursing|gnm|anm|sister|ward.?boy|attendant)';

-- ---------------------------------------------------------------------------
-- 2. Doctors and admins get it outright, even if they never held ipd_clinical.
-- ---------------------------------------------------------------------------
UPDATE roles
SET permissions = array_append(permissions, 'ipd_treatment_plan')
WHERE lower(name) ~ '(doctor|consultant|physician|surgeon|rmo|registrar|medical.?officer)'
  AND NOT ('ipd_treatment_plan' = ANY(COALESCE(permissions, '{}')));

UPDATE roles
SET permissions = array_append(permissions, 'ipd_treatment_plan')
WHERE lower(name) IN ('admin', 'super_admin')
  AND NOT ('ipd_treatment_plan' = ANY(COALESCE(permissions, '{}')));

-- ---------------------------------------------------------------------------
-- 3. Fan out to the denormalized copy on profiles.
--    Only for roles that actually changed above, so this does not clobber
--    per-user IPD grants made through Settings -> IPD Masters -> Users, which
--    write to profiles.permissions directly rather than to the role.
-- ---------------------------------------------------------------------------
UPDATE profiles p
SET permissions = array_append(p.permissions, 'ipd_treatment_plan')
FROM roles r
WHERE p.role_id = r.id
  AND 'ipd_treatment_plan' = ANY(COALESCE(r.permissions, '{}'))
  AND NOT ('ipd_treatment_plan' = ANY(COALESCE(p.permissions, '{}')));

-- ---------------------------------------------------------------------------
-- VERIFY — who can open the Treatment Plan tab
-- ---------------------------------------------------------------------------
-- SELECT name,
--        'ipd_clinical'       = ANY(permissions) AS nursing_and_meds,
--        'ipd_treatment_plan' = ANY(permissions) AS treatment_plan
-- FROM roles ORDER BY name;
--
-- Staff must sign out and back in — profiles.permissions is read at login.
