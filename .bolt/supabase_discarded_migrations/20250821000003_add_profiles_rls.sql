-- Add RLS policy to profiles table for clinic isolation
-- HIGH PRIORITY Security Enhancement
-- Created: August 21, 2025

-- Enable Row Level Security on profiles table if not already enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create clinic isolation policy for profiles table
-- Users can only see profiles from their own clinic + their own profile
CREATE POLICY "profiles_clinic_isolation" ON public.profiles
  FOR ALL USING (
    -- Allow users to see profiles from their own clinic
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
    OR
    -- Allow users to see their own profile (even if clinic_id changes)
    id = auth.uid()
  );

-- Create performance indexes to support RLS filtering
CREATE INDEX IF NOT EXISTS idx_profiles_clinic_id ON public.profiles(clinic_id);
CREATE INDEX IF NOT EXISTS idx_profiles_auth_uid ON public.profiles(id);

-- Grant necessary permissions
GRANT ALL ON public.profiles TO authenticated;

-- Add comment for documentation
COMMENT ON POLICY "profiles_clinic_isolation" ON public.profiles IS 
'Ensures clinic-level data isolation: users can only see profiles from their own clinic plus their own profile. This maintains staff visibility within clinics while preventing cross-clinic data access.';
