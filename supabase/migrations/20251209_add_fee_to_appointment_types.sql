-- Migration: Add fee field to appointment_types in clinic_settings
-- This migration updates the appointment_types JSONB column structure to include fee information

-- Add comment explaining the new structure
COMMENT ON COLUMN clinic_settings.appointment_types IS 'JSONB array of appointment type objects with structure: {id: string, label: string, duration: number, color: string, fee: number}';

-- Note: Since appointment_types is a JSONB column, no schema change is needed.
-- The application will handle the fee field in the JSONB structure.
-- Existing records will continue to work, and new records will include the fee field.
