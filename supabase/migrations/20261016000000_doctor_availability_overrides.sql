-- Date-specific overrides to a doctor's weekly availability.
--
-- The weekly pattern in profiles.doctor_availability stays the default. A row
-- here replaces that pattern for ONE doctor on ONE calendar date: shorter hours
-- ("17 Oct: 11:00-13:00 only"), a full-day leave (is_open = false), or an extra
-- open day on a normally closed weekday. Deleting the row reverts the date to
-- the weekly schedule. Consumed by the public-booking and hims-get-slots edge
-- functions and by the in-app slot/warning logic.
--
-- Times are "HH:MM" clinic-local text, the same convention as the
-- doctor_availability JSONB, so every consumer parses one format.

CREATE TABLE IF NOT EXISTS public.doctor_availability_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  override_date date NOT NULL,
  is_open boolean NOT NULL DEFAULT true,
  start_time text,
  end_time text,
  break_start text,
  break_end text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One override per doctor per date; saving again replaces it (upsert target).
  CONSTRAINT doctor_availability_overrides_unique UNIQUE (doctor_id, override_date),

  CONSTRAINT doctor_availability_overrides_time_format CHECK (
    (start_time IS NULL OR start_time ~ '^([01]?\d|2[0-3]):[0-5]\d$') AND
    (end_time IS NULL OR end_time ~ '^([01]?\d|2[0-3]):[0-5]\d$') AND
    (break_start IS NULL OR break_start ~ '^([01]?\d|2[0-3]):[0-5]\d$') AND
    (break_end IS NULL OR break_end ~ '^([01]?\d|2[0-3]):[0-5]\d$')
  ),

  -- An open override must say when; a closed one needs no times.
  CONSTRAINT doctor_availability_overrides_open_times CHECK (
    is_open = false OR (start_time IS NOT NULL AND end_time IS NOT NULL)
  )
);

-- Slot generation looks up (clinic, doctor, date); the settings screen lists a
-- doctor's upcoming rows. One index serves both.
CREATE INDEX IF NOT EXISTS idx_doctor_availability_overrides_lookup
  ON public.doctor_availability_overrides (clinic_id, doctor_id, override_date);

ALTER TABLE public.doctor_availability_overrides ENABLE ROW LEVEL SECURITY;

-- Same clinic-isolation shape as waiting_sequences. The public booking page
-- never touches this table directly: the edge functions read it with the
-- service role, exactly like doctor_availability itself.
CREATE POLICY "doctor_availability_overrides_clinic_isolation"
  ON public.doctor_availability_overrides
  USING (
    clinic_id IN (
      SELECT id FROM clinic_settings
      WHERE id = (
        SELECT clinic_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

COMMENT ON TABLE public.doctor_availability_overrides IS
'Per-date replacement of a doctor''s weekly availability. is_open=false blocks the whole day; is_open=true with start/end (and optional break) replaces that date''s hours. Absence of a row means the weekly pattern applies. Past rows are purged opportunistically by the app.';
