-- Public self-booking (Phase 1, no OTP).
--
-- Patients open a public URL like https://opdapp.anprohealthtech.com/book/meditrust
-- (or the vanity form https://docpreneur.academy/meditrust/appointment, which is a
-- proxy rewrite to the same route), pick a doctor and a free slot, and book without
-- logging in. All reads/writes go through the `public-booking` edge function using
-- the service role -- exactly the trust-boundary pattern already used by
-- `patient-upload` and `verify-prescription`. No `anon` RLS policy is added here,
-- because nothing public touches these tables directly.

-- ---------------------------------------------------------------------------
-- 1. Clinic public identity + booking policy
-- ---------------------------------------------------------------------------

ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS public_slug text,
  ADD COLUMN IF NOT EXISTS public_booking_enabled boolean NOT NULL DEFAULT false;

-- Lowercase, URL-safe, 2-41 chars. Enforced NOT VALID first so existing rows
-- (all NULL at this point) can never block the deploy, then validated.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clinic_settings_public_slug_format'
      AND conrelid = 'public.clinic_settings'::regclass
  ) THEN
    ALTER TABLE public.clinic_settings
      ADD CONSTRAINT clinic_settings_public_slug_format
      CHECK (public_slug IS NULL OR public_slug ~ '^[a-z0-9][a-z0-9-]{1,40}$')
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.clinic_settings
  VALIDATE CONSTRAINT clinic_settings_public_slug_format;

-- Slug uniqueness is case-insensitive: /book/MediTrust and /book/meditrust must
-- never resolve to two different clinics.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_settings_public_slug
  ON public.clinic_settings (lower(public_slug))
  WHERE public_slug IS NOT NULL;

COMMENT ON COLUMN public.clinic_settings.public_slug IS
'URL segment for the public self-booking page, e.g. "meditrust" -> /book/meditrust. Case-insensitively unique across all clinics.';

COMMENT ON COLUMN public.clinic_settings.public_booking_enabled IS
'Master switch for public self-booking. When false the public page 404s exactly like an unknown slug (no clinic enumeration).';

-- `appointment_config` already exists on clinic_settings and is referenced
-- nowhere in the codebase, so it becomes the public-booking policy blob:
--   {
--     "leadTimeHours":      2,      -- earliest bookable slot, hours from now
--     "horizonDays":        14,     -- how far ahead the date strip runs
--     "maxPerPhonePerDay":  3,      -- abuse cap per phone number per day
--     "autoConfirm":        false,  -- false => lands as 'Scheduled' for reception
--     "allowedTypeLabels":  null,   -- null = all clinic appointment types
--     "blackoutDates":      [],     -- ["2026-08-15", ...] clinic-local YYYY-MM-DD
--     "noticeText":         ""      -- free text shown on the public page
--   }
-- Defaults live in the edge function, so an empty/absent config is valid.
COMMENT ON COLUMN public.clinic_settings.appointment_config IS
'Public self-booking policy: leadTimeHours, horizonDays, maxPerPhonePerDay, autoConfirm, allowedTypeLabels, blackoutDates, noticeText. Absent keys fall back to edge-function defaults.';

-- ---------------------------------------------------------------------------
-- 2. Appointment provenance
-- ---------------------------------------------------------------------------

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS booking_source text NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS public_ref text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_booking_source_check'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_booking_source_check
      CHECK (booking_source IN ('staff', 'public', 'hims'));
  END IF;
END;
$$;

-- The patient's own handle on the booking: printed on the confirmation screen
-- and used to cancel without an account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_public_ref
  ON public.appointments (public_ref)
  WHERE public_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_booking_source
  ON public.appointments (clinic_id, booking_source)
  WHERE booking_source = 'public';

COMMENT ON COLUMN public.appointments.booking_source IS
'Who created this appointment: staff (front desk), public (patient self-booked), hims (external HIMS sync).';

COMMENT ON COLUMN public.appointments.public_ref IS
'Opaque random reference given to a self-booking patient so they can look up or cancel without logging in.';

-- ---------------------------------------------------------------------------
-- 3. Double-booking guard (public bookings only)
-- ---------------------------------------------------------------------------
-- Until now conflict detection was client-side only (doctorAvailabilityService),
-- which cannot stop two patients hitting the same free slot concurrently.
--
-- The obvious fix -- a unique index on every active (doctor_id,
-- appointment_date) -- is WRONG for this platform. Production already holds 351
-- such pairs across 1230 rows: these clinics deliberately overbook, stacking
-- walk-ins onto the same nominal time. A blanket constraint would break the
-- front desk's normal workflow.
--
-- So the guard is scoped to `booking_source = 'public'`. Two anonymous patients
-- can never take the same slot -- the real race, since both arrive at machine
-- speed from a page showing identical availability -- while staff keep
-- overbooking freely. A public-vs-staff collision stays possible in the
-- millisecond window between the edge function's availability check and its
-- insert; that is caught by the server-side re-derivation, and a slot lost that
-- way surfaces to the patient as "just taken, pick another".
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_no_double_book_public
  ON public.appointments (doctor_id, appointment_date)
  WHERE doctor_id IS NOT NULL
    AND booking_source = 'public'
    AND status IN ('Scheduled', 'Confirmed', 'Arrived', 'In_Progress');

-- Slot lookups scan one doctor's day at a time.
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date
  ON public.appointments (doctor_id, appointment_date);

-- ---------------------------------------------------------------------------
-- 4. Rate limiting
-- ---------------------------------------------------------------------------
-- `api_rate_limits` already exists but is used nowhere. The public booking
-- endpoint is the first consumer: it keys on hashed IP and on phone number.
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_lookup
  ON public.api_rate_limits (identifier, endpoint, window_start DESC);

-- ---------------------------------------------------------------------------
-- 5. Patient lookup for self-booking
-- ---------------------------------------------------------------------------
-- The edge function matches a returning patient on (clinic, phone suffix, name).
CREATE INDEX IF NOT EXISTS idx_patients_clinic_phone
  ON public.patients (clinic_id, phone);
