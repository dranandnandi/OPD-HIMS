-- Add a clinic-scoped, human-readable patient number while keeping UUIDs as primary keys.
-- Format: YYYYMM + 4-digit clinic-local running number, e.g. 2026061111.
ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS patient_number text;

-- Backfill existing rows with a continuous sequence per clinic, preserving creation order.
WITH numbered_patients AS (
  SELECT
    id,
    to_char(COALESCE(created_at, now()), 'YYYYMM') ||
    lpad(
      row_number() OVER (
        PARTITION BY clinic_id, to_char(COALESCE(created_at, now()), 'YYYYMM')
        ORDER BY created_at NULLS FIRST, id
      )::text,
      4,
      '0'
    ) AS generated_patient_number
  FROM public.patients
  WHERE patient_number IS NULL
)
UPDATE public.patients AS patients
SET patient_number = numbered_patients.generated_patient_number
FROM numbered_patients
WHERE patients.id = numbered_patients.id
  AND patients.patient_number IS NULL;

ALTER TABLE public.patients
ALTER COLUMN patient_number SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'patients_patient_number_format'
      AND conrelid = 'public.patients'::regclass
  ) THEN
    ALTER TABLE public.patients
    ADD CONSTRAINT patients_patient_number_format
    CHECK (patient_number ~ '^[0-9]{10}$')
    NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.patients
VALIDATE CONSTRAINT patients_patient_number_format;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_clinic_patient_number
ON public.patients (clinic_id, patient_number);

CREATE INDEX IF NOT EXISTS idx_patients_patient_number
ON public.patients (patient_number);

CREATE OR REPLACE FUNCTION public.assign_patient_number()
RETURNS trigger AS $$
DECLARE
  patient_number_prefix text;
  next_patient_number integer;
BEGIN
  IF NEW.patient_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.clinic_id IS NULL THEN
    SELECT clinic_id INTO NEW.clinic_id
    FROM public.profiles
    WHERE id = auth.uid();
  END IF;

  IF NEW.clinic_id IS NULL THEN
    RAISE EXCEPTION 'Patient clinic_id is required to assign a patient number';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.clinic_id::text));

  patient_number_prefix := to_char(COALESCE(NEW.created_at, now()), 'YYYYMM');

  SELECT COALESCE(MAX(right(patient_number, 4)::integer), 0) + 1
  INTO next_patient_number
  FROM public.patients
  WHERE clinic_id = NEW.clinic_id
    AND patient_number LIKE patient_number_prefix || '____';

  IF next_patient_number > 9999 THEN
    RAISE EXCEPTION 'Monthly patient number series exhausted for clinic % and month %', NEW.clinic_id, patient_number_prefix;
  END IF;

  NEW.patient_number := patient_number_prefix || lpad(next_patient_number::text, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_assign_patient_number ON public.patients;
CREATE TRIGGER trigger_assign_patient_number
BEFORE INSERT ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.assign_patient_number();

COMMENT ON COLUMN public.patients.patient_number IS
'Clinic-scoped 10-digit patient number in YYYYMMNNNN format for manual records, search, and printed documents. UUID id remains the primary key.';
