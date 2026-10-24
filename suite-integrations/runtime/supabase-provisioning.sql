-- Append after the product runtime migration. Service-only provisioning RPCs.
BEGIN;
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
COMMIT;
