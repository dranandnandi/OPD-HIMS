-- ============================================================================
-- Per-clinic ABDM facility identity (HFR).
--
-- ABDM issues one HIP ID per (facility x bridge) pair — FAQ v1.4 Q24-Q26. This
-- product is ONE bridge (our client ID) serving MANY clinics, so:
--
--   Bridge ID   -> one for the whole product, an env secret, not stored here
--   HFR ID      -> one per clinic, the facility's registry id
--   HIP ID      -> one per clinic, minted when that facility links our bridge
--
-- So HIP ID is per-clinic data and belongs beside document_link_base, not in an
-- environment variable. Getting this wrong would make every clinic share one
-- facility identity, and patient records would attach to the wrong hospital in
-- the ABHA app.
--
-- Nothing reads these yet. They are the prerequisite for scan-and-share, whose
-- QR is nothing more than:
--   https://phrsbx.abdm.gov.in/share-profile?hipid=<hip_id>&counterid=<context>
--
-- Safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.clinic_settings
  -- The facility's HFR id. Format per the HFR spec: starts 'IN', 12 chars.
  ADD COLUMN IF NOT EXISTS hfr_facility_id text,

  -- What ABDM mints when this facility links our bridge. This is the value the
  -- scan-and-share QR carries, and what identifies the clinic to ABDM.
  ADD COLUMN IF NOT EXISTS abdm_hip_id text,

  -- Patient-facing. This is the name shown in the ABHA/PHR app when a patient
  -- searches for the hospital, so it is branding, not an internal key.
  -- HFR rules: max 15 characters, no special characters, unique per bridge
  -- within a facility.
  ADD COLUMN IF NOT EXISTS abdm_hip_name text,

  -- Facility-defined context in the scan-and-share QR ('counterid'). A clinic
  -- with one reception desk can leave this at '1'; a hospital with several
  -- counters gives each its own, so the profile lands at the right desk.
  ADD COLUMN IF NOT EXISTS abdm_counter_code text DEFAULT '1';

-- Fail loudly at write time rather than at ABDM integration time. A malformed
-- HIP ID would otherwise surface as an opaque rejection weeks later, inside a
-- QR a patient is standing in front of.
ALTER TABLE public.clinic_settings
  DROP CONSTRAINT IF EXISTS clinic_settings_hfr_facility_id_ck;
ALTER TABLE public.clinic_settings
  ADD CONSTRAINT clinic_settings_hfr_facility_id_ck
  CHECK (hfr_facility_id IS NULL OR hfr_facility_id ~ '^IN[A-Za-z0-9]{10}$');

ALTER TABLE public.clinic_settings
  DROP CONSTRAINT IF EXISTS clinic_settings_abdm_hip_name_ck;
ALTER TABLE public.clinic_settings
  ADD CONSTRAINT clinic_settings_abdm_hip_name_ck
  CHECK (abdm_hip_name IS NULL OR abdm_hip_name ~ '^[A-Za-z0-9 ]{1,15}$');

-- Two clinics sharing a HIP ID would silently merge their ABDM identities.
-- Partial so the many clinics with no ABDM registration yet are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_settings_abdm_hip_id
  ON public.clinic_settings (abdm_hip_id)
  WHERE abdm_hip_id IS NOT NULL;

COMMIT;
