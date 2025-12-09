-- Add appointment_types column to clinic_settings
ALTER TABLE clinic_settings 
ADD COLUMN IF NOT EXISTS appointment_types jsonb DEFAULT '[
  {"id": "consultation", "label": "Consultation", "duration": 30, "color": "#3B82F6"},
  {"id": "followup", "label": "Follow-up", "duration": 20, "color": "#10B981"},
  {"id": "emergency", "label": "Emergency", "duration": 15, "color": "#EF4444"},
  {"id": "procedure", "label": "Procedure", "duration": 60, "color": "#8B5CF6"}
]'::jsonb;

-- Backfill existing records with default appointment types
UPDATE clinic_settings 
SET appointment_types = '[
  {"id": "consultation", "label": "Consultation", "duration": 30, "color": "#3B82F6"},
  {"id": "followup", "label": "Follow-up", "duration": 20, "color": "#10B981"},
  {"id": "emergency", "label": "Emergency", "duration": 15, "color": "#EF4444"},
  {"id": "procedure", "label": "Procedure", "duration": 60, "color": "#8B5CF6"}
]'::jsonb
WHERE appointment_types IS NULL;

-- Comment on column
COMMENT ON COLUMN clinic_settings.appointment_types IS 'Customizable appointment types with duration and color coding';
