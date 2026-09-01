-- ============================================================================
-- One stored format for ABHA numbers: 14 bare digits.
--
-- ABDM presents an ABHA number two ways — 91-5268-5170-0066 for humans, and
-- 91526851700066 in API payloads. Rows created before the guard in
-- abha-link-patient hold the dashed form; everything since holds bare digits.
--
-- Two formats in one column is not cosmetic. Every ABDM lookup keys on this
-- value, so a dashed row is invisible to an exact match on the bare form. The
-- scan-and-share callback would have registered a SECOND patient record for a
-- patient already linked — the exact duplication scan-and-share exists to
-- prevent, and the kind that only surfaces once two clinicians are writing
-- notes against different records for the same person.
--
-- Bare digits win because that is what ABDM sends in callbacks and what every
-- API expects. Formatting for display is the UI's job
-- (abhaService.formatAbhaNumber already does it).
--
-- Safe to re-run: the WHERE clause matches only rows still holding non-digits.
-- ============================================================================

BEGIN;

UPDATE public.patients
   SET abha_number = regexp_replace(abha_number, '[^0-9]', '', 'g')
 WHERE abha_number IS NOT NULL
   AND abha_number ~ '[^0-9]';

-- Anything that is not 14 digits after stripping was never a valid ABHA
-- number, and silently keeping it would let a malformed value fail much later
-- inside an ABDM call. Surface it now instead.
DO $$
DECLARE bad_count INT;
BEGIN
  SELECT COUNT(*) INTO bad_count
    FROM public.patients
   WHERE abha_number IS NOT NULL
     AND abha_number !~ '^[0-9]{14}$';

  IF bad_count > 0 THEN
    RAISE WARNING 'patients.abha_number: % row(s) are not 14 digits after normalisation — inspect before relying on ABDM matching', bad_count;
  END IF;
END $$;

-- Keep it that way. NOT VALID so the constraint applies to new and updated
-- rows without failing the migration on any legacy value the UPDATE could not
-- rescue; validate it once the warning above reports zero.
ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_abha_number_digits_ck;
ALTER TABLE public.patients
  ADD CONSTRAINT patients_abha_number_digits_ck
  CHECK (abha_number IS NULL OR abha_number ~ '^[0-9]{14}$') NOT VALID;

COMMIT;
