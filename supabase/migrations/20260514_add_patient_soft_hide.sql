ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS hidden_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_patients_clinic_visible_created
ON public.patients (clinic_id, is_hidden, created_at DESC);
