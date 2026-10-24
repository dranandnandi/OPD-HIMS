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
