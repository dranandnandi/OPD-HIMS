-- Introduce a `reception` permission so front-desk access is permission-driven
-- rather than keyed off the literal role name "receptionist".
--
-- Motivation: a user can hold exactly one role (profiles.role_id is a single
-- FK). Staff who do two jobs — e.g. nurse + front desk — therefore need one
-- combined role carrying the union of both permission sets. With the app
-- checking `reception` instead of `roleName === 'receptionist'`, such a role
-- works as data, with no code change per combination.

-- 1. Grant the permission to existing reception roles.
UPDATE roles
SET permissions = array_append(COALESCE(permissions, '{}'), 'reception')
WHERE lower(name) IN ('receptionist', 'reception')
  AND NOT ('reception' = ANY(COALESCE(permissions, '{}')));

-- 2. Backfill the denormalized copy on profiles. profiles.permissions is only
--    re-synced by trigger when role_id changes, so existing staff need this.
UPDATE profiles p
SET permissions = array_append(COALESCE(p.permissions, '{}'), 'reception')
FROM roles r
WHERE p.role_id = r.id
  AND lower(r.name) IN ('receptionist', 'reception')
  AND NOT ('reception' = ANY(COALESCE(p.permissions, '{}')));

-- Profiles that carry the role name but lost the role_id link.
UPDATE profiles
SET permissions = array_append(COALESCE(permissions, '{}'), 'reception')
WHERE lower(COALESCE(role_name, '')) IN ('receptionist', 'reception')
  AND NOT ('reception' = ANY(COALESCE(permissions, '{}')));

-- 3. Keep profiles in step when a role's permissions are edited.
--    Previously only a role_id change re-synced profiles, so editing a role
--    (the whole point of combined roles) left existing holders on stale
--    permissions until they were reassigned.
CREATE OR REPLACE FUNCTION sync_profiles_on_role_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.permissions IS DISTINCT FROM OLD.permissions
     OR NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE profiles
    SET role_name = NEW.name,
        permissions = COALESCE(NEW.permissions, '{}')
    WHERE role_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_profiles_on_role_update ON roles;
CREATE TRIGGER trigger_sync_profiles_on_role_update
  AFTER UPDATE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION sync_profiles_on_role_update();

-- ---------------------------------------------------------------------------
-- Creating a combined role (template — run per clinic as needed).
--
-- A profile holds exactly one role_id, so staff doing two jobs get one role
-- carrying the union of both permission sets. Because the app now gates on
-- `reception` (not the role name), a role like this gets full front-desk access:
--
--   INSERT INTO roles (name, description, permissions)
--   VALUES (
--     'nurse_reception',
--     'Nursing duties + front desk',
--     (SELECT ARRAY(
--        SELECT DISTINCT unnest(permissions) FROM roles
--        WHERE lower(name) IN ('nurse', 'receptionist')
--      ))
--   )
--   ON CONFLICT (name) DO NOTHING;
--
-- Then assign it in Settings -> User Management. Note that 'doctor' still
-- drives behaviour by role name (consultation fees, doctor pickers), so it
-- should stay a standalone role rather than being folded into a combination.
-- ---------------------------------------------------------------------------
