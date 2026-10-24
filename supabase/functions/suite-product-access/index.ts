import { createClient } from 'npm:@supabase/supabase-js@2.51.0';
import { object, PRODUCTS, SuiteError, text, uuid } from '../_shared/suite-contract.ts';
import { invitationHash, parseInvitationToken } from '../_shared/suite-invitations.ts';

// Server-to-server only. No browser CORS. Each product has a different secret;
// the credential selects its product, never a caller-supplied product field.
async function equalSecret(a: string, b: string) {
  const encode = new TextEncoder();
  const hashes = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', encode.encode(s))));
  const first = new Uint8Array(hashes[0]);
  const second = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i = 0; i < first.length; i++) difference |= first[i] ^ second[i];
  return difference === 0;
}
export async function handleProductAccess(req: Request): Promise<Response> {
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  try {
    if (req.headers.has('Origin')) throw new SuiteError('Server requests only.', 403);
    const token = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) throw new SuiteError('Product authentication required.', 401);
    let product: string | undefined;
    for (const candidate of PRODUCTS) {
      const secret = Deno.env.get(`SUITE_${candidate.toUpperCase()}_ACCESS_TOKEN`);
      if (secret && secret.length >= 32 && await equalSecret(secret, token)) {
        if (product) throw new SuiteError('Product credentials are not uniquely configured.', 503);
        product = candidate;
      }
    }
    if (!product) throw new SuiteError('Invalid product credential.', 401);
    const raw = await req.text();
    if (raw.length > 2048) throw new SuiteError('Request too large.', 413);
    let input: Record<string, unknown>;
    try { input = object(JSON.parse(raw)); } catch { throw new SuiteError('Invalid JSON.'); }
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new SuiteError('Platform is not configured.', 503);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    if(input.action==='redeem_launch'){
      const {data,error}=await admin.rpc('suite_redeem_launch',{p_product:product,p_hash:await invitationHash(parseInvitationToken(input.ticket)),p_instance:uuid(input.instance_id,'instance')});
      if(error)throw new SuiteError(error.code==='P0001'?'Launch link is invalid, expired or no longer permitted.':'Launch service is unavailable.',error.code==='P0001'?403:503);
      return reply(data);
    }
    const org = input.organization_id === undefined ? undefined : uuid(input.organization_id, 'organisation ID');
    const tenant = text(input.local_tenant_id, 'local tenant ID', 200);
    let rpcName = org ? 'suite_product_access' : 'suite_resolve_product_access';
    const args: Record<string, unknown> = { ...(org ? { p_org: org } : {}), p_product: product, p_tenant: tenant };
    if (input.route_id !== undefined) {
      if (!org) throw new SuiteError('Organisation ID is required for a messaging route.');
      rpcName = 'suite_messaging_access';
      args.p_route = uuid(input.route_id, 'route ID');
      args.p_backend = uuid(input.backend_instance_id, 'backend instance');
      args.p_sender = text(input.sender_user_id, 'sender', 200);
      args.p_session = text(input.session_name, 'session', 80);
      if (typeof input.route_version !== 'number' || !Number.isSafeInteger(input.route_version) || input.route_version < 1) throw new SuiteError('Invalid route version.');
      args.p_version = input.route_version;
    }
    const { data, error } = await admin.rpc(rpcName, args);
    if (error) throw new SuiteError('Access state could not be read. Retry within your mirror refresh window.', 503);
    if (!data) throw new SuiteError('No matching product binding.', 404);
    return reply(data);
  } catch (e) {
    return reply({ error: e instanceof SuiteError ? e.message : 'Access check unavailable.' }, e instanceof SuiteError ? e.status : 500);
  }
}

if (import.meta.main) Deno.serve(handleProductAccess);
