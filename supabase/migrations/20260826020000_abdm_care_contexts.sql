-- ============================================================================
-- M2 foundation: care contexts and linking tokens.
--
-- A "care context" is ABDM's unit of shareable health data — one visit, one
-- admission, one lab report. Everything in M2/M3 is expressed in terms of them:
-- linking announces them, discovery finds them, consent authorises them, and
-- data flow transmits them.
--
-- The app already HAS the clinical data (visits, admissions, orders). What it
-- has never had is a stable ABDM-facing identity for each one. That is all this
-- table is: a durable mapping between our row and the reference we told ABDM.
--
-- Why a separate table rather than columns on `visits`:
--
--  1. **Care contexts can never be unlinked** (FAQ v1.4 Q33). Once announced,
--     the reference we sent is permanent — deleting or editing a visit must not
--     silently orphan or change it. A separate row makes that boundary explicit.
--  2. One clinical event can map to several HI types (a visit yields an
--     OPConsultation AND a Prescription), each its own care context.
--  3. Admissions, lab orders and visits all become care contexts, so the
--     mapping is polymorphic and does not belong on any one table.
--
-- Safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Linking tokens (M2 spec 4.3.1).
--
-- A link token is issued per (ABHA address x facility) and is valid for SIX
-- MONTHS. Generating one is rate limited: more than three requests for the same
-- ABHA address from the same facility in a day returns "You are blocked for 24
-- hours" (FAQ Q31). So this MUST be cached and reused — calling it per visit
-- would lock the clinic out of linking for a day.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.abdm_link_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL,
  patient_id    UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  abha_address  TEXT NOT NULL,
  -- Whether the ABHA *number* was sent when this token was generated. Spec
  -- 4.3.3 / FAQ Q32: if it was, it must also be sent on link/carecontext, and
  -- if it was not, it must not. Recording the choice keeps the two consistent.
  abha_number   TEXT,
  link_token    TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The hot path: "do we already hold a live token for this ABHA at this clinic?"
CREATE INDEX IF NOT EXISTS idx_abdm_link_tokens_lookup
  ON public.abdm_link_tokens (clinic_id, abha_address, expires_at DESC);

ALTER TABLE public.abdm_link_tokens ENABLE ROW LEVEL SECURITY;
-- Service role only. A link token authenticates US as the HIP for a patient;
-- it is not a value any browser has a reason to hold. Same posture as
-- _abdm_session: RLS on, zero policies.
REVOKE ALL ON public.abdm_link_tokens FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Care contexts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.abdm_care_contexts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID NOT NULL,
  patient_id          UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,

  -- What this care context is derived from. Polymorphic on purpose: a visit,
  -- an admission and a lab order are all legitimate sources.
  source_type         TEXT NOT NULL CHECK (source_type IN ('visit', 'admission', 'lab_order', 'document')),
  source_id           UUID NOT NULL,

  -- The reference ABDM knows this by. PERMANENT once linked — care contexts
  -- cannot be unlinked or renamed (FAQ Q33), so this value must never be
  -- regenerated for the same clinical event.
  reference_number    TEXT NOT NULL,
  -- Human-readable label shown in the patient's ABHA app, e.g.
  -- "OPD Consultation - 12 Aug 2026". This is patient-facing.
  display             TEXT NOT NULL,

  -- One of ABDM's eight HI types. An HMIS must support all eight for
  -- certification (FAQ Q2).
  hi_type             TEXT NOT NULL CHECK (hi_type IN (
                        'Prescription', 'DiagnosticReport', 'OPConsultation',
                        'DischargeSummary', 'ImmunizationRecord',
                        'HealthDocumentRecord', 'WellnessRecord', 'Invoice')),

  abha_address        TEXT NOT NULL,

  -- Lifecycle. 'pending' exists because linking is asynchronous: we announce a
  -- care context and ABDM confirms on a callback, which may never arrive.
  -- Without this, a failed link is indistinguishable from a successful one.
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'linked', 'failed')),
  linked_at           TIMESTAMPTZ,
  link_request_id     UUID,
  error_message       TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One care context per (clinical event x HI type). A visit legitimately yields
-- both an OPConsultation and a Prescription; it must not yield two of either.
-- This is the guard against announcing a duplicate to ABDM, which answers
-- ABDM-1090 "Duplicate HIP link request".
CREATE UNIQUE INDEX IF NOT EXISTS idx_abdm_care_contexts_unique
  ON public.abdm_care_contexts (source_type, source_id, hi_type);

CREATE INDEX IF NOT EXISTS idx_abdm_care_contexts_patient
  ON public.abdm_care_contexts (patient_id, status);

-- Discovery matches an incoming ABHA address to everything we hold for it.
CREATE INDEX IF NOT EXISTS idx_abdm_care_contexts_abha
  ON public.abdm_care_contexts (clinic_id, abha_address, status);

ALTER TABLE public.abdm_care_contexts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.abdm_care_contexts FROM anon, authenticated;
GRANT SELECT ON public.abdm_care_contexts TO authenticated;

-- Read-only for clinic staff: the desk needs to see what has been shared with
-- ABDM for a patient. Writes stay service-role, because a care context is a
-- claim made to a national registry, not app state a user may edit.
DROP POLICY IF EXISTS "Clinic staff read own clinic care contexts" ON public.abdm_care_contexts;
CREATE POLICY "Clinic staff read own clinic care contexts"
  ON public.abdm_care_contexts
  FOR SELECT
  TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

COMMIT;
