-- Historical imports can push far more than 9999 patients into a single clinic-month,
-- which the monthly YYYYMM + 4-digit series cannot represent. Instead of failing the
-- insert, fall back to an overflow series that starts with 9 — a YYYYMM prefix can
-- never start with 9, so the two series can never collide.

CREATE TABLE IF NOT EXISTS public.patient_number_overflow (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinic_settings (id),
  last_number bigint NOT NULL
);

COMMENT ON TABLE public.patient_number_overflow IS
'Per-clinic counter for the 9-prefixed patient number series used when a monthly series is exhausted.';

-- Internal bookkeeping only: no client should read or write this directly.
-- assign_patient_number() is SECURITY DEFINER and therefore bypasses RLS.
ALTER TABLE public.patient_number_overflow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_number_overflow FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_patient_number()
RETURNS trigger AS $$
DECLARE
  patient_number_prefix text;
  next_patient_number integer;
  overflow_patient_number bigint;
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

  IF next_patient_number <= 9999 THEN
    NEW.patient_number := patient_number_prefix || lpad(next_patient_number::text, 4, '0');
    RETURN NEW;
  END IF;

  -- Monthly series exhausted: take the next number from the clinic's overflow series.
  UPDATE public.patient_number_overflow
  SET last_number = last_number + 1
  WHERE clinic_id = NEW.clinic_id
  RETURNING last_number INTO overflow_patient_number;

  -- First overflow for this clinic: seed the counter from any 9-series numbers
  -- already present (e.g. from an earlier import) so numbers are never reused.
  IF NOT FOUND THEN
    SELECT COALESCE(MAX(patient_number::bigint), 9000000000) + 1
    INTO overflow_patient_number
    FROM public.patients
    WHERE clinic_id = NEW.clinic_id
      AND patient_number LIKE '9%';

    INSERT INTO public.patient_number_overflow (clinic_id, last_number)
    VALUES (NEW.clinic_id, overflow_patient_number);
  END IF;

  IF overflow_patient_number > 9999999999 THEN
    RAISE EXCEPTION 'Patient number overflow series exhausted for clinic %', NEW.clinic_id;
  END IF;

  NEW.patient_number := overflow_patient_number::text;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
