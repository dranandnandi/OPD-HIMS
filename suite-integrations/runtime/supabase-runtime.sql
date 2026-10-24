-- Product-local runtime. __PRODUCT__ is replaced by the reviewed package builder.
BEGIN;
CREATE TABLE public.ds_runtime_config (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),product text NOT NULL CHECK(product IN('opd','growth','workforce')));
INSERT INTO public.ds_runtime_config VALUES(true,'__PRODUCT__');
CREATE TABLE public.ds_legacy_tenants(local_tenant_id text PRIMARY KEY,allowed boolean NOT NULL DEFAULT true);
DO $$ BEGIN
 IF '__PRODUCT__'='opd' THEN INSERT INTO ds_legacy_tenants SELECT id::text,true FROM clinic_settings;
 ELSIF '__PRODUCT__'='workforce' THEN INSERT INTO ds_legacy_tenants SELECT id::text,true FROM organizations;
 ELSE INSERT INTO ds_legacy_tenants SELECT id::text,true FROM users; END IF;
END $$;
CREATE TABLE public.ds_runtime_bindings (
 organization_id uuid PRIMARY KEY, local_tenant_id text NOT NULL UNIQUE, version integer NOT NULL CHECK(version>0),
 snapshot jsonb NOT NULL, access_until timestamptz, active_since timestamptz, fresh_until timestamptz NOT NULL,
 issued_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ds_runtime_members (
 member_id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES public.ds_runtime_bindings(organization_id),
 central_auth_id uuid NOT NULL,local_auth_id uuid NOT NULL UNIQUE,local_user_id text NOT NULL UNIQUE,
 role text NOT NULL CHECK(role IN('owner','admin','member')),active boolean NOT NULL,
 UNIQUE(organization_id,central_auth_id)
);
CREATE FUNCTION public.ds_runtime_tenant(p_user text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT b.local_tenant_id FROM ds_runtime_members m JOIN ds_runtime_bindings b USING(organization_id) WHERE m.local_user_id=p_user
$$;
CREATE FUNCTION public.ds_runtime_service_request() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role' OR current_setting('role',true)='service_role'
$$;
CREATE FUNCTION public.ds_runtime_allowed(p_tenant text,p_auth uuid DEFAULT NULL,p_created timestamptz DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b ds_runtime_bindings;
BEGIN
 SELECT * INTO b FROM ds_runtime_bindings WHERE local_tenant_id=p_tenant;
 IF NOT FOUND THEN RETURN EXISTS(SELECT 1 FROM ds_legacy_tenants WHERE local_tenant_id=p_tenant AND allowed); END IF;
 IF b.fresh_until<=now() OR b.access_until IS NULL OR b.access_until<=now() OR b.snapshot#>>'{organization,status}'<>'active' THEN RETURN false; END IF;
 IF p_created IS NOT NULL AND b.active_since IS NOT NULL AND p_created<b.active_since THEN RETURN false; END IF;
 IF p_auth IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ds_runtime_members WHERE organization_id=b.organization_id AND local_auth_id=p_auth AND active) THEN RETURN false; END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.ds_runtime_user_status(p_auth uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m ds_runtime_members;b ds_runtime_bindings;product text;profile jsonb;tenant text;
BEGIN
 SELECT * INTO m FROM ds_runtime_members WHERE local_auth_id=p_auth;
 IF NOT FOUND THEN
  SELECT c.product INTO product FROM ds_runtime_config c;
  IF product='opd' THEN SELECT to_jsonb(p) INTO profile FROM profiles p WHERE coalesce(p.auth_id,p.user_id,p.id)=p_auth;
  ELSE SELECT to_jsonb(u) INTO profile FROM users u WHERE u.auth_id=p_auth; END IF;
  tenant:=CASE product WHEN 'opd' THEN profile->>'clinic_id' WHEN 'workforce' THEN profile->>'organization_id' ELSE profile->>'id' END;
  RETURN jsonb_build_object('managed',false,'allowed',coalesce(ds_runtime_allowed(tenant,p_auth),false),'local_tenant_id',tenant,'local_user_id',profile->>'id');
 END IF;
 SELECT * INTO b FROM ds_runtime_bindings WHERE organization_id=m.organization_id;
 RETURN jsonb_build_object('managed',true,'allowed',m.active AND ds_runtime_allowed(b.local_tenant_id,p_auth),
 'organization_id',b.organization_id,'local_tenant_id',b.local_tenant_id,'local_user_id',m.local_user_id,
 'organization_name',b.snapshot#>>'{organization,name}','access_until',b.access_until,'fresh_until',b.fresh_until);
END $$;
CREATE FUNCTION public.ds_client_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
 RETURN ds_runtime_user_status(auth.uid());
END $$;
CREATE FUNCTION public.ds_runtime_assert(p_tenant text,p_created timestamptz DEFAULT NULL) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_tenant IS NULL THEN RAISE EXCEPTION 'An authoritative tenant is required'; END IF;
 IF NOT ds_runtime_allowed(p_tenant,NULL,p_created) THEN RAISE EXCEPTION 'Suite access expired, suspended, stale or queued before the current activation'; END IF;
END $$;
CREATE FUNCTION public.ds_runtime_dispatch(p_tenant text,p_purpose text,p_created timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b ds_runtime_bindings;route jsonb;
BEGIN
 PERFORM ds_runtime_assert(p_tenant,p_created);
 SELECT * INTO b FROM ds_runtime_bindings WHERE local_tenant_id=p_tenant;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT r INTO route FROM jsonb_array_elements(coalesce(b.snapshot->'messaging_routes','[]')) r WHERE r->>'purpose'=p_purpose AND (r->>'enabled')::boolean;
 IF route IS NULL THEN
  RAISE EXCEPTION 'An enabled, verified messaging purpose is required for this suite tenant';
 END IF;
 RETURN route;
END $$;
-- Resolve a row's actual owner via its FK graph. Tenant columns and root tables
-- are authoritative; indirect children inherit their parent's tenant.
CREATE FUNCTION public.ds_runtime_scopes(p_table text,p_row jsonb,p_depth integer DEFAULT 0) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE product text;result text[]:='{}';link record;parent jsonb;child text[];tenant text;
BEGIN
 IF p_depth>8 THEN RAISE EXCEPTION 'Tenant relation depth exceeded'; END IF;
 SELECT c.product INTO product FROM ds_runtime_config c;
 IF product='opd' THEN
  IF p_table='clinic_settings' THEN RETURN ARRAY[p_row->>'id']; END IF;
  IF p_row?'clinic_id' AND p_row->>'clinic_id' IS NOT NULL THEN result:=ARRAY[p_row->>'clinic_id']; END IF;
 ELSIF product='workforce' THEN
  IF p_table='organizations' THEN RETURN ARRAY[p_row->>'id']; END IF;
  IF p_row?'organization_id' AND p_row->>'organization_id' IS NOT NULL THEN result:=ARRAY[p_row->>'organization_id']; END IF;
 ELSE
  IF p_table='users' THEN RETURN ARRAY[coalesce(ds_runtime_tenant(p_row->>'id'),p_row->>'id')]; END IF;
 END IF;
 FOR link IN SELECT parent.relname parent_table,ca.attname child_column,pa.attname parent_column
  FROM pg_constraint fk JOIN pg_class current_table ON current_table.oid=fk.conrelid JOIN pg_class parent ON parent.oid=fk.confrelid
  JOIN pg_namespace ns ON ns.oid=parent.relnamespace JOIN pg_attribute ca ON ca.attrelid=fk.conrelid AND ca.attnum=fk.conkey[1]
  JOIN pg_attribute pa ON pa.attrelid=fk.confrelid AND pa.attnum=fk.confkey[1]
  WHERE fk.contype='f' AND cardinality(fk.conkey)=1 AND ns.nspname='public' AND current_table.relnamespace='public'::regnamespace
   AND current_table.relname=p_table AND parent.relname NOT LIKE 'ds\_%' ESCAPE '\' AND parent.relname<>p_table
 LOOP
  IF p_row->>link.child_column IS NULL THEN CONTINUE; END IF;
  EXECUTE format('SELECT to_jsonb(p) FROM public.%I p WHERE p.%I::text=$1',link.parent_table,link.parent_column) INTO parent USING p_row->>link.child_column;
  IF parent IS NOT NULL THEN child:=ds_runtime_scopes(link.parent_table,parent,p_depth+1);result:=result||child; END IF;
 END LOOP;
 RETURN ARRAY(SELECT DISTINCT unnest(result));
END $$;
CREATE FUNCTION public.ds_runtime_row_allowed(p_table text,p_row jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tenant text;scopes text[];subject uuid:=auth.uid();mine ds_runtime_members;binding ds_runtime_bindings;
BEGIN
 SELECT * INTO mine FROM ds_runtime_members WHERE local_auth_id=subject;
 IF subject IS NOT NULL AND NOT coalesce((ds_runtime_user_status(subject)->>'allowed')::boolean,false) THEN RETURN false; END IF;
 scopes:=ds_runtime_scopes(p_table,p_row);
 IF cardinality(scopes)=0 AND mine.member_id IS NOT NULL AND p_table NOT IN('roles','creative_categories','review_request_templates','sequence_templates','pay_components','symptoms_master','diagnoses_master','tests_master','medicines_master','dosage_frequencies','ipd_charge_heads','ipd_bed_types','ipd_departments') THEN RETURN false; END IF;
 FOREACH tenant IN ARRAY scopes LOOP
  SELECT * INTO binding FROM ds_runtime_bindings WHERE local_tenant_id=tenant;
  IF NOT ds_runtime_allowed(tenant,subject) OR binding.organization_id IS NOT NULL AND subject IS NULL AND NOT ds_runtime_service_request() THEN RETURN false; END IF;
  IF mine.member_id IS NOT NULL AND tenant<>(SELECT local_tenant_id FROM ds_runtime_bindings WHERE organization_id=mine.organization_id) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION public.ds_runtime_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tenant text;scopes text[];old_scopes text[];binding ds_runtime_bindings;person ds_runtime_members;field text;product text;
BEGIN
 IF current_setting('ds.provisioning',true)='on' THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 scopes:=ds_runtime_scopes(TG_TABLE_NAME,CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END);
 SELECT c.product INTO product FROM ds_runtime_config c;
 IF (product='opd' AND TG_TABLE_NAME='profiles') OR (product IN('growth','workforce') AND TG_TABLE_NAME='users') THEN
  IF TG_OP<>'INSERT' THEN SELECT * INTO person FROM ds_runtime_members WHERE local_user_id=to_jsonb(OLD)->>'id'; END IF;
  IF person.member_id IS NOT NULL THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Manage suite membership from Suite Admin'; END IF;
   FOREACH field IN ARRAY ARRAY['id','auth_id','user_id','clinic_id','organization_id','role','role_id','role_name','permissions','is_active'] LOOP
    IF to_jsonb(NEW)->field IS DISTINCT FROM to_jsonb(OLD)->field THEN RAISE EXCEPTION 'Manage suite identity and roles from Suite Admin'; END IF;
   END LOOP;
  ELSIF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM ds_runtime_bindings WHERE local_tenant_id=ANY(scopes)) THEN
   RAISE EXCEPTION 'Add suite users through Suite Admin';
  END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  old_scopes:=ds_runtime_scopes(TG_TABLE_NAME,to_jsonb(OLD));
  IF old_scopes IS DISTINCT FROM scopes AND EXISTS(SELECT 1 FROM ds_runtime_bindings WHERE local_tenant_id=ANY(old_scopes||scopes)) THEN RAISE EXCEPTION 'Suite tenant reassignment requires reviewed reconciliation'; END IF;
 END IF;
 IF cardinality(scopes)=0 AND EXISTS(SELECT 1 FROM ds_runtime_members WHERE local_auth_id=auth.uid()) THEN RAISE EXCEPTION 'Suite users cannot modify global shared configuration'; END IF;
 FOREACH tenant IN ARRAY scopes LOOP
  PERFORM ds_runtime_assert(tenant);
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
-- Add a restrictive policy to every existing business table. Existing permissive
-- policies continue to decide ordinary roles; this policy adds suite denial.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT c.relname tablename,c.relrowsecurity enabled FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relname NOT LIKE 'ds\_%' ESCAPE '\' AND c.relname NOT LIKE 'suite\_%' ESCAPE '\' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  EXECUTE format('CREATE POLICY ds_suite_access ON public.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING(public.ds_runtime_row_allowed(%L,to_jsonb(%I))) WITH CHECK(public.ds_runtime_row_allowed(%L,to_jsonb(%I)))',t.tablename,t.tablename,t.tablename,t.tablename,t.tablename);
  EXECUTE format('CREATE TRIGGER ds_suite_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ds_runtime_write_guard()',t.tablename);
  -- Previously RLS-disabled tables need a permissive policy as well. Preserve
  -- their legacy behaviour; restrictive scope/access checks still govern enrolled rows.
  IF NOT t.enabled THEN EXECUTE format('CREATE POLICY ds_preexisting_access ON public.%I FOR ALL TO anon,authenticated USING(true) WITH CHECK(true)',t.tablename); END IF;
 END LOOP;
END $$;
DO $$ DECLARE t record;BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ds\_%' ESCAPE '\' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t.tablename);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t.tablename);
 END LOOP;
 FOR t IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'ds\_%' ESCAPE '\' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',t.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',t.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.ds_client_status(),public.ds_runtime_row_allowed(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ds_runtime_row_allowed(text,jsonb) TO anon;
COMMIT;
