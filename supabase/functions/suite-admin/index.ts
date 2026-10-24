import { createClient } from 'npm:@supabase/supabase-js@2.51.0';
import { isPlatformAdmin, object, parseCommand, PRODUCTS, SuiteError } from '../_shared/suite-contract.ts';
import { checkConnection, connectorSummary } from '../_shared/suite-connections.ts';
import { adapterConfigured, deliverProduct } from '../_shared/suite-delivery.ts';
import { saveMessagingRoute } from '../_shared/suite-messaging.ts';
import { createInvitation } from '../_shared/suite-invitations.ts';
import { linkProductIdentity } from '../_shared/suite-identities.ts';
import type { Component } from '../_shared/suite-connector-core.ts';

const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new SuiteError('The Suite admin service is not configured.', 503);
  return value;
};

export async function handleSuiteAdmin(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin');
  const allowed = (Deno.env.get('SUITE_ADMIN_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (origin && !allowed.includes(origin)) return reply({ error: 'Admin origin is not allowed.' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  const trace = crypto.randomUUID();
  try {
    const bearer = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!bearer) throw new SuiteError('Sign in to Suite Admin.', 401);
    const admin = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.getUser(bearer);
    if (error || !data.user) throw new SuiteError('Your session is invalid or expired. Sign in again.', 401);
    if (!isPlatformAdmin(data.user, Deno.env.get('PLATFORM_SUPER_ADMIN_USER_ID'))) throw new SuiteError('This account is not the Suite Super Admin.', 403);
    const raw = await req.text();
    if (raw.length > 16_384) throw new SuiteError('Request is too large.', 413);
    let decoded: unknown;
    try { decoded = JSON.parse(raw); } catch { throw new SuiteError('Invalid JSON request.'); }
    const command = parseCommand(decoded);
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data: result, error: dbError } = await admin.rpc(name, args);
      if (dbError) {
        console.error('suite-admin database error', { trace, code: dbError.code, operation: name });
        if (dbError.code === 'P0001') throw new SuiteError(dbError.message, 409);
        if (dbError.code === '23505') throw new SuiteError('That membership or tenant mapping already exists.', 409);
        if (['23514', '23502', '23503', '22P02'].includes(dbError.code)) throw new SuiteError('The request contains invalid or missing values.');
        throw new SuiteError('The platform database is unavailable or its migration has not been applied.', 503);
      }
      return result;
    };
    if (command.action === 'check_connection') {
      const result = await checkConnection(command.payload.component as Component);
      await rpc('suite_record_connection', { p_component: result.component, p_instance: result.instance_id, p_environment: result.environment, p_actor: data.user.id });
      return reply(result);
    }
    if (command.action === 'link_product_identity') return reply(await linkProductIdentity(rpc, data.user.id, command.requestId!, command.payload));
    if (command.action === 'create_invitation') return reply(await createInvitation(rpc, data.user.id, command.requestId!, command.payload));
    if (command.action === 'messaging_detail') return reply(await rpc('suite_messaging_detail', { p_org: command.payload.organization_id }));
    if (command.action === 'identity_detail') return reply(await rpc('suite_identity_detail', { p_org: command.payload.organization_id }));
    if (command.action === 'save_messaging_route') return reply(await saveMessagingRoute(rpc, data.user.id, command.requestId!, command.payload));
    if (['revoke_grant', 'set_messaging_route', 'record_payment', 'void_payment'].includes(command.action)) {
      return reply(await rpc('suite_operate', { p_actor: data.user.id, p_request: command.requestId, p_action: command.action, p_payload: command.payload }));
    }
    if (command.action === 'overview') {
      const overview = await rpc('suite_overview', { p_search: command.payload.search, p_offset: command.payload.offset });
      return reply({ ...object(overview), connectors: connectorSummary(), adapters: Object.fromEntries(PRODUCTS.map(p => [p, adapterConfigured(p)])) });
    }
    if (command.action === 'detail') {
      const detail = await rpc('suite_detail', { p_id: command.payload.organization_id });
      if (!detail) throw new SuiteError('Organisation not found.', 404);
      return reply(detail);
    }
    if (command.action === 'sync_product') return reply(await deliverProduct(rpc, data.user.id, String(command.payload.organization_id), String(command.payload.product_code)));
    return reply(await rpc('suite_mutate', { p_actor: data.user.id, p_request: command.requestId, p_action: command.action, p_payload: command.payload }));
  } catch (error) {
    if (error instanceof SuiteError) return reply({ error: error.message, trace }, error.status);
    console.error('suite-admin unexpected error', { trace, type: error instanceof Error ? error.name : 'unknown' });
    return reply({ error: 'The admin operation failed. Please retry.', trace }, 500);
  }
}

if (import.meta.main) Deno.serve(handleSuiteAdmin);
