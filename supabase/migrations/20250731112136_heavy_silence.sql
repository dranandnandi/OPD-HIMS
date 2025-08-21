/*
  # Add clinic_id to core tables for proper multi-clinic support

  1. Schema Changes
    - Add clinic_id column to appointments, visits, bills, and related tables
    - Update foreign key constraints
    - Migrate existing data to use clinic_id from doctor profiles

  2. Security
    - Enable RLS on all tables
    - Add clinic-based policies
    - Ensure users can only see data from their clinic

  3. Data Migration
    - Populate clinic_id for existing records
    - Update all related tables
*/

-- Add clinic_id to appointments table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'appointments' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE appointments ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Add clinic_id to visits table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'visits' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE visits ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Add clinic_id to bills table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bills' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE bills ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Add clinic_id to symptoms table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'symptoms' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE symptoms ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Add clinic_id to diagnoses table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'diagnoses' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE diagnoses ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Add clinic_id to prescriptions table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prescriptions' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE prescriptions ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Add clinic_id to tests_ordered table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tests_ordered' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE tests_ordered ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Add clinic_id to test_results table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'test_results' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE test_results ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Add clinic_id to ocr_uploads table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ocr_uploads' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE ocr_uploads ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Add clinic_id to ocr_results table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ocr_results' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE ocr_results ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Add clinic_id to sent_messages_log table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sent_messages_log' AND column_name = 'clinic_id'
  ) THEN
    ALTER TABLE sent_messages_log ADD COLUMN clinic_id uuid REFERENCES clinic_settings(id);
  END IF;
END $$;

-- Migrate existing data: Update appointments with clinic_id from doctor's profile
UPDATE appointments 
SET clinic_id = profiles.clinic_id
FROM profiles 
WHERE appointments.doctor_id = profiles.id 
AND appointments.clinic_id IS NULL;

-- Migrate existing data: Update visits with clinic_id from doctor's profile
UPDATE visits 
SET clinic_id = profiles.clinic_id
FROM profiles 
WHERE visits.doctor_id = profiles.id 
AND visits.clinic_id IS NULL;

-- Migrate existing data: Update bills with clinic_id from visit
UPDATE bills 
SET clinic_id = visits.clinic_id
FROM visits 
WHERE bills.visit_id = visits.id 
AND bills.clinic_id IS NULL;

-- Migrate existing data: Update symptoms with clinic_id from visit
UPDATE symptoms 
SET clinic_id = visits.clinic_id
FROM visits 
WHERE symptoms.visit_id = visits.id 
AND symptoms.clinic_id IS NULL;

-- Migrate existing data: Update diagnoses with clinic_id from visit
UPDATE diagnoses 
SET clinic_id = visits.clinic_id
FROM visits 
WHERE diagnoses.visit_id = visits.id 
AND diagnoses.clinic_id IS NULL;

-- Migrate existing data: Update prescriptions with clinic_id from visit
UPDATE prescriptions 
SET clinic_id = visits.clinic_id
FROM visits 
WHERE prescriptions.visit_id = visits.id 
AND prescriptions.clinic_id IS NULL;

-- Migrate existing data: Update tests_ordered with clinic_id from visit
UPDATE tests_ordered 
SET clinic_id = visits.clinic_id
FROM visits 
WHERE tests_ordered.visit_id = visits.id 
AND tests_ordered.clinic_id IS NULL;

-- Migrate existing data: Update test_results with clinic_id from visit
UPDATE test_results 
SET clinic_id = visits.clinic_id
FROM visits 
WHERE test_results.visit_id = visits.id 
AND test_results.clinic_id IS NULL;

-- Migrate existing data: Update ocr_uploads with clinic_id from visit (if visit_id exists)
UPDATE ocr_uploads 
SET clinic_id = visits.clinic_id
FROM visits 
WHERE ocr_uploads.visit_id = visits.id 
AND ocr_uploads.clinic_id IS NULL;

-- For ocr_uploads without visit_id, use the uploader's clinic_id
UPDATE ocr_uploads 
SET clinic_id = profiles.clinic_id
FROM profiles 
WHERE ocr_uploads.uploaded_by = profiles.id 
AND ocr_uploads.clinic_id IS NULL;

-- Migrate existing data: Update ocr_results with clinic_id from ocr_uploads
UPDATE ocr_results 
SET clinic_id = ocr_uploads.clinic_id
FROM ocr_uploads 
WHERE ocr_results.ocr_upload_id = ocr_uploads.id 
AND ocr_results.clinic_id IS NULL;

-- Migrate existing data: Update sent_messages_log with clinic_id from visit (if visit_id exists)
UPDATE sent_messages_log 
SET clinic_id = visits.clinic_id
FROM visits 
WHERE sent_messages_log.visit_id = visits.id 
AND sent_messages_log.clinic_id IS NULL;

-- For sent_messages_log without visit_id, use the sender's clinic_id
UPDATE sent_messages_log 
SET clinic_id = profiles.clinic_id
FROM profiles 
WHERE sent_messages_log.sent_by = profiles.id 
AND sent_messages_log.clinic_id IS NULL;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_id ON appointments(clinic_id);
CREATE INDEX IF NOT EXISTS idx_visits_clinic_id ON visits(clinic_id);
CREATE INDEX IF NOT EXISTS idx_bills_clinic_id ON bills(clinic_id);
CREATE INDEX IF NOT EXISTS idx_symptoms_clinic_id ON symptoms(clinic_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_clinic_id ON diagnoses(clinic_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_clinic_id ON prescriptions(clinic_id);
CREATE INDEX IF NOT EXISTS idx_tests_ordered_clinic_id ON tests_ordered(clinic_id);
CREATE INDEX IF NOT EXISTS idx_test_results_clinic_id ON test_results(clinic_id);
CREATE INDEX IF NOT EXISTS idx_ocr_uploads_clinic_id ON ocr_uploads(clinic_id);
CREATE INDEX IF NOT EXISTS idx_ocr_results_clinic_id ON ocr_results(clinic_id);
CREATE INDEX IF NOT EXISTS idx_sent_messages_log_clinic_id ON sent_messages_log(clinic_id);

-- Update RLS policies for appointments
DROP POLICY IF EXISTS "Allow all operations for authenticated users on appointments" ON appointments;
DROP POLICY IF EXISTS "Allow super_admin full access on appointments" ON appointments;

CREATE POLICY "Users can only access appointments from their clinic"
  ON appointments
  FOR ALL
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

-- Update RLS policies for visits
DROP POLICY IF EXISTS "Allow all operations for authenticated users on visits" ON visits;

CREATE POLICY "Users can only access visits from their clinic"
  ON visits
  FOR ALL
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

-- Update RLS policies for bills
DROP POLICY IF EXISTS "Allow all operations for authenticated users on bills" ON bills;

CREATE POLICY "Users can only access bills from their clinic"
  ON bills
  FOR ALL
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

-- Update RLS policies for symptoms
DROP POLICY IF EXISTS "Allow all operations for authenticated users on symptoms" ON symptoms;

CREATE POLICY "Users can only access symptoms from their clinic"
  ON symptoms
  FOR ALL
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

-- Update RLS policies for diagnoses
DROP POLICY IF EXISTS "Allow all operations for authenticated users on diagnoses" ON diagnoses;

CREATE POLICY "Users can only access diagnoses from their clinic"
  ON diagnoses
  FOR ALL
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

-- Update RLS policies for prescriptions
DROP POLICY IF EXISTS "Allow all operations for authenticated users on prescriptions" ON prescriptions;

CREATE POLICY "Users can only access prescriptions from their clinic"
  ON prescriptions
  FOR ALL
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

-- Update RLS policies for tests_ordered
DROP POLICY IF EXISTS "Allow all operations for authenticated users on tests_ordered" ON tests_ordered;

CREATE POLICY "Users can only access tests_ordered from their clinic"
  ON tests_ordered
  FOR ALL
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

-- Update RLS policies for test_results
DROP POLICY IF EXISTS "Allow all operations for authenticated users on test_results" ON test_results;

CREATE POLICY "Users can only access test_results from their clinic"
  ON test_results
  FOR ALL
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

-- Update RLS policies for ocr_uploads
DROP POLICY IF EXISTS "Allow all operations for authenticated users on ocr_uploads" ON ocr_uploads;

CREATE POLICY "Users can only access ocr_uploads from their clinic"
  ON ocr_uploads
  FOR ALL
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

-- Update RLS policies for ocr_results
DROP POLICY IF EXISTS "Allow all operations for authenticated users on ocr_results" ON ocr_results;

CREATE POLICY "Users can only access ocr_results from their clinic"
  ON ocr_results
  FOR ALL
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

-- Update RLS policies for sent_messages_log
DROP POLICY IF EXISTS "Allow authenticated users to manage message logs" ON sent_messages_log;

CREATE POLICY "Users can only access sent_messages_log from their clinic"
  ON sent_messages_log
  FOR ALL
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

-- Create function to automatically set clinic_id on insert
CREATE OR REPLACE FUNCTION set_clinic_id_from_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Get the user's clinic_id from their profile
  SELECT clinic_id INTO NEW.clinic_id
  FROM profiles
  WHERE id = auth.uid();
  
  -- If no clinic_id found, raise an error
  IF NEW.clinic_id IS NULL THEN
    RAISE EXCEPTION 'User must be assigned to a clinic to perform this operation';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers to automatically set clinic_id on insert
CREATE TRIGGER trigger_set_clinic_id_appointments
  BEFORE INSERT ON appointments
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();

CREATE TRIGGER trigger_set_clinic_id_visits
  BEFORE INSERT ON visits
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();

CREATE TRIGGER trigger_set_clinic_id_bills
  BEFORE INSERT ON bills
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();

CREATE TRIGGER trigger_set_clinic_id_symptoms
  BEFORE INSERT ON symptoms
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();

CREATE TRIGGER trigger_set_clinic_id_diagnoses
  BEFORE INSERT ON diagnoses
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();

CREATE TRIGGER trigger_set_clinic_id_prescriptions
  BEFORE INSERT ON prescriptions
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();

CREATE TRIGGER trigger_set_clinic_id_tests_ordered
  BEFORE INSERT ON tests_ordered
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();

CREATE TRIGGER trigger_set_clinic_id_test_results
  BEFORE INSERT ON test_results
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();

CREATE TRIGGER trigger_set_clinic_id_ocr_uploads
  BEFORE INSERT ON ocr_uploads
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();

CREATE TRIGGER trigger_set_clinic_id_ocr_results
  BEFORE INSERT ON ocr_results
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();

CREATE TRIGGER trigger_set_clinic_id_sent_messages_log
  BEFORE INSERT ON sent_messages_log
  FOR EACH ROW
  WHEN (NEW.clinic_id IS NULL)
  EXECUTE FUNCTION set_clinic_id_from_user();