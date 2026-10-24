import { guardEdge } from '../_shared/suite-runtime-guard.ts';
// GMB Profile Manager: the single write path to Google (through Windsor).
//
// POST { locationId, action, params, acknowledgeRisk? }
//
// 1. Verify the session and that the caller owns the location.
// 2. Validate the action against an allowlist and light schema checks.
// 3. Execute through Windsor, scoped to the location's Windsor account id.
// 4. Write an audit row, then refresh the affected cached data.

import {
  corsHeaders,
  errorResponse,
  hasGmbFeature,
  HttpError,
  json,
  readJson,
  requireOwnedLocation,
  requireUser,
  serviceClient,
} from '../_shared/gmb-common.ts';
import { recomputeCompleteness, syncLocation, type SyncPart } from '../_shared/gmb-sync-core.ts';
import { GMB_CONNECTOR, trailingId, windsorExecuteAction } from '../_shared/windsor.ts';

declare const Deno: { serve(handler: (req: Request) => Promise<Response> | Response): void };

type Params = Record<string, unknown>;

interface Body {
  locationId?: string;
  action?: string;
  params?: Params;
  acknowledgeRisk?: boolean;
}

interface ActionSpec {
  resync: SyncPart[];
  risky?: boolean;
  validate: (p: Params) => void;
}

const nonEmpty = (p: Params, key: string, max?: number) => {
  const v = p[key];
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${key} is required`);
  if (max && v.length > max) throw new HttpError(400, `${key} must be at most ${max} characters`);
};
const optionalUrl = (p: Params, key: string) => {
  const v = p[key];
  if (v === undefined || v === null || v === '') return;
  try {
    const u = new URL(String(v));
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    throw new HttpError(400, `${key} must be a valid http(s) URL`);
  }
};
const CTA_TYPES = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'];
const validateCta = (p: Params) => {
  if (p.cta_type === undefined || p.cta_type === null || p.cta_type === '') return;
  if (!CTA_TYPES.includes(String(p.cta_type))) throw new HttpError(400, 'Invalid cta_type');
  if (p.cta_type !== 'CALL') nonEmpty(p, 'cta_url');
  optionalUrl(p, 'cta_url');
};
const TIME_RE = /^([01]\d|2[0-4]):[0-5]\d$/;
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

const ACTIONS: Record<string, ActionSpec> = {
  reply_to_review: {
    resync: [],
    validate: (p) => {
      nonEmpty(p, 'review_id');
      nonEmpty(p, 'comment', 4096);
    },
  },
  create_local_post: {
    resync: ['posts'],
    validate: (p) => {
      nonEmpty(p, 'summary', 1500);
      optionalUrl(p, 'photo_url');
      validateCta(p);
    },
  },
  update_local_post: {
    resync: ['posts'],
    validate: (p) => {
      nonEmpty(p, 'post_id');
      if (p.summary !== undefined && p.summary !== null) nonEmpty(p, 'summary', 1500);
      optionalUrl(p, 'photo_url');
      validateCta(p);
    },
  },
  upload_media: {
    resync: ['media'],
    validate: (p) => {
      nonEmpty(p, 'photo_url');
      optionalUrl(p, 'photo_url');
    },
  },
  update_location: {
    resync: ['profile'],
    validate: (p) => {
      if (p.description !== undefined && p.description !== null && p.description !== '') nonEmpty(p, 'description', 750);
      optionalUrl(p, 'website_url');
      if (!p.description && !p.website_url && !p.primary_phone) throw new HttpError(400, 'Provide at least one of description, website_url, primary_phone');
    },
  },
  update_service_items: {
    resync: ['profile'],
    validate: (p) => {
      if (!Array.isArray(p.service_items) || p.service_items.length === 0) throw new HttpError(400, 'service_items must be a non-empty array');
    },
  },
  update_categories: {
    resync: ['profile'],
    risky: true,
    validate: (p) => nonEmpty(p, 'primary_category_id'),
  },
  update_service_area: {
    resync: ['profile'],
    validate: (p) => {
      if (!Array.isArray(p.places) || p.places.length === 0) throw new HttpError(400, 'places must be a non-empty array');
      nonEmpty(p, 'business_type');
    },
  },
  update_attributes: {
    resync: ['profile'],
    validate: (p) => {
      const hasSet = Array.isArray(p.attributes) && p.attributes.length > 0;
      const hasUnset = Array.isArray(p.unset_attribute_ids) && p.unset_attribute_ids.length > 0;
      if (!hasSet && !hasUnset) throw new HttpError(400, 'Provide attributes and/or unset_attribute_ids');
    },
  },
  update_address: {
    resync: ['profile'],
    risky: true,
    validate: (p) => {
      nonEmpty(p, 'region_code');
      if (!Array.isArray(p.address_lines) || p.address_lines.length === 0) throw new HttpError(400, 'address_lines is required');
    },
  },
  set_regular_hours: {
    resync: ['profile'],
    validate: (p) => {
      if (!Array.isArray(p.periods) || p.periods.length === 0) throw new HttpError(400, 'periods must be a non-empty array');
      for (const period of p.periods as Params[]) {
        if (!DAYS.includes(String(period.open_day))) throw new HttpError(400, 'Invalid open_day');
        if (!TIME_RE.test(String(period.open_time)) || !TIME_RE.test(String(period.close_time))) throw new HttpError(400, 'Times must be HH:MM');
      }
    },
  },
  set_special_hours: {
    resync: ['profile'],
    validate: (p) => {
      if (!Array.isArray(p.periods) || p.periods.length === 0) throw new HttpError(400, 'periods must be a non-empty array');
      for (const period of p.periods as Params[]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(period.date))) throw new HttpError(400, 'date must be YYYY-MM-DD');
        if (!period.closed && (!TIME_RE.test(String(period.open_time)) || !TIME_RE.test(String(period.close_time)))) throw new HttpError(400, 'Open periods need open_time and close_time as HH:MM');
      }
    },
  },
  set_open_status: {
    resync: ['profile'],
    risky: true,
    validate: (p) => {
      if (!['OPEN', 'CLOSED_TEMPORARILY'].includes(String(p.status))) throw new HttpError(400, 'status must be OPEN or CLOSED_TEMPORARILY');
    },
  },
};

Deno.serve(guardEdge(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  try {
    const admin = serviceClient();
    const user = await requireUser(req, admin);
    if (!hasGmbFeature(user)) throw new HttpError(403, 'GMB Profile Manager is not enabled for this account');

    const body = await readJson<Body>(req);
    const action = String(body.action || '');
    const spec = ACTIONS[action];
    if (!spec) throw new HttpError(400, `Action "${action}" is not supported`);

    const location = await requireOwnedLocation(admin, user, String(body.locationId || ''));
    if (location.status !== 'connected' || !location.windsor_account_id) {
      throw new HttpError(409, 'This listing is not connected yet. Grant manager access and refresh first.');
    }

    const params: Params = { ...(body.params || {}) };
    spec.validate(params);
    if (spec.risky && body.acknowledgeRisk !== true) {
      throw new HttpError(428, 'This change can affect how Google verifies the listing. Confirm the risk to continue.');
    }
    if (action === 'update_address') params.acknowledge_reverification_risk = true;

    // Reviews and posts must belong to this location; never let a caller address another listing's ids.
    if (action === 'reply_to_review') {
      const { data: review } = await admin
        .from('gmb_reviews')
        .select('id')
        .eq('location_id', location.id)
        .eq('review_id', String(params.review_id))
        .maybeSingle();
      if (!review) throw new HttpError(404, 'Review not found on this listing');
    }
    if (action === 'update_local_post') {
      const postId = String(params.post_id);
      const { data: post } = await admin
        .from('gmb_posts')
        .select('post_id')
        .eq('location_id', location.id)
        .or(`post_id.eq.${postId},post_id.like.%/localPosts/${trailingId(postId)}`)
        .maybeSingle();
      if (!post) throw new HttpError(404, 'Post not found on this listing');
      params.post_id = trailingId(postId);
    }

    let result: unknown;
    try {
      result = await windsorExecuteAction(GMB_CONNECTOR, location.windsor_account_id, action, params);
    } catch (err) {
      const anyErr = err as { message?: string; body?: unknown };
      await admin.from('gmb_action_log').insert({
        location_id: location.id,
        user_id: user.id,
        action,
        params,
        status: 'failed',
        error: anyErr?.message || String(err),
        response: anyErr?.body ?? null,
      });
      throw err;
    }

    await admin.from('gmb_action_log').insert({
      location_id: location.id,
      user_id: user.id,
      action,
      params,
      status: 'success',
      response: (result as { body?: unknown })?.body ?? null,
    });

    // Reflect the write locally right away, then refresh from Windsor where it is cheap.
    if (action === 'reply_to_review') {
      await admin
        .from('gmb_reviews')
        .update({ reply_comment: String(params.comment), reply_update_time: new Date().toISOString(), status: 'replied' })
        .eq('location_id', location.id)
        .eq('review_id', String(params.review_id));
      await recomputeCompleteness(admin, location.id);
    } else if (spec.resync.length) {
      try {
        await syncLocation(admin, location, spec.resync);
      } catch (e) {
        // The write succeeded; a stale cache is acceptable and the next sync will fix it.
        console.warn('[gmb-action] post-action resync failed', e);
      }
    }

    return json({ success: true, action, result: (result as { body?: unknown })?.body ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}, 'growth', 'gmb-action'));
