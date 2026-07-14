-- ============================================================================
-- IPD Migration 024: Transfer notes, blood transfusion workflow,
-- service-linked documents, MLC (medico-legal case) register data
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Transfer log notes (actor/created_by + reasons already exist since 003)
-- ---------------------------------------------------------------------------
ALTER TABLE public.ipd_bed_allocations ADD COLUMN IF NOT EXISTS notes text;

-- ---------------------------------------------------------------------------
-- 2. Blood transfusion requests: demand → received → cross-checked → given,
--    each step stamped with actor + time; ipd_blood_events is the full audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_blood_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  component text NOT NULL DEFAULT 'prbc'
    CHECK (component IN ('whole_blood', 'prbc', 'ffp', 'platelets', 'cryoprecipitate')),
  blood_group text,
  units integer NOT NULL DEFAULT 1 CHECK (units > 0),
  urgency text NOT NULL DEFAULT 'routine'
    CHECK (urgency IN ('routine', 'urgent', 'emergency')),
  indication text,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'received', 'cross_checked', 'transfused', 'cancelled')),
  -- demand
  requested_by uuid REFERENCES public.profiles(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  -- came (blood bank issue received on ward)
  received_by uuid REFERENCES public.profiles(id),
  received_at timestamptz,
  bag_number text,
  blood_bank text,
  -- check (bedside cross-match / identity verification)
  checked_by uuid REFERENCES public.profiles(id),
  checked_at timestamptz,
  -- given + signed (administering nurse + witness double-signature)
  transfused_by uuid REFERENCES public.profiles(id),
  witnessed_by uuid REFERENCES public.profiles(id),
  transfused_at timestamptz,
  reaction boolean NOT NULL DEFAULT false,
  reaction_notes text,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ipd_blood_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.ipd_blood_requests(id) ON DELETE CASCADE,
  event text NOT NULL,
  actor_id uuid REFERENCES public.profiles(id),
  event_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_blood_requests_admission
  ON public.ipd_blood_requests (admission_id);
CREATE INDEX IF NOT EXISTS idx_blood_requests_clinic_status
  ON public.ipd_blood_requests (clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_blood_events_request
  ON public.ipd_blood_events (request_id);

-- ---------------------------------------------------------------------------
-- 3. Service-linked documents: a service can name its document template
--    (surgery → OT note / consent); generated docs remember which posting
--    they were created for.
-- ---------------------------------------------------------------------------
ALTER TABLE public.services_master
  ADD COLUMN IF NOT EXISTS document_template_id uuid
  REFERENCES public.ipd_document_templates(id) ON DELETE SET NULL;

ALTER TABLE public.ipd_documents
  ADD COLUMN IF NOT EXISTS charge_posting_id uuid
  REFERENCES public.charge_postings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_charge_posting
  ON public.ipd_documents (charge_posting_id) WHERE charge_posting_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. MLC register details (admission.is_mlc/mlc_number exist since 003;
--    the police/incident particulars live here, one row per MLC admission)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_mlc_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL UNIQUE REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  incident_datetime timestamptz,
  incident_place text,
  incident_description text,
  brought_by text,
  injuries_description text,
  alcohol_suspected boolean NOT NULL DEFAULT false,
  police_station text,
  fir_number text,
  police_informed_at timestamptz,
  informed_officer text,
  belongings text,
  identification_marks text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mlc_details_clinic ON public.ipd_mlc_details (clinic_id);

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.ipd_blood_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_blood_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_mlc_details ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ipd_blood_requests', 'ipd_blood_events', 'ipd_mlc_details'] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))', t);
    EXECUTE format(
      'CREATE POLICY tenant_write ON public.%I FOR ALL TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))
         WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()))', t);
  END LOOP;
END $$;

COMMIT;
