import { COMPONENTS, CONNECTION_CONTRACT, handleConnector, type ConnectorConfig } from './suite-connector-core.ts';
import { checkConnection } from './suite-connections.ts';
function assert(condition: unknown, message = 'Assertion failed'): asserts condition { if (!condition) throw new Error(message); }
const instance = '11111111-1111-4111-8111-111111111111';
const token = 'connector-test-key-at-least-thirty-two-characters';
const config: ConnectorConfig = { component: 'opd', instanceId: instance, environment: 'staging', token };
const body = () => ({ contract: CONNECTION_CONTRACT, operation: 'health', component: 'opd', instance_id: instance, environment: 'staging', challenge: crypto.randomUUID() });
function request(value: unknown = body(), key = token, origin?: string) {
  return new Request('https://connector.invalid', { method: 'POST', headers: { Authorization: `Bearer ${key}`, ...(origin === undefined ? {} : { Origin: origin }) }, body: JSON.stringify(value) });
}
Deno.test('connectors reject browsers, missing configuration, bad credentials and mismatched deployments before database access', async () => {
  let reads = 0;
  const store = { health: async () => { reads++; }, identity: async () => { reads++; return null; } };
  for (const component of COMPONENTS) {
    const result = await handleConnector(request({ ...body(), component }), { ...config, component }, store);
    assert(result.status === 200);
    const response = await result.json();
    assert(response.component === component && response.read_only && response.provisioning_ready === false);
    assert(!('enforcement' in response), 'Connection check must never claim provisioning enforcement');
  }
  reads = 0;
  assert((await handleConnector(request(), { ...config, token: undefined }, store)).status === 503);
  assert((await handleConnector(request(), { ...config, token: 'short' }, store)).status === 503);
  assert((await handleConnector(request(), { ...config, instanceId: 'bad' }, store)).status === 503);
  assert((await handleConnector(request(body(), 'wrong'), config, store)).status === 401);
  assert((await handleConnector(request(body(), token, 'https://browser.invalid'), config, store)).status === 403);
  assert((await handleConnector(request({ ...body(), environment: 'production' }), config, store)).status === 409);
  assert((await handleConnector(request({ ...body(), component: 'growth' }), config, store)).status === 409);
  assert((await handleConnector(request({ ...body(), instance_id: crypto.randomUUID() }), config, store)).status === 409);
  assert((await handleConnector(request({ ...body(), operation: 'create_user' }), config, store)).status === 400);
  assert((await handleConnector(request('x'.repeat(5000)), config, store)).status === 413);
  assert(reads === 0, 'Rejected requests reached the database');
});
Deno.test('identity lookup preserves exact identifiers and never leaks database errors', async () => {
  const seen: string[] = [];
  const store = { health: async () => {}, identity: async (id: string) => { seen.push(id); return { local_user_id: id, local_auth_id: 'old-auth', local_tenant_id: 'old-clinic' }; } };
  const response = await handleConnector(request({ ...body(), operation: 'identity', local_user_id: instance, email: 'ignored@example.com' }), config, store);
  assert(response.status === 200);
  const result = await response.json();
  assert(result.identity.local_user_id === instance && result.identity.local_tenant_id === 'old-clinic');
  assert(seen.length === 1 && seen[0] === instance);
  assert((await handleConnector(request({ ...body(), operation: 'identity', local_user_id: 'email@example.com' }), config, store)).status === 400);
  const failed = await handleConnector(request(), config, { ...store, health: async () => { throw new Error('db-password-should-not-leak'); } });
  assert(failed.status === 503 && !(await failed.text()).includes('db-password'));
});
Deno.test('central connection checks pin the environment and challenge, reject redirects and hide remote errors', async () => {
  const keys = { SUITE_OPD_CONNECTOR_URL: 'https://connector.invalid/api/suite/connector', SUITE_OPD_CONNECTOR_TOKEN: token, SUITE_OPD_INSTANCE_ID: instance, SUITE_ENVIRONMENT: 'staging' };
  const saved = Object.fromEntries(Object.keys(keys).map(k => [k, Deno.env.get(k)]));
  const oldFetch = globalThis.fetch;
  let mode = 'ok'; let calls = 0;
  Object.entries(keys).forEach(([k, v]) => Deno.env.set(k, v));
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    assert(init?.redirect === 'error' && init.signal, 'Redirect and timeout protections missing');
    const sent = JSON.parse(String(init.body));
    const response = { ...sent, database_available: true, read_only: true, provisioning_ready: false };
    if (mode === 'wrong') response.challenge = crypto.randomUUID();
    if (mode === 'ready') response.provisioning_ready = true;
    if (mode === 'failure') return new Response('remote-secret', { status: 500 });
    return Response.json(response);
  }) as typeof fetch;
  const rejects = async () => { let error: unknown; try { await checkConnection('opd'); } catch (e) { error = e; } assert(error instanceof Error && !error.message.includes('remote-secret')); };
  try {
    const result = await checkConnection('opd');
    assert(result.connected && result.provisioning_ready === false && result.dependencies[0] === 'legacy_whatsapp');
    for (const next of ['wrong', 'ready', 'failure']) { mode = next; await rejects(); }
    const before = calls;
    for (const url of ['http://connector.invalid', 'https://user:password@connector.invalid', 'https://connector.invalid?token=anything']) {
      Deno.env.set('SUITE_OPD_CONNECTOR_URL', url); await rejects();
    }
    assert(calls === before, 'Invalid destination reached fetch');
  } finally {
    globalThis.fetch = oldFetch;
    Object.entries(saved).forEach(([k, v]) => v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v));
  }
});
