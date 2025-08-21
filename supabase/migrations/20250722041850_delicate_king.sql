/*
  # Add payment_method column to bills table

  1. Changes
    - Add `payment_method` column to `bills` table
    - Column type: text (nullable)
    - Allows storing payment method information for bills

  2. Security
    - No changes to RLS policies needed
    - Column inherits existing table permissions
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bills' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE bills ADD COLUMN payment_method text;
  END IF;
END $$;