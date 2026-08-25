import { supabase } from '../lib/supabase';

/**
 * Stable, shareable PDF links.
 *
 * A token is minted before generation starts and resolves at open time to
 * whatever copy of the document is live right now — the PDF.co temp URL within
 * seconds, the permanent Storage URL once the upload lands. The URL itself never
 * changes, so a link already sent to a patient keeps working after a
 * regeneration. See supabase/migrations/stable-opd.md.
 */

export type DocumentEntityType = 'visit' | 'bill' | 'ipd_bill' | 'ipd_document';
export type DocumentVariant = 'display' | 'print' | 'compact' | 'final';

/** 'temp' and 'permanent' are the states in which a link actually resolves. */
export type DocumentLinkStatus = 'pending' | 'temp' | 'permanent' | 'failed';

export interface DocumentLink {
  token: string;
  url: string;
  status: DocumentLinkStatus;
}

/**
 * A scheme-less base is a *relative* URL: the browser resolves `app.example.in/r`
 * against the app's own origin, the SPA catch-all answers with index.html, and
 * the link opens the app with no error anywhere. Normalise before use.
 */
const normaliseBase = (raw: string | null | undefined): string | null => {
  const value = (raw ?? '').trim();
  if (!value) return null;
  // Netlify renders secret env values as `****`; saving over that stores the
  // mask as the value and the bundle ships `"****...in/r"`. Refuse it loudly
  // rather than emitting links nobody can open.
  if (value.includes('*')) {
    console.error('[doc-link] link base looks masked:', value);
    return null;
  }
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, '');
};

/**
 * `clinicBase` (clinic_settings.document_link_base) wins over the build-time
 * default. The app serves several branded domains from one Netlify site, and
 * which domain a clinic's links carry belongs to the clinic — deliberately not
 * derived from window.location, so a link built in the UI matches one the
 * WhatsApp queue sends hours later from a context with no origin at all.
 */
export const buildDocumentLinkUrl = (
  token: string | null | undefined,
  clinicBase?: string | null,
): string | null => {
  const base = normaliseBase(clinicBase) ?? normaliseBase(import.meta.env.VITE_DOC_LINK_BASE);
  if (!base || !token) return null;
  // Keep the .pdf suffix — WhatsApp, Gmail and iOS sniff the extension before
  // they look at Content-Type.
  return `${base}/${token}.pdf`;
};

export const documentLinkService = {
  /**
   * Reserve (or recover) the token for a document. Race-safe: concurrent callers
   * converge on one token per (record, variant).
   *
   * Best-effort by design — a clinic with the feature off, or any failure here,
   * returns null and the caller falls back to the raw Storage URL.
   */
  async ensureLink(
    entityType: DocumentEntityType,
    entityId: string,
    variant: DocumentVariant = 'display',
    options?: { restart?: boolean },
  ): Promise<string | null> {
    if (!supabase || !entityId) return null;
    try {
      // `restart` additionally retires the current copy, so a regeneration shows
      // the resolver's "preparing" page and then the new PDF, rather than
      // continuing to serve the document being replaced.
      const fn = options?.restart ? 'begin_document_link_generation' : 'ensure_document_link';
      const { data, error } = await supabase.rpc(fn, {
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_variant: variant,
      });
      if (error) {
        console.warn('[doc-link] could not reserve token:', error.message);
        return null;
      }
      return (data as string) ?? null;
    } catch (error) {
      console.warn('[doc-link] reserve threw:', error);
      return null;
    }
  },

  /**
   * Reserve a token and return the public URL for it in one step.
   *
   * The clinic's branded domain is read back through the link row rather than
   * taken from app state: the token already carries the owning clinic, so this
   * stays correct for any caller regardless of what context it runs in.
   */
  async ensureShareUrl(
    entityType: DocumentEntityType,
    entityId: string,
    variant: DocumentVariant = 'display',
    options?: { restart?: boolean },
  ): Promise<DocumentLink | null> {
    const token = await this.ensureLink(entityType, entityId, variant, options);
    if (!token) return null;

    const row = await this.getLinkRow(token);
    const url = buildDocumentLinkUrl(token, row?.base);
    if (!url) return null;

    return { token, url, status: row?.status ?? 'pending' };
  },

  /** Link status plus the owning clinic's domain override, in one round trip. */
  async getLinkRow(
    token: string,
  ): Promise<{ status: DocumentLinkStatus; base: string | null } | null> {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('document_links')
        .select('status, clinic_settings(document_link_base)')
        .eq('token', token)
        .maybeSingle();
      if (error || !data) return null;

      // PostgREST returns the embedded to-one relation as an object, but types
      // it loosely; older versions hand back a single-element array.
      const clinic = Array.isArray(data.clinic_settings)
        ? data.clinic_settings[0]
        : data.clinic_settings;

      return {
        status: (data.status as DocumentLinkStatus) ?? 'pending',
        base: (clinic?.document_link_base as string | null) ?? null,
      };
    } catch {
      return null;
    }
  },

  async getStatus(token: string): Promise<DocumentLinkStatus | null> {
    const row = await this.getLinkRow(token);
    return row?.status ?? null;
  },

  /**
   * Resolve when the link becomes *viewable*, not merely when it exists.
   *
   * At t=0 a token only serves the resolver's "preparing" page, so releasing a
   * View button on token existence alone opens a spinner. 'temp' is the first
   * state that actually redirects to a PDF.
   */
  async waitUntilViewable(token: string, timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getStatus(token);
      if (status === 'temp' || status === 'permanent') return true;
      if (status === 'failed') return false;
      await new Promise((r) => setTimeout(r, 1200));
    }
    return false;
  },
};
