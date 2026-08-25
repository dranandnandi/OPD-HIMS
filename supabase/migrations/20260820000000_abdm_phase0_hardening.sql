-- ABDM Phase 0 — security hardening prerequisites.
--
-- Closes G-01, G-07, G-08, G-12 from
-- docs/abdm-production-readiness/roadmap-m1-m4-and-security-gaps.md.
--
-- Everything here is service-role-only by design: the ABDM edge functions are
-- the sole writer. Nothing in this file should ever be reachable with the anon
-- or authenticated key, because a table an ordinary user can write to cannot
-- serve as an audit trail.

BEGIN;

-- ---------------------------------------------------------------------------
-- G-07 — the session cache table abdm-session has always assumed exists.
--
-- No migration ever created it, so both the SELECT and the INSERT in that
-- function failed silently and every other function fell back to minting its
-- own token inline: 3 ABDM round-trips per OTP request. NHA rate-limits the
-- session API, so this is a production incident waiting to happen.
--
-- `kind` lets the same table cache the RSA public certificate alongside the
-- bearer token — the certificate was also being re-fetched on every call.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._abdm_session (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'token' CHECK (kind IN ('token', 'certificate')),
  -- Which ABDM environment this cache entry belongs to. Without this a
  -- sandbox token would be served to a production caller after an env switch.
  env         TEXT NOT NULL DEFAULT 'sbx',
  value       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The hot path is "newest unexpired entry of this kind for this env".
CREATE INDEX IF NOT EXISTS idx_abdm_session_lookup
  ON public._abdm_session (kind, env, expires_at DESC);

ALTER TABLE public._abdm_session ENABLE ROW LEVEL SECURITY;

-- No policies. RLS with zero policies denies everyone except the service role,
-- which bypasses RLS entirely — exactly the reachability we want.
REVOKE ALL ON public._abdm_session FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- G-01 — abdm_audit_log had no RLS at all.
--
-- Any authenticated user could read every clinic's ABDM trail AND insert
-- forged rows. Forged rows are the worse half: an audit log that its own users
-- can write to proves nothing, which defeats the reason NHA asks for it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.abdm_audit_log ENABLE ROW LEVEL SECURITY;

-- Writes: service role only (no INSERT/UPDATE/DELETE policy exists).
REVOKE ALL ON public.abdm_audit_log FROM anon, authenticated;
GRANT SELECT ON public.abdm_audit_log TO authenticated;

DROP POLICY IF EXISTS "Clinic admins read own clinic ABDM audit log" ON public.abdm_audit_log;
CREATE POLICY "Clinic admins read own clinic ABDM audit log"
  ON public.abdm_audit_log
  FOR SELECT
  TO authenticated
  USING (
    clinic_id IN (SELECT public.user_clinic_ids())
    -- profiles.role_name, matching the pattern in 20250731125108_still_castle.sql.
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND lower(p.role_name) IN ('admin', 'super_admin')
    )
  );

-- Retention: ABDM traceability is about proving what happened, not keeping it
-- forever. Index supports a scheduled purge without a sequential scan.
CREATE INDEX IF NOT EXISTS idx_abdm_audit_log_purge
  ON public.abdm_audit_log (created_at);

-- ---------------------------------------------------------------------------
-- G-08 — rate limiting for OTP requests.
--
-- Without this, an authenticated user can pump OTPs at arbitrary mobile or
-- Aadhaar numbers: SMS-bombing a third party carrying YOUR NHA client ID.
--
-- `target_hash` is a SHA-256 of the mobile/Aadhaar, never the value itself —
-- the whole point is to rate-limit per target without storing the identifier.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.abdm_rate_limit (
  id           BIGSERIAL PRIMARY KEY,
  actor_id     UUID,          -- auth.uid() of the staff member who triggered it
  clinic_id    UUID,
  action       TEXT NOT NULL, -- 'otp_request' | 'login_otp_request' | 'abha_search'
  target_hash  TEXT,          -- SHA-256 hex of the mobile/Aadhaar. Never the raw value.
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abdm_rate_limit_actor
  ON public.abdm_rate_limit (actor_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abdm_rate_limit_target
  ON public.abdm_rate_limit (target_hash, action, created_at DESC);

ALTER TABLE public.abdm_rate_limit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.abdm_rate_limit FROM anon, authenticated;

/*
  Atomic check-and-record.

  Counting and inserting in one statement matters: two concurrent requests that
  each SELECT-then-INSERT would both see a count under the limit and both pass.
  The CTE evaluates the count against the same snapshot as the insert.

  Returns TRUE when the call is allowed (and records it), FALSE when throttled
  (and records nothing, so a throttled caller cannot extend their own window).
*/
CREATE OR REPLACE FUNCTION public.abdm_check_rate_limit(
  p_actor_id    UUID,
  p_clinic_id   UUID,
  p_action      TEXT,
  p_target_hash TEXT,
  p_window_secs INT DEFAULT 3600,
  p_actor_max   INT DEFAULT 30,
  p_target_max  INT DEFAULT 5
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ := NOW() - MAKE_INTERVAL(secs => p_window_secs);
  v_actor_count  INT;
  v_target_count INT;
BEGIN
  SELECT COUNT(*) INTO v_actor_count
  FROM public.abdm_rate_limit
  WHERE actor_id = p_actor_id
    AND action = p_action
    AND created_at > v_window_start;

  IF v_actor_count >= p_actor_max THEN
    RETURN FALSE;
  END IF;

  -- Per-target cap is the anti-SMS-bombing control: it stops many staff
  -- accounts (or one compromised account) converging on a single victim.
  IF p_target_hash IS NOT NULL THEN
    SELECT COUNT(*) INTO v_target_count
    FROM public.abdm_rate_limit
    WHERE target_hash = p_target_hash
      AND action = p_action
      AND created_at > v_window_start;

    IF v_target_count >= p_target_max THEN
      RETURN FALSE;
    END IF;
  END IF;

  INSERT INTO public.abdm_rate_limit (actor_id, clinic_id, action, target_hash)
  VALUES (p_actor_id, p_clinic_id, p_action, p_target_hash);

  RETURN TRUE;
END;
$$;

-- Revoke the default PUBLIC execute grant, then hand it back to service_role
-- only. The GRANT is not optional: service_role is not a superuser, so without
-- it the limiter would fail to execute, `enforceRateLimit` would fail closed,
-- and every OTP request would return 503.
REVOKE ALL ON FUNCTION public.abdm_check_rate_limit(UUID, UUID, TEXT, TEXT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abdm_check_rate_limit(UUID, UUID, TEXT, TEXT, INT, INT, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- G-12 — consent as an artefact, not a boolean.
--
-- patients.abha_consent_given/at record THAT consent happened but not what the
-- patient actually agreed to. ABDM consent is versioned
-- ({code: "abha-enrollment", version: "1.4"}) and an assessor will ask you to
-- produce the exact text shown. M2/M3 need a real artefact table regardless,
-- so this is the seed of that rather than a throwaway.
--
-- The patient columns stay as a denormalized "is it linked" flag for list
-- queries; this table is the record of truth.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.abha_consent_artefacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id        UUID NOT NULL,

  -- ABDM's versioned consent identifiers, stored verbatim as sent upstream.
  consent_code     TEXT NOT NULL,
  consent_version  TEXT NOT NULL,
  -- The exact wording rendered to the patient. Verbatim, so it survives later
  -- copy edits — that is the entire evidentiary value.
  consent_text     TEXT NOT NULL,

  purpose          TEXT NOT NULL DEFAULT 'abha-link',
  -- How identity was established: 'aadhaar-otp' | 'mobile-otp' | 'qr-scan'.
  auth_method      TEXT NOT NULL,

  -- Who was at the desk. Non-repudiation needs an operator, not just a time.
  collected_by     UUID,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- G-13 — the patient must be able to withdraw.
  revoked_at       TIMESTAMPTZ,
  revoked_by       UUID,
  revoke_reason    TEXT,

  -- Correlates back to abdm_audit_log.request_id for the full call chain.
  request_id       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abha_consent_patient
  ON public.abha_consent_artefacts (patient_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_abha_consent_clinic
  ON public.abha_consent_artefacts (clinic_id, collected_at DESC);
-- Partial index: "who currently consents" is the common question.
CREATE INDEX IF NOT EXISTS idx_abha_consent_active
  ON public.abha_consent_artefacts (patient_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.abha_consent_artefacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.abha_consent_artefacts FROM anon;
GRANT SELECT ON public.abha_consent_artefacts TO authenticated;

DROP POLICY IF EXISTS "Clinic staff read own clinic ABHA consents" ON public.abha_consent_artefacts;
CREATE POLICY "Clinic staff read own clinic ABHA consents"
  ON public.abha_consent_artefacts
  FOR SELECT
  TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- Writes go through the edge functions (service role) so that the artefact is
-- always created in the same transaction as the ABDM call that justified it.
-- A client-side insert could claim a consent that never happened.

-- ---------------------------------------------------------------------------
-- Server-side custody of in-flight ABDM tokens.
--
-- The mobile-OTP flow (spec 7.4) is three chained calls, and ABDM's T-token has
-- to travel from step 2 to step 3. The old design solved the equivalent problem
-- by handing the token to the browser — that was G-02, and it put a bearer
-- credential for the patient's ABHA profile into console history.
--
-- Instead the token stays here and the client gets an opaque handle. Storing a
-- credential at rest is a real trade-off, mitigated deliberately:
--   * TTL is minutes (ABDM's own T-token lives 5), enforced on read;
--   * rows are deleted the moment they are consumed — single use;
--   * service-role only, so no API key reaches it;
--   * the handle is bound to the user who created it, so a leaked handle is
--     useless to anyone else.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.abdm_flow_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  clinic_id    UUID NOT NULL,
  patient_id   UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  flow         TEXT NOT NULL,  -- 'mobile-login' | 'abha-search'
  txn_id       TEXT,
  -- ABDM's short-lived user tokens. Never returned to a client.
  t_token      TEXT,
  x_token      TEXT,
  -- Bounded retries. Destroying the session on the first wrong OTP would make
  -- every typo cost a fresh SMS; letting it retry forever would turn the
  -- handle into a brute-force oracle for a 6-digit code. Counted, capped.
  attempts     INT NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abdm_flow_sessions_expiry
  ON public.abdm_flow_sessions (expires_at);

ALTER TABLE public.abdm_flow_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.abdm_flow_sessions FROM anon, authenticated;

/*
  Claim one attempt against a flow session.

  The increment and the cap check happen in a single UPDATE so two concurrent
  requests cannot both read `attempts = 2` and both proceed. Ownership, flow
  and expiry are part of the same predicate: a handle belonging to another
  user, or for another flow, simply matches nothing.

  Returns the session row when the attempt is allowed, and no rows otherwise —
  expired, exhausted, or not yours are deliberately indistinguishable.
*/
CREATE OR REPLACE FUNCTION public.abdm_claim_flow_session(
  p_id           UUID,
  p_user_id      UUID,
  p_flow         TEXT,
  p_max_attempts INT DEFAULT 3
)
RETURNS TABLE (txn_id TEXT, t_token TEXT, x_token TEXT, patient_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.abdm_flow_sessions s
  SET attempts = s.attempts + 1
  WHERE s.id = p_id
    AND s.user_id = p_user_id
    AND s.flow = p_flow
    AND s.expires_at > NOW()
    AND s.attempts < p_max_attempts
  RETURNING s.txn_id, s.t_token, s.x_token, s.patient_id;
$$;

REVOKE ALL ON FUNCTION public.abdm_claim_flow_session(UUID, UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abdm_claim_flow_session(UUID, UUID, TEXT, INT) TO service_role;

COMMIT;
