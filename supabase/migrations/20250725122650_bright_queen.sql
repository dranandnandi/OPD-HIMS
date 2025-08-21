/*
  # Add doctor availability and consultation flag to profiles

  1. New Columns
    - `doctor_availability` (jsonb) - Doctor-specific working hours and availability
    - `is_open_for_consultation` (boolean) - Flag to indicate if user is available for consultations
  
  2. Changes
    - Add doctor_availability column to store individual doctor schedules
    - Add is_open_for_consultation flag with default false
    - Update existing doctor profiles to have is_open_for_consultation = true
*/

-- Add doctor availability column to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'doctor_availability'
  ) THEN
    ALTER TABLE profiles ADD COLUMN doctor_availability jsonb;
  END IF;
END $$;

-- Add is_open_for_consultation column to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_open_for_consultation'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_open_for_consultation boolean DEFAULT false;
  END IF;
END $$;

-- Update existing doctor profiles to be open for consultation by default
UPDATE profiles 
SET is_open_for_consultation = true 
WHERE role_name = 'doctor' AND is_active = true;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_profiles_open_for_consultation 
ON profiles (is_open_for_consultation) 
WHERE is_open_for_consultation = true;