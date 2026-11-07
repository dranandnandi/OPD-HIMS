BEGIN;

-- No default: historical walk-ins cannot safely be called new or follow-up.
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS visit_type text;
ALTER TABLE public.visits ADD CONSTRAINT visits_visit_type_check
  CHECK (visit_type IN ('new', 'follow_up', 'emergency'));

CREATE FUNCTION public.classify_visit_appointment_type(value text, configured_types jsonb DEFAULT '[]'::jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  normalized text := lower(regexp_replace(value, '[[:space:]_-]+', '', 'g'));
  configured_id text;
BEGIN
  CASE normalized
    WHEN 'new', 'newvisit', 'newconsultation', 'consultation' THEN RETURN 'new';
    WHEN 'followup', 'followupvisit' THEN RETURN 'follow_up';
    WHEN 'emergency', 'emergencyvisit' THEN RETURN 'emergency';
    ELSE NULL;
  END CASE;

  SELECT lower(regexp_replace(item->>'id', '[[:space:]_-]+', '', 'g'))
  INTO configured_id
  FROM jsonb_array_elements(COALESCE(configured_types, '[]'::jsonb)) item
  WHERE lower(regexp_replace(item->>'label', '[[:space:]_-]+', '', 'g')) = normalized
     OR lower(regexp_replace(item->>'id', '[[:space:]_-]+', '', 'g')) = normalized
  LIMIT 1;
  CASE configured_id
    WHEN 'new', 'newvisit', 'newconsultation', 'consultation' THEN RETURN 'new';
    WHEN 'followup', 'followupvisit' THEN RETURN 'follow_up';
    WHEN 'emergency', 'emergencyvisit' THEN RETURN 'emergency';
    ELSE RETURN NULL;
  END CASE;
END;
$$;

-- Use only linked appointment evidence from the same clinic and patient.
UPDATE public.visits v
SET visit_type = public.classify_visit_appointment_type(a.appointment_type::text, c.appointment_types)
FROM public.appointments a
JOIN public.clinic_settings c ON c.id = a.clinic_id
WHERE v.appointment_id = a.id AND v.clinic_id = a.clinic_id
  AND v.patient_id = a.patient_id AND v.visit_type IS NULL;

-- Also cover other visit writers; never overwrite an explicit classification.
CREATE FUNCTION public.prefill_visit_type_from_appointment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.visit_type IS NULL AND NEW.appointment_id IS NOT NULL THEN
    SELECT public.classify_visit_appointment_type(a.appointment_type::text, c.appointment_types)
    INTO NEW.visit_type
    FROM public.appointments a
    JOIN public.clinic_settings c ON c.id = a.clinic_id
    WHERE a.id = NEW.appointment_id AND a.clinic_id = NEW.clinic_id
      AND a.patient_id = NEW.patient_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER visits_prefill_visit_type
BEFORE INSERT ON public.visits
FOR EACH ROW EXECUTE FUNCTION public.prefill_visit_type_from_appointment();

CREATE INDEX visits_clinic_type_date_idx ON public.visits (clinic_id, visit_type, date);
COMMENT ON COLUMN public.visits.visit_type IS
  'Encounter category: new, follow_up, emergency. NULL = unclassified historical/custom encounter. Independent of next follow-up date and pricing.';

COMMIT;
