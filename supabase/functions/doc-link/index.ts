// Stable public PDF link resolver.
//
// GET /doc-link/<token>.pdf  →  302 to whatever copy of that PDF is live right
// now. The token is minted before generation starts, so the link is valid and
// shareable immediately; what it points at improves over the next few seconds
// (nothing → pdf.co temp URL → permanent Storage URL) without the URL changing.
//
// verify_jwt = false (see supabase/config.toml): the entire point is that an
// anonymous bearer of an unguessable token can resolve it. Reads use the
// service role for the same reason.
//
// Keep the `.pdf` suffix on the route — WhatsApp, Gmail and iOS sniff the
// extension before they look at Content-Type.
//
// ---------------------------------------------------------------------------
// Why there is no HTML wait page here.
//
// Supabase's edge gateway rewrites every function response with:
//     Content-Type: text/plain
//     X-Content-Type-Options: nosniff
//     Content-Security-Policy: default-src 'none'; sandbox
// so that functions on the shared *.supabase.co domain cannot serve rendered
// HTML (an obvious phishing vector). A Content-Type we set is discarded. An
// HTML page therefore displays as raw source, and — the part that actually
// broke — a <meta http-equiv="refresh"> is never parsed, so a "preparing" page
// sits there forever and only a manual reload advances it.
//
// So instead of asking the browser to poll, this holds the request open and
// polls the database itself, redirecting the moment a URL appears. The user
// sees their browser's own loading indicator and lands directly on the PDF.
// If the hold times out we fall back to a plain-text body plus a `Refresh`
// HTTP *header*, which browsers honour regardless of Content-Type.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

// A pdf.co URL is signed for 3600s. It must never be treated as permanent, and
// must never be written to permanent_url.
const isEphemeral = (u: string | null | undefined): boolean =>
  !!u && /pdf\.co|pdf-temp-files|pdfco/i.test(u);

// Where each (entity_type, variant) keeps its permanent URL, and the column
// that dates it. A URL read out of a source table carries no expiry of its own,
// so an ephemeral one left there by an old failed run looks live forever — age
// it from the generated-at stamp instead of trusting it.
const SOURCE: Record<string, { table: string; url: string; at: string | null }> = {
  'visit:display':      { table: 'visits',        url: 'pdf_url',               at: 'pdf_generated_at' },
  'visit:print':        { table: 'visits',        url: 'print_pdf_url',         at: 'print_pdf_generated_at' },
  'visit:compact':      { table: 'visits',        url: 'compact_print_pdf_url', at: null },
  'bill:display':       { table: 'bills',         url: 'pdf_url',               at: 'pdf_generated_at' },
  'bill:print':         { table: 'bills',         url: 'print_pdf_url',         at: null },
  'ipd_bill:final':     { table: 'ipd_bills',     url: 'pdf_url',               at: null },
  'ipd_document:final': { table: 'ipd_documents', url: 'pdf_url',               at: 'generated_at' },
};

/** How long a generation run is assumed to still be running. */
const IN_FLIGHT_MS = 3 * 60_000;
/** How long one request will hold before handing back a retry page. */
const HOLD_MS = 25_000;
const POLL_MS = 750;

const redirect = (url: string) =>
  new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: url, 'Cache-Control': 'no-store' },
  });

/**
 * Plain text, because the gateway forces text/plain anyway (see header comment).
 * `retryAfter` sets the `Refresh` header, which browsers act on even when the
 * body is not HTML — the only self-advancing mechanism available here.
 */
const message = (status: number, text: string, retryAfter?: number) =>
  new Response(text + '\n', {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(retryAfter ? { Refresh: String(retryAfter) } : {}),
    },
  });

/**
 * Hold the request open until this document becomes viewable.
 *
 * Returns the URL to redirect to, or null if it did not become ready in time.
 * Cheap to do: this is an idle await, not a busy loop.
 */
async function holdUntilReady(
  supabase: SupabaseClient,
  token: string,
  deadline: number,
): Promise<string | null> {
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));

    const { data } = await supabase
      .from('document_links')
      .select('permanent_url, temp_url, temp_expires_at, status')
      .eq('token', token)
      .maybeSingle();
    if (!data) return null;

    if (data.permanent_url && !isEphemeral(data.permanent_url)) return data.permanent_url;
    if (
      data.temp_url &&
      data.temp_expires_at &&
      Date.parse(data.temp_expires_at) > Date.now()
    ) {
      return data.temp_url;
    }
    if (data.status === 'failed') return null;
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return message(405, 'This link only supports GET.');
  }

  try {
    // Last path segment, minus the .pdf the route carries for extension sniffers.
    const raw = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
    const token = raw.replace(/\.pdf$/i, '').trim();

    if (!/^[a-f0-9]{16,64}$/i.test(token)) {
      return message(404, 'This link is not valid. Please request a fresh copy.');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: link, error } = await supabase
      .from('document_links')
      .select('token, entity_type, entity_id, variant, permanent_url, temp_url, temp_expires_at, status, created_at, generation_started_at, first_shared_at, access_count')
      .eq('token', token)
      .maybeSingle();

    if (error) {
      console.error('[doc-link] lookup failed:', error.message);
      return message(500, 'Something went wrong. Please try again in a moment.');
    }
    if (!link) {
      return message(404, 'This document link is no longer available.');
    }

    // Link previewers (WhatsApp, iMessage, Slack) HEAD every URL before a human
    // ever sees it. Counting those corrupts the access stats, so only a real GET
    // is an open — and it is best-effort, never blocking the redirect.
    const countOpen = async () => {
      if (req.method !== 'GET') return;
      try {
        await supabase
          .from('document_links')
          .update({
            access_count: (link.access_count ?? 0) + 1,
            last_accessed_at: new Date().toISOString(),
            ...(link.first_shared_at ? {} : { first_shared_at: new Date().toISOString() }),
          })
          .eq('token', token);
      } catch (e) {
        console.warn('[doc-link] access count failed:', e);
      }
    };

    // 1. A permanent URL we already trust.
    if (link.permanent_url && !isEphemeral(link.permanent_url)) {
      await countOpen();
      return redirect(link.permanent_url);
    }

    // 2. A render is definitely running right now.
    //
    // Checked BEFORE reading the source table, and that order is the whole
    // point: on a regeneration the source column still holds the PREVIOUS
    // copy. Deriving from it here would serve the very document the user just
    // asked to replace — and would then backfill permanent_url with it, making
    // the stale copy stick. While a run is in flight the only acceptable
    // answers are the new copy or a wait.
    const startedAt = link.generation_started_at
      ? Date.parse(link.generation_started_at)
      : NaN;
    const rendering =
      link.status === 'pending' &&
      Number.isFinite(startedAt) &&
      Date.now() - startedAt < IN_FLIGHT_MS;

    if (rendering) {
      const ready = await holdUntilReady(supabase, token, Date.now() + HOLD_MS);
      if (ready) {
        await countOpen();
        return redirect(ready);
      }
      return message(202, 'Preparing your document. This page will retry automatically…', 3);
    }

    // 3. Not rendering, but the source row may already hold a real Storage URL —
    //    a document generated before this feature existed, or one whose stamping
    //    hook failed. Backfill so the next open skips this branch.
    const src = SOURCE[`${link.entity_type}:${link.variant}`];
    if (src) {
      const cols = src.at ? `${src.url}, ${src.at}` : src.url;
      const { data } = await supabase
        .from(src.table)
        .select(cols)
        .eq('id', link.entity_id)
        .maybeSingle();

      // The column names are chosen at runtime from SOURCE, so the row shape is
      // only known dynamically.
      const row = data as Record<string, string | null> | null;
      const candidate = row?.[src.url] ?? undefined;

      if (candidate && !isEphemeral(candidate)) {
        await supabase
          .from('document_links')
          .update({ permanent_url: candidate, status: 'permanent' })
          .eq('token', token);
        await countOpen();
        return redirect(candidate);
      }

      // An ephemeral URL sitting in the source table is only usable while its
      // signature holds. Without a generated-at column we cannot date it, so we
      // decline rather than redirect to a link that answers 403 with an XML body.
      if (candidate && isEphemeral(candidate) && src.at) {
        const stamp = row?.[src.at];
        const generatedAt = stamp ? Date.parse(stamp) : NaN;
        if (Number.isFinite(generatedAt) && Date.now() - generatedAt < 55 * 60_000) {
          await countOpen();
          return redirect(candidate);
        }
      }
    }

    // 4. An unexpired temp URL from a run that has since stopped reporting.
    if (link.temp_url && link.temp_expires_at && Date.parse(link.temp_expires_at) > Date.now()) {
      await countOpen();
      return redirect(link.temp_url);
    }

    // 5. Freshly minted and nothing anywhere yet — the caller reserved the token
    //    and generation is about to start. Covers the gap between the frontend
    //    minting the link and the generator marking the run as started.
    const age = Date.now() - Date.parse(link.created_at);
    if (link.status === 'pending' && Number.isFinite(age) && age < IN_FLIGHT_MS) {
      const ready = await holdUntilReady(supabase, token, Date.now() + HOLD_MS);
      if (ready) {
        await countOpen();
        return redirect(ready);
      }
      return message(202, 'Preparing your document. This page will retry automatically…', 3);
    }

    // 6. Honest error. Regeneration is not re-enqueued here on purpose: the
    //    generator needs the full record payload the app assembles client-side,
    //    which the resolver does not have. Reopening the document in the app
    //    regenerates it and revives this same token.
    return message(
      404,
      'This document could not be prepared. Please reopen it from the clinic app, or ask the clinic to resend the link.',
    );
  } catch (err) {
    console.error('[doc-link] error:', err);
    return message(500, 'Something went wrong. Please try again in a moment.');
  }
});
