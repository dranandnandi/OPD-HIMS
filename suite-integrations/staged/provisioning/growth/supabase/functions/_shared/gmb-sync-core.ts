import {withUser} from './suite-runtime-guard.ts';
// Sync logic shared by gmb-sync (user/cron) and gmb-action (targeted re-sync after a write).
// Everything here runs with the service role and is already scoped to one location row.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  GMB_CONNECTOR,
  GMB_DISCOVERY_FIELDS,
  GMB_INSIGHT_FIELDS,
  GMB_MEDIA_FIELDS,
  GMB_POST_FIELDS,
  GMB_PROFILE_FIELDS,
  GMB_REVIEW_FIELDS,
  isoDate,
  starRatingToNumber,
  windsorRead,
  type WindsorRow,
} from './windsor.ts';
import { evaluateCompleteness } from './gmb-completeness.ts';
import { cidFromMapsUri, type LocationRow } from './gmb-common.ts';

const REVIEW_BACKFILL_FROM = '2010-01-01';
const MEDIA_BACKFILL_FROM = '2010-01-01';
const POST_BACKFILL_DAYS = 730;
const INSIGHTS_BACKFILL_DAYS = 90;
const INSIGHTS_INCREMENTAL_DAYS = 7;

export type SyncPart = 'profile' | 'reviews' | 'posts' | 'media' | 'insights';
export const ALL_SYNC_PARTS: SyncPart[] = ['profile', 'reviews', 'posts', 'media', 'insights'];

export interface DiscoveredLocation {
  windsorAccountId: string;
  title: string | null;
  placeId: string | null;
  cid: string | null;
  mapsUri: string | null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function int(v: unknown): number {
  const n = num(v);
  return n === null ? 0 : Math.round(n);
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function ts(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** Every location our manager identity can see through Windsor. */
export async function discoverLocations(): Promise<DiscoveredLocation[]> {
  const rows = await windsorRead(GMB_CONNECTOR, { fields: GMB_DISCOVERY_FIELDS, datePreset: 'last_7d' });
  const byId = new Map<string, DiscoveredLocation>();
  for (const row of rows) {
    const id = str(row.location_id) || str(row.account_id);
    if (!id) continue;
    if (byId.has(id)) continue;
    const mapsUri = str(row.location_metadata_maps_uri);
    byId.set(id, {
      windsorAccountId: id,
      title: str(row.location_title) || str(row.account_name),
      placeId: str(row.location_metadata_place_id),
      cid: cidFromMapsUri(mapsUri),
      mapsUri,
    });
  }
  return [...byId.values()];
}

/**
 * Discovery is date-scoped, so a quiet listing can be missing from the list without access
 * being lost. Before flagging access_lost, read that one account directly.
 */
export async function probeLocation(windsorAccountId: string): Promise<boolean> {
  try {
    const rows = await windsorRead(GMB_CONNECTOR, {
      fields: ['location_id', 'location_title'],
      selectAccounts: [windsorAccountId],
      datePreset: 'last_30d',
    });
    return rows.some((r) => str(r.location_id) === windsorAccountId) || rows.length > 0;
  } catch {
    return false;
  }
}

export interface SyncStats {
  profile?: boolean;
  reviews?: number;
  posts?: number;
  media?: number;
  insights?: number;
  score?: number;
  issues?: number;
}

/** Pull the requested parts for one connected location and recompute completeness. */
export async function syncLocation(
  admin: SupabaseClient,
  location: LocationRow,
  parts: SyncPart[] = ALL_SYNC_PARTS
): Promise<SyncStats> {
  return withUser(location.user_id,async()=>{
  if (!location.windsor_account_id) throw new Error('Location is not connected to Windsor yet');
  const account = location.windsor_account_id;
  const stats: SyncStats = {};
  const today = isoDate(new Date());

  if (parts.includes('profile')) {
    const rows = await windsorRead(GMB_CONNECTOR, {
      fields: GMB_PROFILE_FIELDS,
      selectAccounts: [account],
      datePreset: 'last_7d',
    });
    const row = rows.find((r) => str(r.location_id) === account) || rows[0];
    if (row) {
      await upsertProfile(admin, location.id, row);
      await admin
        .from('gmb_locations')
        .update({ title: str(row.location_title) || location.title, place_id: str(row.location_metadata_place_id) || location.place_id })
        .eq('id', location.id);
      stats.profile = true;
    }
  }

  if (parts.includes('reviews')) {
    const rows = await windsorRead(GMB_CONNECTOR, {
      fields: GMB_REVIEW_FIELDS,
      selectAccounts: [account],
      dateFrom: REVIEW_BACKFILL_FROM,
      dateTo: today,
    });
    stats.reviews = await upsertReviews(admin, location.id, rows);
  }

  if (parts.includes('posts')) {
    const rows = await windsorRead(GMB_CONNECTOR, {
      fields: GMB_POST_FIELDS,
      selectAccounts: [account],
      dateFrom: isoDate(daysAgo(POST_BACKFILL_DAYS)),
      dateTo: today,
    });
    stats.posts = await upsertPosts(admin, location.id, rows);
  }

  if (parts.includes('media')) {
    const rows = await windsorRead(GMB_CONNECTOR, {
      fields: GMB_MEDIA_FIELDS,
      selectAccounts: [account],
      dateFrom: MEDIA_BACKFILL_FROM,
      dateTo: today,
    });
    stats.media = await upsertMedia(admin, location.id, rows);
  }

  if (parts.includes('insights')) {
    const from = location.last_synced_at ? daysAgo(INSIGHTS_INCREMENTAL_DAYS) : daysAgo(INSIGHTS_BACKFILL_DAYS);
    const rows = await windsorRead(GMB_CONNECTOR, {
      fields: GMB_INSIGHT_FIELDS,
      selectAccounts: [account],
      dateFrom: isoDate(from),
      dateTo: today,
    });
    stats.insights = await upsertInsights(admin, location.id, rows);
  }

  const completeness = await recomputeCompleteness(admin, location.id);
  stats.score = completeness.score;
  stats.issues = completeness.issues.length;

  await admin
    .from('gmb_locations')
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq('id', location.id);

  return stats;
  });
}

async function upsertProfile(admin: SupabaseClient, locationId: string, row: WindsorRow) {
  const payload = {
    location_id: locationId,
    fetched_at: new Date().toISOString(),
    title: str(row.location_title),
    description: str(row.location_profile_description),
    website_uri: str(row.location_website_uri),
    primary_phone: str(row.location_primary_phone),
    primary_category_id: str(row.location_primary_category_id),
    primary_category_name: str(row.location_primary_category_name),
    additional_categories: arr(row.location_additional_categories).map((c) => {
      const cat = (c || {}) as Record<string, unknown>;
      // Drop the very large serviceTypes/moreHoursTypes payloads; keep what the UI needs.
      return { name: cat.name, displayName: cat.displayName, serviceTypes: arr(cat.serviceTypes).map((s) => ({ serviceTypeId: (s as Record<string, unknown>).serviceTypeId, displayName: (s as Record<string, unknown>).displayName })) };
    }),
    attributes: arr(row.location_attributes),
    service_items: arr(row.location_service_items),
    regular_hours: arr(row.location_regular_hours_periods),
    special_hours: arr(row.location_special_hours_periods),
    open_status: str(row.location_open_info_status),
    opening_date_year: num(row.location_open_info_opening_date_year),
    address: {
      lines: arr(row.location_address_lines),
      locality: str(row.location_address_locality),
      sublocality: str(row.location_address_sublocality),
      administrativeArea: str(row.location_address_administrative_area),
      postalCode: str(row.location_address_postal_code),
      regionCode: str(row.location_address_region_code),
    },
    latitude: num(row.location_latitude),
    longitude: num(row.location_longitude),
    maps_uri: str(row.location_metadata_maps_uri),
    new_review_uri: str(row.location_metadata_new_review_uri),
    has_pending_edits: typeof row.location_metadata_has_pending_edits === 'boolean' ? row.location_metadata_has_pending_edits : null,
    raw: {
      more_hours: arr(row.location_more_hours),
      additional_phones: arr(row.location_additional_phones),
      service_area: row.location_service_area ?? null,
      has_google_updated: row.location_metadata_has_google_updated ?? null,
      has_voice_of_merchant: row.location_metadata_has_voice_of_merchant ?? null,
      can_operate_local_post: row.location_metadata_can_operate_local_post ?? null,
      can_modify_service_list: row.location_metadata_can_modify_service_list ?? null,
      opening_date: {
        year: num(row.location_open_info_opening_date_year),
        month: num(row.location_open_info_opening_date_month),
        day: num(row.location_open_info_opening_date_day),
      },
    },
  };
  const { error } = await admin.from('gmb_profile_snapshots').upsert(payload, { onConflict: 'location_id' });
  if (error) throw new Error(`Snapshot upsert failed: ${error.message}`);
}

async function upsertReviews(admin: SupabaseClient, locationId: string, rows: WindsorRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { data: existing } = await admin
    .from('gmb_reviews')
    .select('review_id, status')
    .eq('location_id', locationId);
  const statusById = new Map<string, string>((existing || []).map((r) => [r.review_id as string, r.status as string]));

  const payload = rows
    .map((row) => {
      const reviewId = str(row.review_id);
      if (!reviewId) return null;
      const reply = str(row.review_reply_comment);
      const previous = statusById.get(reviewId);
      const status = reply ? 'replied' : previous === 'ignored' ? 'ignored' : 'needs_reply';
      return {
        location_id: locationId,
        review_id: reviewId,
        reviewer_name: str(row.review_reviewer),
        reviewer_photo_url: str(row.review_reviewer_profile_photo),
        star_rating: starRatingToNumber(row.review_star_rating),
        comment: str(row.review_comment),
        review_create_time: ts(row.review_create_time),
        review_update_time: ts(row.review_update_time),
        reply_comment: reply,
        reply_update_time: ts(row.review_reply_update_time),
        status,
      };
    })
    .filter(Boolean);

  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await admin.from('gmb_reviews').upsert(payload.slice(i, i + 200), { onConflict: 'location_id,review_id' });
    if (error) throw new Error(`Review upsert failed: ${error.message}`);
  }
  return payload.length;
}

async function upsertPosts(admin: SupabaseClient, locationId: string, rows: WindsorRow[]): Promise<number> {
  const payload = rows
    .map((row) => {
      const postId = str(row.post_id);
      if (!postId) return null;
      return {
        location_id: locationId,
        post_id: postId,
        summary: str(row.post_summary),
        state: str(row.post_state),
        topic_type: str(row.post_topic_type),
        cta_type: str(row.post_cta_action_type),
        cta_url: str(row.post_cta_url),
        media_url: str(row.post_media_google_url),
        search_url: str(row.post_search_url),
        post_create_time: ts(row.post_create_time),
        post_update_time: ts(row.post_update_time),
      };
    })
    .filter(Boolean);
  if (payload.length === 0) return 0;
  const { error } = await admin.from('gmb_posts').upsert(payload, { onConflict: 'location_id,post_id' });
  if (error) throw new Error(`Post upsert failed: ${error.message}`);
  return payload.length;
}

async function upsertMedia(admin: SupabaseClient, locationId: string, rows: WindsorRow[]): Promise<number> {
  const payload = rows
    .map((row) => {
      const mediaId = str(row.media_id);
      if (!mediaId) return null;
      return {
        location_id: locationId,
        media_id: mediaId,
        category: str(row.media_category),
        format: str(row.media_format),
        google_url: str(row.media_google_url),
        thumbnail_url: str(row.media_thumbnail_url),
        view_count: int(row.media_view_count),
        media_create_time: ts(row.media_create_time),
      };
    })
    .filter(Boolean);
  if (payload.length === 0) return 0;
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await admin.from('gmb_media').upsert(payload.slice(i, i + 200), { onConflict: 'location_id,media_id' });
    if (error) throw new Error(`Media upsert failed: ${error.message}`);
  }
  return payload.length;
}

async function upsertInsights(admin: SupabaseClient, locationId: string, rows: WindsorRow[]): Promise<number> {
  const payload = rows
    .map((row) => {
      const date = str(row.date);
      if (!date) return null;
      return {
        location_id: locationId,
        date: date.slice(0, 10),
        impressions: int(row.impressions),
        impressions_mobile_maps: int(row.impressions_mobile_maps),
        impressions_mobile_search: int(row.impressions_mobile_search),
        impressions_desktop_maps: int(row.impressions_desktop_maps),
        impressions_desktop_search: int(row.impressions_desktop_search),
        call_clicks: int(row.call_clicks),
        website_clicks: int(row.website_clicks),
        direction_requests: int(row.direction_requests),
        bookings: int(row.business_bookings),
        fetched_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);
  if (payload.length === 0) return 0;
  const { error } = await admin.from('gmb_insights_daily').upsert(payload, { onConflict: 'location_id,date' });
  if (error) throw new Error(`Insights upsert failed: ${error.message}`);
  return payload.length;
}

/** Recompute the completeness score from cached tables and store it on the location. */
export async function recomputeCompleteness(admin: SupabaseClient, locationId: string) {
  const [{ data: snap }, { data: media }, { data: posts }, { data: reviewAgg }] = await Promise.all([
    admin.from('gmb_profile_snapshots').select('*').eq('location_id', locationId).maybeSingle(),
    admin.from('gmb_media').select('category, format').eq('location_id', locationId),
    admin.from('gmb_posts').select('post_create_time, state').eq('location_id', locationId).order('post_create_time', { ascending: false }).limit(50),
    admin.from('gmb_reviews').select('star_rating, status, reply_comment').eq('location_id', locationId),
  ]);

  const photos = (media || []).filter((m) => (m.format || 'PHOTO') === 'PHOTO');
  const since = daysAgo(30).getTime();
  const livePosts = (posts || []).filter((p) => p.post_create_time);
  const recentPosts = livePosts.filter((p) => new Date(p.post_create_time as string).getTime() >= since && (p.state || 'LIVE') !== 'REJECTED');
  const reviews = reviewAgg || [];
  const rated = reviews.filter((r) => typeof r.star_rating === 'number');
  const avg = rated.length ? rated.reduce((s, r) => s + (r.star_rating as number), 0) / rated.length : null;
  const raw = (snap?.raw || {}) as Record<string, unknown>;

  const result = evaluateCompleteness({
    description: snap?.description ?? null,
    websiteUri: snap?.website_uri ?? null,
    primaryPhone: snap?.primary_phone ?? null,
    primaryCategoryId: snap?.primary_category_id ?? null,
    additionalCategories: arr(snap?.additional_categories),
    attributes: arr(snap?.attributes),
    serviceItems: arr(snap?.service_items),
    regularHours: arr(snap?.regular_hours),
    openStatus: snap?.open_status ?? null,
    openingDateYear: snap?.opening_date_year ?? null,
    address: (snap?.address || {}) as Record<string, unknown>,
    hasPendingEdits: snap?.has_pending_edits ?? null,
    hasGoogleUpdated: typeof raw.has_google_updated === 'boolean' ? raw.has_google_updated : null,
    photoCount: photos.length,
    hasCoverPhoto: photos.some((m) => m.category === 'COVER'),
    hasLogoOrProfilePhoto: photos.some((m) => m.category === 'LOGO' || m.category === 'PROFILE'),
    recentPostCount30d: recentPosts.length,
    latestPostAt: livePosts[0]?.post_create_time ?? null,
    unansweredReviewCount: reviews.filter((r) => r.status === 'needs_reply').length,
    totalReviewCount: reviews.length,
    averageRating: avg,
  });

  await admin
    .from('gmb_locations')
    .update({ completeness_score: result.score, completeness_issues: result.issues })
    .eq('id', locationId);

  return result;
}

export async function startRun(admin: SupabaseClient, locationId: string | null, mode: string, trigger: 'user' | 'cron' | 'action') {
  const { data } = await admin
    .from('gmb_sync_runs')
    .insert({ location_id: locationId, mode, trigger })
    .select('id')
    .single();
  return data?.id as string | undefined;
}

export async function finishRun(admin: SupabaseClient, runId: string | undefined, status: 'success' | 'failed', stats: unknown, error?: string) {
  if (!runId) return;
  await admin
    .from('gmb_sync_runs')
    .update({ status, stats: stats ?? {}, error: error ?? null, finished_at: new Date().toISOString() })
    .eq('id', runId);
}
