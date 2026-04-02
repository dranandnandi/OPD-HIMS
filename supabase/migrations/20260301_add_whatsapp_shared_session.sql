-- Add shared WhatsApp session support
-- Allows admin to share their WhatsApp connection with clinic staff (reception)
ALTER TABLE clinic_settings
ADD COLUMN IF NOT EXISTS whatsapp_shared_session_user_id UUID REFERENCES auth.users(id) DEFAULT NULL;

COMMENT ON COLUMN clinic_settings.whatsapp_shared_session_user_id IS 'User ID of admin who shares their WhatsApp session with clinic staff';
