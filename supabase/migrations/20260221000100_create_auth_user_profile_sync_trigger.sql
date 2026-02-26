-- Ensure every new auth user gets/updates a profile row with auth_id populated.
-- This guarantees downstream integrations (including WhatsApp sync) can map by auth identity.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
  v_view_email text;
  v_name text;
BEGIN
  -- Prefer auth.users email; optionally fallback to auth_users_view if present.
  v_email := NEW.email;

  IF v_email IS NULL AND to_regclass('public.auth_users_view') IS NOT NULL THEN
    EXECUTE 'SELECT email FROM public.auth_users_view WHERE id = $1 LIMIT 1'
      INTO v_view_email
      USING NEW.id;
    v_email := v_view_email;
  END IF;

  -- profiles.email is NOT NULL + UNIQUE; keep trigger resilient even for non-email auth providers.
  IF v_email IS NULL OR btrim(v_email) = '' THEN
    v_email := 'user_' || NEW.id::text || '@no-email.local';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.email = v_email
      AND p.id <> NEW.id
  ) THEN
    v_email := 'user_' || NEW.id::text || '@dedup.local';
  END IF;

  v_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    split_part(v_email, '@', 1),
    'User'
  );

  INSERT INTO public.profiles (
    id,
    auth_id,
    email,
    name,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.id,
    v_email,
    v_name,
    now(),
    now()
  )
  ON CONFLICT (id)
  DO UPDATE SET
    auth_id = EXCLUDED.auth_id,
    email = EXCLUDED.email,
    name = COALESCE(public.profiles.name, EXCLUDED.name),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile_sync ON auth.users;

CREATE TRIGGER on_auth_user_created_profile_sync
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user_profile_sync();
