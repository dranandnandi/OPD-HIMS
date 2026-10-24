import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// GMB Profile Manager: connect flow, discovery, and data sync.
//
// Modes (POST JSON { mode, ... }):
//   register  (user)        { gmbLink?, placeId? }        -> create/refresh the clinic's pending location row
//   discover  (user | cron) {}                            -> match pending rows to listings our manager account can see
//   assign    (super admin) { locationId, windsorAccountId } -> manual match when auto-discovery cannot
//   sync      (user | cron) { locationId?, parts? }       -> pull profile/reviews/posts/media/insights into Supabase
//   actions   (super admin) {}                            -> list Windsor write actions (smoke test for the actions endpoint)
//
// Deployed with verify_jwt = false so the cron caller (x-cron-secret) can reach it;
// user calls are verified manually via requireUser().

import {
  corsHeaders,
  errorResponse,
  hasGmbFeature,
  HttpError,
  isCronRequest,
  isPlatformAdmin,
  json,
  readJson,
  resolveGmbLink,
  requireOwnedLocation,
  requireUser,
  serviceClient,
  type AppUser,
  type LocationRow,
} from '../_shared/gmb-common.ts';
import {
  ALL_SYNC_PARTS,
  discoverLocations,
  finishRun,
  probeLocation,
  startRun,
  syncLocation,
  type DiscoveredLocation,
  type SyncPart,
} from '../_shared/gmb-sync-core.ts';
import { GMB_CONNECTOR, windsorListActions } from '../_shared/windsor.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

interface Body {
  mode?: 'register' | 'discover' | 'assign' | 'sync' | 'actions';
  gmbLink?: string;
  placeId?: string;
  locationId?: string;
  windsorAccountId?: string;
  parts?: SyncPart[];
}

const managerEmail = () => Deno.env.get('GMB_MANAGER_EMAIL') || null;

Deno.serve(guardEdge(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  try {
    const admin = serviceClient();
    const body = await readJson<Body>(req);
    const cron = isCronRequest(req);
    const user = cron ? null : await requireUser(req, admin);
    if (user && !hasGmbFeature(user)) throw new HttpError(403, 'GMB Profile Manager is not enabled for this account');

    switch (body.mode) {
      case 'register':
        if (!user) throw new HttpError(401, 'User session required');
        return json(await register(admin, user, body));
      case 'discover':
        return json(await discover(admin, user, cron));
      case 'assign':
        if (!user || !isPlatformAdmin(user)) throw new HttpError(403, 'Platform admin only');
        return json(await assign(admin, body));
      case 'sync':
        return json(await sync(admin, user, cron, body));
      case 'actions':
        if (!user || !isPlatformAdmin(user)) throw new HttpError(403, 'Platform admin only');
        return json({ success: true, actions: await windsorListActions(GMB_CONNECTOR) });
      default:
        throw new HttpError(400, `Unknown mode "${body.mode}"`);
    }
  } catch (err) {
    return errorResponse(err);
  }
}, 'growth', 'gmb-sync'));

// ---------------------------------------------------------------------------

async function register(admin: ReturnType<typeof serviceClient>, user: AppUser, body: Body) {
  const link = (body.gmbLink || user.gmbLink || '').trim();
  const parsed = await resolveGmbLink(link);
  const placeId = (body.placeId || '').trim() || parsed.placeId;

  const { data: existing } = await admin
    .from('gmb_locations')
    .select('id, status')
    .eq('user_id', user.id)
    .neq('status', 'disabled')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let locationId: string;
  if (existing) {
    const { error } = await admin
      .from('gmb_locations')
      .update({ gmb_link: link || null, place_id: placeId, maps_cid: parsed.cid, access_requested_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw new HttpError(500, error.message);
    locationId = existing.id;
  } else {
    const { data, error } = await admin
      .from('gmb_locations')
      .insert({
        user_id: user.id,
        gmb_link: link || null,
        place_id: placeId,
        maps_cid: parsed.cid,
        title: user.clinicName,
        status: 'pending_access',
      })
      .select('id')
      .single();
    if (error || !data) throw new HttpError(500, error?.message || 'Could not create location');
    locationId = data.id;
  }

  // Try to match straight away: the clinic may already have added us as manager.
  const discovery = await discoverForUser(admin, user.id).catch((e) => ({ matched: 0, error: String(e?.message || e) }));

  return {
    success: true,
    locationId,
    managerEmail: managerEmail(),
    parsed: { placeId, cid: parsed.cid },
    discovery,
  };
}

async function discover(admin: ReturnType<typeof serviceClient>, user: AppUser | null, cron: boolean) {
  if (cron || (user && isPlatformAdmin(user))) {
    const result = await discoverAll(admin);
    return { success: true, ...result };
  }
  if (!user) throw new HttpError(401, 'User session required');
  const result = await discoverForUser(admin, user.id);
  return { success: true, managerEmail: managerEmail(), ...result };
}

function matchLocation(row: LocationRow, candidates: DiscoveredLocation[]): DiscoveredLocation | null {
  if (row.windsor_account_id) {
    const direct = candidates.find((c) => c.windsorAccountId === row.windsor_account_id);
    if (direct) return direct;
  }
  if (row.place_id) {
    const byPlace = candidates.find((c) => c.placeId && c.placeId === row.place_id);
    if (byPlace) return byPlace;
  }
  if (row.maps_cid) {
    const byCid = candidates.find((c) => c.cid && c.cid === row.maps_cid);
    if (byCid) return byCid;
  }
  return null;
}

async function applyMatches(
  admin: ReturnType<typeof serviceClient>,
  rows: LocationRow[],
  candidates: DiscoveredLocation[],
  trigger: 'user' | 'cron'
) {
  const seen = new Set(candidates.map((c) => c.windsorAccountId));
  let matched = 0;
  let lost = 0;
  const synced: Record<string, unknown> = {};

  for (const row of rows) {
    if (row.status === 'connected' && row.windsor_account_id && !seen.has(row.windsor_account_id)) {
      const stillVisible = await probeLocation(row.windsor_account_id);
      if (!stillVisible) {
        await admin.from('gmb_locations').update({ status: 'access_lost', last_sync_error: 'Our manager account can no longer see this listing.' }).eq('id', row.id);
        lost += 1;
      }
      continue;
    }
    if (row.status === 'connected') continue;

    const hit = matchLocation(row, candidates);
    if (!hit) continue;

    // Another clinic row may already claim this listing (unique constraint). Skip rather than steal.
    const { data: claimed } = await admin
      .from('gmb_locations')
      .select('id')
      .eq('windsor_account_id', hit.windsorAccountId)
      .neq('id', row.id)
      .maybeSingle();
    if (claimed) continue;

    const { error } = await admin
      .from('gmb_locations')
      .update({
        windsor_account_id: hit.windsorAccountId,
        title: hit.title || row.title,
        place_id: hit.placeId || row.place_id,
        maps_cid: hit.cid || row.maps_cid,
        status: 'connected',
        connected_at: row.status === 'access_lost' ? undefined : new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) continue;
    matched += 1;

    const connected: LocationRow = { ...row, windsor_account_id: hit.windsorAccountId, status: 'connected' };
    const runId = await startRun(admin, row.id, 'initial-sync', trigger);
    try {
      const stats = await syncLocation(admin, connected, ALL_SYNC_PARTS);
      await finishRun(admin, runId, 'success', stats);
      synced[row.id] = stats;
    } catch (e) {
      const message = String((e as Error)?.message || e);
      await finishRun(admin, runId, 'failed', {}, message);
      await admin.from('gmb_locations').update({ last_sync_error: message }).eq('id', row.id);
      synced[row.id] = { error: message };
    }
  }
  return { matched, lost, synced };
}

async function discoverForUser(admin: ReturnType<typeof serviceClient>, userId: string) {
  const { data: rows, error } = await admin
    .from('gmb_locations')
    .select('id, user_id, windsor_account_id, place_id, maps_cid, gmb_link, title, status, last_synced_at')
    .eq('user_id', userId)
    .neq('status', 'disabled');
  if (error) throw new HttpError(500, error.message);
  if (!rows || rows.length === 0) return { matched: 0, lost: 0, pending: 0 };

  const candidates = await discoverLocations();
  const result = await applyMatches(admin, rows as LocationRow[], candidates, 'user');
  const pending = rows.filter((r) => r.status !== 'connected').length - result.matched;
  return { ...result, pending, visibleLocations: candidates.length };
}

async function discoverAll(admin: ReturnType<typeof serviceClient>) {
  const { data: rows, error } = await admin
    .from('gmb_locations')
    .select('id, user_id, windsor_account_id, place_id, maps_cid, gmb_link, title, status, last_synced_at')
    .neq('status', 'disabled');
  if (error) throw new HttpError(500, error.message);

  const candidates = await discoverLocations();
  const result = await applyMatches(admin, (rows || []) as LocationRow[], candidates, 'cron');
  const claimed = new Set((rows || []).map((r) => r.windsor_account_id).filter(Boolean));
  return {
    ...result,
    visibleLocations: candidates.length,
    unclaimed: candidates.filter((c) => !claimed.has(c.windsorAccountId)),
  };
}

async function assign(admin: ReturnType<typeof serviceClient>, body: Body) {
  if (!body.locationId || !body.windsorAccountId) throw new HttpError(400, 'locationId and windsorAccountId are required');
  const { data: row, error } = await admin
    .from('gmb_locations')
    .select('id, user_id, windsor_account_id, place_id, maps_cid, gmb_link, title, status, last_synced_at')
    .eq('id', body.locationId)
    .single();
  if (error || !row) throw new HttpError(404, 'Location not found');

  const candidates = await discoverLocations();
  const hit = candidates.find((c) => c.windsorAccountId === body.windsorAccountId);
  if (!hit) throw new HttpError(400, 'That Windsor account id is not visible to our manager account');

  const { error: updErr } = await admin
    .from('gmb_locations')
    .update({ windsor_account_id: hit.windsorAccountId, title: hit.title || row.title, place_id: hit.placeId, maps_cid: hit.cid, status: 'connected', connected_at: new Date().toISOString() })
    .eq('id', row.id);
  if (updErr) throw new HttpError(500, updErr.message);

  const connected = { ...(row as LocationRow), windsor_account_id: hit.windsorAccountId, status: 'connected' as const };
  const runId = await startRun(admin, row.id, 'initial-sync', 'user');
  try {
    const stats = await syncLocation(admin, connected);
    await finishRun(admin, runId, 'success', stats);
    return { success: true, stats };
  } catch (e) {
    const message = String((e as Error)?.message || e);
    await finishRun(admin, runId, 'failed', {}, message);
    throw new HttpError(502, message);
  }
}

async function sync(admin: ReturnType<typeof serviceClient>, user: AppUser | null, cron: boolean, body: Body) {
  const parts = Array.isArray(body.parts) && body.parts.length ? body.parts.filter((p) => ALL_SYNC_PARTS.includes(p)) : ALL_SYNC_PARTS;

  if (body.locationId) {
    if (!user) throw new HttpError(401, 'User session required');
    const location = await requireOwnedLocation(admin, user, body.locationId);
    if (location.status !== 'connected' || !location.windsor_account_id) {
      // Not connected yet: re-run discovery for this user instead of failing.
      const discovery = await discoverForUser(admin, user.id);
      return { success: true, connected: discovery.matched > 0, discovery, managerEmail: managerEmail() };
    }
    const runId = await startRun(admin, location.id, parts.join(','), 'user');
    try {
      const stats = await syncLocation(admin, location, parts);
      await finishRun(admin, runId, 'success', stats);
      return { success: true, stats };
    } catch (e) {
      const message = String((e as Error)?.message || e);
      await finishRun(admin, runId, 'failed', {}, message);
      await admin.from('gmb_locations').update({ last_sync_error: message }).eq('id', location.id);
      throw new HttpError(502, message);
    }
  }

  if (!cron && !(user && isPlatformAdmin(user))) throw new HttpError(400, 'locationId is required');

  // Cron / platform admin: sync every connected location, sequentially to respect Windsor limits.
  const { data: rows, error } = await admin
    .from('gmb_locations')
    .select('id, user_id, windsor_account_id, place_id, maps_cid, gmb_link, title, status, last_synced_at')
    .eq('status', 'connected')
    .order('last_synced_at', { ascending: true, nullsFirst: true });
  if (error) throw new HttpError(500, error.message);

  const results: Record<string, unknown> = {};
  for (const row of (rows || []) as LocationRow[]) {
    const runId = await startRun(admin, row.id, parts.join(','), cron ? 'cron' : 'user');
    try {
      const stats = await syncLocation(admin, row, parts);
      await finishRun(admin, runId, 'success', stats);
      results[row.id] = stats;
    } catch (e) {
      const message = String((e as Error)?.message || e);
      await finishRun(admin, runId, 'failed', {}, message);
      await admin.from('gmb_locations').update({ last_sync_error: message }).eq('id', row.id);
      results[row.id] = { error: message };
    }
  }
  return { success: true, count: Object.keys(results).length, results };
}
