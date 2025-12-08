/*
  # Add enable_gmb_link_only column to clinic_settings

  1. Changes
    - Add `enable_gmb_link_only` boolean column to clinic_settings table
    - Set default value to true
    - Update existing records to have the default value

  2. Security
    - No changes to RLS policies needed as this inherits from existing table policies
*/

-- Add the new column with default value
ALTER TABLE clinic_settings 
ADD COLUMN IF NOT EXISTS enable_gmb_link_only boolean DEFAULT true;

-- Update any existing records to have the default value
UPDATE clinic_settings 
SET enable_gmb_link_only = true 
WHERE enable_gmb_link_only IS NULL;