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
