-- 1. Find triggers on auth.users
SELECT 
    trigger_name,
    event_manipulation,
    event_object_schema,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth' AND event_object_table = 'users';

-- 2. Find triggers on public.profiles
SELECT 
    trigger_name,
    event_manipulation,
    event_object_schema,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public' AND event_object_table = 'profiles';

-- 3. If you see a function name in the output above (e.g. 'handle_new_user' or 'sync_whatsapp_user'), 
--    run this to see its code:
--    SELECT pg_get_functiondef('public.function_name'::regproc);
