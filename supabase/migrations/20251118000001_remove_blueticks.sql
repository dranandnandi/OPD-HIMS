-- Remove Blueticks API integration
-- This migration removes the Blueticks API key and related settings from clinic_settings
-- and updates any references to use WhatsApp instead

BEGIN;

-- Remove Blueticks columns from clinic_settings
ALTER TABLE clinic_settings DROP COLUMN IF EXISTS blueticks_api_key;
ALTER TABLE clinic_settings DROP COLUMN IF EXISTS enable_blueticks_api_send;

-- Update reviews delivery method (if column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'reviews' 
    AND column_name = 'delivery_method'
  ) THEN
    -- Update any 'blueticks_api' references to 'whatsapp'
    UPDATE reviews 
    SET delivery_method = 'whatsapp' 
    WHERE delivery_method = 'blueticks_api';
  END IF;
END $$;

-- Add comment documenting the change
COMMENT ON TABLE clinic_settings IS 'Clinic settings and configuration. Blueticks integration removed in favor of WhatsApp auto-send system.';

COMMIT;
