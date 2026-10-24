import { guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
// GMB Profile Manager: AI drafts (Gemini). Only generates text; publishing goes through gmb-action.
//
// POST { locationId, kind: 'review_reply' | 'description' | 'post', reviewId?, language?, notes? }

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
  type AppUser,
} from '../_shared/gmb-common.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

const MODEL = 'gemini-2.5-flash';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', gu: 'Gujarati', mr: 'Marathi', bn: 'Bengali',
  ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', ur: 'Urdu',
};

interface Body {
  locationId?: string;
  kind?: 'review_reply' | 'description' | 'post';
  reviewId?: string;
  language?: string;
  notes?: string;
}

Deno.serve(guardEdge(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  try {
    const admin = serviceClient();
    const user = await requireUser(req, admin);
    if (!hasGmbFeature(user)) throw new HttpError(403, 'GMB Profile Manager is not enabled for this account');

    const body = await readJson<Body>(req);
    const location = await requireOwnedLocation(admin, user, String(body.locationId || ''));
    const { data: snap } = await admin.from('gmb_profile_snapshots').select('*').eq('location_id', location.id).maybeSingle();

    const langCode = (body.language || user.defaultLanguage || 'en').toLowerCase();
    const langName = LANGUAGE_NAMES[langCode] || 'English';
    const context = buildBusinessContext(user, location.title, snap);

    switch (body.kind) {
      case 'review_reply': {
        if (!body.reviewId) throw new HttpError(400, 'reviewId is required');
        const { data: review } = await admin
          .from('gmb_reviews')
          .select('id, review_id, reviewer_name, star_rating, comment')
          .eq('location_id', location.id)
          .eq('review_id', body.reviewId)
          .maybeSingle();
        if (!review) throw new HttpError(404, 'Review not found on this listing');

        const text = await generate(
          `You write owner replies to Google reviews for a healthcare business. Reply in ${langName}. Keep medical terms in English (Latin script).
Rules: 40 to 90 words. Warm, specific, professional. Thank the reviewer by first name if given. Reference one concrete detail from the review when there is one.
Never mention diagnoses, treatments or personal health details beyond what the reviewer wrote. Never offer discounts. For 1 to 3 star reviews: apologise sincerely, do not argue, invite them to contact the clinic directly (phone if available) to resolve it.
Sign off with a line break then "— ${location.title || user.clinicName}". Output JSON {"text": string}.`,
          `${context}

Review by: ${review.reviewer_name || 'a patient'}
Rating: ${review.star_rating ?? 'unknown'} / 5
Review text: ${review.comment?.trim() || '(no text, rating only)'}
${body.notes ? `Extra instructions from the clinic: ${body.notes}` : ''}`
        );

        await admin
          .from('gmb_reviews')
          .update({ ai_draft: text, ai_draft_language: langCode, ai_draft_generated_at: new Date().toISOString() })
          .eq('id', review.id);

        return json({ success: true, text, language: langCode });
      }

      case 'description': {
        const text = await generate(
          `You write Google Business Profile descriptions for healthcare businesses in ${langName}. Keep medical terms in English (Latin script).
Rules: 500 to 740 characters, plain prose, no bullet points, no emojis, no phone numbers, no URLs, no promotional claims like "best". Mention location/area, specialities, key services, and how to book (call or WhatsApp). Output JSON {"text": string}.`,
          `${context}

Current description (may be empty): ${snap?.description || '(none)'}
${body.notes ? `Extra instructions from the clinic: ${body.notes}` : ''}`
        );
        return json({ success: true, text: text.slice(0, 750), language: langCode });
      }

      case 'post': {
        const text = await generate(
          `You write short Google Business Profile "What's new" posts for healthcare businesses in ${langName}. Keep medical terms in English (Latin script).
Rules: 300 to 900 characters. Start with one relevant emoji. Clear single topic (doctor availability, a health camp, a seasonal health tip, a new service). Include a one-line call to action to book or call. No prices unless given. Output JSON {"text": string}.`,
          `${context}

Topic / details from the clinic: ${body.notes || 'Promote the clinic services and invite patients to book an appointment.'}`
        );
        return json({ success: true, text: text.slice(0, 1500), language: langCode });
      }

      default:
        throw new HttpError(400, `Unknown kind "${body.kind}"`);
    }
  } catch (err) {
    return errorResponse(err);
  }
}, 'growth', 'gmb-ai-draft'));

function buildBusinessContext(user: AppUser, title: string | null, snap: Record<string, unknown> | null): string {
  const lines: string[] = [];
  lines.push(`Business name: ${title || user.clinicName}`);
  if (snap?.primary_category_name) lines.push(`Primary category: ${snap.primary_category_name}`);
  const extra = Array.isArray(snap?.additional_categories)
    ? (snap!.additional_categories as Array<Record<string, unknown>>).map((c) => c.displayName).filter(Boolean)
    : [];
  if (extra.length) lines.push(`Other categories: ${extra.join(', ')}`);
  const address = (snap?.address || {}) as Record<string, unknown>;
  const area = [address.sublocality, address.locality, address.administrativeArea].filter(Boolean).join(', ');
  if (area) lines.push(`Area: ${area}`);
  const services = Array.isArray(snap?.service_items)
    ? (snap!.service_items as Array<Record<string, unknown>>)
        .map((s) => {
          const free = s.freeFormServiceItem as Record<string, unknown> | undefined;
          const label = free?.label as Record<string, unknown> | undefined;
          const structured = s.structuredServiceItem as Record<string, unknown> | undefined;
          return (label?.displayName as string) || (structured?.serviceTypeId as string) || '';
        })
        .filter(Boolean)
        .slice(0, 15)
    : [];
  if (services.length) lines.push(`Services: ${services.join(', ')}`);
  if (snap?.primary_phone) lines.push(`Phone: ${snap.primary_phone}`);
  else if (user.contactPhone) lines.push(`Phone: ${user.contactPhone}`);
  if (user.contactWhatsapp) lines.push(`WhatsApp: ${user.contactWhatsapp}`);

  const ctx = (user.businessContext || {}) as Record<string, unknown>;
  if (ctx.businessType) lines.push(`Business type: ${ctx.businessType}`);
  if (ctx.customerLabel) lines.push(`Customer label: ${ctx.customerLabel}`);
  if (ctx.serviceKeywords) lines.push(`Service keywords: ${ctx.serviceKeywords}`);
  if (ctx.promptNotes) lines.push(`Writing guidance: ${ctx.promptNotes}`);
  return lines.join('\n');
}

async function generate(systemText: string, userText: string): Promise<string> {
  const key = Deno.env.get('ALLGOOGLE_KEY');
  if (!key) throw new Error('Missing ALLGOOGLE_KEY secret');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const resp = await runtimeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { role: 'system', parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { response_mime_type: 'application/json', temperature: 0.8, topP: 0.92 },
    }),
  });
  if (!resp.ok) throw new HttpError(502, `Gemini error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    const text = typeof parsed === 'string' ? parsed : parsed?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();
  } catch {
    if (cleaned) return cleaned;
  }
  throw new HttpError(502, 'AI returned an empty draft. Please try again.');
}
