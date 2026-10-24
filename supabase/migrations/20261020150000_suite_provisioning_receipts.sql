-- Central project only, after identity/launch. Record actual adapter-created IDs.
BEGIN;
CREATE FUNCTION public.suite_note_provisioning(p_job uuid,p_lease uuid,p_actor uuid,p_instance uuid,p_tenant text,p_identities jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job suite_jobs;binding suite_bindings;member suite_memberships;identity suite_product_identities;entry jsonb;created integer:=0;
BEGIN
 IF p_actor IS NULL OR p_tenant IS NULL OR length(p_tenant) NOT BETWEEN 1 AND 200 OR jsonb_typeof(p_identities) IS DISTINCT FROM 'array' OR jsonb_array_length(p_identities)>1000 THEN RAISE EXCEPTION 'Valid provisioned identities required'; END IF;
 SELECT * INTO job FROM suite_jobs WHERE id=p_job;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM suite_organizations WHERE id=job.organization_id FOR UPDATE;
 SELECT * INTO job FROM suite_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO binding FROM suite_bindings WHERE organization_id=job.organization_id AND product_code=job.product_code FOR UPDATE;
 IF job.state<>'running' OR job.lease_id IS DISTINCT FROM p_lease OR job.lease_until<=clock_timestamp() OR binding.version<>job.version THEN RETURN false; END IF;
 IF binding.local_tenant_id IS NOT NULL AND binding.local_tenant_id<>p_tenant THEN RAISE EXCEPTION 'Adapter cannot change a linked tenant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM suite_instances WHERE id=p_instance AND component=job.product_code) THEN RAISE EXCEPTION 'Product deployment is not registered'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_identities) LOOP
  SELECT * INTO member FROM suite_memberships WHERE organization_id=job.organization_id AND id=(entry->>'member_id')::uuid AND status='active' AND auth_user_id IS NOT NULL AND role<>'billing';
  IF NOT FOUND OR entry->>'local_user_id' IS NULL OR length(entry->>'local_user_id') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Unknown provisioned member'; END IF;
  IF job.product_code<>'whatsapp' AND entry->>'local_auth_id' IS NULL THEN RAISE EXCEPTION 'Local Auth identity missing'; END IF;
  IF job.product_code='opd' AND (entry->>'local_auth_id')::uuid IS DISTINCT FROM member.auth_user_id THEN RAISE EXCEPTION 'Central OPD identity mismatch'; END IF;
  SELECT * INTO identity FROM suite_product_identities WHERE organization_id=job.organization_id AND product_code=job.product_code AND member_id=member.id;
  IF FOUND THEN
   IF identity.local_user_id<>entry->>'local_user_id' OR identity.local_auth_id IS DISTINCT FROM (entry->>'local_auth_id')::uuid OR identity.local_tenant_id<>p_tenant OR identity.instance_id<>p_instance THEN RAISE EXCEPTION 'Product identity cannot be silently reassigned'; END IF;
  ELSE
   INSERT INTO suite_product_identities(organization_id,product_code,member_id,local_user_id,local_auth_id,local_tenant_id,instance_id,created_by,reason)
   VALUES(job.organization_id,job.product_code,member.id,entry->>'local_user_id',(entry->>'local_auth_id')::uuid,p_tenant,p_instance,p_actor,'Created by the authenticated product provisioning adapter');
   created:=created+1;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM suite_memberships m WHERE m.organization_id=job.organization_id AND m.status='active' AND m.auth_user_id IS NOT NULL AND m.role<>'billing' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_identities) i WHERE i->>'member_id'=m.id::text)) THEN RAISE EXCEPTION 'Adapter did not provision every active product member'; END IF;
 UPDATE suite_bindings SET local_tenant_id=p_tenant WHERE organization_id=job.organization_id AND product_code=job.product_code;
 IF created>0 THEN INSERT INTO suite_audit(organization_id,actor_id,action,details) VALUES(job.organization_id,p_actor,'provision_product_identities',jsonb_build_object('product_code',job.product_code,'count',created)); END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.suite_note_provisioning(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suite_note_provisioning(uuid,uuid,uuid,uuid,text,jsonb) TO service_role;
-- The claim function appended below includes explicit links and shared-product dependencies.
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
    'identity_links',coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM suite_product_identities i WHERE organization_id=p_org AND product_code=p_product),'[]'),
    'product_links',coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM suite_product_identities i WHERE organization_id=p_org),'[]'),
    'bindings',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM suite_bindings b WHERE organization_id=p_org),'[]'),
    'issued_at',now(),'refresh_by',now()+interval '5 minutes','contract','suite.access.v1');
END;
$$;
REVOKE ALL ON FUNCTION public.suite_claim_job(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suite_claim_job(uuid,text) TO service_role;
COMMIT;
