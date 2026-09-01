-- Run BY HAND in the Mumbai SQL editor (kiezgfhonvwryxpubfvl).
-- NEVER `supabase db push` — schema_migrations on Mumbai is empty and a push
-- would replay ~110 migrations against a populated database.
--
-- Order matters: the constraint must be relaxed before the 17-character
-- hipName can be written.

-- 1. Apply 20260901000000_hip_name_length.sql first, then:

UPDATE public.clinic_settings
SET hfr_facility_id   = 'IN2410002622',
    abdm_hip_id       = 'IN2410002622',   -- confirmed 2026-09-01, no longer provisional
    abdm_hip_name     = 'Meditrust Clinics',
    abdm_counter_code = COALESCE(abdm_counter_code, '1')
WHERE id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30';

-- 2. Verify — expect exactly one row, all four values populated.
SELECT id, clinic_name, hfr_facility_id, abdm_hip_id, abdm_hip_name, abdm_counter_code
FROM public.clinic_settings
WHERE id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30';
