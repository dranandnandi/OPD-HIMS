-- ============================================================================
-- Automatic WhatsApp reminders (appointment + follow-up)
--
-- Two Netlify scheduled functions drive this:
--   queue-auto-reminders    (daily)   inserts due reminders into the queue
--   process-whatsapp-queue  (5 min)   sends ONE message per clinic per run
--
-- The drip pacing exists to keep the WhatsApp Web session under the radar:
-- a clinic sends at most one message every whatsappAutoSendConfig.minGapMinutes
-- to maxGapMinutes (randomised so the cadence is not robotic).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Queue: idempotent inserts, priority ordering, atomic claim
-- ---------------------------------------------------------------------------

ALTER TABLE whatsapp_message_queue
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100;

COMMENT ON COLUMN whatsapp_message_queue.dedupe_key IS
  'Stable natural key (e.g. appt_reminder:<appointment_id>) so re-running the producer cannot double-send.';
COMMENT ON COLUMN whatsapp_message_queue.priority IS
  'Lower sends first. Appointment reminders derive it from the appointment time so the 9am patient is messaged before the 5pm one.';

-- 'sending' is the in-flight state between claim and delivery
ALTER TABLE whatsapp_message_queue DROP CONSTRAINT IF EXISTS whatsapp_message_queue_status_check;
ALTER TABLE whatsapp_message_queue ADD CONSTRAINT whatsapp_message_queue_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_queue_dedupe
  ON whatsapp_message_queue (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_due
  ON whatsapp_message_queue (clinic_id, status, priority, scheduled_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Per-clinic automation config
-- ---------------------------------------------------------------------------

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS whatsapp_auto_send_config JSONB NOT NULL DEFAULT jsonb_build_object(
    'minGapMinutes', 5,
    'maxGapMinutes', 10,
    'sendWindowStart', '09:00',
    'sendWindowEnd', '20:00',
    'appointmentReminderHoursBefore', 24,
    'followUpLeadDays', 0
  );

COMMENT ON COLUMN clinic_settings.whatsapp_auto_send_config IS
  'Pacing + timing knobs for automatic WhatsApp reminders. Window times are IST (Asia/Kolkata).';

-- ---------------------------------------------------------------------------
-- Per-clinic send clock + session health
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS whatsapp_send_state (
  clinic_id UUID PRIMARY KEY REFERENCES clinic_settings(id) ON DELETE CASCADE,
  next_send_after TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMP WITH TIME ZONE,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_error_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE whatsapp_send_state IS
  'One row per clinic. next_send_after enforces the drip gap; failure_streak surfaces a dropped WhatsApp session in Settings.';

DROP TRIGGER IF EXISTS update_whatsapp_send_state_timestamp ON whatsapp_send_state;
CREATE TRIGGER update_whatsapp_send_state_timestamp
  BEFORE UPDATE ON whatsapp_send_state
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_updated_at();

ALTER TABLE whatsapp_send_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their clinic's send state" ON whatsapp_send_state;
CREATE POLICY "Users can view their clinic's send state"
  ON whatsapp_send_state FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Atomic claim
--
-- FOR UPDATE SKIP LOCKED means two concurrent workers (or the scheduled
-- function overlapping with itself on a slow run) can never claim the same
-- row. Messages stuck in 'sending' for over 15 minutes are treated as
-- abandoned -- the worker died mid-send -- and become claimable again.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_next_whatsapp_message(p_clinic_id UUID)
RETURNS SETOF whatsapp_message_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE whatsapp_message_queue
     SET status = 'pending', claimed_at = NULL
   WHERE clinic_id = p_clinic_id
     AND status = 'sending'
     AND claimed_at < NOW() - INTERVAL '15 minutes';

  SELECT id INTO v_id
    FROM whatsapp_message_queue
   WHERE clinic_id = p_clinic_id
     AND status = 'pending'
     AND scheduled_at <= NOW()
     AND retry_count < 3
   ORDER BY priority ASC, scheduled_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE whatsapp_message_queue
     SET status = 'sending', claimed_at = NOW()
   WHERE id = v_id
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_whatsapp_message(UUID) FROM PUBLIC, anon, authenticated;

COMMIT;
