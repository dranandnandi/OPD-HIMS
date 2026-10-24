-- Product resource limits, serialized per enrolled tenant; no legacy data reset.
BEGIN;
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
COMMIT;
