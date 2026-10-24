-- Additive control plane. Does not modify clinical tables or existing policies.
-- Only the service role can access suite_* tables/RPCs. The Edge Function must
-- authenticate the caller and enforce the separate platform-admin allowlist.
BEGIN;

CREATE TABLE public.suite_products (
  code text PRIMARY KEY, name text NOT NULL
);
INSERT INTO public.suite_products VALUES
  ('opd','Clinic Operations'), ('growth','Clinic Growth'),
  ('whatsapp','Patient Communication'), ('workforce','Staff & Tasks');

CREATE TABLE public.suite_plans (
  code text PRIMARY KEY, name text NOT NULL, limits jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.suite_plans(code,name,limits) VALUES
  ('clinic_core','Clinic Operations','{"locations":1,"doctors":2,"staff":5}'),
  ('clinic_growth','Clinic Growth','{"locations":1,"google_profiles":1,"staff":3}'),
  ('clinic_connect','Patient Communication','{"whatsapp_numbers":1,"operators":3}'),
  ('clinic_workforce','Staff & Tasks','{"locations":1,"employees":10}'),
  ('doctor_complete','Complete Doctor Suite','{"locations":1,"doctors":2,"staff":10,"google_profiles":1,"whatsapp_numbers":1}');

CREATE TABLE public.suite_plan_products (
  plan_code text REFERENCES public.suite_plans(code),
  product_code text REFERENCES public.suite_products(code),
  PRIMARY KEY(plan_code,product_code)
);
INSERT INTO public.suite_plan_products VALUES
  ('clinic_core','opd'), ('clinic_growth','growth'), ('clinic_connect','whatsapp'),
  ('clinic_workforce','workforce'), ('doctor_complete','opd'),
  ('doctor_complete','growth'), ('doctor_complete','whatsapp'), ('doctor_complete','workforce');

CREATE TABLE public.suite_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code text NOT NULL REFERENCES public.suite_plans(code),
  interval text NOT NULL CHECK (interval IN ('month','year')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 1000000000),
  currency text NOT NULL DEFAULT 'INR' CHECK(currency = 'INR'),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);

CREATE TABLE public.suite_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
  owner_email text NOT NULL, plan_code text NOT NULL REFERENCES public.suite_plans(code),
  plan_snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  trial_started_at timestamptz, trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  CHECK ((trial_started_at IS NULL) = (trial_ends_at IS NULL)),
  CHECK (trial_ends_at > trial_started_at)
);
CREATE TABLE public.suite_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.suite_organizations(id),
  email text NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  auth_user_id uuid REFERENCES auth.users(id),
  role text NOT NULL CHECK(role IN ('owner','admin','member','billing')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,email),
  UNIQUE(organization_id,auth_user_id)
);
CREATE TABLE public.suite_bindings (
  organization_id uuid NOT NULL REFERENCES public.suite_organizations(id),
  product_code text NOT NULL REFERENCES public.suite_products(code),
  local_tenant_id text,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','linked','ready','failed')),
  enforcement_version text, last_error text, version integer NOT NULL DEFAULT 1,
  PRIMARY KEY(organization_id,product_code), UNIQUE(product_code,local_tenant_id)
);
CREATE TABLE public.suite_product_trials (
  organization_id uuid NOT NULL, product_code text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at > starts_at),
  PRIMARY KEY(organization_id,product_code),
  FOREIGN KEY(organization_id,product_code) REFERENCES public.suite_bindings(organization_id,product_code)
);
CREATE TABLE public.suite_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  product_code text NOT NULL, kind text NOT NULL DEFAULT 'manual' CHECK(kind='manual'),
  starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000), created_by uuid NOT NULL,
  CHECK(ends_at > starts_at),
  FOREIGN KEY(organization_id,product_code) REFERENCES public.suite_bindings(organization_id,product_code)
);
CREATE TABLE public.suite_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, product_code text NOT NULL,
  version integer NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','failed')),
  attempts integer NOT NULL DEFAULT 0, lease_id uuid, lease_until timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,product_code,version),
  FOREIGN KEY(organization_id,product_code) REFERENCES public.suite_bindings(organization_id,product_code)
);
CREATE TABLE public.suite_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid REFERENCES public.suite_organizations(id),
  actor_id uuid NOT NULL, action text NOT NULL, reason text, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.suite_requests (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL, action text NOT NULL, payload jsonb NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suite_memberships_identity ON public.suite_memberships(auth_user_id);
CREATE INDEX suite_audit_org ON public.suite_audit(organization_id,created_at DESC);
CREATE INDEX suite_jobs_queue ON public.suite_jobs(state,lease_until,created_at);
CREATE INDEX suite_grants_org ON public.suite_access_grants(organization_id,product_code,ends_at);

CREATE FUNCTION public.suite_org_json(p_org public.suite_organizations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(p_org) - 'plan_snapshot' || jsonb_build_object(
    'trial_status', CASE WHEN p_org.status='suspended' THEN 'suspended'
      WHEN p_org.trial_ends_at IS NULL THEN 'not_started'
      WHEN p_org.trial_ends_at <= now() THEN 'expired' ELSE 'trial' END,
    'ready_count',(SELECT count(*) FROM suite_bindings WHERE organization_id=p_org.id AND state='ready'),
    'product_count',(SELECT count(*) FROM suite_bindings WHERE organization_id=p_org.id)
  )
$$;

CREATE FUNCTION public.suite_overview(p_search text DEFAULT '', p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
SELECT jsonb_build_object(
  'server_time',now(),
  'total',(SELECT count(*) FROM suite_organizations WHERE name ILIKE '%' || left(p_search,160) || '%' OR owner_email ILIKE '%' || left(p_search,160) || '%'),
  'organizations',coalesce((SELECT jsonb_agg(suite_org_json(o)) FROM (
    SELECT * FROM suite_organizations WHERE name ILIKE '%' || left(p_search,160) || '%' OR owner_email ILIKE '%' || left(p_search,160) || '%'
    ORDER BY created_at DESC,id LIMIT 50 OFFSET greatest(p_offset,0)) o),'[]'),
  'products',(SELECT jsonb_agg(to_jsonb(p) ORDER BY code) FROM suite_products p),
  'plans',(SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object(
    'products',(SELECT jsonb_agg(product_code ORDER BY product_code) FROM suite_plan_products WHERE plan_code=p.code),
    'prices',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT DISTINCT ON (interval) * FROM suite_prices WHERE plan_code=p.code ORDER BY interval,created_at DESC,id DESC) x),'[]')
  ) ORDER BY p.code) FROM suite_plans p)
)
$$;

CREATE FUNCTION public.suite_detail(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
SELECT jsonb_build_object(
  'organization',suite_org_json(o),
  'bindings',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY product_code) FROM suite_bindings b WHERE organization_id=o.id),'[]'),
  'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at) FROM suite_memberships m WHERE organization_id=o.id),'[]'),
  'grants',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY ends_at DESC) FROM suite_access_grants g WHERE organization_id=o.id),'[]'),
  'audit',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT * FROM suite_audit WHERE organization_id=o.id ORDER BY id DESC LIMIT 50) a),'[]')
) FROM suite_organizations o WHERE id=p_id
$$;

-- Called only from the authenticated admin Edge Function, never from a browser RPC.
CREATE FUNCTION public.suite_mutate(p_actor uuid, p_request uuid, p_action text, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old suite_requests; v_org suite_organizations; v_id uuid; v_user uuid;
  v_email text; v_reason text; v_end timestamptz; v_result jsonb; v_plan suite_plans;
  v_product text; v_member suite_memberships; v_count integer; v_owner_count integer;
BEGIN
  IF p_actor IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'Actor and request ID required'; END IF;
  -- Serialise identical retries, and reject reusing a key for another operation.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  SELECT * INTO v_old FROM suite_requests WHERE id=p_request;
  IF FOUND THEN
    IF v_old.actor_id<>p_actor OR v_old.action<>p_action OR v_old.payload<>p_payload THEN
      RAISE EXCEPTION 'Request ID already used for a different operation';
    END IF;
    RETURN v_old.result;
  END IF;
  v_reason := nullif(trim(p_payload->>'reason'),'');
  IF p_action NOT IN ('create_organization','publish_price') THEN
    v_id := (p_payload->>'organization_id')::uuid;
    SELECT * INTO v_org FROM suite_organizations WHERE id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Organisation not found'; END IF;
  END IF;

  CASE p_action
  WHEN 'create_organization' THEN
    SELECT * INTO v_plan FROM suite_plans WHERE code=p_payload->>'plan_code';
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown plan'; END IF;
    v_email := lower(trim(p_payload->>'owner_email'));
    IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Valid owner email required'; END IF;
    INSERT INTO suite_organizations(name,owner_email,plan_code,plan_snapshot,created_by)
    VALUES(trim(p_payload->>'name'),v_email,v_plan.code,to_jsonb(v_plan),p_actor) RETURNING id INTO v_id;
    -- No unverified email auto-linking. An existing confirmed central login can be linked.
    SELECT id INTO v_user FROM auth.users WHERE lower(email)=v_email AND email_confirmed_at IS NOT NULL;
    INSERT INTO suite_memberships(organization_id,email,name,auth_user_id,role,status)
    VALUES(v_id,v_email,trim(p_payload->>'owner_name'),v_user,'owner',CASE WHEN v_user IS NULL THEN 'pending' ELSE 'active' END);
    INSERT INTO suite_bindings(organization_id,product_code)
    SELECT v_id,product_code FROM suite_plan_products WHERE plan_code=v_plan.code;

  WHEN 'publish_price' THEN
    INSERT INTO suite_prices(plan_code,interval,amount_minor,created_by)
    VALUES(p_payload->>'plan_code',p_payload->>'interval',(p_payload->>'amount_minor')::bigint,p_actor);

  WHEN 'set_status' THEN
    IF coalesce(length(v_reason),0)<5 THEN RAISE EXCEPTION 'A reason of at least five characters is required'; END IF;
    UPDATE suite_organizations SET status=p_payload->>'status' WHERE id=v_id;

  WHEN 'start_trial' THEN
    IF v_org.status<>'active' THEN RAISE EXCEPTION 'Reactivate the organisation first'; END IF;
    IF v_org.trial_started_at IS NOT NULL THEN RAISE EXCEPTION 'Trial already used; use an audited extension'; END IF;
    IF EXISTS(SELECT 1 FROM suite_bindings WHERE organization_id=v_id AND (state<>'ready' OR enforcement_version IS DISTINCT FROM 'suite.access.v1')) THEN
      RAISE EXCEPTION 'All products must confirm provisioning and access enforcement before starting the trial';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM suite_memberships WHERE organization_id=v_id AND role='owner' AND status='active') THEN
      RAISE EXCEPTION 'Link a verified owner login before activating the trial';
    END IF;
    UPDATE suite_organizations SET trial_started_at=now(),trial_ends_at=now()+interval '168 hours' WHERE id=v_id;
    INSERT INTO suite_product_trials(organization_id,product_code,starts_at,ends_at)
    SELECT v_id,product_code,now(),now()+interval '168 hours' FROM suite_bindings WHERE organization_id=v_id;

  WHEN 'extend_trial' THEN
    IF v_org.trial_started_at IS NULL THEN RAISE EXCEPTION 'Start the trial first'; END IF;
    IF coalesce(length(v_reason),0)<5 THEN RAISE EXCEPTION 'A reason of at least five characters is required'; END IF;
    v_count := (p_payload->>'days')::integer;
    IF v_count IS NULL OR v_count NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Extension must be between 1 and 30 days'; END IF;
    v_end := greatest(now(),v_org.trial_ends_at)+make_interval(hours=>v_count*24);
    UPDATE suite_organizations SET trial_ends_at=v_end WHERE id=v_id;
    UPDATE suite_product_trials SET ends_at=v_end WHERE organization_id=v_id;

  WHEN 'add_member' THEN
    v_email := lower(trim(p_payload->>'email'));
    IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Valid email required'; END IF;
    SELECT id INTO v_user FROM auth.users WHERE lower(email)=v_email AND email_confirmed_at IS NOT NULL;
    INSERT INTO suite_memberships(organization_id,email,name,auth_user_id,role,status)
    VALUES(v_id,v_email,trim(p_payload->>'name'),v_user,p_payload->>'role',CASE WHEN v_user IS NULL THEN 'pending' ELSE 'active' END);

  WHEN 'link_member' THEN
    SELECT * INTO v_member FROM suite_memberships WHERE id=(p_payload->>'member_id')::uuid AND organization_id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Member not found in this organisation'; END IF;
    SELECT id INTO v_user FROM auth.users WHERE lower(email)=v_member.email AND email_confirmed_at IS NOT NULL;
    IF v_user IS NULL THEN RAISE EXCEPTION 'No verified central login exists for this email yet'; END IF;
    IF v_member.status='disabled' THEN RAISE EXCEPTION 'Restore the membership before linking'; END IF;
    UPDATE suite_memberships SET auth_user_id=v_user,status='active' WHERE id=v_member.id;

  WHEN 'set_member_status' THEN
    SELECT * INTO v_member FROM suite_memberships WHERE id=(p_payload->>'member_id')::uuid AND organization_id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Member not found in this organisation'; END IF;
    IF coalesce(length(v_reason),0)<5 THEN RAISE EXCEPTION 'A reason of at least five characters is required'; END IF;
    IF p_payload->>'status' NOT IN ('active','disabled') OR p_payload->>'status' IS NULL THEN RAISE EXCEPTION 'Invalid membership status'; END IF;
    IF p_payload->>'status'='active' AND v_member.auth_user_id IS NULL THEN RAISE EXCEPTION 'Link a verified login first'; END IF;
    SELECT count(*) INTO v_owner_count FROM suite_memberships WHERE organization_id=v_id AND role='owner' AND status='active' AND id<>v_member.id;
    IF v_member.role='owner' AND p_payload->>'status'='disabled' AND v_owner_count=0 THEN RAISE EXCEPTION 'Cannot disable the last active owner'; END IF;
    UPDATE suite_memberships SET status=p_payload->>'status' WHERE id=v_member.id;

  WHEN 'link_tenant' THEN
    v_product := p_payload->>'product_code';
    IF coalesce(length(v_reason),0)<5 THEN RAISE EXCEPTION 'A mapping reason is required'; END IF;
    IF coalesce(length(trim(p_payload->>'local_tenant_id')),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Tenant ID required'; END IF;
    IF EXISTS(SELECT 1 FROM suite_bindings WHERE organization_id=v_id AND product_code=v_product AND local_tenant_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Tenant already bound; reassignment requires a reviewed migration';
    END IF;
    UPDATE suite_bindings SET local_tenant_id=trim(p_payload->>'local_tenant_id'),state='linked',enforcement_version=NULL
    WHERE organization_id=v_id AND product_code=v_product;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not included in this organisation'; END IF;

  WHEN 'grant_access' THEN
    v_end := (p_payload->>'ends_at')::timestamptz;
    IF v_end IS NULL OR v_end<=now() OR v_end>now()+interval '366 days' THEN RAISE EXCEPTION 'Grant expiry must be within the next 366 days'; END IF;
    INSERT INTO suite_access_grants(organization_id,product_code,ends_at,reason,created_by)
    VALUES(v_id,p_payload->>'product_code',v_end,v_reason,p_actor);

  ELSE RAISE EXCEPTION 'Unsupported admin operation';
  END CASE;

  -- One versioned, durable delivery per affected app; mutation + outbox + audit
  -- commit together. Consumers must reject stale versions and deduplicate retries.
  IF v_id IS NOT NULL THEN
    UPDATE suite_bindings SET version=version+1,
      state=CASE WHEN state='ready' THEN 'pending' ELSE state END
    WHERE organization_id=v_id;
    INSERT INTO suite_jobs(organization_id,product_code,version)
    SELECT organization_id,product_code,version FROM suite_bindings WHERE organization_id=v_id;
  END IF;
  INSERT INTO suite_audit(organization_id,actor_id,action,reason,details)
  VALUES(v_id,p_actor,p_action,v_reason,p_payload);
  v_result := jsonb_build_object('organization_id',v_id,'request_id',p_request);
  INSERT INTO suite_requests VALUES(p_request,p_actor,p_action,p_payload,v_result,now());
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.suite_claim_job(p_org uuid,p_product text) RETURNS jsonb
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
  IF v_job.state='done' THEN RETURN NULL; END IF;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'No provisioning job exists'; END IF;
  UPDATE suite_jobs SET state='running',attempts=attempts+1,lease_id=v_lease,lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=v_job.id;
  RETURN jsonb_build_object('job_id',v_job.id,'lease_id',v_lease,'version',v_binding.version,
    'organization_id',p_org,'product_code',p_product,'local_tenant_id',v_binding.local_tenant_id,
    'organization',to_jsonb(v_org),'members',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM suite_memberships m WHERE organization_id=p_org),'[]'),
    'trial',(SELECT to_jsonb(t) FROM suite_product_trials t WHERE organization_id=p_org AND product_code=p_product),
    'grants',coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM suite_access_grants g WHERE organization_id=p_org AND product_code=p_product AND ends_at>now()),'[]'),
    'issued_at',now(),'refresh_by',now()+interval '5 minutes','contract','suite.access.v1');
END;
$$;

CREATE FUNCTION public.suite_finish_job(p_job uuid,p_lease uuid,p_actor uuid,p_tenant text DEFAULT NULL,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_job suite_jobs; v_binding suite_bindings;
BEGIN
  SELECT * INTO v_job FROM suite_jobs WHERE id=p_job;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Same lock order as mutations/claims to avoid deadlocks.
  PERFORM 1 FROM suite_organizations WHERE id=v_job.organization_id FOR UPDATE;
  SELECT * INTO v_job FROM suite_jobs WHERE id=p_job FOR UPDATE;
  IF v_job.state<>'running' OR v_job.lease_id IS DISTINCT FROM p_lease OR v_job.lease_until<=now() THEN RETURN false; END IF;
  SELECT * INTO v_binding FROM suite_bindings WHERE organization_id=v_job.organization_id AND product_code=v_job.product_code FOR UPDATE;
  IF p_error IS NULL AND (p_tenant IS NULL OR length(p_tenant) NOT BETWEEN 1 AND 200) THEN RAISE EXCEPTION 'Adapter did not return a valid tenant'; END IF;
  IF p_error IS NULL AND v_binding.local_tenant_id IS NOT NULL AND v_binding.local_tenant_id<>p_tenant THEN RAISE EXCEPTION 'Adapter returned a different tenant'; END IF;
  UPDATE suite_jobs SET state=CASE WHEN p_error IS NULL THEN 'done' ELSE 'failed' END,last_error=left(p_error,500),lease_until=NULL,updated_at=now() WHERE id=p_job;
  IF v_binding.version=v_job.version THEN
    UPDATE suite_bindings SET state=CASE WHEN p_error IS NULL THEN 'ready' ELSE 'failed' END,
      local_tenant_id=CASE WHEN p_error IS NULL THEN p_tenant ELSE local_tenant_id END,
      enforcement_version=CASE WHEN p_error IS NULL THEN 'suite.access.v1' ELSE enforcement_version END,
      last_error=left(p_error,500)
    WHERE organization_id=v_job.organization_id AND product_code=v_job.product_code;
  END IF;
  INSERT INTO suite_audit(organization_id,actor_id,action,details) VALUES(v_job.organization_id,p_actor,'sync_product',jsonb_build_object('product',v_job.product_code,'version',v_job.version,'success',p_error IS NULL));
  RETURN true;
END;
$$;

-- Product servers refresh their local mirror through a separately authenticated
-- endpoint. The timestamp comparison, rather than a cron status update, decides
-- exact expiry. Read/export policies remain explicitly owned by each app.
CREATE FUNCTION public.suite_product_access(p_org uuid,p_product text,p_tenant text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'contract','suite.access.v1','organization_id',o.id,'product_code',b.product_code,
    'local_tenant_id',b.local_tenant_id,'version',b.version,'organization_status',o.status,
    'allowed',coalesce(o.status='active' AND b.state='ready' AND a.access_until>now(),false),
    'access_until',a.access_until,'issued_at',now(),'refresh_by',now()+interval '5 minutes',
    'plan',o.plan_snapshot,
    'members',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM suite_memberships m WHERE organization_id=o.id),'[]')
  ) FROM suite_organizations o JOIN suite_bindings b ON b.organization_id=o.id
  CROSS JOIN LATERAL (
    SELECT max(ends_at) AS access_until FROM (
      SELECT ends_at FROM suite_product_trials WHERE organization_id=o.id AND product_code=b.product_code AND starts_at<=now() AND ends_at>now()
      UNION ALL
      SELECT ends_at FROM suite_access_grants WHERE organization_id=o.id AND product_code=b.product_code AND starts_at<=now() AND ends_at>now()
    ) x
  ) a
  WHERE o.id=p_org AND b.product_code=p_product AND b.local_tenant_id=p_tenant
$$;

-- Default deny for both API roles, including projects with permissive default grants.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'suite\_%' ESCAPE '\' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',r.tablename);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',r.tablename);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'suite\_%' ESCAPE '\' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.suite_audit_id_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.suite_audit_id_seq TO service_role;
COMMIT;
