/*
  # Fix RLS policies for clinic_test_prices table

  1. Security Updates
    - Drop existing restrictive policies
    - Create permissive policies for authenticated users
    - Allow users to manage their own clinic's test prices

  2. Changes
    - Enables INSERT, UPDATE, DELETE for authenticated users on their clinic's data
*/

-- Drop existing policies that may conflict
DROP POLICY IF EXISTS "Allow authenticated users to insert clinic_test_prices" ON clinic_test_prices;
DROP POLICY IF EXISTS "Allow authenticated users to update clinic_test_prices" ON clinic_test_prices;
DROP POLICY IF EXISTS "Admins can manage test prices" ON clinic_test_prices;
DROP POLICY IF EXISTS "Users can read their clinic's test prices" ON clinic_test_prices;

-- Create comprehensive policies for clinic_test_prices

-- SELECT: Users can read their clinic's test prices
CREATE POLICY "clinic_test_prices_select"
  ON clinic_test_prices
  FOR SELECT
  TO authenticated
  USING (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

-- INSERT: Users can insert test prices for their clinic
CREATE POLICY "clinic_test_prices_insert"
  ON clinic_test_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

-- UPDATE: Users can update their clinic's test prices
CREATE POLICY "clinic_test_prices_update"
  ON clinic_test_prices
  FOR UPDATE
  TO authenticated
  USING (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

-- DELETE: Users can delete their clinic's test prices
CREATE POLICY "clinic_test_prices_delete"
  ON clinic_test_prices
  FOR DELETE
  TO authenticated
  USING (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Also fix clinic_medicine_prices to be consistent
DROP POLICY IF EXISTS "Allow authenticated users to insert clinic_medicine_prices" ON clinic_medicine_prices;
DROP POLICY IF EXISTS "Allow authenticated users to update clinic_medicine_prices" ON clinic_medicine_prices;
DROP POLICY IF EXISTS "Admins can manage medicine prices" ON clinic_medicine_prices;
DROP POLICY IF EXISTS "Users can read their clinic's medicine prices" ON clinic_medicine_prices;

-- SELECT: Users can read their clinic's medicine prices
CREATE POLICY "clinic_medicine_prices_select"
  ON clinic_medicine_prices
  FOR SELECT
  TO authenticated
  USING (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

-- INSERT: Users can insert medicine prices for their clinic
CREATE POLICY "clinic_medicine_prices_insert"
  ON clinic_medicine_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

-- UPDATE: Users can update their clinic's medicine prices
CREATE POLICY "clinic_medicine_prices_update"
  ON clinic_medicine_prices
  FOR UPDATE
  TO authenticated
  USING (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

-- DELETE: Users can delete their clinic's medicine prices
CREATE POLICY "clinic_medicine_prices_delete"
  ON clinic_medicine_prices
  FOR DELETE
  TO authenticated
  USING (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );
