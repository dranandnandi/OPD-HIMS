-- Add waiting sequence feature

-- Enable on clinic_settings
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS waiting_sequence_enabled BOOLEAN NOT NULL DEFAULT false;

-- Condition type selected by front desk when marking Arrived
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS waiting_condition_type TEXT;

-- Sequences defined by clinic admin
CREATE TABLE IF NOT EXISTS waiting_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
  condition_type TEXT NOT NULL DEFAULT 'General',
  step_order INTEGER NOT NULL DEFAULT 1,
  delay_minutes INTEGER NOT NULL DEFAULT 5,
  message TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waiting_sequences_clinic_condition
  ON waiting_sequences(clinic_id, condition_type, step_order)
  WHERE is_active = true;

-- RLS
ALTER TABLE waiting_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "waiting_sequences_clinic_isolation" ON waiting_sequences
  USING (
    clinic_id IN (
      SELECT id FROM clinic_settings
      WHERE id = (
        SELECT clinic_id FROM profiles WHERE id = auth.uid()
      )
    )
  );
