/*
  # Add notes column to bills table

  1. Changes
    - Add `notes` column to `bills` table as TEXT type (nullable)
    - This column will store additional notes or comments for bills

  2. Notes
    - The column is nullable to maintain compatibility with existing records
    - Uses IF NOT EXISTS pattern to prevent errors if column already exists
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bills' AND column_name = 'notes'
  ) THEN
    ALTER TABLE bills ADD COLUMN notes TEXT;
  END IF;
END $$;