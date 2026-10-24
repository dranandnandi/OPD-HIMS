import { withSuiteClient, runtimeFetch } from './suite-runtime-guard.ts';
// Shared helpers for the GMB Profile Manager edge functions:
// CORS, JSON responses, caller authentication, tenant checks.

import { createClient as dsBase_createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
const createClient=withSuiteClient(dsBase_createClient);


declare const Deno: { env: { get(name: string): string | undefined } };

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Max-Age': '86400',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface AppUser {
  id: string;
  authId: string;
  name: string;
  role: string;
  clinicName: string;
  gmbLink: string | null;
  defaultLanguage: string | null;
  enabledFeatures: string[];
  businessContext: Record<string, unknown> | null;
  contactPhone: string | null;
  contactWhatsapp: string | null;
}

/** Resolve the calling app user from the Supabase JWT in the Authorization header. */
export async function requireUser(req: Request, admin: SupabaseClient): Promise<AppUser> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) throw new HttpError(401, 'Missing authorization header');

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!anonKey || !url) throw new Error('Supabase anon credentials are not configured');

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new HttpError(401, 'Invalid or expired session');

  const { data, error: rowError } = await admin
    .from('users')
    .select('id, auth_id, name, role, clinic_name, gmb_link, default_language, enabled_features, business_context, contact_phone, contact_whatsapp')
    .eq('auth_id', user.id)
    .single();
  if (rowError || !data) throw new HttpError(403, 'User profile not found');

  return {
    id: data.id,
    authId: data.auth_id,
    name: data.name,
    role: data.role,
    clinicName: data.clinic_name,
    gmbLink: data.gmb_link,
    defaultLanguage: data.default_language,
    enabledFeatures: Array.isArray(data.enabled_features) ? data.enabled_features : [],
    businessContext: data.business_context ?? null,
    contactPhone: data.contact_phone,
    contactWhatsapp: data.contact_whatsapp,
  };
}

export function isPlatformAdmin(user: AppUser): boolean {
  return user.role === 'super_admin';
}

export function hasGmbFeature(user: AppUser): boolean {
  return isPlatformAdmin(user) || user.enabledFeatures.includes('gmb');
}

/** True when the request carries the cron secret (server-to-server call). */
export function isCronRequest(req: Request): boolean {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) return false;
  return req.headers.get('x-cron-secret') === secret;
}

export interface LocationRow {
  id: string;
  user_id: string;
  windsor_account_id: string | null;
  place_id: string | null;
  maps_cid: string | null;
  gmb_link: string | null;
  title: string | null;
  status: 'pending_access' | 'connected' | 'access_lost' | 'disabled';
  last_synced_at: string | null;
}

/** Load a location and verify the caller owns it (or is a platform admin). */
export async function requireOwnedLocation(
  admin: SupabaseClient,
  user: AppUser,
  locationId: string
): Promise<LocationRow> {
  if (!locationId) throw new HttpError(400, 'locationId is required');
  const { data, error } = await admin
    .from('gmb_locations')
    .select('id, user_id, windsor_account_id, place_id, maps_cid, gmb_link, title, status, last_synced_at')
    .eq('id', locationId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, 'Location not found');
  if (data.user_id !== user.id && !isPlatformAdmin(user)) throw new HttpError(403, 'You do not own this location');
  return data as LocationRow;
}

/**
 * g.page/r/<token> short links encode the Maps CID as a tiny protobuf
 * (field 1, fixed64 little-endian) in base64url. Decode it without a network call.
 */
function cidFromGPageToken(token: string): string | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (token.length % 4)) % 4);
    const bin = atob(b64);
    if (bin.length < 9 || bin.charCodeAt(0) !== 0x09) return null;
    let cid = 0n;
    for (let i = 8; i >= 1; i--) cid = (cid << 8n) | BigInt(bin.charCodeAt(i));
    return cid > 0n ? cid.toString(10) : null;
  } catch {
    return null;
  }
}

/** Extract a Google place id and/or Maps CID from the many shapes a "GMB link" takes. */
export function parseGmbLink(link: string | null | undefined): { placeId: string | null; cid: string | null } {
  const value = String(link || '').trim();
  if (!value) return { placeId: null, cid: null };

  let placeId: string | null = null;
  let cid: string | null = null;

  const gpage = value.match(/g\.page\/r\/([A-Za-z0-9_-]{8,})/);
  if (gpage) cid = cidFromGPageToken(gpage[1]);

  const placeIdMatch = value.match(/(?:placeid|place_id)=([A-Za-z0-9_-]{10,})/i);
  if (placeIdMatch) placeId = placeIdMatch[1];
  if (!placeId && /^ChIJ[A-Za-z0-9_-]{10,}$/.test(value)) placeId = value;

  const cidMatch = value.match(/[?&]cid=(\d{6,})/) || value.match(/[?&]ludocid=(\d{6,})/);
  if (cidMatch) cid = cidMatch[1];
  if (!cid) {
    // maps.google.com/?cid=... is handled above; the "0x...:0x..." data form carries the CID in hex
    const hexMatch = value.match(/!1s0x[0-9a-f]+:0x([0-9a-f]+)/i);
    if (hexMatch) {
      try {
        cid = BigInt(`0x${hexMatch[1]}`).toString(10);
      } catch {
        cid = null;
      }
    }
  }
  if (!cid && /^\d{10,}$/.test(value)) cid = value;

  return { placeId, cid };
}

const SHORT_LINK_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.page|g\.co|share\.google|maps\.google\.com|www\.google\.com|google\.com)$/i;

/**
 * parseGmbLink, plus a redirect-following fallback for short links that carry no id in the
 * URL itself (maps.app.goo.gl/..., g.co/kgs/..., google.com/maps/place/<name>). Follows up to
 * five redirects and parses every hop; never downloads page bodies.
 */
export async function resolveGmbLink(link: string | null | undefined): Promise<{ placeId: string | null; cid: string | null }> {
  const direct = parseGmbLink(link);
  if (direct.placeId || direct.cid) return direct;

  let url: string;
  try {
    url = new URL(String(link || '').trim()).toString();
  } catch {
    return direct;
  }
  if (!SHORT_LINK_HOSTS.test(new URL(url).hostname)) return direct;

  for (let hop = 0; hop < 5; hop++) {
    let resp: Response;
    try {
      resp = await runtimeFetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GMBProfileManager/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      break;
    }
    const next = resp.headers.get('location');
    try {
      await resp.body?.cancel();
    } catch {
      // ignore
    }
    if (!next) break;
    url = new URL(next, url).toString();
    const parsed = parseGmbLink(decodeURIComponent(url));
    if (parsed.placeId || parsed.cid) return parsed;
  }
  return direct;
}

export function cidFromMapsUri(uri: string | null | undefined): string | null {
  const match = String(uri || '').match(/[?&]cid=(\d+)/);
  return match ? match[1] : null;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ success: false, error: err.message }, err.status);
  const anyErr = err as { message?: string; status?: number; body?: unknown };
  console.error('[gmb] unhandled error', err);
  const status = typeof anyErr?.status === 'number' && anyErr.status >= 400 && anyErr.status < 600 ? 502 : 500;
  return json(
    {
      success: false,
      error: anyErr?.message || 'Unexpected error',
      detail: anyErr?.body ?? undefined,
    },
    status
  );
}
