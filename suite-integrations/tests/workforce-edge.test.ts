import { handleWorkforceWhatsApp } from '../staged/workforce/supabase/functions/workforce-whatsapp/index.ts';
import { parseWorkforceScope, workforceRoute } from '../staged/whatsapp/server/workforceBridgeCore.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
const user = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const source = '33333333-3333-4333-8333-333333333333';
const outsider = '44444444-4444-4444-8444-444444444444';

Deno.test('Task facade derives admin and organisation scope from authenticated database records', async () => {
  const env = { SUPABASE_URL: 'https://task.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service-only',
    WORKFORCE_WHATSAPP_URL: 'https://whatsapp.invalid/api/integrations/workforce', WORKFORCE_WHATSAPP_TOKEN: 'test-workforce-key-at-least-thirty-two-characters',
    WORKFORCE_SOURCE_ID: source, WORKFORCE_ALLOWED_ORIGINS: 'https://task-ui.invalid' };
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, Deno.env.get(k)]));
  Object.entries(env).forEach(([k, v]) => Deno.env.set(k, v));
  const original = globalThis.fetch; let mode = 'valid'; let forwardCount = 0; let authCount = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'task.invalid' && url.pathname === '/auth/v1/user') {
      authCount++;
      if (mode === 'invalid') return Response.json({ message: 'Invalid JWT' }, { status: 401 });
      return Response.json({ id: user, email: 'admin@example.com', aud: 'authenticated', user_metadata: {}, app_metadata: {} });
    }
    if (url.hostname === 'task.invalid' && url.pathname === '/rest/v1/users') {
      if (url.searchParams.has('auth_id')) {
        assert(url.searchParams.get('auth_id') === `eq.${user}`);
        return Response.json({ id: user, organization_id: org, role: mode === 'member' ? 'user' : 'admin', is_active: mode !== 'disabled' });
      }
      assert(url.searchParams.get('organization_id') === `eq.${org}` && url.searchParams.get('is_active') === 'eq.true');
      assert(url.searchParams.get('role') === 'in.(admin,superadmin)');
      return Response.json([{ id: user, role: 'admin', email: 'admin@example.com', name: 'Admin' }]);
    }
    if (url.hostname === 'whatsapp.invalid') {
      forwardCount++;
      assert(init?.redirect === 'error' && init.signal);
      const body = JSON.parse(String(init.body));
      assert(body.organization_id === org && body.source_id === source && body.user_id === user);
      assert(body.admins.length === 1 && body.admins[0].id === user && !('role' in body.admins[0]));
      assert(!('url' in body) && !('method' in body));
      if (mode === 'backend-failed') return Response.json({ error: 'database-password-never-leak' }, { status: 500 });
      return Response.json({ success: true, data: { userId: user, existed: true } });
    }
    throw new Error('Unexpected network destination');
  }) as typeof fetch;
  const request = (body: unknown, token = 'user-jwt', origin = 'https://task-ui.invalid') => new Request('https://task.invalid/functions/v1/workforce-whatsapp', {
    method: 'POST', headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  try {
    let response = await handleWorkforceWhatsApp(request({ action: 'handshake', organization_id: outsider, admins: [{ id: outsider, role: 'super_admin' }], url: 'https://evil.invalid' }));
    assert(response.status === 200 && forwardCount === 1);
    assert(response.headers.get('Access-Control-Allow-Origin') === 'https://task-ui.invalid' && response.headers.get('Cache-Control') === 'no-store');
    const count = forwardCount;
    for (const badMode of ['invalid', 'member', 'disabled']) {
      mode = badMode;
      response = await handleWorkforceWhatsApp(request({ action: 'sync_admins' }));
      assert(response.status === (badMode === 'invalid' ? 401 : 403));
    }
    mode = 'valid';
    assert((await handleWorkforceWhatsApp(request({ action: 'status', user_id: outsider }))).status === 403);
    assert((await handleWorkforceWhatsApp(request({ action: 'send_message' }))).status === 400);
    assert((await handleWorkforceWhatsApp(request({ action: 'connect', session_name: '../foreign' }))).status === 400);
    assert(forwardCount === count, 'Rejected requests reached messaging backend');
    const authBefore = authCount;
    assert((await handleWorkforceWhatsApp(request({ action: 'status' }, ''))).status === 401);
    assert((await handleWorkforceWhatsApp(request({ action: 'status' }, 'user-jwt', 'https://evil.invalid'))).status === 403);
    assert(authCount === authBefore);
    mode = 'backend-failed';
    response = await handleWorkforceWhatsApp(request({ action: 'status' }));
    assert(response.status === 502 && !(await response.text()).includes('database-password'));
  } finally {
    globalThis.fetch = original;
    Object.entries(saved).forEach(([k, v]) => v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v));
  }
});
Deno.test('Workforce bridge pins source and routes; caller cannot add arbitrary operations', () => {
  const body = { source_id: source, organization_id: org, user_id: user, action: 'qr', session_name: 'clinic_1', admins: [{ id: user, email: 'admin@example.com' }] };
  const scope = parseWorkforceScope(body, source);
  const route = workforceRoute(scope);
  assert(route.method === 'GET' && route.url.endsWith('/qr?sessionName=clinic_1'));
  for (const bad of [ { ...body, source_id: outsider }, { ...body, user_id: outsider }, { ...body, action: 'bulk_send' }, { ...body, admins: [{ id: user }, { id: user }] }, { ...body, session_name: '../../' } ]) {
    let rejected = false;
    try { parseWorkforceScope(bad, source); } catch { rejected = true; }
    assert(rejected);
  }
});
