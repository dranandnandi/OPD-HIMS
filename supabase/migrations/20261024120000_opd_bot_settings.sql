-- Shared clinic bot configuration. Browsers use the authenticated hims-opd-bot
-- function; only the service role can read/write this table directly.
CREATE TABLE IF NOT EXISTS public.opd_bot_settings (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.opd_bot_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opd_bot_settings FROM anon, authenticated;
GRANT ALL ON public.opd_bot_settings TO service_role;
