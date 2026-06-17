-- Add clinic_tier column to clinic_settings
-- Tiers: basic (no WhatsApp/AI/Follow-ups/GMB access), silver, gold
-- Existing clinics are set to 'silver'; new clinics default to 'basic'

ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS clinic_tier text NOT NULL DEFAULT 'basic'
    CHECK (clinic_tier IN ('basic', 'silver', 'gold'));

-- Upgrade all existing clinics to silver (they were active before tiering was introduced)
UPDATE public.clinic_settings
  SET clinic_tier = 'silver'
  WHERE clinic_tier = 'basic';

COMMENT ON COLUMN public.clinic_settings.clinic_tier IS
  'Subscription tier: basic (limited access, default for new clinics), silver (standard), gold (premium).';
