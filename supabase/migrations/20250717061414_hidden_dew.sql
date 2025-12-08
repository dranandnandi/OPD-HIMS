/*
  # Create patients and visits tables

  1. New Tables
    - `patients`
      - `id` (uuid, primary key)
      - `name` (text, not null)
      - `phone` (text, unique, not null)
      - `age` (integer)
      - `gender` (text)
      - `address` (text)
      - `emergency_contact` (text)
      - `blood_group` (text)
      - `allergies` (text array)
      - `created_at` (timestamp)
      - `last_visit` (timestamp)
    
    - `visits`
      - `id` (uuid, primary key)
      - `patient_id` (uuid, foreign key)
      - `date` (timestamp)
      - `chief_complaint` (text)
      - `symptoms` (text array)
      - `vitals` (jsonb)
      - `diagnosis` (text array)
      - `prescriptions` (jsonb array)
      - `advice` (text array)
      - `follow_up_date` (timestamp)
      - `doctor_notes` (text)
      - `case_image_url` (text)

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users
*/

-- Create patients table
CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text UNIQUE NOT NULL,
  age integer,
  gender text CHECK (gender IN ('male', 'female', 'other')),
  address text,
  emergency_contact text,
  blood_group text,
  allergies text[],
  created_at timestamptz DEFAULT now(),
  last_visit timestamptz
);

-- Create visits table
CREATE TABLE IF NOT EXISTS visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date timestamptz DEFAULT now(),
  chief_complaint text,
  symptoms text[],
  vitals jsonb,
  diagnosis text[],
  prescriptions jsonb[],
  advice text[],
  follow_up_date timestamptz,
  doctor_notes text,
  case_image_url text
);

-- Enable Row Level Security
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

-- Create policies for patients table
CREATE POLICY "Allow all operations for authenticated users on patients"
  ON patients
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create policies for visits table
CREATE POLICY "Allow all operations for authenticated users on visits"
  ON visits
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);
CREATE INDEX IF NOT EXISTS idx_visits_patient_id ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(date);

-- Create function to update last_visit when a new visit is added
CREATE OR REPLACE FUNCTION update_patient_last_visit()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE patients 
  SET last_visit = NEW.date 
  WHERE id = NEW.patient_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update last_visit
DROP TRIGGER IF EXISTS trigger_update_patient_last_visit ON visits;
CREATE TRIGGER trigger_update_patient_last_visit
  AFTER INSERT ON visits
  FOR EACH ROW
  EXECUTE FUNCTION update_patient_last_visit();