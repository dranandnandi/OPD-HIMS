-- Helper function to delete a user by email
-- Can be called from Supabase Dashboard SQL Editor:
-- SELECT public.delete_user_by_email('email@example.com');

CREATE OR REPLACE FUNCTION public.delete_user_by_email(email_to_delete text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of the creator (postgres/admin)
AS $$
DECLARE
    deleted_uid UUID;
BEGIN
    -- 1. Get the User ID
    SELECT id INTO deleted_uid FROM auth.users WHERE email = email_to_delete;

    IF deleted_uid IS NULL THEN
        RETURN 'User not found: ' || email_to_delete;
    END IF;

    -- 2. Delete the user (Cascades to public.profiles etc if Foreign Keys are set)
    DELETE FROM auth.users WHERE id = deleted_uid;

    RETURN 'Successfully deleted user: ' || email_to_delete || ' (ID: ' || deleted_uid || ')';

EXCEPTION WHEN OTHERS THEN
    RETURN 'Error deleting user: ' || SQLERRM;
END;
$$;

-- Grant execute permission to Service Role and Postgres (Dashboard)
GRANT EXECUTE ON FUNCTION public.delete_user_by_email(text) TO service_role, postgres, dashboard_user;

-- Optional: Grant to authenticated if you want to allow a specific admin user to call it via RPC
-- GRANT EXECUTE ON FUNCTION public.delete_user_by_email(text) TO authenticated;
