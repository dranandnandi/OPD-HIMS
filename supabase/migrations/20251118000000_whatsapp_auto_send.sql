-- WhatsApp Auto-Send Management Tables

-- Auto-send rules configuration
CREATE TABLE IF NOT EXISTS whatsapp_auto_send_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  enabled BOOLEAN DEFAULT false,
  template_id UUID,
  delay_minutes INTEGER DEFAULT 0,
  conditions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(clinic_id, event_type)
);

-- Message templates
CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message_content TEXT NOT NULL,
  variables TEXT[] DEFAULT ARRAY[]::TEXT[],
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Message queue for scheduled/pending messages
CREATE TABLE IF NOT EXISTS whatsapp_message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message_content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Message log for sent messages
CREATE TABLE IF NOT EXISTS whatsapp_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message_content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
  message_id TEXT,
  error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_rules_clinic ON whatsapp_auto_send_rules(clinic_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_rules_event ON whatsapp_auto_send_rules(event_type);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_clinic ON whatsapp_message_templates(clinic_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_event ON whatsapp_message_templates(event_type);

CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_clinic ON whatsapp_message_queue(clinic_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_status ON whatsapp_message_queue(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_scheduled ON whatsapp_message_queue(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_patient ON whatsapp_message_queue(patient_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_log_clinic ON whatsapp_message_log(clinic_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_log_patient ON whatsapp_message_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_log_sent_at ON whatsapp_message_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_log_event ON whatsapp_message_log(event_type);

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_whatsapp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_whatsapp_rules_timestamp
  BEFORE UPDATE ON whatsapp_auto_send_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_updated_at();

CREATE TRIGGER update_whatsapp_templates_timestamp
  BEFORE UPDATE ON whatsapp_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_updated_at();

CREATE TRIGGER update_whatsapp_queue_timestamp
  BEFORE UPDATE ON whatsapp_message_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_updated_at();

-- RLS Policies
ALTER TABLE whatsapp_auto_send_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_message_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_message_log ENABLE ROW LEVEL SECURITY;

-- Policies for rules
CREATE POLICY "Users can view their clinic's rules"
  ON whatsapp_auto_send_rules FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage their clinic's rules"
  ON whatsapp_auto_send_rules FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

-- Policies for templates
CREATE POLICY "Users can view their clinic's templates"
  ON whatsapp_message_templates FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage their clinic's templates"
  ON whatsapp_message_templates FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

-- Policies for queue
CREATE POLICY "Users can view their clinic's queue"
  ON whatsapp_message_queue FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage their clinic's queue"
  ON whatsapp_message_queue FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

-- Policies for log
CREATE POLICY "Users can view their clinic's logs"
  ON whatsapp_message_log FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert their clinic's logs"
  ON whatsapp_message_log FOR INSERT
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));
