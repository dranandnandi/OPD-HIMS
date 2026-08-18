-- Optional date of birth for patients.
-- `age` stays the primary field used across visits, prescriptions and PDFs because
-- most walk-in registrations only capture age; DOB is recorded when it is known
-- and is used to derive the age at registration.
ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS date_of_birth date;

COMMENT ON COLUMN public.patients.date_of_birth IS
'Optional date of birth. Age is stored separately and remains the value shown across the app.';
