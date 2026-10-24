-- Product-local RPC hardening. Preserve signatures while putting data functions
-- behind the same non-bypassing role and restrictive policies as ordinary users.
BEGIN;
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
