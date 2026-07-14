-- Clinic-wise IPD module access. Platform-managed (like clinic_tier):
-- IPD stays hidden for a clinic until this is switched on.
ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS ipd_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clinic_settings.ipd_enabled IS
  'When true, the IPD (inpatient) module is available to this clinic''s users (still permission-gated per user via ipd_* permissions).';
