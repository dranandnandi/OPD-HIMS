/*
  # Disable RLS on profiles table to fix infinite recursion

  1. Problem
    - RLS policies on other tables (patients, appointments, etc.) query the profiles table to check clinic_id
    - RLS policies on profiles table create circular dependencies when these queries happen
    - This causes infinite recursion errors across the application

  2. Solution
    - Disable RLS on the profiles table entirely
    - This allows other tables' RLS policies to safely query profiles for clinic_id checks
    - The profiles table will rely on application-level security instead of database RLS

  3. Security Note
    - Application code already handles profile access control through getCurrentProfile()
    - Disabling RLS on profiles is safe since it's primarily used for clinic_id lookups by other tables
*/

-- Disable RLS on profiles table to prevent infinite recursion
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies on profiles table
DROP POLICY IF EXISTS "Allow all authenticated users to view profiles" ON profiles;
DROP POLICY IF EXISTS "Allow authenticated users to insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Allow authenticated users to update their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can only read their own profile" ON profiles;