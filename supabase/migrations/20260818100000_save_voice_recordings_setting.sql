-- Clinic-level opt-in for keeping voice-dictation audio.
--
-- Off by default: dictation still transcribes and fills the EMR exactly as
-- before, but the recording itself is discarded once the transcript is back.
-- When enabled, the audio is uploaded and attached to the visit (stored in
-- visits.visit_images with imageType 'voice_note'), so it shows up in the
-- patient's visit history next to the other attachments.

ALTER TABLE clinic_settings
ADD COLUMN IF NOT EXISTS save_voice_recordings BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN clinic_settings.save_voice_recordings IS
  'When true, voice dictation audio is stored as a visit attachment. When false, only the transcript is kept.';
