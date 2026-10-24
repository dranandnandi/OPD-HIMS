import { handleSuiteAdmin } from '../suite-admin/index.ts';
import { handleProductAccess } from '../suite-product-access/index.ts';
import { INITIAL_ADMIN_EMAIL } from './suite-contract.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const orgId = '22222222-2222-4222-8222-222222222222';
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function request(body: unknown, token = 'test-user-token', origin?: string) {
  return new Request('https://platform.invalid/functions/v1/suite-admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
}

Deno.test('HTTP handlers authenticate before accessing the privileged database and fail closed', async () => {
  // All network calls are intercepted. These tests never contact live services.
  const originalFetch = globalThis.fetch;
  const environment: Record<string, string | undefined> = {};
  const vars: Record<string, string> = {
    SUPABASE_URL: 'https://platform.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service-secret',
    SUITE_ADMIN_ALLOWED_ORIGINS: 'http://localhost:5175',
    SUITE_OPD_ACCESS_TOKEN: 'opd-test-secret-at-least-thirty-two-chars',
  };
  for (const key of [...Object.keys(vars), 'PLATFORM_SUPER_ADMIN_USER_ID', 'SUITE_GROWTH_ACCESS_TOKEN', 'SUITE_WHATSAPP_ACCESS_TOKEN', 'SUITE_WORKFORCE_ACCESS_TOKEN', 'SUITE_OPD_ADAPTER_URL', 'SUITE_OPD_ADAPTER_TOKEN']) {
    environment[key] = Deno.env.get(key);
    Deno.env.delete(key);
  }
  for (const [key, value] of Object.entries(vars)) Deno.env.set(key, value);
  let mode = 'admin';
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      calls.push({ url, body: {} });
      if (mode === 'invalid') return new Response(JSON.stringify({ message: 'Invalid token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ id: userId, email: mode === 'admin' ? INITIAL_ADMIN_EMAIL : 'clinic@example.com', email_confirmed_at: '2026-10-18T00:00:00Z', app_metadata: {}, user_metadata: { role: 'super_admin' }, aud: 'authenticated' }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (!url.startsWith('https://platform.invalid/rest/v1/rpc/suite_')) throw new Error(`Unexpected network call: ${url}`);
    calls.push({ url, body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify(url.endsWith('suite_overview') ? { organizations: [], products: [], plans: [] } : { organization_id: orgId }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    let response = await handleSuiteAdmin(request({ action: 'overview' }, ''));
    assert(response.status === 401);
    assert(calls.length === 0);
    response = await handleSuiteAdmin(request({ action: 'overview' }, 'test', 'https://untrusted.invalid'));
    assert(response.status === 403);
    assert(calls.length === 0);
    mode = 'invalid';
    response = await handleSuiteAdmin(request({ action: 'overview' }));
    assert(response.status === 401);
    assert(calls.every(c => c.url.endsWith('/auth/v1/user')));
    mode = 'clinic';
    response = await handleSuiteAdmin(request({ action: 'overview' }));
    assert(response.status === 403, 'User metadata super_admin must not authorise platform access');
    assert(calls.every(c => c.url.endsWith('/auth/v1/user')));
    mode = 'admin';
    response = await handleSuiteAdmin(request({ action: 'overview' }, 'test', 'http://localhost:5175'));
    assert(response.status === 200);
    assert(response.headers.get('Access-Control-Allow-Origin') === 'http://localhost:5175');
    assert(response.headers.get('Cache-Control') === 'no-store');
    response = await handleSuiteAdmin(request({ action: 'start_trial', organization_id: orgId, request_id: orgId, p_actor: orgId }));
    assert(response.status === 200);
    const mutation = calls.findLast(c => c.url.endsWith('suite_mutate'))!;
    assert(mutation.body.p_actor === userId, 'Actor must come from verified auth, not request');
    response = await handleSuiteAdmin(request({ action: 'sync_product', organization_id: orgId, product_code: 'opd' }));
    assert(response.status === 409, 'Unconfigured adapters may not create/claim jobs');
    assert(!calls.some(c => c.url.endsWith('suite_claim_job')));

    response = await handleProductAccess(request({ organization_id: orgId, local_tenant_id: 'tenant-1' }, 'bad-key'));
    assert(response.status === 401);
    response = await handleProductAccess(request({ organization_id: orgId, local_tenant_id: 'tenant-1' }, vars.SUITE_OPD_ACCESS_TOKEN, 'http://localhost:5175'));
    assert(response.status === 403);
    response = await handleProductAccess(request({ organization_id: orgId, local_tenant_id: 'tenant-1', product_code: 'growth' }, vars.SUITE_OPD_ACCESS_TOKEN));
    assert(response.status === 200);
    const access = calls.findLast(c => c.url.endsWith('suite_product_access'))!;
    assert(access.body.p_product === 'opd', 'Machine credential must fix the product scope');
    assert(access.body.p_org === orgId);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});
