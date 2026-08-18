-- Role-wise module (tab) access.
--
-- Until now the OPD sidebar was open to every signed-in user: only clinic tier
-- and a few admin-only configuration routes were gated, so a nurse saw the same
-- tabs as a receptionist — including OPD Billing. IPD used the opposite model
-- (hide the tab unless the user holds an ipd_* permission), which is why
-- reception and nursing staff saw no IPD section at all.
--
-- This migration unifies both on the IPD model by seeding module keys onto the
-- standard roles. Keys mirror src/utils/modulePermissions.ts — keep in step.
--
-- SAFETY: the app treats a role holding none of the opd_* keys as "legacy" and
-- keeps showing it every OPD tab, so nothing goes dark if this migration has not
-- run yet. `modules_assigned` marks a role as deliberately configured, which
-- switches that role to strict access. Because we seed and mark in one step,
-- roles touched here move to strict access immediately.

-- ---------------------------------------------------------------------------
-- 1. Admin / super_admin — full access.
--    They already bypass every gate in code; granting explicitly keeps the
--    User Management matrix honest.
-- ---------------------------------------------------------------------------
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(
  COALESCE(permissions, '{}') || ARRAY[
    'modules_assigned',
    'opd_appointments','opd_patients','opd_visits','opd_followups',
    'opd_billing','opd_collections','pharmacy','gmb_reviews','chatbots','analytics',
    'ipd_census','ipd_admissions','ipd_clinical','ipd_charges','ipd_billing',
    'ipd_collections','ipd_documents','ipd_stores','ipd_masters'
  ]))
WHERE lower(name) IN ('admin', 'super_admin');

-- ---------------------------------------------------------------------------
-- 2. Receptionist — front desk, billing, admissions & discharges.
--    Gets IPD admissions/billing (they admit patients and take deposits) but
--    NOT doctor share, stores or clinical charting.
--    Note: ipd_billing also unlocks Discharges, TPA and Doctor Share, which
--    share that key. Drop 'ipd_billing' here if front desk must not see the
--    doctor revenue split.
-- ---------------------------------------------------------------------------
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(
  COALESCE(permissions, '{}') || ARRAY[
    'modules_assigned',
    'opd_appointments','opd_patients','opd_visits','opd_followups',
    'opd_billing','opd_collections','gmb_reviews',
    'ipd_census','ipd_admissions','ipd_documents'
  ]))
WHERE lower(name) IN ('receptionist', 'reception');

-- ---------------------------------------------------------------------------
-- 3. Nurse — clinical work only. Deliberately NO billing, collections,
--    pharmacy or analytics: this is the case you flagged.
-- ---------------------------------------------------------------------------
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(
  COALESCE(permissions, '{}') || ARRAY[
    'modules_assigned',
    'opd_appointments','opd_patients','opd_visits',
    'ipd_census','ipd_admissions','ipd_clinical','ipd_documents'
  ]))
WHERE lower(name) IN ('nurse', 'nursing', 'staff_nurse');

-- ---------------------------------------------------------------------------
-- 4. Doctor — clinical + their own analytics. No pharmacy stock, no
--    reconciliation. 'doctor' still drives behaviour by role name elsewhere
--    (consultation fees, doctor pickers), so keep it a standalone role.
-- ---------------------------------------------------------------------------
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(
  COALESCE(permissions, '{}') || ARRAY[
    'modules_assigned',
    'opd_appointments','opd_patients','opd_visits','opd_followups','analytics',
    'ipd_census','ipd_admissions','ipd_clinical','ipd_charges','ipd_documents'
  ]))
WHERE lower(name) IN ('doctor', 'consultant');

-- ---------------------------------------------------------------------------
-- 5. Pharmacist — pharmacy only, plus visits (to read prescriptions).
-- ---------------------------------------------------------------------------
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(
  COALESCE(permissions, '{}') || ARRAY[
    'modules_assigned',
    'opd_patients','opd_visits','pharmacy',
    'ipd_stores'
  ]))
WHERE lower(name) IN ('pharmacist', 'pharmacy');

-- ---------------------------------------------------------------------------
-- 6. Billing / accounts — money screens, no clinical charting.
-- ---------------------------------------------------------------------------
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(
  COALESCE(permissions, '{}') || ARRAY[
    'modules_assigned',
    'opd_patients','opd_visits','opd_billing','opd_collections','analytics',
    'ipd_census','ipd_billing','ipd_charges','ipd_collections'
  ]))
WHERE lower(name) IN ('billing', 'accountant', 'accounts', 'cashier');

-- ---------------------------------------------------------------------------
-- 7. Fan the new arrays out to existing staff.
--    profiles.permissions is a denormalized copy. The
--    sync_profiles_on_role_update trigger (20260818100000_reception_permission)
--    handles this for future edits, but it fires per-statement on UPDATE and we
--    want existing rows correct regardless of trigger presence/order.
-- ---------------------------------------------------------------------------
UPDATE profiles p
SET permissions = COALESCE(r.permissions, '{}')
FROM roles r
WHERE p.role_id = r.id
  AND 'modules_assigned' = ANY(COALESCE(r.permissions, '{}'))
  AND p.permissions IS DISTINCT FROM COALESCE(r.permissions, '{}');

-- ---------------------------------------------------------------------------
-- VERIFY — which modules each role now carries
-- ---------------------------------------------------------------------------
-- SELECT name,
--        ARRAY(SELECT unnest(permissions)
--              INTERSECT
--              SELECT unnest(ARRAY[
--                'opd_appointments','opd_patients','opd_visits','opd_followups',
--                'opd_billing','opd_collections','pharmacy','gmb_reviews',
--                'chatbots','analytics','ipd_census','ipd_admissions',
--                'ipd_clinical','ipd_charges','ipd_billing','ipd_collections',
--                'ipd_documents','ipd_stores','ipd_masters'])
--              ORDER BY 1) AS modules
-- FROM roles ORDER BY name;
--
-- Staff must sign out and back in — profiles.permissions is read at login.
