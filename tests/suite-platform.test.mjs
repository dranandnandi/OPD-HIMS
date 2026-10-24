import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL semantics in an isolated in-memory database. Never reads .env
// or connects to a deployed Supabase project.
test('Suite platform SQL: isolation, lifecycle and recoverable provisioning', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const actor = randomUUID();
  const owner = randomUUID();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
  `);
  await db.query('INSERT INTO auth.users VALUES ($1,$2,now()),($3,$4,NULL)', [owner, 'owner@example.com', randomUUID(), 'unverified@example.com']);
  const sql = await readFile(new URL('../supabase/migrations/20261018120000_suite_platform.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  const call = async (name, args = []) => (await db.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS result`, args)).rows[0].result;
  const mutate = (action, payload, request = randomUUID(), who = actor) => call('suite_mutate', [who, request, action, JSON.stringify(payload)]);
  const create = async (plan = 'doctor_complete', email = 'owner@example.com') => (await mutate('create_organization', { name: 'Test clinic', owner_name: 'Test owner', owner_email: email, plan_code: plan })).organization_id;
  const sync = async (org, product) => {
    const job = await call('suite_claim_job', [org, product]);
    if (job) assert.equal(await call('suite_finish_job', [job.job_id, job.lease_id, actor, job.local_tenant_id || `${org}-${product}`, null]), true);
    return job;
  };
  const syncAll = async org => { for (const p of ['opd', 'growth', 'whatsapp', 'workforce']) await sync(org, p); };
  const state = (org, product = 'opd') => call('suite_product_access', [org, product, `${org}-${product}`]);

  await t.test('all central tables have RLS and both browser roles lack table and RPC privileges', async () => {
    const tables = await db.query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname LIKE 'suite_%'");
    assert.ok(tables.rows.length >= 12);
    for (const row of tables.rows) {
      assert.equal(row.relrowsecurity, true, row.relname);
      for (const role of ['anon', 'authenticated']) {
        const permissions = await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, row.relname, 'SELECT,INSERT,UPDATE,DELETE']);
        assert.equal(permissions.rows[0].allowed, false, `${role} ${row.relname}`);
      }
    }
    for (const role of ['anon', 'authenticated']) {
      const functions = await db.query("SELECT p.oid::regprocedure::text AS name,has_function_privilege($1,p.oid,'EXECUTE') AS allowed FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname LIKE 'suite_%'", [role]);
      for (const fn of functions.rows) assert.equal(fn.allowed, false, `${role} ${fn.name}`);
    }
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM suite_organizations'), /permission denied/);
    await assert.rejects(db.query('SELECT suite_overview()'), /permission denied/);
    await db.exec('RESET ROLE');
  });

  await t.test('duplicate signup retries return the same organisation and mismatched replays fail', async () => {
    const request = randomUUID();
    const payload = { name: 'Idempotent clinic', owner_name: 'Owner', owner_email: 'owner@example.com', plan_code: 'doctor_complete' };
    const first = await mutate('create_organization', payload, request);
    const second = await mutate('create_organization', payload, request);
    assert.deepEqual(second, first);
    await assert.rejects(mutate('create_organization', { ...payload, name: 'Different' }, request), /different operation/);
    await assert.rejects(mutate('create_organization', payload, request, randomUUID()), /different operation/);
    const detail = await call('suite_detail', [first.organization_id]);
    assert.equal(detail.bindings.length, 4);
    assert.equal(detail.members.length, 1);
    assert.equal(detail.members[0].auth_user_id, owner);
    assert.equal(detail.audit.length, 1);
    assert.equal(detail.organization.trial_status, 'not_started');
  });

  await t.test('new or unverified owner email remains pending and receives no active access', async () => {
    const org = await create('clinic_core', 'unverified@example.com');
    const detail = await call('suite_detail', [org]);
    assert.equal(detail.members[0].auth_user_id, null);
    assert.equal(detail.members[0].status, 'pending');
    await sync(org, 'opd');
    await assert.rejects(mutate('start_trial', { organization_id: org }), /verified owner/);
    await assert.rejects(mutate('link_member', { organization_id: org, member_id: detail.members[0].id }), /No verified central login/);
  });

  await t.test('trial requires all products ready and lasts exactly 168 hours', async () => {
    const org = await create();
    await assert.rejects(mutate('start_trial', { organization_id: org }), /All products/);
    await sync(org, 'opd');
    await assert.rejects(mutate('start_trial', { organization_id: org }), /All products/);
    await syncAll(org);
    assert.equal((await state(org)).allowed, false);
    assert.equal((await state(org)).access_until, null);
    await mutate('start_trial', { organization_id: org });
    const detail = await call('suite_detail', [org]);
    assert.equal(Date.parse(detail.organization.trial_ends_at) - Date.parse(detail.organization.trial_started_at), 168 * 3600_000);
    assert.equal(detail.organization.trial_status, 'trial');
    assert.equal(detail.organization.ready_count, 0, 'access changes await acknowledgement');
    await syncAll(org);
    assert.equal((await state(org)).allowed, true);
    await assert.rejects(mutate('start_trial', { organization_id: org }), /Trial already used/);
  });

  await t.test('deadline is exclusive, without cron or browser time', async () => {
    const org = await create('clinic_core');
    await sync(org, 'opd');
    await mutate('start_trial', { organization_id: org });
    await sync(org, 'opd');
    await db.exec('BEGIN');
    await db.query("UPDATE suite_product_trials SET starts_at=now()-interval '7 days',ends_at=now()+interval '1 second' WHERE organization_id=$1", [org]);
    assert.equal((await state(org)).allowed, true);
    await db.query('UPDATE suite_product_trials SET ends_at=now() WHERE organization_id=$1', [org]);
    assert.equal((await state(org)).allowed, false);
    await db.query("UPDATE suite_product_trials SET ends_at=now()-interval '1 second' WHERE organization_id=$1", [org]);
    assert.equal((await state(org)).allowed, false);
    await db.exec('ROLLBACK');
  });

  await t.test('suspension overrides grants; restore preserves grant and trial history', async () => {
    const org = await create('clinic_core');
    const until = new Date(Date.now() + 30 * 86400_000).toISOString();
    await mutate('grant_access', { organization_id: org, product_code: 'opd', ends_at: until, reason: 'Existing customer contract' });
    await sync(org, 'opd');
    assert.equal((await state(org)).allowed, true);
    await mutate('set_status', { organization_id: org, status: 'suspended', reason: 'Manual suspension for test' });
    await sync(org, 'opd');
    assert.equal((await state(org)).allowed, false);
    await mutate('set_status', { organization_id: org, status: 'active', reason: 'Restored after review' });
    await sync(org, 'opd');
    assert.equal((await state(org)).allowed, true);
    assert.equal((await call('suite_detail', [org])).grants.length, 1);
  });

  await t.test('tenant mapping cannot be shared, silently reassigned or queried through a different binding', async () => {
    const a = await create('clinic_core');
    const b = await create('clinic_core');
    await mutate('link_tenant', { organization_id: a, product_code: 'opd', local_tenant_id: 'existing-clinic', reason: 'Reviewed existing mapping' });
    await assert.rejects(mutate('link_tenant', { organization_id: b, product_code: 'opd', local_tenant_id: 'existing-clinic', reason: 'Duplicate mapping attempt' }), /unique constraint/);
    await assert.rejects(mutate('link_tenant', { organization_id: a, product_code: 'opd', local_tenant_id: 'other-clinic', reason: 'Attempted reassignment' }), /already bound/);
    assert.equal(await call('suite_product_access', [b, 'opd', 'existing-clinic']), null);
    assert.equal(await call('suite_product_access', [a, 'growth', 'existing-clinic']), null);
  });

  await t.test('job leases prevent concurrent execution and expired acknowledgements', async () => {
    const org = await create('clinic_core');
    const job = await call('suite_claim_job', [org, 'opd']);
    await assert.rejects(call('suite_claim_job', [org, 'opd']), /already running/);
    assert.equal(await call('suite_finish_job', [job.job_id, randomUUID(), actor, 'wrong-lease', null]), false);
    await db.query("UPDATE suite_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [job.job_id]);
    assert.equal(await call('suite_finish_job', [job.job_id, job.lease_id, actor, 'expired-lease', null]), false);
    const retry = await call('suite_claim_job', [org, 'opd']);
    assert.equal(retry.job_id, job.job_id);
    assert.notEqual(retry.lease_id, job.lease_id);
    assert.equal(await call('suite_finish_job', [retry.job_id, retry.lease_id, actor, 'correct-tenant', null]), true);
    assert.equal(await call('suite_claim_job', [org, 'opd']), null);
  });

  await t.test('late acknowledgement cannot overwrite newer entitlement state', async () => {
    const org = await create('clinic_core');
    const job = await call('suite_claim_job', [org, 'opd']);
    await mutate('set_status', { organization_id: org, status: 'suspended', reason: 'Suspend while provisioning' });
    await call('suite_finish_job', [job.job_id, job.lease_id, actor, 'stale-result', null]);
    const detail = await call('suite_detail', [org]);
    assert.equal(detail.bindings[0].state, 'pending');
    assert.equal(detail.bindings[0].local_tenant_id, null);
    assert.equal(detail.organization.status, 'suspended');
  });

  await t.test('failed provisioning is visible and retryable with a stable idempotency key', async () => {
    const org = await create('clinic_core');
    const job = await call('suite_claim_job', [org, 'opd']);
    await call('suite_finish_job', [job.job_id, job.lease_id, actor, null, 'Adapter unavailable']);
    assert.equal((await call('suite_detail', [org])).bindings[0].state, 'failed');
    const retry = await call('suite_claim_job', [org, 'opd']);
    assert.equal(retry.job_id, job.job_id);
    await call('suite_finish_job', [retry.job_id, retry.lease_id, actor, 'recovered-tenant', null]);
    assert.equal((await call('suite_detail', [org])).bindings[0].state, 'ready');
  });

  await t.test('member changes cannot cross organisations or disable the last owner', async () => {
    const org = await create('clinic_core');
    const otherOrg = await create('clinic_core');
    const member = (await call('suite_detail', [org])).members[0];
    await assert.rejects(mutate('set_member_status', { organization_id: otherOrg, member_id: member.id, status: 'disabled', reason: 'Cross organisation attempt' }), /Member not found/);
    await assert.rejects(mutate('set_member_status', { organization_id: org, member_id: member.id, status: 'disabled', reason: 'Disable last owner attempt' }), /last active owner/);
  });

  await t.test('invalid mutation is atomic; prices are append-only through the API', async () => {
    const org = await create('clinic_core');
    const before = await call('suite_detail', [org]);
    await assert.rejects(mutate('set_status', { organization_id: org, status: 'invalid', reason: 'Bad status value' }), /check constraint/);
    const after = await call('suite_detail', [org]);
    assert.equal(before.audit.length, after.audit.length);
    assert.equal(before.bindings[0].version, after.bindings[0].version);
    await mutate('publish_price', { plan_code: 'clinic_core', interval: 'month', amount_minor: 100000 });
    await mutate('publish_price', { plan_code: 'clinic_core', interval: 'month', amount_minor: 120000 });
    const versions = await db.query("SELECT count(*)::int AS count FROM suite_prices WHERE plan_code='clinic_core'");
    assert.equal(versions.rows[0].count, 2);
    const overview = await call('suite_overview', ['', 0]);
    assert.equal(overview.plans.find(p => p.code === 'clinic_core').prices[0].amount_minor, 120000);
  });

  await t.test('audited extension does not reset the original start or duplicate the product trial', async () => {
    const org = await create('clinic_core');
    await sync(org, 'opd');
    await mutate('start_trial', { organization_id: org });
    const before = (await call('suite_detail', [org])).organization;
    await mutate('extend_trial', { organization_id: org, days: 3, reason: 'Customer onboarding delay' });
    const after = (await call('suite_detail', [org])).organization;
    assert.equal(after.trial_started_at, before.trial_started_at);
    assert.equal(Date.parse(after.trial_ends_at) - Date.parse(before.trial_ends_at), 72 * 3600_000);
    const trials = await db.query('SELECT count(*)::int AS count FROM suite_product_trials WHERE organization_id=$1', [org]);
    assert.equal(trials.rows[0].count, 1);
  });
});
