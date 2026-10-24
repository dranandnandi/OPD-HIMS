import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('Suite operations: payments, shared messaging ownership and durable delivery', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const actor = randomUUID(); const owner = randomUUID();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
  await db.query('INSERT INTO auth.users VALUES ($1,$2,now())', [owner, 'owner@example.com']);
  for (const file of ['20261018120000_suite_platform.sql', '20261019120000_suite_operations.sql', '20261020100000_suite_runtime_refresh.sql', '20261020110000_suite_resolve_access.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
  }
  const rpc = async (name, args = []) => (await db.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS result`, args)).rows[0].result;
  const mutate = (action, input) => rpc('suite_mutate', [actor, randomUUID(), action, JSON.stringify(input)]);
  const operate = (action, input, request = randomUUID()) => rpc('suite_operate', [actor, request, action, JSON.stringify(input)]);
  const create = async () => (await mutate('create_organization', { name: 'Operations test', owner_name: 'Owner', owner_email: 'owner@example.com', plan_code: 'doctor_complete' })).organization_id;
  const sync = async (org, product, tenant = org + '-' + product) => {
    const job = await rpc('suite_claim_job', [org, product]);
    if (job) await rpc('suite_finish_job', [job.job_id, job.lease_id, actor, job.local_tenant_id || tenant, null]);
    return job;
  };
  const syncAll = async org => { for (const product of ['opd', 'growth', 'whatsapp', 'workforce']) await sync(org, product); };
  const access = (org, product) => rpc('suite_product_access', [org, product, org + '-' + product]);
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString();
  const paymentInput = org => ({ organization_id: org, amount_minor: 125000, reference: 'cash-receipt-1', reason: 'Received clinic payment', ends_at: nextMonth });

  await t.test('new tables and RPCs remain unavailable to browser roles', async () => {
    const tables = (await db.query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname LIKE 'suite_%'")).rows;
    for (const row of tables) {
      assert.equal(row.relrowsecurity, true);
      for (const role of ['anon', 'authenticated']) assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role,row.relname,'SELECT,INSERT,UPDATE,DELETE'])).rows[0].allowed, false);
    }
    const functions = (await db.query("SELECT oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'suite_%'")).rows;
    for (const row of functions) for (const role of ['anon','authenticated']) assert.equal((await db.query('SELECT has_function_privilege($1,$2,$3) AS allowed',[role,row.signature,'EXECUTE'])).rows[0].allowed,false);
  });
  await t.test('manual payment creates all plan grants once without bypassing enforcement', async () => {
    const org = await create(); const request = randomUUID(); const input = paymentInput(org);
    const first = await operate('record_payment', input, request);
    assert.deepEqual(await operate('record_payment', input, request), first);
    await assert.rejects(operate('record_payment', { ...input, amount_minor: 1 }, request), /different operation/);
    await assert.rejects(operate('record_payment', input), /unique constraint/);
    const detail = await rpc('suite_detail', [org]);
    assert.equal(detail.payments.length, 1); assert.equal(detail.grants.length, 4);
    assert.equal(detail.payments[0].amount_minor, 125000);
    await mutate('link_tenant', { organization_id: org, product_code: 'opd', local_tenant_id: org + '-opd', reason: 'Verified existing tenant' });
    assert.equal((await access(org, 'opd')).allowed, false);
    await syncAll(org);
    assert.equal((await access(org, 'opd')).allowed, true);
    const opGrant = detail.grants.find(g => g.product_code === 'opd');
    await operate('revoke_grant', { organization_id: org, grant_id: opGrant.id, reason: 'Access revoked on request' });
    assert.equal((await access(org, 'opd')).allowed, false);
    assert.equal((await access(org, 'workforce')).allowed, true);
    await sync(org, 'opd');
    assert.equal((await access(org, 'opd')).access_until, null);
  });
  await t.test('voiding payment revokes its grants, preserves other grants and never refunds money', async () => {
    const org = await create(); const paid = await operate('record_payment', paymentInput(org));
    await mutate('grant_access', { organization_id: org, product_code: 'workforce', ends_at: nextMonth, reason: 'Independent support exception' });
    const other = await create();
    await assert.rejects(operate('void_payment', { organization_id: other, payment_id: paid.payment_id, reason: 'Attempt cross tenant' }), /not found/);
    await operate('void_payment', { organization_id: org, payment_id: paid.payment_id, reason: 'Incorrect payment record' });
    await syncAll(org);
    assert.equal((await access(org, 'opd')).allowed, false);
    assert.equal((await access(org, 'workforce')).allowed, true);
    assert.ok((await rpc('suite_detail', [org])).payments[0].voided_at);
    await assert.rejects(operate('record_payment', { ...paymentInput(org), reference: 'expired', ends_at: '2020-01-01T00:00:00Z' }), /next 366 days/);
  });
  const instances = { workforce: randomUUID(), whatsapp: randomUUID(), legacy_whatsapp: randomUUID() };
  for (const [component,id] of Object.entries(instances)) await rpc('suite_record_connection', [component,id,'production',actor]);
  await t.test('registered instance cannot be silently repointed or moved to another component', async () => {
    await assert.rejects(rpc('suite_record_connection', ['workforce',randomUUID(),'production',actor]), /reviewed migration/);
    await assert.rejects(rpc('suite_record_connection', ['growth',instances.whatsapp,'production',actor]), /different component/);
  });
  await t.test('shared messaging account is reused while each purpose keeps separate access', async () => {
    const org = await create(); const tenant = randomUUID(); const user = randomUUID();
    for (const product of ['workforce','whatsapp']) await mutate('link_tenant', { organization_id: org, product_code: product, local_tenant_id: tenant, reason: 'Verified local organisation' });
    const save = async (product,purpose) => {
      const binding = (await rpc('suite_detail', [org])).bindings.find(b => b.product_code === product);
      const command = { organization_id: org, product_code: product, purpose, source_user_id: user, sender_user_id: user, session_name: 'default', reason: 'Verified sender mapping' };
      const input = { ...command, command, binding_version: binding.version, source_tenant_id: tenant, backend_tenant_id: tenant,
        source_instance_id: instances[product], backend_instance_id: instances.whatsapp };
      const request = randomUUID(); const result = await operate('save_messaging_route', input, request);
      assert.deepEqual(await operate('save_messaging_route', { ...input, binding_version: 999 }, request), result);
      assert.deepEqual(await rpc('suite_operation_receipt',[actor,request,'save_messaging_route',JSON.stringify(command)]),result);
      return result.route_id;
    };
    const workforce = await save('workforce','workforce.notifications'); const whatsapp = await save('whatsapp','whatsapp.campaigns');
    const detail = await rpc('suite_messaging_detail', [org]); assert.equal(detail.accounts.length,1); assert.equal(detail.routes.length,2);
    await operate('record_payment', paymentInput(org)); await syncAll(org);
    const routeAccess = (product,route,version=1, sender=user) => rpc('suite_messaging_access', [org,product,tenant,route,version,instances.whatsapp,sender,'default']);
    assert.equal((await routeAccess('workforce',workforce)).allowed,true);
    assert.equal(await routeAccess('workforce',whatsapp),null);
    assert.equal(await routeAccess('workforce',workforce,1,randomUUID()),null);
    await operate('set_messaging_route', { organization_id: org, route_id: workforce, version: 1, enabled: false, reason: 'Disable Task notifications' });
    assert.equal(await routeAccess('workforce',workforce),null);
    assert.equal((await routeAccess('workforce',workforce,2)).allowed,false);
    assert.equal((await routeAccess('whatsapp',whatsapp)).allowed,true);
    await assert.rejects(operate('set_messaging_route', { organization_id: org, route_id: workforce, version: 1, enabled: true, reason: 'Stale route update' }), /Route changed/);
    const foreign = await create();
    await mutate('link_tenant', { organization_id: foreign, product_code: 'workforce', local_tenant_id: randomUUID(), reason: 'Different local organisation' });
    const b = (await rpc('suite_detail',[foreign])).bindings.find(b=>b.product_code==='workforce');
    await assert.rejects(operate('save_messaging_route', { organization_id: foreign, product_code:'workforce', purpose:'workforce.notifications',
      source_user_id:user,sender_user_id:user,session_name:'default',reason:'Attempt messaging account claim', source_tenant_id:b.local_tenant_id,
      backend_tenant_id:tenant,binding_version:b.version,source_instance_id:instances.workforce,backend_instance_id:instances.whatsapp }), /another suite organisation/);
    assert.equal((await rpc('suite_messaging_detail',[foreign])).routes.length,0);
  });
  await t.test('product-scoped tenant lookup denies unenrolled accounts and cannot cross another product binding', async () => {
    const unknown=await rpc('suite_resolve_product_access',['opd','unknown-local-tenant']);
    assert.equal(unknown.managed,false);assert.equal(unknown.allowed,false);
    const org=await create();await syncAll(org);
    await operate('record_payment',paymentInput(org));await syncAll(org);
    const state=await rpc('suite_resolve_product_access',['opd',org+'-opd']);
    assert.equal(state.organization_id,org);assert.equal(state.product_code,'opd');assert.equal(state.managed,true);assert.equal(state.allowed,true);
    assert.equal((await rpc('suite_resolve_product_access',['workforce',org+'-opd'])).managed,false);
    await mutate('set_status',{organization_id:org,status:'suspended',reason:'Requested suspension'});
    assert.equal((await rpc('suite_resolve_product_access',['opd',org+'-opd'])).allowed,false);
  });
  await t.test('ready products refresh the same version before mirror expiry without resetting trial or access', async () => {
    const org = await create(); await syncAll(org);
    await mutate('start_trial', { organization_id: org }); await syncAll(org);
    const before = await rpc('suite_detail', [org]);
    const binding = before.bindings.find(b => b.product_code === 'opd');
    assert.equal(await rpc('suite_claim_job', [org,'opd']), null);
    await db.query("UPDATE suite_jobs SET updated_at=now()-interval '4 minutes' WHERE organization_id=$1 AND product_code='opd' AND version=$2",[org,binding.version]);
    assert.ok((await rpc('suite_pending_jobs',[['opd'],4])).some(j=>j.organization_id===org));
    const refreshed = await rpc('suite_claim_job', [org,'opd']);
    assert.equal(refreshed.version,binding.version);
    assert.ok(Date.parse(refreshed.refresh_by)>Date.parse(refreshed.issued_at));
    assert.equal((await access(org,'opd')).allowed,true);
    await rpc('suite_finish_job', [refreshed.job_id,refreshed.lease_id,actor,refreshed.local_tenant_id,null]);
    const after=await rpc('suite_detail',[org]);
    assert.equal(after.organization.trial_started_at,before.organization.trial_started_at);
    assert.equal(after.organization.trial_ends_at,before.organization.trial_ends_at);
    assert.equal(after.bindings.find(b=>b.product_code==='opd').version,binding.version);
    assert.equal(await rpc('suite_claim_job',[org,'opd']),null);
  });
  await t.test('background queue skips stale versions, backs off failure and recovers expired leases', async () => {
    const org = await create();
    const job = await rpc('suite_claim_job',[org,'opd']);
    await rpc('suite_finish_job',[job.job_id,job.lease_id,actor,null,'Offline']);
    assert.ok(!(await rpc('suite_pending_jobs',[['opd'],4])).some(j=>j.organization_id===org));
    await db.query("UPDATE suite_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[job.job_id]);
    const retry = await rpc('suite_claim_job',[org,'opd']); assert.equal(retry.job_id,job.job_id);
    await assert.rejects(rpc('suite_claim_job',[org,'opd']), /already running/);
    await db.query("UPDATE suite_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[retry.job_id]);
    const recovered = await rpc('suite_claim_job',[org,'opd']); assert.notEqual(recovered.lease_id,retry.lease_id);
    assert.equal(await rpc('suite_finish_job',[job.job_id,retry.lease_id,actor,'tenant',null]),false);
    await rpc('suite_finish_job',[job.job_id,recovered.lease_id,actor,'tenant',null]);
    const before = await rpc('suite_pending_jobs',[['opd'],4]); assert.ok(before.length<=4);
    assert.ok(before.every(j=>j.product_code==='opd'));
  });
});
