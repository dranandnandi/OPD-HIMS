import { runtimeFetch } from './suite-runtime-guard.ts';
// Windsor.ai REST client for the google_my_business connector.
//
// Reads:  GET  https://connectors.windsor.ai/{connector}?api_key=...&fields=...&date_from=...&select_accounts=...
// Writes: POST https://connectors.windsor.ai/{connector}/actions   body: { account, action, params }
//
// The API key is ours (one Windsor team). Tenant isolation is NOT Windsor's job: every call
// here must be scoped with `select_accounts` / `account` to the location the caller owns,
// which the edge functions resolve from gmb_locations before calling anything in this file.

declare const Deno: { env: { get(name: string): string | undefined } };

export const WINDSOR_BASE_URL = 'https://connectors.windsor.ai';
export const GMB_CONNECTOR = 'google_my_business';

export type WindsorRow = Record<string, unknown>;

export interface WindsorReadParams {
  fields: string[];
  selectAccounts?: string[];
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  datePreset?: string; // e.g. last_7d
  extra?: Record<string, string>;
}

export class WindsorError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'WindsorError';
    this.status = status;
    this.body = body;
  }
}

function apiKey(): string {
  const key = Deno.env.get('WINDSOR_API_KEY');
  if (!key) throw new Error('Missing WINDSOR_API_KEY secret');
  return key;
}

async function parseBody(resp: Response): Promise<unknown> {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Read rows from a Windsor connector. Returns the `data` array. */
export async function windsorRead(connector: string, params: WindsorReadParams): Promise<WindsorRow[]> {
  const url = new URL(`${WINDSOR_BASE_URL}/${connector}`);
  url.searchParams.set('api_key', apiKey());
  url.searchParams.set('fields', params.fields.join(','));
  if (params.selectAccounts?.length) url.searchParams.set('select_accounts', params.selectAccounts.join(','));
  if (params.datePreset) {
    url.searchParams.set('date_preset', params.datePreset);
  } else {
    if (params.dateFrom) url.searchParams.set('date_from', params.dateFrom);
    if (params.dateTo) url.searchParams.set('date_to', params.dateTo);
  }
  for (const [k, v] of Object.entries(params.extra || {})) url.searchParams.set(k, v);

  const resp = await runtimeFetch(url.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
  const body = await parseBody(resp);
  if (!resp.ok) {
    throw new WindsorError(`Windsor read failed (${resp.status})`, resp.status, body);
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as WindsorRow[];
    if (Array.isArray(obj.result)) return obj.result as WindsorRow[];
    if (typeof obj.error === 'string') throw new WindsorError(obj.error, 400, body);
  }
  if (Array.isArray(body)) return body as WindsorRow[];
  return [];
}

export interface WindsorActionResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** Execute a write action on a connected account. Caller must have authorised the account. */
export async function windsorExecuteAction(
  connector: string,
  account: string,
  action: string,
  params: Record<string, unknown>
): Promise<WindsorActionResult> {
  const url = new URL(`${WINDSOR_BASE_URL}/${connector}/actions`);
  url.searchParams.set('api_key', apiKey());

  const resp = await runtimeFetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({ account, action, params }),
  });
  const body = await parseBody(resp);
  if (!resp.ok) {
    throw new WindsorError(`Windsor action "${action}" failed (${resp.status})`, resp.status, body);
  }
  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (obj.success === false || typeof obj.error === 'string') {
    throw new WindsorError(String(obj.error || `Windsor action "${action}" rejected`), 400, body);
  }
  return { ok: true, status: resp.status, body };
}

/** List the write actions Windsor currently offers for a connector (ids + schemas). */
export async function windsorListActions(connector: string): Promise<unknown> {
  const url = new URL(`${WINDSOR_BASE_URL}/${connector}/actions`);
  url.searchParams.set('api_key', apiKey());
  const resp = await runtimeFetch(url.toString(), { headers: { Accept: 'application/json' } });
  const body = await parseBody(resp);
  if (!resp.ok) throw new WindsorError(`Windsor list actions failed (${resp.status})`, resp.status, body);
  return body;
}

// ---------------------------------------------------------------------------
// Field sets for the google_my_business connector
// ---------------------------------------------------------------------------

export const GMB_DISCOVERY_FIELDS = [
  'account_id',
  'account_name',
  'location_id',
  'location_title',
  'location_metadata_place_id',
  'location_metadata_maps_uri',
];

export const GMB_PROFILE_FIELDS = [
  'location_id',
  'location_title',
  'location_profile_description',
  'location_website_uri',
  'location_primary_phone',
  'location_additional_phones',
  'location_primary_category_id',
  'location_primary_category_name',
  'location_additional_categories',
  'location_attributes',
  'location_service_items',
  'location_regular_hours_periods',
  'location_special_hours_periods',
  'location_more_hours',
  'location_open_info_status',
  'location_open_info_opening_date_year',
  'location_open_info_opening_date_month',
  'location_open_info_opening_date_day',
  'location_metadata_place_id',
  'location_metadata_maps_uri',
  'location_metadata_new_review_uri',
  'location_metadata_has_pending_edits',
  'location_metadata_has_google_updated',
  'location_metadata_has_voice_of_merchant',
  'location_metadata_can_operate_local_post',
  'location_metadata_can_modify_service_list',
  'location_address_lines',
  'location_address_locality',
  'location_address_sublocality',
  'location_address_administrative_area',
  'location_address_postal_code',
  'location_address_region_code',
  'location_latitude',
  'location_longitude',
  'location_service_area',
];

export const GMB_REVIEW_FIELDS = [
  'location_id',
  'review_id',
  'review_reviewer',
  'review_reviewer_profile_photo',
  'review_star_rating',
  'review_comment',
  'review_create_time',
  'review_update_time',
  'review_reply_comment',
  'review_reply_update_time',
];

export const GMB_POST_FIELDS = [
  'location_id',
  'post_id',
  'post_summary',
  'post_state',
  'post_topic_type',
  'post_create_time',
  'post_update_time',
  'post_cta_action_type',
  'post_cta_url',
  'post_media_google_url',
  'post_search_url',
];

export const GMB_MEDIA_FIELDS = [
  'location_id',
  'media_id',
  'media_category',
  'media_format',
  'media_google_url',
  'media_thumbnail_url',
  'media_create_time',
  'media_view_count',
];

export const GMB_INSIGHT_FIELDS = [
  'date',
  'location_id',
  'impressions',
  'impressions_mobile_maps',
  'impressions_mobile_search',
  'impressions_desktop_maps',
  'impressions_desktop_search',
  'call_clicks',
  'website_clicks',
  'direction_requests',
  'business_bookings',
];

/** Google returns star ratings as words. */
export function starRatingToNumber(value: unknown): number | null {
  if (typeof value === 'number') return value >= 1 && value <= 5 ? value : null;
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  const key = String(value || '').toUpperCase();
  if (map[key]) return map[key];
  const n = Number(key);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

/** Trailing id from a resource name like accounts/1/locations/2/localPosts/3 -> 3 */
export function trailingId(resourceName: string): string {
  const parts = String(resourceName || '').split('/');
  return parts[parts.length - 1] || resourceName;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
