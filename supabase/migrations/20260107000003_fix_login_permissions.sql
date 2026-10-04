-- FIX 1: Grant permissions to prevent "Database error querying schema"
-- This gives the internal Auth service the access it needs.
GRANT USAGE ON SCHEMA auth TO postgres, service_role, anon, authenticated, dashboard_user;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO postgres, service_role, dashboard_user;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres, service_role, dashboard_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO postgres, service_role, dashboard_user;
GRANT ALL ON ALL ROUTINES IN SCHEMA auth TO postgres, service_role, dashboard_user;

-- FIX 2: Check and Fix 'public.users' if it causes the 406 error
-- If you access /rest/v1/users, you must have a table or view named 'users' in public schema.
-- This creates a view if it is missing, mapping auth.users to public.users
CREATE OR REPLACE VIEW public.users AS
SELECT 
    id,
    email,
    raw_user_meta_data->>'full_name' as name,
    raw_user_meta_data->>'lab_id' as lab_id,
    'Active' as status -- Default status since column might be missing
FROM auth.users;

-- FIX 3: Ensure public permissions
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT SELECT ON public.users TO postgres, anon, authenticated, service_role;

-- DIAGNOSTIC: Check specifically for the problem user
DO $$
DECLARE
    auth_count int;
    profile_count int;
BEGIN
    SELECT count(*) INTO auth_count FROM auth.users WHERE email ILIKE 'Rahulc.ortho@gmail.com';
    SELECT count(*) INTO profile_count FROM public.profiles WHERE email ILIKE 'Rahulc.ortho@gmail.com';
    
    RAISE NOTICE 'Diagnostics for Rahulc.ortho@gmail.com:';
    RAISE NOTICE 'Found in auth.users: %', auth_count;
    RAISE NOTICE 'Found in public.profiles: %', profile_count;
END $$;
