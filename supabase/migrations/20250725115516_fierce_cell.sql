/*
  # Fix RLS policies for master data tables

  1. Security Updates
    - Add INSERT and UPDATE policies for tests_master table
    - Add INSERT and UPDATE policies for medicines_master table
    - Add INSERT and UPDATE policies for clinic_medicine_prices table
    - Add INSERT and UPDATE policies for clinic_test_prices table
    - Allow authenticated users to manage master data and pricing

  2. Changes
    - Enable proper permissions for authenticated users to add/update master data
    - Maintain existing SELECT policies
    - Ensure clinic-specific pricing can be managed by authenticated users
*/

-- Add INSERT and UPDATE policies for tests_master
CREATE POLICY "Allow authenticated users to insert tests_master"
  ON tests_master
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update tests_master"
  ON tests_master
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Add INSERT and UPDATE policies for medicines_master
CREATE POLICY "Allow authenticated users to insert medicines_master"
  ON medicines_master
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update medicines_master"
  ON medicines_master
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Add INSERT and UPDATE policies for clinic_medicine_prices
CREATE POLICY "Allow authenticated users to insert clinic_medicine_prices"
  ON clinic_medicine_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update clinic_medicine_prices"
  ON clinic_medicine_prices
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Add INSERT and UPDATE policies for clinic_test_prices
CREATE POLICY "Allow authenticated users to insert clinic_test_prices"
  ON clinic_test_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update clinic_test_prices"
  ON clinic_test_prices
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);