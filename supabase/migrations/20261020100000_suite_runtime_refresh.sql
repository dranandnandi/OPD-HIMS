-- Central project only, after operations and invitations. Local preparation.
-- Ready products receive periodic snapshots before their five-minute mirror expires.
-- Refresh reuses the same job/version; it never resets trial dates or grants.
BEGIN;
CREATE OR REPLACE FUNCTION public.suite_pending_jobs(p_products text[],p_limit integer DEFAULT 4) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (
    SELECT j.organization_id,j.product_code FROM suite_jobs j
    JOIN suite_bindings b USING(organization_id,product_code,version)
    WHERE j.product_code=ANY(p_products) AND (j.state<>'done' OR (b.state='ready' AND j.updated_at<=now()-interval '3 minutes')) AND j.next_attempt_at<=now()
      AND NOT EXISTS(SELECT 1 FROM suite_jobs running WHERE running.organization_id=j.organization_id
        AND running.product_code=j.product_code AND running.state='running' AND running.lease_until>now())
    ORDER BY j.next_attempt_at,j.created_at LIMIT greatest(0,least(p_limit,4))
  ) q
$$;

CREATE OR REPLACE FUNCTION public.suite_claim_job(p_org uuid,p_product text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_job suite_jobs; v_binding suite_bindings; v_org suite_organizations; v_lease uuid:=gen_random_uuid();
BEGIN
  SELECT * INTO v_org FROM suite_organizations WHERE id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organisation not found'; END IF;
  SELECT * INTO v_binding FROM suite_bindings WHERE organization_id=p_org AND product_code=p_product FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not included'; END IF;
  IF EXISTS(SELECT 1 FROM suite_jobs WHERE organization_id=p_org AND product_code=p_product AND state='running' AND lease_until>now()) THEN
    RAISE EXCEPTION 'Product synchronisation is already running';
  END IF;
  SELECT * INTO v_job FROM suite_jobs WHERE organization_id=p_org AND product_code=p_product AND version=v_binding.version FOR UPDATE;
  IF v_job.state='done' AND v_job.updated_at>now()-interval '3 minutes' THEN RETURN NULL; END IF;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'No provisioning job exists'; END IF;
  UPDATE suite_jobs SET state='running',attempts=attempts+1,lease_id=v_lease,lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=v_job.id;
  RETURN jsonb_build_object('job_id',v_job.id,'lease_id',v_lease,'version',v_binding.version,
    'organization_id',p_org,'product_code',p_product,'local_tenant_id',v_binding.local_tenant_id,
    'organization',to_jsonb(v_org),'members',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM suite_memberships m WHERE organization_id=p_org),'[]'),
    'trial',(SELECT to_jsonb(t) FROM suite_product_trials t WHERE organization_id=p_org AND product_code=p_product),
    'grants',coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM suite_access_grants g WHERE organization_id=p_org AND product_code=p_product AND ends_at>now() AND revoked_at IS NULL),'[]'),
    'messaging_routes',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM suite_messaging_routes r WHERE organization_id=p_org AND product_code=p_product),'[]'),
    'issued_at',now(),'refresh_by',now()+interval '5 minutes','contract','suite.access.v1');
END;
$$;
REVOKE ALL ON FUNCTION public.suite_pending_jobs(text[],integer),public.suite_claim_job(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suite_pending_jobs(text[],integer),public.suite_claim_job(uuid,text) TO service_role;
COMMIT;
