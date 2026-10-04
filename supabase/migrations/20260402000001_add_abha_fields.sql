-- Add ABHA (Ayushman Bharat Health Account) fields to patients table
-- Required for ABDM compliance

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS abha_number TEXT,
  ADD COLUMN IF NOT EXISTS abha_address TEXT,
  ADD COLUMN IF NOT EXISTS abha_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS abha_consent_given BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS abha_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mobile_verified BOOLEAN DEFAULT FALSE;

-- Unique index on abha_number (one ABHA per patient record)
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_abha_number
  ON patients (abha_number)
  WHERE abha_number IS NOT NULL;
