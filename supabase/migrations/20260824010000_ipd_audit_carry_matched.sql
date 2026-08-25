-- Discharge could become impossible once a finding was resolved as "Already
-- matched": that classification was not carried into the next run, so every
-- fresh discharge audit resurrected the same finding as unresolved and the
-- discharge guard rejected the discharge forever.
--
-- "Already matched" is a human classification (the documented item is billed
-- under another line/date), exactly like package/non_chargeable — so it is now
-- carried forward too. Only 'charged' stays out: it asserts a posting exists,
-- which the fresh run re-verifies against charge_postings.
BEGIN;

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
  -- Carry forward human classifications tied to the same source row and service.
  WITH prior AS (
    SELECT DISTINCT ON (f.source_table,f.source_id,f.service_id)
      f.source_table,f.source_id,f.service_id,f.status,f.resolution_reason,f.resolved_by,f.resolved_at
    FROM ipd_billing_audit_findings f
    WHERE f.admission_id=r.admission_id AND f.audit_run_id<>r.id
      AND f.status IN ('matched','package','non_chargeable','not_performed','duplicate','ignored')
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

GRANT EXECUTE ON FUNCTION public.complete_ipd_billing_audit(uuid,jsonb) TO authenticated;
COMMIT;
