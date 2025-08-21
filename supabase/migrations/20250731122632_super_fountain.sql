/*
  # Create Helper Function for Clinic ID

  1. Helper Function
    - `get_current_user_clinic_id()` - Returns the clinic_id for the current authenticated user
    - Marked as STABLE for performance and safety in RLS policies
    - Prevents recursion issues in RLS policies

  2. Security
    - Function safely retrieves clinic_id from profiles table
    - Used by RLS policies to enforce clinic-level data isolation
*/

CREATE OR REPLACE FUNCTION public.get_current_user_clinic_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid()
$$;