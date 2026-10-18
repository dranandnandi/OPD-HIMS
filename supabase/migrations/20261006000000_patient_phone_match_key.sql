-- ============================================================================
-- One matchable format for patient phone numbers.
--
-- `patients.phone` stores whatever the caller supplied. Reception types it as
-- it is spoken -- "+91 98765 43210", "098765 43210", "9876543210" -- and
-- patientService.addPatient inserts that string verbatim, while the public
-- self-booking function strips to bare digits and may keep a country code
-- ("919876543210"). One clinic's column therefore holds the same mobile number
-- in four different spellings.
--
-- That is not cosmetic, because every "is this patient already registered?"
-- check in the app is a string comparison against this column:
--
--   * the appointment modal's patient search  phone.includes(term)
--   * the duplicate-registration warning      phone = $1
--   * the public booking returning-patient    phone ILIKE '%' || last10
--
-- The first two miss across formats, so reception is told "no patients found"
-- for someone who is registered, registers them again, and the person's
-- history splits across two records -- each with its own visits, bills and
-- ABDM care contexts. It needs no scale to happen: one number entered with a
-- +91 once and without it the next time is enough.
--
-- phone_norm is the last 10 digits, which is what identifies an Indian mobile
-- regardless of how the country code and spacing were written. GENERATED
-- ALWAYS ... STORED rather than a trigger or a backfilled plain column: it
-- cannot drift from phone, needs no application cooperation, and every
-- existing row gets it during this migration's table rewrite.
--
-- NULL below 10 digits, deliberately. A landline, a half-typed number or a
-- placeholder like "N/A" normalises to a short string or '', and two such rows
-- would otherwise compare equal and present unrelated people to reception as
-- each other's duplicates. NULL never equals NULL, so those rows simply do not
-- participate in matching -- which is the correct answer for a number that
-- cannot identify anyone.
--
-- Safe to re-run: the column and index are both guarded.
-- ============================================================================

BEGIN;

ALTER TABLE public.patients
  DROP COLUMN IF EXISTS phone_norm;

ALTER TABLE public.patients
  ADD COLUMN phone_norm text
  GENERATED ALWAYS AS (
    CASE
      WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
      THEN right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
    END
  ) STORED;

COMMENT ON COLUMN public.patients.phone_norm IS
  'Last 10 digits of phone, or NULL when phone holds fewer than 10 digits. '
  'Generated -- never write to it. Match patients on this, never on phone.';

-- Partial: the NULL rows are unmatchable by design, so they are dead weight in
-- the index. Covers both the duplicate check (clinic_id, phone_norm) and the
-- public booking lookup, which until now did a sequential scan per booking --
-- idx_patients_clinic_phone could not serve its leading-wildcard ILIKE.
CREATE INDEX IF NOT EXISTS idx_patients_clinic_phone_norm
  ON public.patients (clinic_id, phone_norm)
  WHERE phone_norm IS NOT NULL;

-- Visibility, not a failure: these rows are reachable by name and patient
-- number but will never match on phone, and the clinic should know how many
-- they have rather than discover it as a missed duplicate.
DO $$
DECLARE unmatchable_count INT;
BEGIN
  SELECT COUNT(*) INTO unmatchable_count
    FROM public.patients
   WHERE phone_norm IS NULL;

  IF unmatchable_count > 0 THEN
    RAISE WARNING 'patients.phone_norm: % row(s) hold fewer than 10 digits in phone and will not match on phone number -- inspect if duplicates are suspected', unmatchable_count;
  END IF;
END $$;

COMMIT;
