-- Extend waiting sequences for pre-visit, after-arrival, and post-visit messaging.

ALTER TABLE waiting_sequences
  ADD COLUMN IF NOT EXISTS sequence_stage TEXT NOT NULL DEFAULT 'waiting',
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type TEXT;

ALTER TABLE waiting_sequences
  DROP CONSTRAINT IF EXISTS waiting_sequences_sequence_stage_check;

ALTER TABLE waiting_sequences
  ADD CONSTRAINT waiting_sequences_sequence_stage_check
  CHECK (sequence_stage IN ('pre_visit', 'waiting', 'post_visit'));

UPDATE waiting_sequences
SET sequence_stage = 'waiting'
WHERE sequence_stage IS NULL;

CREATE INDEX IF NOT EXISTS idx_waiting_sequences_stage_clinic_condition
  ON waiting_sequences(clinic_id, sequence_stage, condition_type, step_order)
  WHERE is_active = true;
