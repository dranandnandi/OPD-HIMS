/*
  # Seed the pharmacist role

  20260818200000_role_module_permissions.sql grants module permissions with
  `UPDATE roles ... WHERE lower(name) IN ('pharmacist', 'pharmacy')`, which is a
  no-op when no such row exists. No migration has ever INSERTed a role row, and
  User Management can only edit an existing role's module matrix — it has no
  "create role" screen. So a clinic that never hand-inserted one has no pharmacy
  user type to assign at all, and the Pharmacy tabs are unreachable for staff.

  This creates it idempotently with the permission set migration ...200000
  intended: pharmacy stock plus the patient/visit screens needed to read a
  prescription, and IPD stores.
*/

INSERT INTO public.roles (name, description, permissions)
SELECT
  'pharmacist',
  'Pharmacy inventory, dispensing and ward stores',
  ARRAY[
    'modules_assigned',
    'opd_patients','opd_visits','pharmacy',
    'ipd_stores'
  ]
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles WHERE lower(name) IN ('pharmacist', 'pharmacy')
);

-- If the row already existed but predates the module-permission rollout, make
-- sure it carries the same set rather than leaving it half-granted.
UPDATE public.roles
SET permissions = ARRAY(SELECT DISTINCT unnest(
  COALESCE(permissions, '{}') || ARRAY[
    'modules_assigned',
    'opd_patients','opd_visits','pharmacy',
    'ipd_stores'
  ]))
WHERE lower(name) IN ('pharmacist', 'pharmacy');
