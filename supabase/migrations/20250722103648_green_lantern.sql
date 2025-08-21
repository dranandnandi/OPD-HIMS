/*
  # Create Clinic-Specific Pricing Tables

  1. New Tables
    - `clinic_medicine_prices`
      - `id` (uuid, primary key)
      - `clinic_id` (uuid, foreign key to clinic_settings)
      - `medicine_id` (uuid, foreign key to medicines_master)
      - `selling_price` (numeric, not null)
      - `cost_price` (numeric, not null)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    - `clinic_test_prices`
      - `id` (uuid, primary key)
      - `clinic_id` (uuid, foreign key to clinic_settings)
      - `test_id` (uuid, foreign key to tests_master)
      - `price` (numeric, not null)
      - `cost` (numeric, not null)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users to read their clinic's data
    - Add policies for admins to manage pricing data

  3. Constraints
    - Unique constraint on (clinic_id, medicine_id) for clinic_medicine_prices
    - Unique constraint on (clinic_id, test_id) for clinic_test_prices
*/

-- Create clinic_medicine_prices table
CREATE TABLE IF NOT EXISTS clinic_medicine_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL REFERENCES medicines_master(id) ON DELETE CASCADE,
  selling_price numeric NOT NULL CHECK (selling_price >= 0),
  cost_price numeric NOT NULL CHECK (cost_price >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(clinic_id, medicine_id)
);

-- Create clinic_test_prices table
CREATE TABLE IF NOT EXISTS clinic_test_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES tests_master(id) ON DELETE CASCADE,
  price numeric NOT NULL CHECK (price >= 0),
  cost numeric NOT NULL CHECK (cost >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(clinic_id, test_id)
);

-- Enable RLS
ALTER TABLE clinic_medicine_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_test_prices ENABLE ROW LEVEL SECURITY;

-- Create policies for clinic_medicine_prices
CREATE POLICY "Users can read their clinic's medicine prices"
  ON clinic_medicine_prices
  FOR SELECT
  TO authenticated
  USING (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage medicine prices"
  ON clinic_medicine_prices
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role_id = (
        SELECT id FROM roles WHERE name = 'admin'
      )
    )
  );

-- Create policies for clinic_test_prices
CREATE POLICY "Users can read their clinic's test prices"
  ON clinic_test_prices
  FOR SELECT
  TO authenticated
  USING (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage test prices"
  ON clinic_test_prices
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role_id = (
        SELECT id FROM roles WHERE name = 'admin'
      )
    )
  );

-- Create indexes for better performance
CREATE INDEX idx_clinic_medicine_prices_clinic_id ON clinic_medicine_prices(clinic_id);
CREATE INDEX idx_clinic_medicine_prices_medicine_id ON clinic_medicine_prices(medicine_id);
CREATE INDEX idx_clinic_test_prices_clinic_id ON clinic_test_prices(clinic_id);
CREATE INDEX idx_clinic_test_prices_test_id ON clinic_test_prices(test_id);

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clinic_medicine_prices_updated_at
    BEFORE UPDATE ON clinic_medicine_prices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clinic_test_prices_updated_at
    BEFORE UPDATE ON clinic_test_prices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();