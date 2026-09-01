-- ============================================================================
-- Relax the abdm_hip_name length cap.
--
-- 20260826000000_clinic_hfr_identity.sql capped this at 15 characters, taken
-- from the HFR API documentation's MutipleHRPAddUpdateServices contract.
--
-- On 2026-09-01 the HFR portal's Software Linkage accepted and now stores
-- 'Meditrust Clinics' — 17 characters — for facility IN2410002622. So the
-- 15-char rule is either specific to the API route or simply not enforced on
-- the portal, and our constraint would reject the value ABDM itself holds.
--
-- This column exists to MIRROR ABDM's record. A constraint that forbids ABDM's
-- own value is worse than no constraint: it would force us to store a name that
-- disagrees with what patients see in the ABHA app.
--
-- The character-class rule is kept (no special characters, per the same doc)
-- and the length raised to 50, which is a sanity bound rather than a spec
-- limit. If NHA ever documents the portal's real cap, tighten to it.
--
-- Safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.clinic_settings
  DROP CONSTRAINT IF EXISTS clinic_settings_abdm_hip_name_ck;
ALTER TABLE public.clinic_settings
  ADD CONSTRAINT clinic_settings_abdm_hip_name_ck
  CHECK (abdm_hip_name IS NULL OR abdm_hip_name ~ '^[A-Za-z0-9 ]{1,50}$');

COMMIT;
