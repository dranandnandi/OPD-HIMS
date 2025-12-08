/*
  # Add referred_by column to patients table

  1. Schema Changes
    - Add `referred_by` column to `patients` table
    - Column is nullable text type to store referral source information

  2. Notes
    - This allows tracking how patients were referred to the clinic
    - Field is optional and can be left empty
*/

ALTER TABLE public.patients
ADD COLUMN referred_by text;