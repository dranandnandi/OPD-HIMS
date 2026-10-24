-- Doctor Suite: central catch-up SQL. Prepared 2026-10-20 by Claude.
-- Run ONCE in the SQL Editor of the central OPD Supabase project (kiezgfhonvwryxpubfvl, clinic.anprohealthtech.com).
-- Why one file: the live DB has an EARLIER DRAFT of 20261019120000_suite_operations.sql (suite_instances/messaging
-- tables and suite_operate exist, but suite_manual_payments, suite_access_grants.payment_id and suite_messaging_access
-- do not). This script is idempotent: it adds only what is missing and replaces every suite function with the
-- current reviewed version, then applies 20261019150000, 20261020100000 and 20261020110000. Safe to re-run.
-- It touches ONLY suite_* objects. It does NOT rerun 20261018120000 and does not include clinical migrations.
BEGIN;
-- ===== 20261019120000_suite_operations (catch-up) =====
ALTER TABLE public.suite_access_grants ADD COLUMN IF NOT EXISTS revoked_at timestamptz, ADD COLUMN IF NOT EXISTS revoked_by uuid, ADD COLUMN IF NOT EXISTS revoke_reason text;
ALTER TABLE public.suite_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS suite_jobs_due ON public.suite_jobs(next_attempt_at) WHERE state <> 'done';
CREATE TABLE IF NOT EXISTS public.suite_manual_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.suite_organizations(id),
  amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
  currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'), reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 160),
  plan_snapshot jsonb NOT NULL, starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz, voided_by uuid, void_reason text,
  CHECK(ends_at>starts_at), UNIQUE(organization_id,reference), UNIQUE(id,organization_id)
);
ALTER TABLE public.suite_access_grants ADD COLUMN IF NOT EXISTS payment_id uuid;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='suite_grant_payment_scope') THEN
  ALTER TABLE public.suite_access_grants ADD CONSTRAINT suite_grant_payment_scope FOREIGN KEY(payment_id,organization_id) REFERENCES public.suite_manual_payments(id,organization_id);
END IF; END $$;
CREATE TABLE IF NOT EXISTS public.suite_instances (
  id uuid PRIMARY KEY,
  component text NOT NULL CHECK(component IN ('opd','growth','workforce','whatsapp','legacy_whatsapp')),
  environment text NOT NULL CHECK(environment IN ('production','staging')),
  checked_at timestamptz NOT NULL DEFAULT now(), checked_by uuid NOT NULL,
  UNIQUE(component,environment), UNIQUE(id,environment)
);
CREATE TABLE IF NOT EXISTS public.suite_messaging_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.suite_organizations(id),
  backend_instance_id uuid NOT NULL REFERENCES public.suite_instances(id),
  local_tenant_id text NOT NULL CHECK(length(local_tenant_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(backend_instance_id,local_tenant_id), UNIQUE(id,organization_id,backend_instance_id)
);
CREATE TABLE IF NOT EXISTS public.suite_messaging_purposes (
  purpose text PRIMARY KEY, product_code text NOT NULL REFERENCES public.suite_products(code),
  UNIQUE(purpose,product_code)
);
INSERT INTO public.suite_messaging_purposes VALUES
 ('opd.reminders','opd'),('growth.review_requests','growth'),
 ('workforce.notifications','workforce'),('workforce.hr_bot','workforce'),('whatsapp.campaigns','whatsapp') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.suite_messaging_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  product_code text NOT NULL, purpose text NOT NULL,
  environment text NOT NULL, source_instance_id uuid NOT NULL,
  source_user_id text NOT NULL CHECK(length(source_user_id) BETWEEN 1 AND 200),
  source_tenant_id text NOT NULL,
  backend_instance_id uuid NOT NULL, account_id uuid NOT NULL,
  sender_user_id text NOT NULL CHECK(length(sender_user_id) BETWEEN 1 AND 200),
  session_name text NOT NULL CHECK(session_name ~ '^[a-zA-Z0-9_-]{1,80}$'),
  enabled boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
  identity_checked_at timestamptz NOT NULL DEFAULT now(), checked_by uuid NOT NULL,
  UNIQUE(organization_id,purpose),
  FOREIGN KEY(organization_id,product_code) REFERENCES public.suite_bindings(organization_id,product_code),
  FOREIGN KEY(purpose,product_code) REFERENCES public.suite_messaging_purposes(purpose,product_code),
  FOREIGN KEY(source_instance_id,environment) REFERENCES public.suite_instances(id,environment),
  FOREIGN KEY(backend_instance_id,environment) REFERENCES public.suite_instances(id,environment),
  FOREIGN KEY(account_id,organization_id,backend_instance_id)
    REFERENCES public.suite_messaging_accounts(id,organization_id,backend_instance_id)
);
DROP FUNCTION IF EXISTS public.suite_queue_change(uuid,text);
DROP FUNCTION IF EXISTS public.suite_record_connection(text,uuid,text,uuid);
DROP FUNCTION IF EXISTS public.suite_messaging_detail(uuid);
DROP FUNCTION IF EXISTS public.suite_operate(uuid,uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.suite_pending_jobs(text[],integer);
DROP FUNCTION IF EXISTS public.suite_operation_receipt(uuid,uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.suite_messaging_access(uuid,text,text,uuid,integer,uuid,text,text);
CREATE FUNCTION public.suite_queue_change(p_org uuid,p_product text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  -- All callers take the organisation lock before reaching this helper.
  UPDATE suite_bindings SET version=version+1,state=CASE WHEN state='ready' THEN 'pending' ELSE state END
    WHERE organization_id=p_org AND (p_product IS NULL OR product_code=p_product);
  INSERT INTO suite_jobs(organization_id,product_code,version)
    SELECT organization_id,product_code,version FROM suite_bindings
    WHERE organization_id=p_org AND (p_product IS NULL OR product_code=p_product);
END $$;

CREATE FUNCTION public.suite_record_connection(p_component text,p_instance uuid,p_environment text,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v suite_instances;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Verified actor required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_component||':'||p_environment,0));
  SELECT * INTO v FROM suite_instances WHERE component=p_component AND environment=p_environment FOR UPDATE;
  IF FOUND AND v.id<>p_instance THEN RAISE EXCEPTION 'Instance replacement requires a reviewed migration; existing mappings are pinned'; END IF;
  IF EXISTS(SELECT 1 FROM suite_instances WHERE id=p_instance AND (component<>p_component OR environment<>p_environment)) THEN
    RAISE EXCEPTION 'Instance ID already belongs to a different component or environment';
  END IF;
  INSERT INTO suite_instances(id,component,environment,checked_by) VALUES(p_instance,p_component,p_environment,p_actor)
  ON CONFLICT(id) DO UPDATE SET checked_at=now(),checked_by=EXCLUDED.checked_by;
  RETURN jsonb_build_object('instance_id',p_instance,'checked_at',now());
END $$;

CREATE FUNCTION public.suite_messaging_detail(p_org uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('routes',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY purpose) FROM suite_messaging_routes r WHERE organization_id=p_org),'[]'),
    'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM suite_messaging_accounts a WHERE organization_id=p_org),'[]'),
    'instances',coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM suite_instances i),'[]'))
  FROM suite_organizations WHERE id=p_org
$$;

CREATE FUNCTION public.suite_operate(p_actor uuid,p_request uuid,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_old suite_requests; v_org uuid; v_reason text; v_result jsonb; v_product text;
  v_route suite_messaging_routes; v_binding suite_bindings; v_account suite_messaging_accounts;
  v_backend suite_instances; v_source suite_instances; v_grant suite_access_grants; v_payment suite_manual_payments; v_end timestamptz;
BEGIN
  IF p_actor IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'Actor and request ID required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  SELECT * INTO v_old FROM suite_requests WHERE id=p_request;
  IF FOUND THEN
    IF v_old.actor_id<>p_actor OR v_old.action<>p_action OR v_old.payload<>coalesce(p_payload->'command',p_payload) THEN RAISE EXCEPTION 'Request ID already used for a different operation'; END IF;
    RETURN v_old.result;
  END IF;
  v_org:=(p_payload->>'organization_id')::uuid;
  PERFORM 1 FROM suite_organizations WHERE id=v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organisation not found'; END IF;
  v_reason:=trim(p_payload->>'reason');
  IF coalesce(length(v_reason),0) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'A reason of 5 to 1000 characters is required'; END IF;
  CASE p_action
  WHEN 'record_payment' THEN
    v_end:=(p_payload->>'ends_at')::timestamptz;
    IF v_end IS NULL OR v_end<=now() OR v_end>now()+interval '366 days' THEN RAISE EXCEPTION 'Paid access must end within the next 366 days'; END IF;
    IF NOT EXISTS(SELECT 1 FROM suite_bindings WHERE organization_id=v_org) THEN RAISE EXCEPTION 'Organisation has no selected products'; END IF;
    INSERT INTO suite_manual_payments(organization_id,amount_minor,reference,plan_snapshot,ends_at,reason,created_by)
      SELECT v_org,(p_payload->>'amount_minor')::bigint,trim(p_payload->>'reference'),plan_snapshot,v_end,v_reason,p_actor
      FROM suite_organizations WHERE id=v_org RETURNING * INTO v_payment;
    INSERT INTO suite_access_grants(organization_id,product_code,ends_at,reason,created_by,payment_id)
      SELECT v_org,product_code,v_end,v_reason,p_actor,v_payment.id FROM suite_bindings WHERE organization_id=v_org;
    -- All products in the current organisation plan receive one dated grant.
    -- Payment records do not override suspension or missing enforcement.
    v_product:=NULL;
  WHEN 'void_payment' THEN
    SELECT * INTO v_payment FROM suite_manual_payments WHERE id=(p_payload->>'payment_id')::uuid AND organization_id=v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found in this organisation'; END IF;
    IF v_payment.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Payment already voided'; END IF;
    UPDATE suite_manual_payments SET voided_at=now(),voided_by=p_actor,void_reason=v_reason WHERE id=v_payment.id;
    UPDATE suite_access_grants SET revoked_at=now(),revoked_by=p_actor,revoke_reason=v_reason
      WHERE payment_id=v_payment.id AND organization_id=v_org AND revoked_at IS NULL;
    v_product:=NULL;
  WHEN 'revoke_grant' THEN
    SELECT * INTO v_grant FROM suite_access_grants WHERE id=(p_payload->>'grant_id')::uuid AND organization_id=v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Grant not found in this organisation'; END IF;
    IF v_grant.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Grant is already revoked'; END IF;
    UPDATE suite_access_grants SET revoked_at=now(),revoked_by=p_actor,revoke_reason=v_reason WHERE id=v_grant.id;
    v_product:=v_grant.product_code;
  WHEN 'save_messaging_route' THEN
    v_product:=p_payload->>'product_code';
    SELECT * INTO v_binding FROM suite_bindings WHERE organization_id=v_org AND product_code=v_product FOR UPDATE;
    IF NOT FOUND OR v_binding.local_tenant_id IS NULL OR v_binding.local_tenant_id IS DISTINCT FROM p_payload->>'source_tenant_id'
      OR v_binding.version IS DISTINCT FROM (p_payload->>'binding_version')::integer THEN
      RAISE EXCEPTION 'Product mapping changed or has not been linked; verify it again';
    END IF;
    SELECT * INTO v_source FROM suite_instances WHERE id=(p_payload->>'source_instance_id')::uuid;
    SELECT * INTO v_backend FROM suite_instances WHERE id=(p_payload->>'backend_instance_id')::uuid;
    IF v_source.id IS NULL OR v_backend.id IS NULL OR v_source.component<>v_product OR v_source.environment<>v_backend.environment
      OR v_source.checked_at<now()-interval '15 minutes' OR v_backend.checked_at<now()-interval '15 minutes'
      OR v_backend.component<>(CASE WHEN v_product IN ('opd','growth') THEN 'legacy_whatsapp' ELSE 'whatsapp' END) THEN
      RAISE EXCEPTION 'Source and messaging backend must be freshly verified in the same environment';
    END IF;
    SELECT * INTO v_route FROM suite_messaging_routes WHERE organization_id=v_org AND purpose=p_payload->>'purpose';
    IF FOUND THEN RAISE EXCEPTION 'Route already exists. Disable it or use a reviewed mapping migration'; END IF;
    INSERT INTO suite_messaging_accounts(organization_id,backend_instance_id,local_tenant_id)
      VALUES(v_org,v_backend.id,p_payload->>'backend_tenant_id') ON CONFLICT(backend_instance_id,local_tenant_id) DO NOTHING;
    SELECT * INTO v_account FROM suite_messaging_accounts WHERE backend_instance_id=v_backend.id AND local_tenant_id=p_payload->>'backend_tenant_id';
    IF v_account.organization_id IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'Messaging account belongs to another suite organisation'; END IF;
    INSERT INTO suite_messaging_routes(organization_id,product_code,purpose,environment,source_instance_id,source_user_id,source_tenant_id,
      backend_instance_id,account_id,sender_user_id,session_name,checked_by)
    VALUES(v_org,v_product,p_payload->>'purpose',v_source.environment,v_source.id,p_payload->>'source_user_id',v_binding.local_tenant_id,
      v_backend.id,v_account.id,p_payload->>'sender_user_id',p_payload->>'session_name',p_actor) RETURNING * INTO v_route;
  WHEN 'set_messaging_route' THEN
    SELECT * INTO v_route FROM suite_messaging_routes WHERE id=(p_payload->>'route_id')::uuid AND organization_id=v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Route not found in this organisation'; END IF;
    IF v_route.version IS DISTINCT FROM (p_payload->>'version')::integer THEN RAISE EXCEPTION 'Route changed; refresh before retrying'; END IF;
    IF jsonb_typeof(p_payload->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Enabled must be a boolean'; END IF;
    UPDATE suite_messaging_routes SET enabled=(p_payload->>'enabled')::boolean,version=version+1 WHERE id=v_route.id RETURNING * INTO v_route;
    v_product:=v_route.product_code;
  ELSE RAISE EXCEPTION 'Unsupported operation';
  END CASE;
  PERFORM suite_queue_change(v_org,v_product);
  INSERT INTO suite_audit(organization_id,actor_id,action,reason,details) VALUES(v_org,p_actor,p_action,v_reason,p_payload);
  v_result:=jsonb_build_object('organization_id',v_org,'request_id',p_request,'route_id',v_route.id,'payment_id',v_payment.id);
  INSERT INTO suite_requests VALUES(p_request,p_actor,p_action,coalesce(p_payload->'command',p_payload),v_result,now());
  RETURN v_result;
END $$;

-- suite_pending_jobs / suite_claim_job: the 20261020100000 (runtime refresh) versions are used directly below.
CREATE OR REPLACE FUNCTION public.suite_finish_job(p_job uuid,p_lease uuid,p_actor uuid,p_tenant text DEFAULT NULL,p_error text DEFAULT NULL) RETURNS boolean
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
  UPDATE suite_jobs SET state=CASE WHEN p_error IS NULL THEN 'done' ELSE 'failed' END,last_error=left(p_error,500),lease_until=NULL,next_attempt_at=CASE WHEN p_error IS NULL THEN now() ELSE now()+make_interval(secs=>least(900,30*power(2,least(v_job.attempts-1,5)))::integer) END,updated_at=now() WHERE id=p_job;
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

CREATE OR REPLACE FUNCTION public.suite_product_access(p_org uuid,p_product text,p_tenant text) RETURNS jsonb
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
      SELECT ends_at FROM suite_access_grants WHERE revoked_at IS NULL AND organization_id=o.id AND product_code=b.product_code AND starts_at<=now() AND ends_at>now()
    ) x
  ) a
  WHERE o.id=p_org AND b.product_code=p_product AND b.local_tenant_id=p_tenant
$$;

CREATE FUNCTION public.suite_operation_receipt(p_actor uuid,p_request uuid,p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v suite_requests;
BEGIN
 SELECT * INTO v FROM suite_requests WHERE id=p_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v.actor_id<>p_actor OR v.action<>p_action OR v.payload<>p_input THEN RAISE EXCEPTION 'Request ID already used for a different operation'; END IF;
 RETURN v.result;
END $$;

CREATE FUNCTION public.suite_messaging_access(p_org uuid,p_product text,p_tenant text,p_route uuid,p_version integer,
 p_backend uuid,p_sender text,p_session text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('contract','suite.messaging.v1','organization_id',p_org,'product_code',p_product,
   'route_id',r.id,'route_version',r.version,'purpose',r.purpose,'backend_instance_id',r.backend_instance_id,
   'sender_user_id',r.sender_user_id,'session_name',r.session_name,
   'allowed',coalesce(r.enabled AND (a.state->>'allowed')::boolean,false),
   'access_until',a.state->'access_until','issued_at',now(),'refresh_by',a.state->'refresh_by')
 FROM suite_messaging_routes r CROSS JOIN LATERAL (SELECT suite_product_access(p_org,p_product,p_tenant) AS state) a
 WHERE a.state IS NOT NULL AND r.organization_id=p_org AND r.product_code=p_product AND r.id=p_route
   AND r.source_tenant_id=p_tenant AND r.version=p_version AND r.backend_instance_id=p_backend
   AND r.sender_user_id=p_sender AND r.session_name=p_session
$$;

CREATE OR REPLACE FUNCTION public.suite_detail(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
SELECT jsonb_build_object(
  'organization',suite_org_json(o),
  'bindings',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY product_code) FROM suite_bindings b WHERE organization_id=o.id),'[]'),
  'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at) FROM suite_memberships m WHERE organization_id=o.id),'[]'),
  'grants',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY ends_at DESC) FROM suite_access_grants g WHERE organization_id=o.id),'[]'),
  'payments',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at DESC) FROM suite_manual_payments p WHERE organization_id=o.id),'[]'),
  'audit',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT * FROM suite_audit WHERE organization_id=o.id ORDER BY id DESC LIMIT 50) a),'[]')
) FROM suite_organizations o WHERE id=p_id
$$;

DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'suite\_%' ESCAPE '\' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r.tablename);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',r.tablename);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',r.tablename);
 END LOOP;
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'suite\_%' ESCAPE '\' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);
 END LOOP;
END $$;
-- ===== 20261019160000_suite_invitations =====
DROP FUNCTION IF EXISTS public.suite_issue_invitation(uuid,uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.suite_accept_invitation(uuid,text);
CREATE TABLE IF NOT EXISTS public.suite_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES public.suite_memberships(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '168 hours',
 created_by uuid NOT NULL, used_at timestamptz, used_by uuid REFERENCES auth.users(id), revoked_at timestamptz,
 CHECK(expires_at>created_at)
);
CREATE FUNCTION public.suite_issue_invitation(p_actor uuid,p_request uuid,p_org uuid,p_member uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_member suite_memberships; v_old suite_requests; v_input jsonb; v_result jsonb; v_invite suite_invitations;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'Actor and request ID required'; END IF;
 v_input:=jsonb_build_object('organization_id',p_org,'member_id',p_member,'token_hash',p_hash);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 SELECT * INTO v_old FROM suite_requests WHERE id=p_request;
 IF FOUND THEN
  IF v_old.actor_id<>p_actor OR v_old.action<>'create_invitation' OR v_old.payload<>v_input THEN RAISE EXCEPTION 'Request ID already used for another operation'; END IF;
  RETURN v_old.result;
 END IF;
 PERFORM 1 FROM suite_organizations WHERE id=p_org FOR UPDATE;
 SELECT * INTO v_member FROM suite_memberships WHERE id=p_member AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR v_member.status<>'pending' OR v_member.auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'A pending unlinked member is required'; END IF;
 UPDATE suite_invitations SET revoked_at=now() WHERE member_id=p_member AND used_at IS NULL AND revoked_at IS NULL;
 INSERT INTO suite_invitations(member_id,token_hash,created_by) VALUES(p_member,p_hash,p_actor) RETURNING * INTO v_invite;
 v_result:=jsonb_build_object('organization_id',p_org,'invitation_id',v_invite.id,'expires_at',v_invite.expires_at);
 INSERT INTO suite_requests VALUES(p_request,p_actor,'create_invitation',v_input,v_result,now());
 INSERT INTO suite_audit(organization_id,actor_id,action,details) VALUES(p_org,p_actor,'create_invitation',jsonb_build_object('member_id',p_member,'invitation_id',v_invite.id));
 RETURN v_result;
END $$;
CREATE FUNCTION public.suite_accept_invitation(p_user uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_invite suite_invitations; v_member suite_memberships; v_email text; v_org uuid;
BEGIN
 SELECT m.organization_id INTO v_org FROM suite_invitations i JOIN suite_memberships m ON m.id=i.member_id WHERE i.token_hash=p_hash;
 IF v_org IS NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
 -- Same organisation-first lock order as membership changes and issue/reissue.
 PERFORM 1 FROM suite_organizations WHERE id=v_org FOR UPDATE;
 SELECT * INTO v_invite FROM suite_invitations WHERE token_hash=p_hash FOR UPDATE;
 SELECT * INTO v_member FROM suite_memberships WHERE id=v_invite.member_id FOR UPDATE;
 SELECT lower(trim(email)) INTO v_email FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL;
 IF v_email IS NULL OR v_email<>v_member.email OR v_member.status='disabled' OR v_invite.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
 IF v_invite.used_at IS NOT NULL THEN
  IF v_invite.used_by=p_user AND v_member.auth_user_id=p_user AND v_member.status='active' THEN
   RETURN jsonb_build_object('organization_id',v_org,'member_id',v_member.id,'accepted',true);
  END IF;
  RAISE EXCEPTION 'Invitation already used';
 END IF;
 IF v_invite.expires_at<=now() OR v_member.status<>'pending' OR v_member.auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
 UPDATE suite_memberships SET auth_user_id=p_user,status='active' WHERE id=v_member.id;
 UPDATE suite_invitations SET used_at=now(),used_by=p_user WHERE id=v_invite.id;
 PERFORM suite_queue_change(v_org);
 INSERT INTO suite_audit(organization_id,actor_id,action,details) VALUES(v_org,p_user,'accept_invitation',jsonb_build_object('member_id',v_member.id));
 RETURN jsonb_build_object('organization_id',v_org,'member_id',v_member.id,'accepted',true);
END $$;
ALTER TABLE public.suite_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suite_invitations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.suite_invitations TO service_role;
REVOKE ALL ON FUNCTION public.suite_issue_invitation(uuid,uuid,uuid,uuid,text),public.suite_accept_invitation(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suite_issue_invitation(uuid,uuid,uuid,uuid,text),public.suite_accept_invitation(uuid,text) TO service_role;
-- ===== 20261020100000_suite_runtime_refresh =====
CREATE OR REPLACE FUNCTION public.suite_pending_jobs(p_products text[],p_limit integer DEFAULT 4) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM (
    SELECT j.organization_id,j.product_code FROM suite_jobs j
    JOIN suite_bindings b USING(organization_id,product_code,version)
    WHERE j.product_code=ANY(p_products) AND (j.state<>'done' OR (b.state='ready' AND j.updated_at<=now()-interval '3 minutes')) AND j.next_attempt_at<=now()
      AND NOT EXISTS(SELECT 1 FROM suite_jobs running WHERE running.organization_id=j.organization_id
        AND running.product_code=j.product_code AND running.state='running' AND running.lease_until>now())
    ORDER BY j.next_attempt_at,j.created_at LIMIT greatest(0,least(p_limit,4))
  ) q
$$;

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
    'issued_at',now(),'refresh_by',now()+interval '5 minutes','contract','suite.access.v1');
END;
$$;
REVOKE ALL ON FUNCTION public.suite_pending_jobs(text[],integer),public.suite_claim_job(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suite_pending_jobs(text[],integer),public.suite_claim_job(uuid,text) TO service_role;
-- ===== 20261020110000_suite_resolve_access =====
DROP FUNCTION IF EXISTS public.suite_resolve_product_access(text,text);
CREATE FUNCTION public.suite_resolve_product_access(p_product text,p_tenant text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid;
BEGIN
 IF p_product NOT IN ('opd','growth','whatsapp','workforce') OR p_tenant IS NULL OR length(p_tenant) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'Valid product and local tenant required';
 END IF;
 SELECT organization_id INTO v_org FROM suite_bindings WHERE product_code=p_product AND local_tenant_id=p_tenant;
 IF v_org IS NULL THEN
  RETURN jsonb_build_object('contract','suite.access.v1','managed',false,'allowed',false,
    'product_code',p_product,'local_tenant_id',p_tenant,'issued_at',now(),'refresh_by',now()+interval '5 minutes');
 END IF;
 RETURN suite_product_access(v_org,p_product,p_tenant)||jsonb_build_object('managed',true);
END $$;
REVOKE ALL ON FUNCTION public.suite_resolve_product_access(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suite_resolve_product_access(text,text) TO service_role;
-- (The DO block above already re-locks every suite_* table and function.)
COMMIT;
