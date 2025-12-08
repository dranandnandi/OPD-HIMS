/*
  # Add Doctor-Specific Consultation Fees

  1. Schema Changes
    - Add consultation fee columns to profiles table
    - Add constraints to ensure fees are non-negative
    - Add indexes for performance

  2. Security
    - Existing RLS policies will apply to new columns
    - Doctors can update their own fees
    - Admins can manage all doctor fees
*/

-- Add consultation fee columns to profiles table
ALTER TABLE profiles 
ADD COLUMN consultation_fee numeric CHECK (consultation_fee >= 0),
ADD COLUMN follow_up_fee numeric CHECK (follow_up_fee >= 0),
ADD COLUMN emergency_fee numeric CHECK (emergency_fee >= 0);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_consultation_fee ON profiles (consultation_fee);
CREATE INDEX IF NOT EXISTS idx_profiles_follow_up_fee ON profiles (follow_up_fee);
CREATE INDEX IF NOT EXISTS idx_profiles_emergency_fee ON profiles (emergency_fee);

-- Add comments for documentation
COMMENT ON COLUMN profiles.consultation_fee IS 'Doctor-specific consultation fee. If null, clinic default is used.';
COMMENT ON COLUMN profiles.follow_up_fee IS 'Doctor-specific follow-up fee. If null, clinic default is used.';
COMMENT ON COLUMN profiles.emergency_fee IS 'Doctor-specific emergency consultation fee. If null, clinic default is used.';