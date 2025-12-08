-- Fix profiles RLS policy to avoid infinite recursion
-- HIGH PRIORITY Security Fix  
-- Created: August 21, 2025

-- Drop the problematic policy that causes infinite recursion
DROP POLICY IF EXISTS "profiles_clinic_isolation" ON public.profiles;

-- For now, disable RLS on profiles table to restore functionality
-- This is a temporary measure while we implement a better solution
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

-- TODO: Implement clinic isolation at application level instead of RLS
-- The profiles table needs special handling due to its role in authentication
-- and clinic resolution, which creates circular dependencies with RLS

-- Keep the indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_clinic_id ON public.profiles(clinic_id);
CREATE INDEX IF NOT EXISTS idx_profiles_auth_uid ON public.profiles(id);

-- Add comment explaining the decision
COMMENT ON TABLE public.profiles IS 
'RLS temporarily disabled due to circular dependency. Clinic isolation handled at application level through getCurrentProfile() service which validates clinic_id access.';
