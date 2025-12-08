/*
  # Add prescription frequencies to clinic settings

  1. Schema Changes
    - Add `prescription_frequencies` JSONB column to clinic_settings table
    - This stores customizable prescription frequency options per clinic

  2. Purpose
    - Allow clinics to customize their prescription frequency options
    - Default values: OD, BD, TID, QID, PRN
*/

-- Add prescription_frequencies column
ALTER TABLE clinic_settings 
ADD COLUMN IF NOT EXISTS prescription_frequencies jsonb DEFAULT '[
  {"code": "OD", "label": "OD (Once daily)", "timesPerDay": 1},
  {"code": "BD", "label": "BD (Twice daily)", "timesPerDay": 2},
  {"code": "TID", "label": "TID (Three times daily)", "timesPerDay": 3},
  {"code": "QID", "label": "QID (Four times daily)", "timesPerDay": 4},
  {"code": "PRN", "label": "PRN (As needed)", "timesPerDay": null}
]'::jsonb;

-- Set default values for existing clinics
UPDATE clinic_settings 
SET prescription_frequencies = '[
  {"code": "OD", "label": "OD (Once daily)", "timesPerDay": 1},
  {"code": "BD", "label": "BD (Twice daily)", "timesPerDay": 2},
  {"code": "TID", "label": "TID (Three times daily)", "timesPerDay": 3},
  {"code": "QID", "label": "QID (Four times daily)", "timesPerDay": 4},
  {"code": "PRN", "label": "PRN (As needed)", "timesPerDay": null}
]'::jsonb
WHERE prescription_frequencies IS NULL;
