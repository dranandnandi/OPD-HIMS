import { withSuiteClient, runtimeFetch, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { createClient as dsBase_createClient } from 'npm:@supabase/supabase-js@2.51.0';
const createClient=withSuiteClient(dsBase_createClient);


const ACTIONS = ['sync_admins', 'handshake', 'connect', 'refresh_qr', 'qr', 'status', 'disconnect'];
const ADMIN_ROLES = ['admin', 'superadmin'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleWorkforceWhatsApp(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin');
  const origins = (Deno.env.get('WORKFORCE_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
  if (origin && origins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !origins.includes(origin)) return reply({ error: 'Origin is not allowed.' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  try {
    const bearer = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!bearer) return reply({ error: 'Sign in to Task Manager.' }, 401);
    const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return reply({ error: 'Task server is not configured.' }, 503);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !user) return reply({ error: 'Invalid or expired session.' }, 401);
    const { data: profile, error: profileError } = await admin.from('users')
      .select('id,organization_id,role,is_active').eq('auth_id', user.id).maybeSingle();
    if (profileError || !profile?.organization_id || !profile.is_active || !ADMIN_ROLES.includes(profile.role)) {
      return reply({ error: 'An active organisation administrator is required.' }, 403);
    }
    const raw = await req.text();
    if (raw.length > 4096) return reply({ error: 'Request too large.' }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return reply({ error: 'Invalid JSON.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.includes(String(body.action))) return reply({ error: 'Invalid action.' }, 400);
    const userId = body.user_id === undefined ? profile.id : body.user_id;
    if (typeof userId !== 'string' || !UUID.test(userId)) return reply({ error: 'Invalid Task user ID.' }, 400);
    const sessionName = body.session_name === undefined ? 'default' : body.session_name;
    if (typeof sessionName !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(sessionName)) return reply({ error: 'Invalid session name.' }, 400);
    // Re-read active admins from the database. Ignore client-supplied org IDs, roles and admin lists.
    const { data: rows, error: usersError } = await admin.from('users').select('id,email,name,role')
      .eq('organization_id', profile.organization_id).eq('is_active', true).in('role', ADMIN_ROLES).limit(201);
    if (usersError || !rows) return reply({ error: 'Organisation users could not be checked.' }, 503);
    if (rows.length > 200) return reply({ error: 'This organisation requires a paginated integration rollout.' }, 409);
    if (!rows.some(row => row.id === userId)) return reply({ error: 'The requested sender is not an active administrator in your organisation.' }, 403);
    const endpoint = Deno.env.get('WORKFORCE_WHATSAPP_URL'); const credential = Deno.env.get('WORKFORCE_WHATSAPP_TOKEN');
    const sourceId = Deno.env.get('WORKFORCE_SOURCE_ID');
    if (!endpoint || !credential || credential.length < 32 || !sourceId || !UUID.test(sourceId)) return reply({ error: 'WhatsApp server connection is not configured.' }, 503);
    const destination = new URL(endpoint);
    if (destination.protocol !== 'https:' || destination.username || destination.password || destination.search || destination.hash ||
        destination.pathname !== '/api/integrations/workforce') return reply({ error: 'Invalid WhatsApp server destination.' }, 503);
    const response = await runtimeFetch(destination, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId, organization_id: profile.organization_id,
        action: body.action, user_id: userId, session_name: sessionName,
        admins: rows.map(row => ({ id: row.id, email: row.email || null, name: row.name || null })) }),
    });
    const resultText = await response.text();
    if (resultText.length > 1_000_000) return reply({ error: 'WhatsApp server response was too large.' }, 502);
    if (!response.ok) return reply({ error: `WhatsApp operation failed (HTTP ${response.status}). Check the sender mapping and server connection.` }, response.status === 404 ? 404 : response.status === 409 ? 409 : 502);
    const result = JSON.parse(resultText);
    if (!result || result.success !== true || typeof result.data !== 'object' || result.data === null) return reply({ error: 'Invalid WhatsApp server response.' }, 502);
    return reply(result);
  } catch { return reply({ error: 'WhatsApp connection is unavailable. Retry after checking server configuration.' }, 503); }
}
if (import.meta.main) Deno.serve(guardEdge(handleWorkforceWhatsApp, 'workforce', 'workforce-whatsapp'));
