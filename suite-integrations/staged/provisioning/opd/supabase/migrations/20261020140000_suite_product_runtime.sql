BEGIN;
-- Product-local runtime. opd is replaced by the reviewed package builder.

CREATE TABLE public.ds_runtime_config (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),product text NOT NULL CHECK(product IN('opd','growth','workforce')));
INSERT INTO public.ds_runtime_config VALUES(true,'opd');
CREATE TABLE public.ds_legacy_tenants(local_tenant_id text PRIMARY KEY,allowed boolean NOT NULL DEFAULT true);
DO $$ BEGIN
 IF 'opd'='opd' THEN INSERT INTO ds_legacy_tenants SELECT id::text,true FROM clinic_settings;
 ELSIF 'opd'='workforce' THEN INSERT INTO ds_legacy_tenants SELECT id::text,true FROM organizations;
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

-- Product resource limits, serialized per enrolled tenant; no legacy data reset.

CREATE FUNCTION public.ds_capacity_limit(p_snapshot jsonb,p_kind text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE value jsonb:=p_snapshot#>ARRAY['organization','plan_snapshot','limits',p_kind];amount numeric;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Plan resource capacity is not configured: %',p_kind;END IF;
 amount:=value::text::numeric;
 IF amount<0 OR amount>2147483647 OR trunc(amount)<>amount THEN RAISE EXCEPTION 'Invalid plan resource capacity: %',p_kind;END IF;
 RETURN amount::integer;
END $$;
CREATE FUNCTION public.ds_capacity_kind(p_table text,p_row jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE product text;role_name text;
BEGIN
 SELECT c.product INTO product FROM ds_runtime_config c;
 IF product='growth' AND p_table='gmb_locations' AND coalesce(p_row->>'status','')<>'disabled' THEN RETURN 'google_profiles';END IF;
 IF product='opd' AND p_table='profiles' AND coalesce((p_row->>'is_active')::boolean,true) THEN
  role_name:=lower(coalesce(p_row->>'role_name',''));
  IF role_name='' AND p_row->>'role_id' IS NOT NULL THEN SELECT lower(name) INTO role_name FROM roles WHERE id::text=p_row->>'role_id';END IF;
  IF role_name='doctor' THEN RETURN 'doctors';END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION public.ds_capacity_check(p_tenant text,p_table text,p_row jsonb,p_existing boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b ds_runtime_bindings;kind text;capacity integer;used bigint;
BEGIN
 kind:=ds_capacity_kind(p_table,p_row);IF kind IS NULL THEN RETURN;END IF;
 SELECT * INTO b FROM ds_runtime_bindings WHERE local_tenant_id=p_tenant;IF NOT FOUND THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('suite-capacity:'||b.organization_id::text||':'||kind,0));
 capacity:=ds_capacity_limit(b.snapshot,kind);
 EXECUTE format('SELECT count(*) FROM public.%I t WHERE $1=ANY(public.ds_runtime_scopes(%L,to_jsonb(t))) AND public.ds_capacity_kind(%L,to_jsonb(t))=$2 AND ($3 IS NULL OR to_jsonb(t)->>''id''<>$3)',p_table,p_table,p_table)
 INTO used USING p_tenant,kind,CASE WHEN p_existing THEN p_row->>'id' ELSE NULL END;
 IF used+1>capacity THEN RAISE EXCEPTION 'Plan % capacity exceeded',kind;END IF;
END $$;
CREATE FUNCTION public.ds_capacity_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tenant text;
BEGIN
 IF current_setting('ds.provisioning',true)='on' THEN RETURN NEW;END IF;
 FOREACH tenant IN ARRAY ds_runtime_scopes(TG_TABLE_NAME,to_jsonb(NEW)) LOOP
  PERFORM ds_capacity_check(tenant,TG_TABLE_NAME,to_jsonb(NEW),TG_OP='UPDATE');
 END LOOP;
 RETURN NEW;
END $$;
CREATE FUNCTION public.ds_capacity_review(p_tenant text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row_data jsonb;product text;table_name text;b ds_runtime_bindings;capacity integer;used integer;
BEGIN
 SELECT * INTO b FROM ds_runtime_bindings WHERE local_tenant_id=p_tenant;IF NOT FOUND THEN RETURN;END IF;
 SELECT c.product INTO product FROM ds_runtime_config c;
 -- Suspension must be delivered even if a simultaneous plan downgrade would
 -- otherwise fail capacity review. It never removes clinical/product records.
 IF b.snapshot#>>'{organization,status}'<>'active' THEN RETURN;END IF;
 IF b.snapshot#>'{organization,plan_snapshot,limits,locations}' IS NOT NULL AND ds_capacity_limit(b.snapshot,'locations')<1 THEN RAISE EXCEPTION 'An active product tenant requires one location';END IF;
 capacity:=ds_capacity_limit(b.snapshot,CASE WHEN product='workforce' AND b.snapshot#>'{organization,plan_snapshot,limits,employees}' IS NOT NULL THEN 'employees' ELSE 'staff' END);
 SELECT count(*) INTO used FROM ds_runtime_members WHERE organization_id=b.organization_id AND active;
 IF capacity IS NULL OR capacity<used THEN RAISE EXCEPTION 'Active member capacity exceeded';END IF;
 table_name:=CASE WHEN product='opd' THEN 'profiles' WHEN product='growth' THEN 'gmb_locations' ELSE NULL END;
 IF table_name IS NULL OR to_regclass('public.'||table_name) IS NULL THEN RETURN;END IF;
 FOR row_data IN EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE $1=ANY(public.ds_runtime_scopes(%L,to_jsonb(t)))',table_name,table_name) USING p_tenant LOOP
  PERFORM ds_capacity_check(p_tenant,table_name,row_data,true);
 END LOOP;
END $$;
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['profiles','gmb_locations'] LOOP
  IF to_regclass('public.'||name) IS NOT NULL THEN EXECUTE format('CREATE TRIGGER ds_suite_capacity BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ds_capacity_write()',name);END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.ds_capacity_kind(text,jsonb),public.ds_capacity_check(text,text,jsonb,boolean),public.ds_capacity_write(),public.ds_capacity_review(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ds_capacity_limit(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ds_capacity_kind(text,jsonb),public.ds_capacity_check(text,text,jsonb,boolean),public.ds_capacity_review(text) TO service_role;

-- Append after the product runtime migration. Service-only provisioning RPCs.

CREATE TABLE public.ds_legacy_sync_receipts(local_user_id text NOT NULL,local_auth_id uuid NOT NULL,writer_url text NOT NULL,completed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(local_user_id,local_auth_id,writer_url));
ALTER TABLE public.ds_legacy_sync_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ds_legacy_sync_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ds_legacy_sync_checkpoint(p_user text,p_auth uuid,p_writer text,p_complete boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ds_runtime_config WHERE product IN('opd','growth')) OR NOT EXISTS(SELECT 1 FROM ds_runtime_members WHERE local_user_id=p_user AND local_auth_id=p_auth AND active) THEN RAISE EXCEPTION 'Verified source identity required';END IF;
 IF p_writer IS NULL OR length(p_writer)>2048 OR p_writer!~'^https://' THEN RAISE EXCEPTION 'Invalid identity writer';END IF;
 IF p_complete THEN INSERT INTO ds_legacy_sync_receipts(local_user_id,local_auth_id,writer_url) VALUES(p_user,p_auth,p_writer) ON CONFLICT DO NOTHING;END IF;
 RETURN EXISTS(SELECT 1 FROM ds_legacy_sync_receipts WHERE local_user_id=p_user AND local_auth_id=p_auth AND writer_url=p_writer);
END $$;
REVOKE ALL ON FUNCTION public.ds_legacy_sync_checkpoint(text,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ds_legacy_sync_checkpoint(text,uuid,text,boolean) TO service_role;
CREATE FUNCTION public.ds_runtime_auth(p_central uuid,p_org uuid,p_email text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',id,'owned',raw_app_meta_data#>>'{doctor_suite,central_user_id}'=p_central::text AND raw_app_meta_data#>>'{doctor_suite,organization_id}'=p_org::text)
 FROM auth.users WHERE lower(email)=lower(trim(p_email)) LIMIT 1
$$;
CREATE FUNCTION public.ds_runtime_apply(p_snapshot jsonb,p_links jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE product text;org uuid:=(p_snapshot->>'organization_id')::uuid;tenant text;v_version integer:=(p_snapshot->>'version')::integer;
 previous ds_runtime_bindings;link jsonb;member jsonb;subject auth.users;old_user jsonb;local_id text;local_auth uuid;v_member_id uuid;
 selected_role uuid;role_label text;v_permissions text[];result jsonb:='[]';expiry timestamptz;since_at timestamptz;v_member ds_runtime_members;
BEGIN
 SELECT c.product INTO product FROM ds_runtime_config c;
 IF p_snapshot->>'product_code' IS DISTINCT FROM product OR v_version IS NULL OR v_version<1 THEN RAISE EXCEPTION 'Invalid product snapshot'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ds:'||org::text,0));
 SELECT * INTO previous FROM ds_runtime_bindings WHERE organization_id=org FOR UPDATE;
 tenant:=coalesce(previous.local_tenant_id,p_snapshot->>'local_tenant_id',org::text);
 IF previous.organization_id IS NOT NULL AND (previous.version>v_version OR previous.issued_at>(p_snapshot->>'issued_at')::timestamptz) THEN RAISE EXCEPTION 'Stale product snapshot'; END IF;
 IF p_snapshot->>'local_tenant_id' IS NOT NULL AND tenant<>p_snapshot->>'local_tenant_id' THEN RAISE EXCEPTION 'Tenant mapping changed'; END IF;
 IF (p_snapshot->>'refresh_by')::timestamptz<=clock_timestamp() OR (p_snapshot->>'refresh_by')::timestamptz>(p_snapshot->>'issued_at')::timestamptz+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid snapshot freshness'; END IF;
 IF EXISTS(SELECT 1 FROM ds_runtime_bindings WHERE local_tenant_id=tenant AND organization_id<>org) THEN RAISE EXCEPTION 'Local tenant already belongs to another suite organisation'; END IF;
 SELECT max((g->>'ends_at')::timestamptz),max((g->>'starts_at')::timestamptz) INTO expiry,since_at
 FROM jsonb_array_elements(coalesce(p_snapshot->'grants','[]')||CASE WHEN jsonb_typeof(p_snapshot->'trial')='object' THEN jsonb_build_array(p_snapshot->'trial') ELSE '[]'::jsonb END) g
 WHERE g->>'revoked_at' IS NULL AND (g->>'starts_at')::timestamptz<=now() AND (g->>'ends_at')::timestamptz>now();
 IF p_snapshot#>>'{organization,status}'<>'active' THEN expiry:=NULL; END IF;
 PERFORM set_config('ds.provisioning','on',true);
 IF product='opd' THEN
  INSERT INTO clinic_settings(id,clinic_name) VALUES(tenant::uuid,p_snapshot#>>'{organization,name}') ON CONFLICT(id) DO NOTHING;
 ELSIF product='workforce' THEN
  INSERT INTO organizations(id,name,subscription_status,trial_ends_at) VALUES(tenant::uuid,p_snapshot#>>'{organization,name}','active',NULL) ON CONFLICT(id) DO NOTHING;
 END IF;
 INSERT INTO ds_runtime_bindings(organization_id,local_tenant_id,version,snapshot,access_until,active_since,fresh_until,issued_at)
 VALUES(org,tenant,v_version,p_snapshot,expiry,since_at,(p_snapshot->>'refresh_by')::timestamptz,(p_snapshot->>'issued_at')::timestamptz)
 ON CONFLICT(organization_id) DO UPDATE SET version=EXCLUDED.version,snapshot=EXCLUDED.snapshot,access_until=EXCLUDED.access_until,active_since=EXCLUDED.active_since,fresh_until=EXCLUDED.fresh_until,issued_at=EXCLUDED.issued_at,updated_at=now();
 FOR link IN SELECT value FROM jsonb_array_elements(p_links) LOOP
  v_member_id:=(link->>'member_id')::uuid;local_auth:=(link->>'local_auth_id')::uuid;local_id:=link->>'local_user_id';
  SELECT value INTO member FROM jsonb_array_elements(p_snapshot->'members') WHERE value->>'id'=v_member_id::text AND value->>'status'='active' AND value->>'role'<>'billing';
  IF member IS NULL THEN RAISE EXCEPTION 'Provisioned identity is not an active product member'; END IF;
  SELECT * INTO subject FROM auth.users WHERE id=local_auth AND email_confirmed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'A verified local Auth identity is required'; END IF;
  IF product='opd' THEN
   IF local_auth IS DISTINCT FROM (member->>'auth_user_id')::uuid THEN RAISE EXCEPTION 'Central OPD Auth identity mismatch'; END IF;
  ELSIF NOT coalesce(subject.raw_app_meta_data#>>'{doctor_suite,central_user_id}'=member->>'auth_user_id' AND subject.raw_app_meta_data#>>'{doctor_suite,organization_id}'=org::text,false)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_snapshot->'identity_links','[]')) i WHERE i->>'member_id'=v_member_id::text AND i->>'local_auth_id'=local_auth::text AND i->>'local_user_id'=local_id) THEN
   RAISE EXCEPTION 'Existing Auth account requires explicit Suite Admin identity approval';
  END IF;
  SELECT * INTO v_member FROM ds_runtime_members m WHERE m.member_id=(link->>'member_id')::uuid;
  IF FOUND AND (v_member.organization_id<>org OR v_member.local_auth_id<>local_auth OR v_member.local_user_id<>local_id) THEN RAISE EXCEPTION 'Product identity cannot be silently reassigned'; END IF;
  IF product='opd' THEN
   SELECT to_jsonb(p) INTO old_user FROM profiles p WHERE p.id=local_id::uuid;
   IF old_user IS NOT NULL AND (coalesce(old_user->>'auth_id',old_user->>'user_id',old_user->>'id')<>local_auth::text OR old_user->>'clinic_id' IS NOT NULL AND old_user->>'clinic_id'<>tenant) THEN RAISE EXCEPTION 'Existing OPD profile belongs to another clinic'; END IF;
   IF old_user IS NULL OR old_user->>'role_id' IS NULL THEN
    SELECT id,name,r.permissions INTO selected_role,role_label,v_permissions FROM roles r WHERE lower(name)=CASE WHEN member->>'role' IN('owner','admin') THEN 'admin' ELSE 'receptionist' END LIMIT 1;
    IF selected_role IS NULL THEN RAISE EXCEPTION 'Configure the clinic admin/receptionist role before suite provisioning'; END IF;
   END IF;
   IF old_user IS NULL THEN INSERT INTO profiles(id,user_id,auth_id,clinic_id,email,name,role_id,role_name,permissions,is_active) VALUES(local_id::uuid,local_auth,local_auth,tenant::uuid,subject.email,member->>'name',selected_role,role_label,v_permissions,true);
   ELSE UPDATE profiles SET clinic_id=tenant::uuid,user_id=local_auth,auth_id=local_auth,is_active=true,
    role_name=CASE WHEN role_id IS NULL THEN role_label ELSE role_name END,permissions=CASE WHEN role_id IS NULL THEN v_permissions ELSE profiles.permissions END,role_id=coalesce(role_id,selected_role) WHERE id=local_id::uuid; END IF;
  ELSIF product='workforce' THEN
   SELECT to_jsonb(u) INTO old_user FROM users u WHERE u.id=local_id::uuid;
   IF old_user IS NOT NULL AND (old_user->>'auth_id'<>local_auth::text OR old_user->>'organization_id' IS NOT NULL AND old_user->>'organization_id'<>tenant) THEN RAISE EXCEPTION 'Existing Task profile belongs to another organisation'; END IF;
   IF old_user IS NULL THEN INSERT INTO users(id,auth_id,organization_id,name,email,whatsapp_number,department,role,is_active) VALUES(local_id::uuid,local_auth,tenant::uuid,member->>'name',subject.email,'','Management',CASE WHEN member->>'role' IN('owner','admin') THEN 'admin' ELSE 'user' END,true);
   ELSE UPDATE users SET organization_id=tenant::uuid,is_active=true WHERE id=local_id::uuid; END IF;
  ELSE
   SELECT to_jsonb(u) INTO old_user FROM users u WHERE u.id=local_id::uuid;
   IF old_user IS NOT NULL AND old_user->>'auth_id'<>local_auth::text THEN RAISE EXCEPTION 'Existing Growth identity mismatch'; END IF;
   IF old_user IS NULL THEN INSERT INTO users(id,auth_id,username,password_hash,name,role,clinic_name,clinic_address) VALUES(local_id::uuid,local_auth,'suite_'||local_id,'!supabase-auth-only!',member->>'name',CASE WHEN member->>'role' IN('owner','admin') THEN 'admin' ELSE 'receptionist' END,p_snapshot#>>'{organization,name}',''); END IF;
  END IF;
  INSERT INTO ds_runtime_members(member_id,organization_id,central_auth_id,local_auth_id,local_user_id,role,active)
  VALUES((link->>'member_id')::uuid,org,(member->>'auth_user_id')::uuid,local_auth,local_id,member->>'role',true)
  ON CONFLICT(member_id) DO UPDATE SET role=EXCLUDED.role,active=true;
  result:=result||jsonb_build_array(jsonb_build_object('member_id',v_member_id,'local_user_id',local_id,'local_auth_id',local_auth));
 END LOOP;
 UPDATE ds_runtime_members m SET active=false WHERE m.organization_id=org AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_links) l WHERE l->>'member_id'=m.member_id::text);
 IF product='opd' THEN UPDATE profiles p SET is_active=false FROM ds_runtime_members m WHERE m.organization_id=org AND NOT m.active AND p.id::text=m.local_user_id;
 ELSIF product='workforce' THEN UPDATE users u SET is_active=false FROM ds_runtime_members m WHERE m.organization_id=org AND NOT m.active AND u.id::text=m.local_user_id; END IF;
 PERFORM ds_capacity_review(tenant);
 PERFORM set_config('ds.provisioning','off',true);
 RETURN jsonb_build_object('local_tenant_id',tenant,'version',v_version,'identities',result);
END $$;
REVOKE ALL ON FUNCTION public.ds_runtime_auth(uuid,uuid,text),public.ds_runtime_apply(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ds_runtime_auth(uuid,uuid,text),public.ds_runtime_apply(jsonb,jsonb) TO service_role;

-- Product-local RPC hardening. Preserve signatures while putting data functions
-- behind the same non-bypassing role and restrictive policies as ordinary users.

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ds_rpc_runner') THEN CREATE ROLE ds_rpc_runner NOLOGIN NOSUPERUSER NOBYPASSRLS INHERIT; END IF;
END $$;
GRANT authenticated TO ds_rpc_runner;
GRANT USAGE,CREATE ON SCHEMA public TO ds_rpc_runner;
CREATE SCHEMA ds_private;
REVOKE ALL ON SCHEMA ds_private FROM PUBLIC,anon,authenticated;
GRANT USAGE,CREATE ON SCHEMA ds_private TO ds_rpc_runner;
CREATE TABLE public.ds_rpc_wrappers(name text NOT NULL,signature text PRIMARY KEY,original_oid oid NOT NULL);
ALTER TABLE public.ds_rpc_wrappers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ds_rpc_wrappers FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.ds_rpc_wrappers TO service_role;
CREATE OR REPLACE FUNCTION public.ds_runtime_service_request() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role'
 OR current_setting('role',true)='service_role'
$$;
CREATE FUNCTION public.ds_runtime_reference(p_table text,p_id text) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row_data jsonb;
BEGIN
 IF p_table NOT IN('users','profiles','notifications','tasks','appointments','patients','report_requests','gmb_locations','attendance','attendance_import_batches','payroll_periods','ipd_admissions','medicine_batches','pharmacy_inward_items','bills','prescriptions') OR to_regclass('public.'||p_table) IS NULL THEN RETURN '{}'; END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id::text=$1',p_table) INTO row_data USING p_id;
 IF row_data IS NULL THEN RETURN '{}'; END IF;
 RETURN ds_runtime_scopes(p_table,row_data);
END $$;
CREATE FUNCTION public.ds_runtime_request_context(p_body jsonb,p_auth uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE state jsonb;scopes text[]:='{}';entry record;key text;value text;target text;product text;mine text;tenant text;person ds_runtime_members;
BEGIN
 SELECT c.product INTO product FROM ds_runtime_config c;
 IF p_auth IS NOT NULL THEN
  state:=ds_runtime_user_status(p_auth);
  IF NOT coalesce((state->>'allowed')::boolean,false) THEN RAISE EXCEPTION 'Suite product access is inactive or setup is pending'; END IF;
  mine:=state->>'local_tenant_id';
  IF mine IS NOT NULL THEN scopes:=ARRAY[mine]; END IF;
  SELECT * INTO person FROM ds_runtime_members WHERE local_auth_id=p_auth;
 END IF;
 FOR entry IN SELECT * FROM jsonb_each(CASE WHEN jsonb_typeof(p_body)='object' THEN p_body ELSE '{}'::jsonb END) LOOP
  IF jsonb_typeof(entry.value)<>'string' THEN CONTINUE; END IF;
  key:=lower(regexp_replace(entry.key,'[^a-zA-Z0-9]','','g'));key:=regexp_replace(key,'^p(?=organization|clinic|user|profile|task|notification|patient|location|appointment|admission|batch|period|bill|prescription|report)','');
  value:=entry.value#>>'{}';
  IF key IN('organizationid','clinicid','localtenantid') THEN scopes:=scopes||value; CONTINUE; END IF;
  target:=CASE key WHEN 'userid' THEN CASE WHEN product='opd' THEN 'profiles' ELSE 'users' END WHEN 'profileid' THEN CASE WHEN product='opd' THEN 'profiles' ELSE 'users' END
   WHEN 'notificationid' THEN 'notifications' WHEN 'taskid' THEN 'tasks' WHEN 'appointmentid' THEN 'appointments' WHEN 'patientid' THEN 'patients'
   WHEN 'reportrequestid' THEN 'report_requests' WHEN 'locationid' THEN 'gmb_locations' WHEN 'attendanceid' THEN 'attendance'
   WHEN 'batchid' THEN 'attendance_import_batches' WHEN 'periodid' THEN 'payroll_periods' WHEN 'admissionid' THEN 'ipd_admissions'
   WHEN 'billid' THEN 'bills' WHEN 'prescriptionid' THEN 'prescriptions' ELSE NULL END;
  IF target IS NOT NULL THEN scopes:=scopes||ds_runtime_reference(target,value); END IF;
  IF person.member_id IS NOT NULL AND person.role='member' AND key IN('userid','profileid') AND value NOT IN(person.local_user_id,person.local_auth_id::text) THEN RAISE EXCEPTION 'This operation requires an organisation administrator'; END IF;
 END LOOP;
 scopes:=ARRAY(SELECT DISTINCT unnest(scopes));
 IF cardinality(scopes)>1 THEN RAISE EXCEPTION 'Request references more than one product tenant'; END IF;
 tenant:=scopes[1];
 IF p_auth IS NOT NULL AND mine IS NOT NULL AND tenant IS DISTINCT FROM mine THEN RAISE EXCEPTION 'Request tenant differs from the signed-in account'; END IF;
 IF tenant IS NOT NULL THEN
  PERFORM ds_runtime_assert(tenant);
  IF p_auth IS NULL AND NOT ds_runtime_service_request() AND EXISTS(SELECT 1 FROM ds_runtime_bindings WHERE local_tenant_id=tenant) THEN RAISE EXCEPTION 'Authentication required'; END IF;
 END IF;
 RETURN coalesce(state,'{}'::jsonb)||jsonb_build_object('local_tenant_id',tenant,'role',person.role,'managed',person.member_id IS NOT NULL OR EXISTS(SELECT 1 FROM ds_runtime_bindings WHERE local_tenant_id=tenant));
END $$;
CREATE FUNCTION public.ds_runtime_rpc_guard(p_name text,p_args jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE state jsonb;subject uuid:=auth.uid();
BEGIN
 IF subject IS NULL AND NOT ds_runtime_service_request() THEN RAISE EXCEPTION 'Authentication required'; END IF;
 state:=ds_runtime_request_context(p_args,subject);
 IF coalesce((state->>'managed')::boolean,false) AND p_name IN('get_unused_auth_users','delete_user_by_email','update_missing_whatsapp_numbers') THEN RAISE EXCEPTION 'Manage suite identities through Suite Admin'; END IF;
END $$;
-- Worker calls retain their existing service authority only when the JWT role
-- actually is service_role; the runner itself cannot mint that authority.
DO $$ DECLARE t record;BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'ds\_%' ESCAPE '\' AND tablename NOT LIKE 'suite\_%' ESCAPE '\' LOOP
  EXECUTE format('CREATE POLICY ds_machine_access ON public.%I FOR ALL TO ds_rpc_runner USING(public.ds_runtime_service_request() AND public.ds_runtime_row_allowed(%L,to_jsonb(%I))) WITH CHECK(public.ds_runtime_service_request() AND public.ds_runtime_row_allowed(%L,to_jsonb(%I)))',t.tablename,t.tablename,t.tablename,t.tablename,t.tablename);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.ds_runtime_row_allowed(text,jsonb),public.ds_runtime_service_request(),public.ds_runtime_rpc_guard(text,jsonb) TO ds_rpc_runner;
REVOKE ALL ON FUNCTION public.ds_runtime_service_request(),public.ds_runtime_reference(text,text),public.ds_runtime_request_context(jsonb,uuid),public.ds_runtime_rpc_guard(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ds_runtime_service_request(),public.ds_runtime_reference(text,text),public.ds_runtime_request_context(jsonb,uuid),public.ds_runtime_rpc_guard(text,jsonb) TO service_role;
DO $$ DECLARE f record;idx integer;position integer;args text;call_args text;json_args text;out_args text;arg text;mode text;body text;call_sql text;can_anon boolean;can_auth boolean;can_service boolean;is_identity_helper boolean; BEGIN
 FOR f IN SELECT p.*,pg_get_function_arguments(p.oid) arguments,pg_get_function_result(p.oid) result_type,pg_get_function_identity_arguments(p.oid) identity_args
  FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND l.lanname IN('sql','plpgsql')
  AND p.proname NOT LIKE 'ds\_%' ESCAPE '\' AND p.proname NOT LIKE 'suite\_%' ESCAPE '\'
  AND p.prorettype NOT IN('trigger'::regtype,'event_trigger'::regtype)
  AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e')
 LOOP
  can_anon:=has_function_privilege('anon',f.oid,'EXECUTE');can_auth:=has_function_privilege('authenticated',f.oid,'EXECUTE');can_service:=has_function_privilege('service_role',f.oid,'EXECUTE');
  args:='';call_args:='';json_args:='';out_args:='';position:=0;
  FOR idx IN 1..coalesce(cardinality(f.proallargtypes),f.pronargs) LOOP
   mode:=coalesce(f.proargmodes[idx]::text,'i');
   IF mode IN('i','b','v') THEN
    position:=position+1;arg:=CASE WHEN coalesce(f.proargnames[idx],'')<>'' THEN quote_ident(f.proargnames[idx]) ELSE '$'||position END;
    call_args:=call_args||CASE WHEN call_args='' THEN '' ELSE ',' END||CASE WHEN mode='v' THEN 'VARIADIC ' ELSE '' END||arg;
    json_args:=json_args||CASE WHEN json_args='' THEN '' ELSE ',' END||quote_literal(coalesce(nullif(f.proargnames[idx],''),'arg'||position))||',to_jsonb('||arg||')';
   END IF;
   IF mode IN('o','b','t') THEN out_args:=out_args||CASE WHEN out_args='' THEN '' ELSE ',' END||quote_ident(f.proargnames[idx]); END IF;
  END LOOP;
  call_sql:=format('ds_private.%I(%s)',f.proname,call_args);
  is_identity_helper:=f.prorettype IN('boolean'::regtype,'uuid'::regtype,'uuid[]'::regtype) AND f.prosrc~'auth[.]uid[[:space:]]*[(]';
  EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA ds_private',f.proname,f.identity_args);
  IF NOT is_identity_helper THEN EXECUTE format('ALTER FUNCTION ds_private.%I(%s) OWNER TO ds_rpc_runner',f.proname,f.identity_args); END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION ds_private.%I(%s) TO ds_rpc_runner',f.proname,f.identity_args);
  body:=format('BEGIN PERFORM public.ds_runtime_rpc_guard(%L,jsonb_build_object(%s)); ',f.proname,json_args);
  IF f.proretset THEN body:=body||'RETURN QUERY SELECT * FROM '||call_sql||'; RETURN;';
  ELSIF out_args<>'' THEN body:=body||'SELECT * INTO '||out_args||' FROM '||call_sql||'; RETURN;';
  ELSIF f.prorettype='void'::regtype THEN body:=body||'PERFORM '||call_sql||'; RETURN;';
  ELSE body:=body||'RETURN '||call_sql||';'; END IF;
  body:=body||' END';
  EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS %L',f.proname,f.arguments,f.result_type,body);
  EXECUTE format('ALTER FUNCTION public.%I(%s) OWNER TO ds_rpc_runner',f.proname,f.identity_args);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated,service_role',f.proname,f.identity_args);
  IF can_anon THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon',f.proname,f.identity_args); END IF;
  IF can_auth THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',f.proname,f.identity_args); END IF;
  IF can_service THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',f.proname,f.identity_args); END IF;
  INSERT INTO ds_rpc_wrappers VALUES(f.proname,format('%I(%s)',f.proname,f.identity_args),f.oid);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public,ds_private FROM ds_rpc_runner;
CREATE FUNCTION public.ds_runtime_coverage() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('database_ready',NOT EXISTS(
  SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relname NOT LIKE 'ds\_%' ESCAPE '\' AND c.relname NOT LIKE 'suite\_%' ESCAPE '\'
  AND (NOT c.relrowsecurity OR NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='ds_suite_access') OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='ds_suite_write' AND t.tgenabled<>'D'))
 ),'rpc_ready',NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND l.lanname IN('sql','plpgsql')
  AND p.proname NOT LIKE 'ds\_%' ESCAPE '\' AND p.proname NOT LIKE 'suite\_%' ESCAPE '\' AND p.prorettype NOT IN('trigger'::regtype,'event_trigger'::regtype)
  AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e')
  AND (p.proowner<>(SELECT oid FROM pg_roles WHERE rolname='ds_rpc_runner') OR p.prosrc NOT LIKE '%ds_runtime_rpc_guard%')
 ))
$$;
REVOKE ALL ON FUNCTION public.ds_runtime_coverage() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ds_runtime_coverage() TO service_role;
-- Views must respect their caller's restrictive table policies as well.
DO $$ DECLARE v record;BEGIN
 FOR v IN SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='v' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.classid='pg_class'::regclass AND d.deptype='e') LOOP
  EXECUTE format('ALTER VIEW public.%I SET(security_invoker=true)',v.relname);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';

COMMIT;
