CREATE TABLE IF NOT EXISTS ds_node_bindings(
 organization_id uuid NOT NULL,product_code text NOT NULL CHECK(product_code IN('opd','growth','workforce','whatsapp')),
 local_tenant_id text NOT NULL,version integer NOT NULL,snapshot jsonb NOT NULL,
 access_until timestamptz,active_since timestamptz,fresh_until timestamptz NOT NULL,issued_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,product_code),UNIQUE(product_code,local_tenant_id)
);
-- ds-statement
CREATE TABLE IF NOT EXISTS ds_node_members(
 organization_id uuid NOT NULL,product_code text NOT NULL,member_id uuid NOT NULL,central_auth_id uuid NOT NULL,
 source_user_id text NOT NULL,backend_user_id text NOT NULL,role text NOT NULL,active boolean NOT NULL,
 PRIMARY KEY(organization_id,product_code,member_id),UNIQUE(product_code,backend_user_id),
 FOREIGN KEY(organization_id,product_code) REFERENCES ds_node_bindings(organization_id,product_code)
);
-- ds-statement
CREATE TABLE IF NOT EXISTS ds_node_legacy_users(user_id text PRIMARY KEY);
-- ds-statement
CREATE TABLE IF NOT EXISTS ds_node_setup(singleton boolean PRIMARY KEY CHECK(singleton),seeded_at timestamptz NOT NULL DEFAULT now());
-- ds-statement
DO $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('ds-node-legacy-seed',0));
 IF NOT EXISTS(SELECT 1 FROM ds_node_setup WHERE singleton) THEN
  INSERT INTO ds_node_legacy_users SELECT id::text FROM users ON CONFLICT DO NOTHING;
  INSERT INTO ds_node_setup(singleton) VALUES(true);
 END IF;
END $$;
-- ds-statement
CREATE OR REPLACE FUNCTION ds_node_session_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text:=to_jsonb(NEW)->>'user_id';binding ds_node_bindings;capacity integer;used bigint;
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD)->>'user_id' IS DISTINCT FROM owner_id AND EXISTS(SELECT 1 FROM ds_node_members WHERE backend_user_id IN(owner_id,to_jsonb(OLD)->>'user_id')) THEN RAISE EXCEPTION 'Suite session owner cannot be reassigned';END IF;
 SELECT b.* INTO binding FROM ds_node_bindings b JOIN ds_node_members m USING(organization_id,product_code) WHERE m.backend_user_id=owner_id AND b.product_code='whatsapp';
 IF NOT FOUND THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ds-node:'||binding.organization_id::text,0));
 -- Reload after the lock: a concurrent plan update may have changed capacity.
 SELECT * INTO binding FROM ds_node_bindings WHERE organization_id=binding.organization_id AND product_code='whatsapp';
 capacity:=ds_node_number_limit(binding.snapshot);
 EXECUTE format('SELECT count(*) FROM public.%I s WHERE s.user_id::text IN(SELECT backend_user_id FROM ds_node_members WHERE organization_id=$1 AND product_code=''whatsapp'')',TG_TABLE_NAME) INTO used USING binding.organization_id;
 IF used>=capacity THEN RAISE EXCEPTION 'WhatsApp number/session capacity exceeded';END IF;
 RETURN NEW;
END $$;
-- ds-statement
CREATE OR REPLACE FUNCTION ds_node_number_limit(snapshot jsonb) RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE value jsonb:=snapshot#>'{organization,plan_snapshot,limits,whatsapp_numbers}';amount numeric;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'WhatsApp number capacity is not configured';END IF;
 amount:=value::text::numeric;
 IF amount<0 OR amount>2147483647 OR trunc(amount)<>amount THEN RAISE EXCEPTION 'Invalid WhatsApp number capacity';END IF;
 RETURN amount::integer;
END $$;
-- ds-statement
DO $$ BEGIN
 IF to_regclass('public.whatsapp_sessions') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ds_node_session_capacity' AND tgrelid=to_regclass('public.whatsapp_sessions')) THEN CREATE TRIGGER ds_node_session_capacity BEFORE INSERT OR UPDATE ON whatsapp_sessions FOR EACH ROW EXECUTE FUNCTION ds_node_session_capacity();END IF;
END $$;
-- ds-statement
CREATE OR REPLACE FUNCTION ds_node_apply(p_snapshot jsonb,p_links jsonb,p_modern boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE org uuid:=(p_snapshot->>'organization_id')::uuid;product text:=p_snapshot->>'product_code';tenant text:=p_snapshot->>'local_tenant_id';
 v_version integer:=(p_snapshot->>'version')::integer;previous ds_node_bindings;link jsonb;member jsonb;found_user jsonb;backend_id text;
 expiry timestamptz;since_at timestamptz;result jsonb:='[]';known ds_node_members;affected integer;capacity integer;used bigint;
BEGIN
 IF tenant IS NULL OR jsonb_typeof(p_links)<>'array' OR product NOT IN('opd','growth','workforce','whatsapp') OR NOT p_modern AND product NOT IN('opd','growth') OR p_modern AND product NOT IN('workforce','whatsapp') THEN RAISE EXCEPTION 'Invalid messaging dependency'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ds-node:'||org::text,0));
 SELECT * INTO previous FROM ds_node_bindings WHERE organization_id=org AND product_code=product FOR UPDATE;
 IF FOUND AND (previous.version>v_version OR previous.issued_at>(p_snapshot->>'issued_at')::timestamptz OR previous.local_tenant_id<>tenant) THEN RAISE EXCEPTION 'Messaging tenant/version cannot be reassigned'; END IF;
 IF (p_snapshot->>'refresh_by')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'Messaging snapshot is stale'; END IF;
 SELECT max((g->>'ends_at')::timestamptz),max((g->>'starts_at')::timestamptz) INTO expiry,since_at
 FROM jsonb_array_elements(coalesce(p_snapshot->'grants','[]')||CASE WHEN jsonb_typeof(p_snapshot->'trial')='object' THEN jsonb_build_array(p_snapshot->'trial') ELSE '[]'::jsonb END) g
 WHERE g->>'revoked_at' IS NULL AND (g->>'starts_at')::timestamptz<=now() AND (g->>'ends_at')::timestamptz>now();
 IF p_snapshot#>>'{organization,status}'<>'active' THEN expiry:=NULL; END IF;
 INSERT INTO ds_node_bindings(organization_id,product_code,local_tenant_id,version,snapshot,access_until,active_since,fresh_until,issued_at)
 VALUES(org,product,tenant,v_version,p_snapshot,expiry,since_at,(p_snapshot->>'refresh_by')::timestamptz,(p_snapshot->>'issued_at')::timestamptz)
 ON CONFLICT(organization_id,product_code) DO UPDATE SET version=EXCLUDED.version,snapshot=EXCLUDED.snapshot,access_until=EXCLUDED.access_until,active_since=EXCLUDED.active_since,fresh_until=EXCLUDED.fresh_until,issued_at=EXCLUDED.issued_at;
 FOR link IN SELECT value FROM jsonb_array_elements(p_links) LOOP
  SELECT value INTO member FROM jsonb_array_elements(p_snapshot->'members') m WHERE m->>'id'=link->>'member_id' AND m->>'status'='active' AND m->>'role'<>'billing';
  IF member IS NULL THEN RAISE EXCEPTION 'Unknown messaging member'; END IF;
  IF p_modern THEN
   backend_id:=link->>'backend_user_id';
   SELECT to_jsonb(u) INTO found_user FROM users u WHERE id::text=backend_id FOR UPDATE;
   IF found_user IS NOT NULL AND found_user->>'organization_id'<>coalesce(p_snapshot->>'backend_tenant_id',tenant) THEN RAISE EXCEPTION 'Existing messaging user belongs to another organisation'; END IF;
   IF found_user IS NULL THEN
    IF link->>'password_hash' IS NULL THEN RAISE EXCEPTION 'A new external identity requires an unknown random password'; END IF;
    INSERT INTO users(id,username,password,email,organization_id,role,created_at,updated_at)
    VALUES(backend_id,'suite_'||backend_id,link->>'password_hash',NULL,coalesce(p_snapshot->>'backend_tenant_id',tenant),'user',now(),now());
   END IF;
  ELSE
   SELECT to_jsonb(u) INTO found_user FROM users u WHERE auth_id::text=link->>'source_auth_id' LIMIT 1 FOR UPDATE;
   IF found_user IS NULL THEN RAISE EXCEPTION 'Legacy user synchronisation must finish before linking its dependency'; END IF;
   SELECT count(*) INTO affected FROM users WHERE auth_id::text=link->>'source_auth_id';
   IF affected<>1 THEN RAISE EXCEPTION 'Legacy Auth identity is ambiguous; reconcile it explicitly'; END IF;
   backend_id:=found_user->>'id';
  END IF;
  SELECT * INTO known FROM ds_node_members WHERE organization_id=org AND product_code=product AND member_id=(member->>'id')::uuid;
  IF FOUND AND (known.backend_user_id<>backend_id OR known.source_user_id<>link->>'source_user_id' OR known.central_auth_id<>(member->>'auth_user_id')::uuid) THEN RAISE EXCEPTION 'Messaging identity cannot be silently reassigned'; END IF;
  IF EXISTS(SELECT 1 FROM ds_node_members WHERE backend_user_id=backend_id AND organization_id<>org) THEN RAISE EXCEPTION 'Messaging account is already linked to another suite organisation'; END IF;
  INSERT INTO ds_node_members(organization_id,product_code,member_id,central_auth_id,source_user_id,backend_user_id,role,active)
  VALUES(org,product,(member->>'id')::uuid,(member->>'auth_user_id')::uuid,link->>'source_user_id',backend_id,member->>'role',true)
  ON CONFLICT(organization_id,product_code,member_id) DO UPDATE SET role=EXCLUDED.role,active=true;
  result:=result||jsonb_build_array(jsonb_build_object('member_id',member->>'id','local_user_id',backend_id,'local_auth_id',NULL,'source_user_id',link->>'source_user_id'));
 END LOOP;
 UPDATE ds_node_members m SET active=false WHERE m.organization_id=org AND m.product_code=product AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_links) l WHERE l->>'member_id'=m.member_id::text);
 -- Review existing slots during enrolment and plan changes. Revocation must
 -- still succeed without deleting or disconnecting any shared phone session.
 IF product='whatsapp' AND expiry IS NOT NULL THEN
  capacity:=ds_node_number_limit(p_snapshot);
  IF to_regclass('public.whatsapp_sessions') IS NOT NULL THEN
   EXECUTE 'SELECT count(*) FROM public.whatsapp_sessions s WHERE s.user_id::text IN(SELECT backend_user_id FROM ds_node_members WHERE organization_id=$1 AND product_code=''whatsapp'')' INTO used USING org;
   IF used>capacity THEN RAISE EXCEPTION 'Existing WhatsApp number/session capacity exceeded';END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('local_tenant_id',tenant,'version',v_version,'identities',result);
END $$;
-- ds-statement
CREATE OR REPLACE FUNCTION ds_node_user_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text;
BEGIN
 IF EXISTS(SELECT 1 FROM ds_node_members WHERE backend_user_id=OLD.id::text) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Manage suite identity through Suite Admin'; END IF;
  FOREACH field IN ARRAY ARRAY['id','organization_id','role','auth_id'] LOOP
   IF to_jsonb(OLD)->field IS DISTINCT FROM to_jsonb(NEW)->field THEN RAISE EXCEPTION 'Suite messaging identity cannot be reassigned'; END IF;
  END LOOP;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
-- ds-statement
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ds_node_user_identity' AND tgrelid='users'::regclass) THEN CREATE TRIGGER ds_node_user_identity BEFORE UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION ds_node_user_guard();END IF;
END $$;
