// The three generator-side hooks for stable PDF links.
//
// See supabase/migrations/stable-opd.md. Every function here is best-effort:
// a failure must never change the PDF the caller gets back, so each one
// swallows its own errors and returns a falsy value instead of throwing.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';

export type LinkEntityType = 'visit' | 'bill' | 'ipd_bill' | 'ipd_document';
export type LinkVariant = 'display' | 'print' | 'compact' | 'final';

// pdf.co signs its S3 links for 3600s. Publish a 55-minute window so we always
// expire the temp URL slightly before the signature does.
const TEMP_TTL_MS = 55 * 60_000;

export const isEphemeralPdfUrl = (u: string | null | undefined): boolean =>
  !!u && /pdf\.co|pdf-temp-files|pdfco/i.test(u);

/**
 * Hook (a) — reserve the token *before* rendering starts.
 *
 * Valid immediately, so it can be handed to the UI or pasted into a message
 * while the PDF is still being produced.
 */
export async function ensureDocumentLink(
  supabase: SupabaseClient,
  entityType: LinkEntityType,
  entityId: string,
  variant: LinkVariant,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('ensure_document_link', {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_variant: variant,
    });
    if (error) {
      console.warn('[doc-link] mint failed:', error.message);
      return null;
    }
    return (data as string) ?? null;
  } catch (e) {
    console.warn('[doc-link] mint threw:', e);
    return null;
  }
}

/**
 * Hook (a'), regeneration only — mint the token AND retire the current copy.
 *
 * A forced regeneration must not keep serving the previous PDF: hook (b) is
 * guarded with `.is('permanent_url', null)`, so without this reset the new temp
 * URL is never published and an early open returns stale content. Resetting
 * also restarts the resolver's "preparing" window.
 */
export async function beginDocumentLinkGeneration(
  supabase: SupabaseClient,
  entityType: LinkEntityType,
  entityId: string,
  variant: LinkVariant,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('begin_document_link_generation', {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_variant: variant,
    });
    if (error) {
      console.warn('[doc-link] regeneration reset failed:', error.message);
      return null;
    }
    return (data as string) ?? null;
  } catch (e) {
    console.warn('[doc-link] regeneration reset threw:', e);
    return null;
  }
}

/**
 * Hook (b) — publish the pdf.co URL the instant it comes back.
 *
 * This is where the latency win lands: the link becomes openable here, rather
 * than after the settle delay, the availability polling, the download retries
 * and the Storage upload that all still follow.
 */
export async function publishTempUrl(
  supabase: SupabaseClient,
  entityType: LinkEntityType,
  entityId: string,
  variant: LinkVariant,
  tempUrl: string,
): Promise<void> {
  try {
    await supabase
      .from('document_links')
      .update({
        temp_url: tempUrl,
        temp_expires_at: new Date(Date.now() + TEMP_TTL_MS).toISOString(),
        status: 'temp',
      })
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .eq('variant', variant)
      // Never downgrade a link that already resolves to a permanent copy.
      .is('permanent_url', null);
  } catch (e) {
    console.warn('[doc-link] temp publish failed:', e);
  }
}

/**
 * Hook (c) — stamp the permanent Storage URL, refusing ephemeral input.
 *
 * The refusal is the point. If the upload failed and the caller fell back to
 * the pdf.co URL, writing it here would freeze a link that dies within the
 * hour. Declining leaves the token on 'temp' so a later regeneration can
 * still revive it.
 */
export async function stampPermanentUrl(
  supabase: SupabaseClient,
  entityType: LinkEntityType,
  entityId: string,
  variant: LinkVariant,
  url: string | null | undefined,
): Promise<void> {
  if (!url || isEphemeralPdfUrl(url)) {
    if (url) console.warn('[doc-link] refused ephemeral permanent_url:', url);
    return;
  }
  try {
    await supabase
      .from('document_links')
      .update({ permanent_url: url, status: 'permanent' })
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .eq('variant', variant);
  } catch (e) {
    console.warn('[doc-link] permanent stamp failed:', e);
  }
}

/** Marks a link failed so the resolver stops showing the "preparing" page. */
export async function markLinkFailed(
  supabase: SupabaseClient,
  entityType: LinkEntityType,
  entityId: string,
  variant: LinkVariant,
): Promise<void> {
  try {
    await supabase
      .from('document_links')
      .update({ status: 'failed' })
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .eq('variant', variant)
      .is('permanent_url', null);
  } catch {
    // best effort
  }
}

/**
 * A scheme-less base silently breaks everything: `app.example.in/r` is a
 * *relative* URL, so the browser resolves it against the app origin and the SPA
 * catch-all serves index.html — the link opens the app with no error anywhere.
 */
function normaliseBase(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  // Netlify renders secret env values as `****`; saving over that mask stores
  // the mask as the value. Refuse it rather than emitting unopenable links.
  if (value.includes('*')) {
    console.warn('[doc-link] link base looks masked, ignoring:', value);
    return null;
  }
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, '');
}

/**
 * Public URL for a token.
 *
 * `clinicBase` wins over the environment default: the app is served on more
 * than one branded domain from a single site, and which domain a clinic's links
 * carry is a property of the clinic — not of whoever triggered generation, and
 * not something the queue or an edge function could infer from an origin.
 */
export function buildDocumentLinkUrl(
  token: string | null,
  clinicBase?: string | null,
): string | null {
  if (!token) return null;
  const base = normaliseBase(clinicBase) ?? normaliseBase(Deno.env.get('DOC_LINK_BASE'));
  if (!base) return null;
  return `${base}/${token}.pdf`;
}

export interface DocumentLinkConfig {
  enabled: boolean;
  /** Per-clinic domain override; null falls back to DOC_LINK_BASE. */
  base: string | null;
}

/** Whether this clinic has stable links on, and which domain they carry. */
export async function getDocumentLinkConfig(
  supabase: SupabaseClient,
  clinicId: string | null | undefined,
): Promise<DocumentLinkConfig> {
  if (!clinicId) return { enabled: false, base: null };
  try {
    const { data } = await supabase
      .from('clinic_settings')
      .select('document_link_enabled, document_link_base')
      .eq('id', clinicId)
      .maybeSingle();
    return {
      enabled: Boolean(data?.document_link_enabled),
      base: (data?.document_link_base as string | null) ?? null,
    };
  } catch {
    return { enabled: false, base: null };
  }
}
