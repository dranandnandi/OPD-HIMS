/*
  # Remove unique constraint on patients phone number

  1. Changes
    - Remove unique constraint on `patients.phone` column
    - Allow multiple patients to have the same phone number
    - Drop the unique index `patients_phone_key`

  2. Rationale
    - Multiple family members may share the same phone number
    - Emergency contacts may use the same number for different patients
    - Business requirement to allow duplicate phone numbers
*/

-- Remove the unique constraint on phone column
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_phone_key;

-- Remove the unique index on phone column (if it exists separately)
DROP INDEX IF EXISTS patients_phone_key;