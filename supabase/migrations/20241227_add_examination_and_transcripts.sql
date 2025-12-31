-- Migration: Add physical examination and voice transcripts
-- Run this in Supabase SQL Editor

-- Add physical_examination JSONB column to visits table
ALTER TABLE visits ADD COLUMN IF NOT EXISTS physical_examination JSONB DEFAULT '{}';

-- Create voice_transcripts table for offline sync
CREATE TABLE IF NOT EXISTS voice_transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  visit_id UUID REFERENCES visits(id) ON DELETE CASCADE,
  transcript TEXT NOT NULL,
  extracted_data JSONB,
  sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed')),
  device_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  synced_at TIMESTAMPTZ
);

-- Index for faster sync queries
CREATE INDEX IF NOT EXISTS idx_voice_transcripts_sync_status ON voice_transcripts(sync_status);
CREATE INDEX IF NOT EXISTS idx_voice_transcripts_visit_id ON voice_transcripts(visit_id);

-- Enable RLS
ALTER TABLE voice_transcripts ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see transcripts for their clinic's visits
CREATE POLICY "Users can view own clinic transcripts" ON voice_transcripts
  FOR ALL USING (
    visit_id IN (
      SELECT v.id FROM visits v
      JOIN patients p ON v.patient_id = p.id
      JOIN profiles pr ON p.clinic_id = pr.clinic_id
      WHERE pr.user_id = auth.uid()
    )
  );
