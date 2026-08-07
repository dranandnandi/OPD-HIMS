-- ============================================================================
-- Enable the IPD (inpatient) module for ONE clinic.
--
-- Usage: replace the placeholder UUID on the v_clinic_id line below, then run
--        the whole file in the Supabase SQL editor.
--
-- The clinic id is `clinic_settings.id` (the same value stored in
-- `profiles.clinic_id`). Find it with:
--     SELECT id, clinic_name FROM public.clinic_settings ORDER BY clinic_name;
--
-- Idempotent — safe to re-run.
-- ============================================================================

DO $$
DECLARE
  -- >>>>>>>>>>>>>>>>  PUT THE CLINIC ID HERE  <<<<<<<<<<<<<<<<
  v_clinic_id uuid := '00000000-0000-0000-0000-000000000000';

  -- All IPD permission keys (mirrors IPD_PERMISSIONS in
  -- src/modules/ipd/utils/permissions.ts). Trim this list if you want to grant
  -- only part of the module.
  v_perms text[] := ARRAY[
    'ipd_census',
    'ipd_admissions',
    'ipd_clinical',
    'ipd_charges',
    'ipd_billing',
    'ipd_collections',
    'ipd_documents',
    'ipd_stores',
    'ipd_masters'
  ];

  v_clinic_name text;
  v_seed_result text;
  v_granted int;
BEGIN
  -- 1. Verify the clinic exists (fail loudly rather than silently doing nothing)
  SELECT clinic_name INTO v_clinic_name
  FROM public.clinic_settings
  WHERE id = v_clinic_id;

  IF v_clinic_name IS NULL THEN
    RAISE EXCEPTION 'No clinic_settings row with id %. Check the UUID.', v_clinic_id;
  END IF;

  RAISE NOTICE 'Enabling IPD for clinic: % (%)', v_clinic_name, v_clinic_id;

  -- 2. Flip the platform gate. This is what user.clinic.ipdEnabled reads.
  UPDATE public.clinic_settings
  SET ipd_enabled = true
  WHERE id = v_clinic_id;

  RAISE NOTICE '  [1/3] clinic_settings.ipd_enabled = true';

  -- 3. Seed the IPD master data (charge groups, services, wards, payers...).
  --    Without this the module loads but every master dropdown is empty.
  --    Idempotent: ON CONFLICT DO NOTHING on the coded uniques.
  SELECT public.seed_ipd_masters(v_clinic_id) INTO v_seed_result;
  RAISE NOTICE '  [2/3] seed_ipd_masters: %', v_seed_result;

  -- 4. Grant the ipd_* permissions to this clinic's admin users.
  --    The clinic flag alone is not enough — routes are ALSO gated per user by
  --    hasPermission('ipd_*'). Roles named admin/super_admin, and anyone
  --    holding 'admin' or 'all', already bypass the permission check, but we
  --    grant explicitly so the nav items render for them too.
  UPDATE public.profiles p
  SET permissions = ARRAY(
        SELECT DISTINCT unnest(COALESCE(p.permissions, '{}'::text[]) || v_perms)
      )
  WHERE p.clinic_id = v_clinic_id
    AND (
      lower(p.role_name) IN ('admin', 'super_admin')
      OR p.permissions && ARRAY['admin', 'all']
    );

  GET DIAGNOSTICS v_granted = ROW_COUNT;
  RAISE NOTICE '  [3/3] ipd_* permissions granted to % admin profile(s)', v_granted;
  RAISE NOTICE 'Done. Affected users must sign out and back in.';
END $$;


-- ============================================================================
-- OPTIONAL: grant IPD access to specific non-admin staff.
-- Edit the email list and the permission array, then run.
-- ============================================================================
-- UPDATE public.profiles p
-- SET permissions = ARRAY(
--       SELECT DISTINCT unnest(
--         COALESCE(p.permissions, '{}'::text[])
--         || ARRAY['ipd_census', 'ipd_admissions', 'ipd_clinical']  -- <-- pick keys
--       )
--     )
-- WHERE p.clinic_id = '00000000-0000-0000-0000-000000000000'        -- <-- clinic id
--   AND p.email IN ('nurse1@example.com', 'billing@example.com');   -- <-- users


-- ============================================================================
-- VERIFY
-- ============================================================================
-- SELECT id, clinic_name, ipd_enabled
-- FROM public.clinic_settings
-- WHERE id = '00000000-0000-0000-0000-000000000000';
--
-- SELECT name, email, role_name,
--        ARRAY(SELECT unnest(permissions) INTERSECT SELECT unnest(ARRAY[
--          'ipd_census','ipd_admissions','ipd_clinical','ipd_charges','ipd_billing',
--          'ipd_collections','ipd_documents','ipd_stores','ipd_masters'])) AS ipd_perms
-- FROM public.profiles
-- WHERE clinic_id = '00000000-0000-0000-0000-000000000000'
-- ORDER BY role_name, name;


-- ============================================================================
-- DISABLE (rollback the gate; masters and permissions are left in place)
-- ============================================================================
-- UPDATE public.clinic_settings
-- SET ipd_enabled = false
-- WHERE id = '00000000-0000-0000-0000-000000000000';
