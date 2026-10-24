-- Doctor Suite: central catch-up #3. Prepared 2026-10-22. Supersedes APPLY_CENTRAL_SQL_2026-10-20b.sql (which was never applied).
-- Run ONCE in the central OPD Supabase SQL Editor (project kiezgfhonvwryxpubfvl), after APPLY_CENTRAL_SQL_2026-10-20.sql.
-- Contents, unchanged: 20261020130000_suite_identity_launch, 20261020150000_suite_provisioning_receipts, 20261022100000_suite_dependency_receipts.
-- Each file is its own BEGIN/COMMIT. If a block errors with 'already exists', that block was applied earlier; continue with the next.

-- Central project only. Additive identity approvals and one-use customer launches.
BEGIN;
CREATE TABLE public.suite_product_identities (
 organization_id uuid NOT NULL, product_code text NOT NULL, member_id uuid NOT NULL REFERENCES public.suite_memberships(id),
 local_user_id text NOT NULL CHECK(length(local_user_id) BETWEEN 1 AND 200), local_auth_id uuid,
 local_tenant_id text NOT NULL, instance_id uuid NOT NULL REFERENCES public.suite_instances(id),
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, reason text NOT NULL,
 PRIMARY KEY(organization_id,product_code,member_id), UNIQUE(product_code,local_user_id), UNIQUE(product_code,local_auth_id),
 FOREIGN KEY(organization_id,product_code) REFERENCES public.suite_bindings(organization_id,product_code)
);
CREATE TABLE public.suite_launch_tickets (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'), organization_id uuid NOT NULL,
 product_code text NOT NULL, member_id uuid NOT NULL REFERENCES public.suite_memberships(id),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '60 seconds', used_at timestamptz,
 FOREIGN KEY(organization_id,product_code,member_id) REFERENCES public.suite_product_identities(organization_id,product_code,member_id)
);
CREATE FUNCTION public.suite_link_product_identity(p_actor uuid,p_request uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid:=(p_payload->>'organization_id')::uuid; v_product text:=p_payload->>'product_code';
 v_binding suite_bindings; v_member suite_memberships; v_instance suite_instances; v_old suite_requests; v_input jsonb:=p_payload->'command';v_result jsonb;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR v_input IS NULL THEN RAISE EXCEPTION 'Verified operation required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 SELECT * INTO v_old FROM suite_requests WHERE id=p_request;
 IF FOUND THEN
  IF v_old.actor_id<>p_actor OR v_old.action<>'link_product_identity' OR v_old.payload<>v_input THEN RAISE EXCEPTION 'Request ID already used for a different operation'; END IF;
  RETURN v_old.result;
 END IF;
 PERFORM 1 FROM suite_organizations WHERE id=v_org FOR UPDATE;
 SELECT * INTO v_binding FROM suite_bindings WHERE organization_id=v_org AND product_code=v_product FOR UPDATE;
 IF NOT FOUND OR v_binding.local_tenant_id IS NULL OR v_binding.local_tenant_id IS DISTINCT FROM p_payload->>'local_tenant_id'
  OR v_binding.version IS DISTINCT FROM (p_payload->>'binding_version')::integer THEN RAISE EXCEPTION 'Product mapping changed; verify identity again'; END IF;
 SELECT * INTO v_member FROM suite_memberships WHERE organization_id=v_org AND id=(p_payload->>'member_id')::uuid;
 IF NOT FOUND OR v_member.status<>'active' OR v_member.auth_user_id IS NULL OR v_member.role='billing' THEN RAISE EXCEPTION 'A verified active product member is required'; END IF;
 SELECT * INTO v_instance FROM suite_instances WHERE id=(p_payload->>'instance_id')::uuid AND component=v_product AND checked_at>now()-interval '15 minutes';
 IF NOT FOUND THEN RAISE EXCEPTION 'Product instance must be freshly verified'; END IF;
 IF v_product<>'whatsapp' AND p_payload->>'local_auth_id' IS NULL THEN RAISE EXCEPTION 'Product Auth identity required'; END IF;
 IF v_product='opd' AND (p_payload->>'local_auth_id')::uuid IS DISTINCT FROM v_member.auth_user_id THEN RAISE EXCEPTION 'Central OPD identity must match the verified member'; END IF;
 IF coalesce(length(trim(p_payload->>'reason')),0) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Identity approval reason required'; END IF;
 INSERT INTO suite_product_identities(organization_id,product_code,member_id,local_user_id,local_auth_id,local_tenant_id,instance_id,created_by,reason)
 VALUES(v_org,v_product,v_member.id,p_payload->>'local_user_id',(p_payload->>'local_auth_id')::uuid,v_binding.local_tenant_id,v_instance.id,p_actor,p_payload->>'reason');
 PERFORM suite_queue_change(v_org,v_product);
 v_result:=jsonb_build_object('organization_id',v_org,'member_id',v_member.id,'product_code',v_product);
 INSERT INTO suite_requests VALUES(p_request,p_actor,'link_product_identity',v_input,v_result,now());
 INSERT INTO suite_audit(organization_id,actor_id,action,reason,details) VALUES(v_org,p_actor,'link_product_identity',p_payload->>'reason',v_input);
 RETURN v_result;
END $$;
CREATE FUNCTION public.suite_member_apps(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('organization_id',o.id,'organization_name',o.name,'product_code',b.product_code,
 'product_name',p.name,'state',b.state,'identity_linked',i.member_id IS NOT NULL,
 'allowed',coalesce((suite_product_access(o.id,b.product_code,b.local_tenant_id)->>'allowed')::boolean,false) AND i.member_id IS NOT NULL) ORDER BY o.name,b.product_code),'[]')
 FROM suite_memberships m JOIN suite_organizations o ON o.id=m.organization_id JOIN suite_bindings b ON b.organization_id=o.id
 JOIN suite_products p ON p.code=b.product_code LEFT JOIN suite_product_identities i ON i.organization_id=o.id AND i.product_code=b.product_code AND i.member_id=m.id
 WHERE m.auth_user_id=p_user AND m.status='active' AND m.role<>'billing'
$$;
CREATE FUNCTION public.suite_identity_detail(p_org uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY product_code,member_id),'[]') FROM suite_product_identities i WHERE organization_id=p_org
$$;
CREATE FUNCTION public.suite_create_launch(p_user uuid,p_org uuid,p_product text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_member suite_memberships; v_identity suite_product_identities; v_access jsonb;
BEGIN
 PERFORM 1 FROM suite_organizations WHERE id=p_org FOR UPDATE;
 SELECT * INTO v_member FROM suite_memberships WHERE organization_id=p_org AND auth_user_id=p_user AND status='active' AND role<>'billing';
 IF NOT FOUND THEN RAISE EXCEPTION 'Active membership required'; END IF;
 SELECT * INTO v_identity FROM suite_product_identities WHERE organization_id=p_org AND product_code=p_product AND member_id=v_member.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product login has not been linked'; END IF;
 v_access:=suite_product_access(p_org,p_product,v_identity.local_tenant_id);
 IF NOT coalesce((v_access->>'allowed')::boolean,false) THEN RAISE EXCEPTION 'Product access is unavailable'; END IF;
 -- Bound outstanding tickets per member; stale links never accumulate indefinitely.
 DELETE FROM suite_launch_tickets WHERE member_id=v_member.id AND product_code=p_product;
 INSERT INTO suite_launch_tickets(token_hash,organization_id,product_code,member_id) VALUES(p_hash,p_org,p_product,v_member.id);
 RETURN jsonb_build_object('expires_in',60);
END $$;
CREATE FUNCTION public.suite_redeem_launch(p_product text,p_hash text,p_instance uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_ticket suite_launch_tickets; v_identity suite_product_identities; v_member suite_memberships; v_access jsonb;
BEGIN
 SELECT * INTO v_ticket FROM suite_launch_tickets WHERE token_hash=p_hash AND product_code=p_product;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid launch ticket'; END IF;
 PERFORM 1 FROM suite_organizations WHERE id=v_ticket.organization_id FOR UPDATE;
 SELECT * INTO v_ticket FROM suite_launch_tickets WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR v_ticket.used_at IS NOT NULL OR v_ticket.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Invalid launch ticket'; END IF;
 SELECT * INTO v_member FROM suite_memberships WHERE id=v_ticket.member_id AND organization_id=v_ticket.organization_id AND status='active' AND role<>'billing';
 IF NOT FOUND THEN RAISE EXCEPTION 'Membership is unavailable'; END IF;
 SELECT * INTO v_identity FROM suite_product_identities WHERE organization_id=v_ticket.organization_id AND product_code=p_product AND member_id=v_member.id AND instance_id=p_instance;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product identity mismatch'; END IF;
 v_access:=suite_product_access(v_identity.organization_id,p_product,v_identity.local_tenant_id);
 IF NOT coalesce((v_access->>'allowed')::boolean,false) THEN RAISE EXCEPTION 'Product access is unavailable'; END IF;
 UPDATE suite_launch_tickets SET used_at=now() WHERE token_hash=p_hash;
 INSERT INTO suite_audit(organization_id,actor_id,action,details) VALUES(v_identity.organization_id,v_member.auth_user_id,'launch_product',jsonb_build_object('product_code',p_product));
 RETURN jsonb_build_object('organization_id',v_identity.organization_id,'product_code',p_product,'local_tenant_id',v_identity.local_tenant_id,
 'local_user_id',v_identity.local_user_id,'local_auth_id',v_identity.local_auth_id,'member_id',v_member.id,'role',v_member.role);
END $$;
ALTER TABLE public.suite_product_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suite_launch_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suite_product_identities,public.suite_launch_tickets FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.suite_product_identities,public.suite_launch_tickets TO service_role;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('suite_link_product_identity','suite_identity_detail','suite_member_apps','suite_create_launch','suite_redeem_launch') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);
 END LOOP;
END $$;
COMMIT;

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

-- Central only. Add after 20261020150000_suite_provisioning_receipts.
BEGIN;
CREATE TABLE public.suite_dependency_identities(
 organization_id uuid NOT NULL,product_code text NOT NULL,member_id uuid NOT NULL,
 backend_instance_id uuid NOT NULL REFERENCES public.suite_instances(id),
 source_user_id text NOT NULL,backend_user_id text NOT NULL CHECK(length(backend_user_id) BETWEEN 1 AND 200),
 binding_version integer NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,product_code,member_id),
 FOREIGN KEY(organization_id,product_code,member_id) REFERENCES public.suite_product_identities(organization_id,product_code,member_id),
 UNIQUE(backend_instance_id,product_code,backend_user_id)
);
ALTER TABLE public.suite_dependency_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suite_dependency_identities FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.suite_dependency_identities TO service_role;
CREATE FUNCTION public.suite_note_dependency(p_job uuid,p_lease uuid,p_actor uuid,p_instance uuid,p_identities jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job suite_jobs;binding suite_bindings;entry jsonb;source suite_product_identities;known suite_dependency_identities;created integer:=0;
BEGIN
 IF p_actor IS NULL OR jsonb_typeof(p_identities) IS DISTINCT FROM 'array' OR jsonb_array_length(p_identities)>1000 THEN RAISE EXCEPTION 'Valid dependency identities required'; END IF;
 SELECT * INTO job FROM suite_jobs WHERE id=p_job;IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM suite_organizations WHERE id=job.organization_id FOR UPDATE;
 SELECT * INTO job FROM suite_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO binding FROM suite_bindings WHERE organization_id=job.organization_id AND product_code=job.product_code FOR UPDATE;
 IF job.state<>'running' OR job.lease_id IS DISTINCT FROM p_lease OR job.lease_until<=clock_timestamp() OR binding.version<>job.version THEN RETURN false; END IF;
 IF job.product_code NOT IN('opd','growth','workforce') THEN RAISE EXCEPTION 'Product has no separate messaging dependency'; END IF;
 IF NOT EXISTS(SELECT 1 FROM suite_instances WHERE id=p_instance AND component=CASE WHEN job.product_code='workforce' THEN 'whatsapp' ELSE 'legacy_whatsapp' END) THEN RAISE EXCEPTION 'Messaging deployment is not registered for this product'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_identities) i GROUP BY i->>'member_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate dependency member'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_identities) LOOP
  SELECT * INTO source FROM suite_product_identities WHERE organization_id=job.organization_id AND product_code=job.product_code AND member_id=(entry->>'member_id')::uuid;
  IF NOT FOUND OR source.local_user_id IS DISTINCT FROM entry->>'source_user_id' OR NOT EXISTS(SELECT 1 FROM suite_memberships WHERE id=source.member_id AND organization_id=job.organization_id AND status='active' AND role<>'billing') THEN RAISE EXCEPTION 'Dependency source identity mismatch'; END IF;
  IF entry->>'local_user_id' IS NULL THEN RAISE EXCEPTION 'Missing backend identity'; END IF;
  SELECT * INTO known FROM suite_dependency_identities WHERE organization_id=job.organization_id AND product_code=job.product_code AND member_id=source.member_id;
  IF FOUND AND (known.backend_instance_id<>p_instance OR known.backend_user_id<>entry->>'local_user_id' OR known.source_user_id<>source.local_user_id) THEN RAISE EXCEPTION 'Dependency identity cannot be silently reassigned'; END IF;
  IF NOT FOUND THEN created:=created+1; END IF;
  IF EXISTS(SELECT 1 FROM suite_dependency_identities WHERE backend_instance_id=p_instance AND backend_user_id=entry->>'local_user_id' AND organization_id<>job.organization_id) THEN RAISE EXCEPTION 'Messaging account belongs to another suite organisation'; END IF;
  INSERT INTO suite_dependency_identities(organization_id,product_code,member_id,backend_instance_id,source_user_id,backend_user_id,binding_version,created_by)
  VALUES(job.organization_id,job.product_code,source.member_id,p_instance,source.local_user_id,entry->>'local_user_id',job.version,p_actor)
  ON CONFLICT(organization_id,product_code,member_id) DO UPDATE SET binding_version=EXCLUDED.binding_version,checked_at=now();
 END LOOP;
 IF EXISTS(SELECT 1 FROM suite_memberships m WHERE m.organization_id=job.organization_id AND m.status='active' AND m.auth_user_id IS NOT NULL AND m.role<>'billing' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_identities) i WHERE i->>'member_id'=m.id::text)) THEN RAISE EXCEPTION 'Dependency did not provision every active member'; END IF;
 IF created>0 THEN INSERT INTO suite_audit(organization_id,actor_id,action,details) VALUES(job.organization_id,p_actor,'provision_dependency_identities',jsonb_build_object('product_code',job.product_code,'instance_id',p_instance,'count',created)); END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.suite_note_dependency(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suite_note_dependency(uuid,uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;
