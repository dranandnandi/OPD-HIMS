-- Persisted clinical-note billing audits and server-side discharge guard.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ipd_billing_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  run_type text NOT NULL CHECK (run_type IN ('manual','discharge')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  notes_through timestamptz NOT NULL DEFAULT now(),
  findings_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);

CREATE TABLE IF NOT EXISTS public.ipd_billing_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id uuid NOT NULL REFERENCES public.ipd_billing_audit_runs(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  source_table text NOT NULL CHECK (source_table IN ('ipd_treatment_plans','ipd_nursing_notes')),
  source_id uuid NOT NULL,
  source_date date NOT NULL,
  source_excerpt text,
  service_id uuid NOT NULL REFERENCES public.services_master(id),
  service_name text NOT NULL,
  documented_quantity numeric NOT NULL DEFAULT 1 CHECK (documented_quantity > 0),
  charged_quantity numeric NOT NULL DEFAULT 0 CHECK (charged_quantity >= 0),
  status text NOT NULL DEFAULT 'unresolved'
    CHECK (status IN ('unresolved','charged','matched','package','non_chargeable','not_performed','duplicate','ignored')),
  resolution_reason text,
  resolved_by uuid REFERENCES public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One backend-managed AI configuration per clinic. There is intentionally no
-- client write policy or UI; safety instructions remain fixed in the function.
CREATE TABLE IF NOT EXISTS public.ipd_billing_audit_ai_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL UNIQUE REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  additional_instructions text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT 'claude-haiku-4-5'
    CHECK (model IN ('claude-haiku-4-5','claude-sonnet-4-5')),
  max_output_tokens integer NOT NULL DEFAULT 4096 CHECK (max_output_tokens BETWEEN 1024 AND 8192),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipd_audit_runs_admission
  ON public.ipd_billing_audit_runs(admission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipd_audit_findings_open
  ON public.ipd_billing_audit_findings(admission_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ipd_billing_audit_ai_config_clinic
  ON public.ipd_billing_audit_ai_config(clinic_id);

ALTER TABLE public.ipd_billing_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_billing_audit_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_billing_audit_ai_config ENABLE ROW LEVEL SECURITY;

-- Same clinic isolation pattern used by the IPD module. Mutations are performed
-- through the RPCs below, so clients only need SELECT/UPDATE on resolutions.
DROP POLICY IF EXISTS ipd_audit_runs_clinic ON public.ipd_billing_audit_runs;
DROP POLICY IF EXISTS ipd_audit_findings_clinic ON public.ipd_billing_audit_findings;
DROP POLICY IF EXISTS ipd_audit_ai_config_read ON public.ipd_billing_audit_ai_config;
CREATE POLICY ipd_audit_runs_clinic ON public.ipd_billing_audit_runs
  FOR SELECT TO authenticated USING (clinic_id IN (SELECT public.user_clinic_ids()));
CREATE POLICY ipd_audit_findings_clinic ON public.ipd_billing_audit_findings
  FOR SELECT TO authenticated USING (clinic_id IN (SELECT public.user_clinic_ids()));
CREATE POLICY ipd_audit_ai_config_read ON public.ipd_billing_audit_ai_config
  FOR SELECT TO authenticated USING (clinic_id IN (SELECT public.user_clinic_ids()));

CREATE OR REPLACE FUNCTION public.begin_ipd_billing_audit(
  p_admission_id uuid, p_run_type text, p_created_by uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_clinic uuid; v_count integer;
BEGIN
  IF p_run_type NOT IN ('manual','discharge') THEN RAISE EXCEPTION 'Invalid audit type'; END IF;
  SELECT clinic_id INTO v_clinic FROM ipd_admissions WHERE id=p_admission_id AND status='admitted' FOR UPDATE;
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'Active admission not found'; END IF;
  IF NOT (v_clinic IN (SELECT public.user_clinic_ids())) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_run_type='manual' THEN
    SELECT count(*) INTO v_count FROM ipd_billing_audit_runs
     WHERE admission_id=p_admission_id AND run_type='manual'
       AND (created_at AT TIME ZONE 'Asia/Kolkata')::date=(now() AT TIME ZONE 'Asia/Kolkata')::date
       AND status <> 'failed';
    IF v_count >= 2 THEN RAISE EXCEPTION 'Maximum 2 manual billing audits allowed per admission per day'; END IF;
  END IF;
  INSERT INTO ipd_billing_audit_runs(clinic_id,admission_id,run_type,created_by)
  VALUES(v_clinic,p_admission_id,p_run_type,p_created_by) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.complete_ipd_billing_audit(p_run_id uuid, p_findings jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r ipd_billing_audit_runs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM ipd_billing_audit_runs WHERE id=p_run_id AND status='running' FOR UPDATE;
  IF r.id IS NULL OR NOT (r.clinic_id IN (SELECT public.user_clinic_ids())) THEN RAISE EXCEPTION 'Audit run not found'; END IF;
  INSERT INTO ipd_billing_audit_findings
    (audit_run_id,clinic_id,admission_id,source_table,source_id,source_date,source_excerpt,
     service_id,service_name,documented_quantity,charged_quantity)
  SELECT r.id,r.clinic_id,r.admission_id,x.source_table,x.source_id,x.source_date,x.source_excerpt,
         x.service_id,x.service_name,x.documented_quantity,x.charged_quantity
    FROM jsonb_to_recordset(COALESCE(p_findings,'[]'::jsonb)) AS x(
      source_table text, source_id uuid, source_date date, source_excerpt text,
      service_id uuid, service_name text, documented_quantity numeric, charged_quantity numeric);
  -- Carry forward only human classifications tied to the same source row and
  -- service. “Charged/matched” is deliberately not carried: billing is checked anew.
  WITH prior AS (
    SELECT DISTINCT ON (f.source_table,f.source_id,f.service_id)
      f.source_table,f.source_id,f.service_id,f.status,f.resolution_reason,f.resolved_by,f.resolved_at
    FROM ipd_billing_audit_findings f
    WHERE f.admission_id=r.admission_id AND f.audit_run_id<>r.id
      AND f.status IN ('package','non_chargeable','not_performed','duplicate','ignored')
    ORDER BY f.source_table,f.source_id,f.service_id,f.resolved_at DESC NULLS LAST
  )
  UPDATE ipd_billing_audit_findings n SET
    status=prior.status,resolution_reason=prior.resolution_reason,
    resolved_by=prior.resolved_by,resolved_at=prior.resolved_at
  FROM prior WHERE n.audit_run_id=r.id AND prior.source_table=n.source_table
    AND prior.source_id=n.source_id AND prior.service_id=n.service_id;
  UPDATE ipd_billing_audit_runs SET status='completed',completed_at=now(),notes_through=now(),
    findings_count=(SELECT count(*) FROM ipd_billing_audit_findings WHERE audit_run_id=r.id AND status='unresolved')
    WHERE id=r.id;
END $$;

CREATE OR REPLACE FUNCTION public.fail_ipd_billing_audit(p_run_id uuid,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE ipd_billing_audit_runs SET status='failed',completed_at=now(),error_message=left(p_error,500)
   WHERE id=p_run_id AND status='running' AND clinic_id IN (SELECT public.user_clinic_ids());
END $$;

CREATE OR REPLACE FUNCTION public.resolve_ipd_billing_audit_finding(
  p_finding_id uuid,p_status text,p_reason text DEFAULT NULL,p_user_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_run uuid;
BEGIN
  IF p_status NOT IN ('charged','matched','package','non_chargeable','not_performed','duplicate','ignored') THEN
    RAISE EXCEPTION 'Invalid resolution'; END IF;
  IF p_status IN ('non_chargeable','not_performed','duplicate','ignored') AND nullif(trim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE ipd_billing_audit_findings SET status=p_status,resolution_reason=p_reason,
    resolved_by=p_user_id,resolved_at=now()
   WHERE id=p_finding_id AND clinic_id IN (SELECT public.user_clinic_ids())
   RETURNING audit_run_id INTO v_run;
  IF NOT FOUND THEN RAISE EXCEPTION 'Finding not found'; END IF;
  UPDATE ipd_billing_audit_runs SET findings_count=(
    SELECT count(*) FROM ipd_billing_audit_findings WHERE audit_run_id=v_run AND status='unresolved'
  ) WHERE id=v_run;
END $$;

-- Prevent every API/code path from bypassing the mandatory fresh discharge audit.
CREATE OR REPLACE FUNCTION public.guard_ipd_discharge_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_run uuid; v_through timestamptz; v_latest_note timestamptz; v_open integer; v_pending integer; v_balance numeric;
BEGIN
  IF OLD.status='admitted' AND NEW.status IN ('discharged','dama','expired','transferred_out') THEN
    SELECT id,notes_through INTO v_run,v_through FROM ipd_billing_audit_runs
     WHERE admission_id=NEW.id AND run_type='discharge' AND status='completed'
     ORDER BY completed_at DESC LIMIT 1;
    SELECT greatest(
      COALESCE((SELECT max(updated_at) FROM ipd_treatment_plans WHERE admission_id=NEW.id AND status='active'),'-infinity'),
      COALESCE((SELECT max(created_at) FROM ipd_nursing_notes WHERE admission_id=NEW.id),'-infinity')
    ) INTO v_latest_note;
    IF v_run IS NULL OR v_through < v_latest_note THEN RAISE EXCEPTION 'A fresh discharge billing audit is required'; END IF;
    SELECT count(*) INTO v_open FROM ipd_billing_audit_findings WHERE audit_run_id=v_run AND status='unresolved';
    SELECT count(*) INTO v_pending FROM charge_postings WHERE admission_id=NEW.id AND status='pending';
    SELECT COALESCE(sum(greatest(balance_amount,0)),0) INTO v_balance FROM ipd_bills WHERE admission_id=NEW.id AND status<>'cancelled';
    IF v_open>0 THEN RAISE EXCEPTION '% billing-audit finding(s) remain unresolved',v_open; END IF;
    IF v_pending>0 THEN RAISE EXCEPTION '% charge(s) remain unbilled',v_pending; END IF;
    IF v_balance>0 THEN RAISE EXCEPTION 'Outstanding bill balance is %',v_balance; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_ipd_discharge_billing ON public.ipd_admissions;
CREATE TRIGGER trg_guard_ipd_discharge_billing BEFORE UPDATE OF status ON public.ipd_admissions
FOR EACH ROW EXECUTE FUNCTION public.guard_ipd_discharge_billing();

CREATE OR REPLACE FUNCTION public.finalize_ipd_discharge(p_admission_id uuid,p_discharge_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_clinic uuid; v_status public.ipd_admission_status_enum; v_now timestamptz:=now();
BEGIN
  IF p_discharge_type NOT IN ('routine','dama','referred','expired','absconded') THEN
    RAISE EXCEPTION 'Invalid discharge type'; END IF;
  SELECT clinic_id INTO v_clinic FROM ipd_admissions
    WHERE id=p_admission_id AND status='admitted' FOR UPDATE;
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'Active admission not found'; END IF;
  IF NOT (v_clinic IN (SELECT public.user_clinic_ids())) THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_status := CASE WHEN p_discharge_type='expired' THEN 'expired'::public.ipd_admission_status_enum
                   WHEN p_discharge_type='dama' THEN 'dama'::public.ipd_admission_status_enum
                   ELSE 'discharged'::public.ipd_admission_status_enum END;
  -- The guard trigger runs here. Any failure rolls back this function, including
  -- the bed-allocation update below.
  UPDATE ipd_admissions SET status=v_status,discharge_datetime=v_now,
    discharge_type=p_discharge_type,current_bed_id=NULL,updated_at=v_now
    WHERE id=p_admission_id;
  UPDATE ipd_bed_allocations SET to_datetime=v_now
    WHERE admission_id=p_admission_id AND to_datetime IS NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.begin_ipd_billing_audit(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ipd_billing_audit(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_ipd_billing_audit(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_ipd_billing_audit_finding(uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_ipd_discharge(uuid,text) TO authenticated;
COMMIT;
