-- 1. Fix Permissions (often fixes "Database error querying schema" 500 error)
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;
GRANT SELECT ON TABLE auth.users TO service_role;
-- Also grant select to postgres/dashboard user just in case
GRANT SELECT ON TABLE auth.users TO postgres;

-- 2. Diagnostic: Check if 'profiles' table exists and has expected columns
-- We are looking for 'lab_id' and 'status' because your 406 error queries them from 'users'
DO $$
DECLARE
    has_lab_id boolean;
    has_status boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'lab_id') INTO has_lab_id;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'status') INTO has_status;
    
    RAISE NOTICE 'Profiles Table Exists: %', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles');
    RAISE NOTICE 'Profiles has lab_id: %', has_lab_id;
    RAISE NOTICE 'Profiles has status: %', has_status;
END $$;

-- 3. Diagnostic: Check 'public.users' View definition
-- If this View is invalid (e.g. references missing columns), it causes 406 errors
SELECT table_name, view_definition 
FROM information_schema.views 
WHERE table_schema = 'public' AND table_name = 'users';

-- 4. Check 'debug_logs' we created earlier (just to confirm it exists)
SELECT count(*) as debug_log_count FROM public.debug_logs;
