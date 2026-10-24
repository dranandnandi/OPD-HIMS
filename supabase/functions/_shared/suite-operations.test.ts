import { parseCommand } from './suite-contract.ts';
import { verifySenderMapping, saveMessagingRoute } from './suite-messaging.ts';
import { handleSuiteWorker } from '../suite-worker/index.ts';
import { requireVerifiedOrganization } from '../../../suite-integrations/staged/workforce/src/utils/verifiedOrganization.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function rejects(fn: () => unknown) { let rejected = false; try { fn(); } catch { rejected = true; } assert(rejected, 'Expected rejection'); }
const org = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';

Deno.test('payment and mapping commands ignore client authority and validate product purposes', () => {
  const payment = parseCommand({ action: 'record_payment', organization_id: org, request_id: actor,
    amount_minor: 100, reference: 'receipt', ends_at: '2027-01-01T00:00:00Z', reason: 'Payment received', created_by: org, enabled: true });
  assert(!('created_by' in payment.payload) && !('enabled' in payment.payload));
  rejects(() => parseCommand({ ...payment.payload, request_id: actor, action: 'record_payment', amount_minor: 1.5 }));
  rejects(() => parseCommand({ ...payment.payload, request_id: actor, action: 'record_payment', ends_at: '2027-01-01' }));
  const route = { action: 'save_messaging_route', organization_id: org, request_id: actor, product_code: 'workforce',
    purpose: 'workforce.notifications', source_user_id: 'public-id', sender_user_id: 'public-id', session_name: 'default', reason: 'Verified source identity' };
  const parsed = parseCommand({ ...route, source_instance_id: actor, backend_tenant_id: 'foreign', binding_version: 999 });
  assert(!('binding_version' in parsed.payload) && !('backend_tenant_id' in parsed.payload) && !('source_instance_id' in parsed.payload));
  rejects(() => parseCommand({ ...route, purpose: 'whatsapp.campaigns' }));
  rejects(() => parseCommand({ ...route, sender_user_id: 'email@example.com' }));
});

Deno.test('sender identity checks preserve source namespaces and reject tenant/email guesses', () => {
  const source = { local_user_id: 'task-user', local_auth_id: 'task-auth', local_tenant_id: 'task-org' };
  const sender = { ...source, local_auth_id: null };
  assert(verifySenderMapping('workforce', source, sender, 'task-org').backend_tenant_id === 'task-org');
  rejects(() => verifySenderMapping('workforce', source, { ...sender, local_user_id: 'other-user' }, 'task-org'));
  rejects(() => verifySenderMapping('workforce', source, { ...sender, local_tenant_id: 'foreign-org' }, 'task-org'));
  rejects(() => verifySenderMapping('opd', source, sender, 'task-org'));
  assert(verifySenderMapping('opd', source, { local_user_id: 'legacy-user', local_tenant_id: 'legacy-user', local_auth_id: 'task-auth' }, 'task-org').backend_tenant_id === 'legacy-user');
  rejects(() => verifySenderMapping('opd', source, { ...source, local_auth_id: 'other-auth' }, 'task-org'));
  rejects(() => requireVerifiedOrganization(null, actor));
  rejects(() => requireVerifiedOrganization({ id: org, auth_id: actor, organization_id: null, is_active: true }, actor));
  rejects(() => requireVerifiedOrganization({ id: org, auth_id: org, organization_id: org, is_active: true }, actor));
  rejects(() => requireVerifiedOrganization({ id: org, auth_id: actor, organization_id: org, is_active: false }, actor));
  assert(requireVerifiedOrganization({ id: org, auth_id: actor, organization_id: org, is_active: true }, actor) === org);
});

Deno.test('route retry returns durable receipt before accessing unavailable product servers', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('No external lookup is allowed on a completed retry'); }) as typeof fetch;
  try {
    let calls = 0;
    const result = await saveMessagingRoute(async (name, args) => {
      assert(name === 'suite_operation_receipt'); assert(args.p_actor === actor); calls++;
      return { route_id: org };
    }, actor, org, { organization_id: org });
    assert((result as { route_id: string }).route_id === org && calls === 1);
  } finally { globalThis.fetch = oldFetch; }
});

Deno.test('scheduled worker authenticates, ignores caller scope and rejects fake enforcement acknowledgement', async () => {
  const oldFetch = globalThis.fetch;
  const vars: Record<string,string> = { SUPABASE_URL: 'https://central.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only-service',
    PLATFORM_SUPER_ADMIN_USER_ID: actor, SUITE_WORKER_TOKEN: 'worker-test-secret-at-least-thirty-two-characters',
    SUITE_OPD_ADAPTER_URL: 'https://opd.invalid/adapter', SUITE_OPD_ADAPTER_TOKEN: 'adapter-test-secret-at-least-thirty-two-characters',
    SUITE_OPD_INSTANCE_ID: org, SUITE_ENVIRONMENT: 'production',SUITE_LEGACY_WHATSAPP_INSTANCE_ID:actor,SUITE_LEGACY_WHATSAPP_DEPENDENCY_URL:'https://legacy.invalid/dependency',SUITE_OPD_DEPENDENCY_TOKEN:'dependency-test-secret-at-least-thirty-two-chars' };
  const keys = [...Object.keys(vars), ...['GROWTH','WORKFORCE','WHATSAPP'].flatMap(p => [`SUITE_${p}_ADAPTER_URL`,`SUITE_${p}_ADAPTER_TOKEN`])];
  const saved = Object.fromEntries(keys.map(key => [key,Deno.env.get(key)]));
  keys.forEach(key => Deno.env.delete(key)); Object.entries(vars).forEach(([key,value]) => Deno.env.set(key,value));
  const calls: { name: string; body: Record<string,unknown> }[] = [];
  let acknowledge = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const name = url.split('/').at(-1)!; const body = JSON.parse(String(init?.body || '{}')); calls.push({ name,body });
    let result: unknown;
    if (name === 'suite_pending_jobs') result = [{ organization_id: org, product_code: 'opd' }];
    else if (name === 'suite_claim_job') result = { contract: 'suite.access.v1', job_id: org, lease_id: actor, organization_id: org, product_code: 'opd', version: 2, local_tenant_id: 'clinic' };
    else if (['suite_finish_job','suite_note_provisioning','suite_note_dependency'].includes(name)) result = true;
    else if(url===vars.SUITE_LEGACY_WHATSAPP_DEPENDENCY_URL)result={...body,identities:[{member_id:actor,source_user_id:actor,local_user_id:actor}],enforcement:{server:true,workers:true,expires_at:true,tenant_isolation:true}};
    else if (url === vars.SUITE_OPD_ADAPTER_URL) {
      assert(init?.redirect === 'error' && init.signal);
      assert(body.target_instance_id === org && body.environment === 'production');
      result = { ...body, local_tenant_id: 'clinic', identities:[{member_id:actor,local_user_id:actor,local_auth_id:actor}],enforcement: { server: acknowledge, workers: acknowledge, expires_at: acknowledge, tenant_isolation: acknowledge } };
    } else throw new Error('Unexpected network call');
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const req = (token = vars.SUITE_WORKER_TOKEN, origin?: string) => new Request('https://central.invalid/worker', {
    method:'POST',headers:{Authorization:`Bearer ${token}`,...(origin?{Origin:origin}:{})},body:JSON.stringify({ actor_id:org, organization_id:actor, product_code:'growth' }),
  });
  try {
    assert((await handleSuiteWorker(req('bad'))).status === 401);
    assert((await handleSuiteWorker(req(undefined,'https://browser.invalid'))).status === 403); assert(calls.length === 0);
    let result = await (await handleSuiteWorker(req())).json(); assert(result.failed === 1);
    let finish = calls.findLast(c=>c.name==='suite_finish_job')!;
    assert(finish.body.p_actor === actor && !finish.body.p_tenant && typeof finish.body.p_error === 'string');
    acknowledge=true; result=await (await handleSuiteWorker(req())).json(); assert(result.succeeded===1);
    finish=calls.findLast(c=>c.name==='suite_finish_job')!; assert(finish.body.p_tenant==='clinic' && finish.body.p_actor===actor);
    const queued=calls.find(c=>c.name==='suite_pending_jobs')!; assert(JSON.stringify(queued.body.p_products)==='["opd"]');
  } finally {
    globalThis.fetch=oldFetch;
    for(const [key,value] of Object.entries(saved)) { if(value===undefined)Deno.env.delete(key); else Deno.env.set(key,value); }
  }
});
