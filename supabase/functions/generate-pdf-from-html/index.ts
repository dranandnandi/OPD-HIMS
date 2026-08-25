import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
// Pinned: the floating `@2` tag resolves to 2.112.1, whose esm.sh build points
// at https://esm.sh/@supabase/auth-js@2.112.1/denonext/auth-js.mjs — which 404s,
// breaking `supabase functions deploy` at the bundling step. 2.111.0 resolves.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0'
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts"
import {
  ensureDocumentLink,
  beginDocumentLinkGeneration,
  publishTempUrl,
  stampPermanentUrl,
  markLinkFailed,
  buildDocumentLinkUrl,
  getDocumentLinkConfig,
  type LinkEntityType,
  type LinkVariant,
} from "../_shared/documentLinks.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

// Normalizes doctor name: strips any existing Dr./dr. prefix (with or without space)
// then re-adds a clean "Dr. " — handles "Dr.pranav", "Dr. Pranav", "dr. pranav" etc.
const formatDoctorName = (name: string | null | undefined): string => {
  if (!name) return '';
  const cleaned = name.trim().replace(/^dr\.?\s*/i, '').trim();
  return cleaned ? `Dr. ${cleaned}` : '';
}

const AI_BLOCK_HEADER_PATTERN = /^\[[^\]]+\]$/

// Drops the "[Voice dictation]" / "[Case paper]" blocks that applyAiExtraction appends to
// Doctor Notes. They are working notes for the doctor inside the app (echoed chief complaint,
// AI differentials to review) and do not belong on a printed copy.
const stripAiNoteBlocks = (doctorNotes?: string | null): string => {
  let inAiBlock = false
  return (doctorNotes || '')
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim()
      if (AI_BLOCK_HEADER_PATTERN.test(trimmed)) {
        inAiBlock = true
        return false
      }
      if (!inAiBlock) return true
      if (!trimmed || trimmed.startsWith('•')) return false
      inAiBlock = false
      return true
    })
    .join('\n')
    .trim()
}

const extractImpressionDetails = (doctorNotes?: string | null) => {
  const notes = stripAiNoteBlocks(doctorNotes);
  if (!notes) {
    return {
      impressionItems: [] as string[],
      remainingNotes: ''
    };
  }

  const headingPattern = /^\s*(?:\[[^\]]+\]\s*:?\s*)?(impression|findings?)\s*[:\-]?\s*/i;
  const splitItems = (text: string) => text
    .split(/\r?\n+|\/|;|(?<=\.)\s+(?=[A-Z])/g)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const lines = notes
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const impressionLines: string[] = [];
  const remainingLines: string[] = [];

  lines.forEach((line) => {
    if (headingPattern.test(line)) {
      impressionLines.push(line.replace(headingPattern, '').trim());
      return;
    }
    remainingLines.push(line);
  });

  const collapsed = lines.join(' ');
  if (impressionLines.length === 0 && headingPattern.test(collapsed)) {
    const extracted = collapsed.replace(headingPattern, '').trim();
    return {
      impressionItems: splitItems(extracted),
      remainingNotes: ''
    };
  }

  return {
    impressionItems: splitItems(impressionLines.join('\n')),
    remainingNotes: remainingLines.join('\n').trim()
  };
}

type LetterheadSpacing = { top: number; bottom: number; left: number; right: number };

const DEFAULT_LETTERHEAD_SPACING: LetterheadSpacing = { top: 130, bottom: 130, left: 20, right: 20 };

// Full-page letterhead mode.
//
// The band mode (separate header/footer images) hands the artwork to PDF.co's
// header/footer templates, which Chromium renders in an isolated context outside
// the page box. A whole-page letterhead cannot go there — it has to be painted
// *behind* the content, edge to edge, on every page. That needs two independent
// mechanisms working together:
//
//   1. a `position: fixed` div sized to the exact paper — fixed elements repeat
//      on every printed page, absolute ones only land on page 1;
//   2. a layout <table> whose <thead>/<tfoot> hold empty spacer rows — browsers
//      repeat thead/tfoot on every page, so the content stays clear of the
//      printed header/footer artwork on page 2, 3, 4… A plain `padding-top`
//      would only protect page 1.
//
// The API side must then use zero margins and `displayheaderfooter: false`,
// otherwise Chromium reserves header/footer bands and the background is pushed
// down and clipped. See letteheaduse.md in this folder.
const applyFullLetterhead = (
  html: string,
  letterheadUrl: string,
  spacing: LetterheadSpacing,
  paper: { width: string; height: string },
  grayscale = false
): string => {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) {
    console.warn('[PDF GEN] ⚠️ Could not locate <body> — skipping full letterhead wrap');
    return html;
  }

  const bodyInner = bodyMatch[1];

  // API margins are zero in this mode, so side padding must come from CSS.
  // Floor it so text can never touch the paper edge if a clinic saved 0.
  const padLeft = Math.max(0, spacing.left);
  const padRight = Math.max(0, spacing.right);
  const topSpacer = Math.max(0, spacing.top);
  const bottomSpacer = Math.max(0, spacing.bottom);

  const letterheadCss = `
    /* === FULL-PAGE LETTERHEAD MODE === */
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      ${grayscale ? `
      /* The print templates desaturate via a filter on html/body — but a
         filtered element becomes the containing block for its position: fixed
         descendants, which would pin #page-bg to the body instead of the page
         and leave the letterhead on page 1 only. Strip it here and desaturate
         the background and the content separately below. */
      filter: none !important;
      -webkit-filter: none !important;
      ` : ''}
    }
    #page-bg {
      position: fixed;
      top: 0;
      left: 0;
      width: ${paper.width};
      height: ${paper.height};
      z-index: 0;
      pointer-events: none;
      background-image: url('${letterheadUrl}');
      background-repeat: no-repeat;
      background-position: top left;
      background-size: ${paper.width} ${paper.height};
      ${grayscale ? 'filter: grayscale(100%); -webkit-filter: grayscale(100%);' : ''}
    }
    /* The wrapper table must inherit none of the document's own table styling —
       every template sets global border/padding/background/font rules on
       table/th/td, and without these overrides the wrapper would draw borders
       around the whole page and resize all the body text (A5 invoices force
       table font-size to 8px, for instance). Using inherit walks the font back
       up to the body, so content renders at exactly the size it does in
       header/footer band mode. */
    table.lh-frame {
      width: 100%;
      border: none !important;
      border-collapse: collapse !important;
      margin: 0 !important;
      background: transparent !important;
      font-size: inherit !important;
      line-height: inherit !important;
      position: relative;
      z-index: 1;
    }
    table.lh-frame > thead,
    table.lh-frame > tfoot,
    table.lh-frame > tbody { background: transparent !important; }
    table.lh-frame > thead > tr,
    table.lh-frame > tfoot > tr,
    table.lh-frame > tbody > tr {
      background: transparent !important;
      background-color: transparent !important;
    }
    table.lh-frame > thead > tr > td,
    table.lh-frame > tfoot > tr > td,
    table.lh-frame > tbody > tr > td {
      border: none !important;
      padding: 0 !important;
      margin: 0 !important;
      background: transparent !important;
      background-color: transparent !important;
    }
    /* Spacer cells hold nothing but a sized div — kill any inherited text metrics
       so they cannot grow taller than the height asked for. */
    table.lh-frame > thead > tr > td,
    table.lh-frame > tfoot > tr > td {
      font-size: 0 !important;
      line-height: 0 !important;
    }
    table.lh-frame > tbody > tr > td {
      font-size: inherit !important;
      line-height: inherit !important;
    }
    .lh-content {
      position: relative;
      z-index: 1;
      padding: 0 ${padRight}px 0 ${padLeft}px;
      background: transparent !important;
      ${grayscale ? 'filter: grayscale(100%); -webkit-filter: grayscale(100%);' : ''}
    }
    /* Keep rows and signature blocks from straddling a page break, where they
       would land on top of the letterhead's footer artwork. */
    .lh-content table tr { break-inside: avoid; page-break-inside: avoid; }
    .lh-content .signature-section, .lh-content .sig-row { page-break-inside: avoid; }
  `;

  // Function replacers throughout: the injected CSS/body carry arbitrary clinic
  // content, and a stray `$&` or `$'` in a string replacement would be treated
  // as a substitution pattern.
  const headInjection = `<style>${letterheadCss}</style></head>`;
  const withCss = html.includes('</head>')
    ? html.replace('</head>', () => headInjection)
    : html.replace(/<body([^>]*)>/i, (_m, attrs) => `<head>${headInjection}<body${attrs}>`);

  const wrappedBody = `
      <div id="page-bg"></div>
      <table class="lh-frame">
        <thead style="display: table-header-group;">
          <tr><td><div style="height: ${topSpacer}px;"></div></td></tr>
        </thead>
        <tfoot style="display: table-footer-group;">
          <tr><td><div style="height: ${bottomSpacer}px;"></div></td></tr>
        </tfoot>
        <tbody>
          <tr><td><div class="lh-content">${bodyInner}</div></td></tr>
        </tbody>
      </table>
  `;

  return withCss.replace(
    /<body([^>]*)>[\s\S]*<\/body>/i,
    (_m, attrs) => `<body${attrs}>${wrappedBody}</body>`
  );
}

// Builds a QR code img tag pointing to the prescription verify page
const buildQrHtml = (visitId: string, sizePx = 70): string => {
  const verifyUrl = `https://docpreneur.academy/verify?id=${encodeURIComponent(visitId)}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verifyUrl)}`;
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <img src="${qrSrc}" style="width:${sizePx}px;height:${sizePx}px;display:block;" alt="Scan to verify" />
      <span style="font-size:8px;color:#666;text-align:center;line-height:1.2;">Scan to<br>verify</span>
    </div>
  `;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Hoisted so the outer catch can retire a reserved share token — otherwise a
  // failed render leaves it 'pending' and the resolver shows the "preparing"
  // page to anyone who opens the link.
  let failedLinkCtx: {
    admin: SupabaseClient
    entityType: LinkEntityType
    entityId: string
    variant: LinkVariant
  } | null = null

  try {
    const { type, data, printVersion, compactVersion, forceRegenerate } = await req.json()

    console.log('[PDF GEN] Request received:', {
      type,
      printVersion: printVersion || false,
      compactVersion: compactVersion || false,
      forceRegenerate: forceRegenerate || false
    })

    if (!type || !data) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: type and data' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Initialize Supabase Admin Client for checking existing PDFs
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

    // === Record / column / link-variant resolution ===
    //
    // One place decides which table, which cached-URL column and which link
    // variant this request is about. It used to be three scattered ternaries
    // that disagreed: the bill paths named columns `pdfUrl` / `printPdfUrl`,
    // neither of which exists (bills has pdf_url / print_pdf_url), so the cache
    // read errored and fell through and the cache write errored and was only
    // logged — every bill PDF re-rendered from scratch on every open.
    const entityType: LinkEntityType | null =
      type === 'visit' ? 'visit' : type === 'bill' ? 'bill' : null
    const entityId: string | undefined =
      type === 'visit' ? data.visit?.id : type === 'bill' ? data.bill?.id : undefined
    const variant: LinkVariant = compactVersion ? 'compact' : printVersion ? 'print' : 'display'
    const sourceTable = type === 'bill' ? 'bills' : 'visits'
    const urlColumn = compactVersion
      ? 'compact_print_pdf_url'
      : printVersion
        ? 'print_pdf_url'
        : 'pdf_url'
    const variantLabel = compactVersion ? 'compact print' : printVersion ? 'print' : 'display'

    // === Hook (a): reserve the share token BEFORE anything is rendered ===
    //
    // Minted here rather than after generation so that (1) it is valid the
    // instant the caller gets a response, and (2) the cached early-return below
    // still produces one — a record generated before this feature existed would
    // otherwise never get a token.
    let linkToken: string | null = null
    // Named distinctly: a `clinicId` const already exists further down this
    // handler's scope, and redeclaring it breaks the deploy bundle.
    const linkClinicId: string | undefined = data.clinicSettings?.id
    const linkConfig = await getDocumentLinkConfig(supabaseAdmin, linkClinicId)
    if (linkConfig.enabled && entityType && entityId) {
      // Pure mint here — a cached hit below must not disturb a live link.
      // Marking the run as started happens after the cache check, once we know
      // a render is actually going to happen.
      linkToken = await ensureDocumentLink(supabaseAdmin, entityType, entityId, variant)
      if (linkToken) {
        failedLinkCtx = { admin: supabaseAdmin, entityType, entityId, variant }
      }
    }
    // Per-clinic domain first, environment default second.
    const shareUrl = buildDocumentLinkUrl(linkToken, linkConfig.base)

    // === PDF EXISTENCE CHECK - Return cached PDF if available ===
    if (!forceRegenerate) {
      if (entityType && entityId) {
        const { data: existingRow, error } = await supabaseAdmin
          .from(sourceTable)
          .select(urlColumn)
          .eq('id', entityId)
          .single()

        if (error) {
          console.warn(`[PDF GEN] Cache lookup failed on ${sourceTable}.${urlColumn}:`, error.message)
        }

        // urlColumn is chosen at runtime, so the row shape is only known dynamically.
        const existing = existingRow as Record<string, string | null> | null
        const existingPdfUrl = existing?.[urlColumn]
        if (existingPdfUrl) {
          console.log(`[PDF GEN] ✅ ${variantLabel} PDF already exists, returning cached URL:`, existingPdfUrl)
          // Backfill the token so a link minted just now resolves immediately
          // instead of sitting on the "preparing" page until a regeneration.
          if (linkToken) {
            await stampPermanentUrl(supabaseAdmin, entityType, entityId, variant, existingPdfUrl)
          }
          return new Response(
            JSON.stringify({ success: true, url: existingPdfUrl, cached: true, token: linkToken, shareUrl }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        console.log(`[PDF GEN] No cached ${variantLabel} PDF found, generating new one...`)
      }
    } else {
      console.log('[PDF GEN] Force regenerate enabled: bypassing cache check.')
    }
    // === END PDF EXISTENCE CHECK ===

    // Past the cache check, so a render is definitely happening. Mark the run as
    // started and retire the previous copy on the token.
    //
    // Both halves matter to anyone holding the link open right now: the resolver
    // uses generation_started_at to tell "rendering, wait for it" apart from
    // "finished long ago, serve what's on file", and clearing permanent_url is
    // what stops it from serving the copy this render is about to replace.
    if (linkToken && entityType && entityId) {
      await beginDocumentLinkGeneration(supabaseAdmin, entityType, entityId, variant)
    }

    const pdfCoApiKey = Deno.env.get('PDF_CO_API')
    if (!pdfCoApiKey) {
      return new Response(
        JSON.stringify({ error: 'PDF.co API key not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Letterhead images MUST be inlined as data: URIs. PDF.co maps `header`/
    // `footer` onto Chrome's headerTemplate/footerTemplate, which render in an
    // isolated print context that performs no network requests — a remote
    // <img src="https://..."> there silently renders as a broken-image icon.
    //
    // But that same string is passed to the html2pdf binary as a command-line
    // argument, and Linux caps one argument at 128KB (MAX_ARG_STRLEN); going
    // over kills the job with "[Errno 7] Argument list too long".
    //
    // So the image is re-encoded here until it fits. Clinics upload PNG
    // letterheads that are 5-6x larger than an equivalent JPEG, which is what
    // blew the limit; re-encoding costs ~20ms and needs no re-upload.
    const MAX_INLINE_BAND_IMAGE = 90000;      // characters of data: URI
    const BAND_IMAGE_MAX_WIDTH = 1000;        // ample for a ~120px print band
    const BAND_IMAGE_TARGET_BYTES = 60 * 1024;

    const shrinkBandImage = async (bytes: Uint8Array, label: string): Promise<Uint8Array | null> => {
      try {
        const decoded = await Image.decode(bytes);

        // Letterheads print onto white paper, so flatten any alpha channel —
        // otherwise transparency encodes as black once we drop to JPEG.
        const flat = new Image(decoded.width, decoded.height).fill(0xffffffff);
        flat.composite(decoded, 0, 0);
        if (flat.width > BAND_IMAGE_MAX_WIDTH) {
          flat.resize(BAND_IMAGE_MAX_WIDTH, Image.RESIZE_AUTO);
        }

        let out: Uint8Array | null = null;
        for (const quality of [80, 65, 50, 35]) {
          out = await flat.encodeJPEG(quality);
          if (out.length <= BAND_IMAGE_TARGET_BYTES) break;
        }
        return out;
      } catch (e) {
        console.error(`[PDF GEN] ${label} image could not be re-encoded:`, e);
        return null;
      }
    };

    const inlineBandImage = async (url: string, label: string): Promise<string | null> => {
      try {
        if (url.startsWith('data:image')) {
          return url.length <= MAX_INLINE_BAND_IMAGE ? url : null;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
        let contentType = response.headers.get('content-type') || 'image/png';
        console.log(`[PDF GEN] ${label} image fetched: ${bytes.length} bytes (${contentType})`);

        if (bytes.length > BAND_IMAGE_TARGET_BYTES) {
          const shrunk = await shrinkBandImage(bytes, label);
          if (shrunk) {
            console.log(`[PDF GEN] ${label} image re-encoded: ${bytes.length} → ${shrunk.length} bytes`);
            bytes = shrunk;
            contentType = 'image/jpeg';
          }
        }

        const src = `data:${contentType};base64,${encode(bytes)}`;

        if (src.length > MAX_INLINE_BAND_IMAGE) {
          console.warn(
            `[PDF GEN] ⚠️ ${label} image still too large to inline (${src.length} chars > ${MAX_INLINE_BAND_IMAGE}) — using text band instead. ` +
            `Re-upload a smaller letterhead in Settings → PDF Settings.`
          );
          return null;
        }

        console.log(`[PDF GEN] ✅ ${label} image inlined (${src.length} chars)`);
        return src;
      } catch (e) {
        console.error(`[PDF GEN] ⚠️ ${label} image unavailable (${e instanceof Error ? e.message : e}) — using text band instead`);
        return null;
      }
    };

    let htmlContent = '';
    let filename = 'document.pdf';

    // Dynamic HTML Generation based on type
    if (type === 'bill') {
      const { bill, patient, doctor, clinicSettings } = data;
      const consultationItem = bill?.billItems?.find((item: any) =>
        String(item?.itemType || '').toLowerCase() === 'consultation' &&
        typeof item?.itemName === 'string'
      );
      const extractedDoctorName = consultationItem?.itemName?.includes(' - ')
        ? consultationItem.itemName.split(' - ').slice(1).join(' - ').trim()
        : '';
      const resolvedDoctorName = (doctor?.name || bill?.visit?.doctor?.name || extractedDoctorName || '').trim();
      const doctorDisplayName = resolvedDoctorName
        ? (/^dr\.?\s+/i.test(resolvedDoctorName) ? resolvedDoctorName : `Dr. ${resolvedDoctorName}`)
        : '';
      filename = printVersion
        ? `Print_Bill_${bill.billNumber}_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
        : `Bill_${bill.billNumber}_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

      // Get invoice paper size (default A4)
      const invoicePaperSize = clinicSettings?.invoicePaperSize || 'A4';
      const isA5 = invoicePaperSize === 'A5';

      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Bill #${bill.billNumber}${printVersion ? ' (Print Version)' : ''}</title>
          <style>
            /* === PRINT VERSION STYLING === */
            ${printVersion ? `
            html, body {
              filter: grayscale(100%) !important;
              -webkit-filter: grayscale(100%) !important;
              print-color-adjust: exact !important;
            }

            /* Hide headers and footers for letterhead */
            .custom-header, .custom-footer, .header, .footer {
              display: none !important;
            }

            /* Force black text */
            body, p, div, span, h1, h2, h3 {
              color: #000 !important;
            }

            /* Remove backgrounds */
            .status, th {
              background: #ddd !important;
              color: #000 !important;
            }

            /* Simplify borders */
            .header, .details-section > div, table, th, td {
              border-color: #000 !important;
            }
            ` : ''}
            /* === END PRINT VERSION STYLING === */

            /* === A5 COMPACT STYLING === */
            ${isA5 ? `
            @page { size: A5; margin: 0; }
            html, body { width: 100%; min-height: 0; }
            body { font-size: 9px !important; margin: 0 !important; line-height: 1.2 !important; }
            .bill-title { margin-bottom: 8px !important; padding-bottom: 6px !important; border-bottom-width: 1px !important; }
            .bill-title p { margin: 2px 0 !important; font-size: 9px !important; }
            .details-section { margin-bottom: 8px !important; gap: 8px !important; }
            .details-section > div { padding: 6px !important; border-radius: 4px !important; }
            .details-section h3 { font-size: 9px !important; margin: 0 0 4px !important; padding-bottom: 3px !important; }
            .details-section p { margin: 1px 0 !important; font-size: 8px !important; line-height: 1.2 !important; }
            body > h3, .bill-details-heading { margin: 0 0 5px !important; padding-bottom: 4px !important; font-size: 10px !important; border-bottom-width: 1px !important; }
            table { font-size: 8px !important; margin-bottom: 8px !important; page-break-inside: avoid !important; }
            th, td { padding: 3px 4px !important; font-size: 8px !important; line-height: 1.15 !important; }
            .summary { width: 160px !important; padding: 5px 7px !important; border-radius: 4px !important; page-break-inside: avoid !important; }
            .summary div { font-size: 8px !important; padding: 2px 0 !important; }
            .summary .total { margin-top: 3px !important; padding-top: 4px !important; font-size: 9px !important; border-top-width: 1px !important; }
            h2 { font-size: 12px !important; line-height: 1.1 !important; }
            .status { padding: 2px 5px !important; font-size: 8px !important; }
            .notes-section { margin-top: 8px !important; page-break-inside: avoid !important; }
            .notes-section h3 { margin: 0 0 4px !important; font-size: 10px !important; }
            .notes-section p { padding: 6px !important; margin: 0 !important; font-size: 8px !important; }
            ` : ''}
            /* === END A5 STYLING === */

            body { font-family: Arial, sans-serif; margin: 20px; color: #333; line-height: 1.4; }
            .header { text-align: center; border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; color: #0066FF; }
            .header p { margin: 5px 0; font-size: 12px; }
            .details-section { display: flex; justify-content: space-between; margin-bottom: 20px; gap: 15px; }
            .details-section > div { flex: 1; border: 1px solid #e0e0e0; padding: 15px; border-radius: 8px; background: #fafafa; }
            .details-section h3 { margin-top: 0; font-size: 14px; color: #0066FF; border-bottom: 1px solid #eee; padding-bottom: 8px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { border: 1px solid #ddd; padding: 10px 8px; text-align: left; font-size: 12px; }
            th { background: linear-gradient(135deg, #0066FF 0%, #0088FF 100%); color: white; font-weight: 600; }
            tr:nth-child(even) { background-color: #f8f9fa; }
            .summary { width: 300px; margin-left: auto; border: 1px solid #e0e0e0; padding: 15px; border-radius: 8px; background: #fafafa; }
            .summary div { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
            .summary .total { font-weight: bold; border-top: 2px solid #0066FF; margin-top: 10px; padding-top: 10px; font-size: 16px; }
            .footer { text-align: center; font-size: 10px; color: #777; margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px; }
            .status { display: inline-block; padding: 5px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; }
            .status-paid { background-color: #d4edda; color: #155724; }
            .status-pending { background-color: #fff3cd; color: #856404; }
            .status-partial { background-color: #cce7ff; color: #004085; }
            .status-overdue { background-color: #f8d7da; color: #721c24; }
            .bill-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #0066FF; }
          </style>
        </head>
        <body>
          <div class="bill-title">
            <div>
              <h2 style="margin: 0; color: #0066FF;">📋 BILL / INVOICE</h2>
              <p style="margin: 5px 0; font-size: 12px;"><strong>Bill No:</strong> ${bill.billNumber}</p>
              <p style="margin: 5px 0; font-size: 12px;"><strong>Date:</strong> ${new Date(bill.billDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            </div>
            <div>
              <span class="status status-${bill.paymentStatus}">${bill.paymentStatus.toUpperCase()}</span>
            </div>
          </div>

          <div class="details-section">
            <div>
              <h3>👤 PATIENT DETAILS</h3>
              <p><strong>Name:</strong> ${patient.name}</p>
              <p><strong>Phone:</strong> ${patient.phone}</p>
              <p><strong>Age:</strong> ${patient.age} years | <strong>Gender:</strong> ${patient.gender}</p>
              ${patient.bloodGroup ? `<p><strong>Blood Group:</strong> ${patient.bloodGroup}</p>` : ''}
              ${patient.address ? `<p><strong>Address:</strong> ${patient.address}</p>` : ''}
            </div>
            <div>
              <h3>👨‍⚕️ DOCTOR DETAILS</h3>
              ${doctorDisplayName ? `<p><strong>Name:</strong> ${doctorDisplayName}</p>` : '<p><em>Not specified</em></p>'}
              ${doctor?.specialization ? `<p><strong>Specialization:</strong> ${doctor.specialization}</p>` : ''}
              ${doctor?.qualification ? `<p><strong>Qualification:</strong> ${doctor.qualification}</p>` : ''}
              ${doctor?.registrationNo ? `<p><strong>Reg No:</strong> ${doctor.registrationNo}</p>` : ''}
            </div>
          </div>

          <h3 style="color: #0066FF; border-bottom: 2px solid #0066FF; padding-bottom: 8px;">📝 BILL DETAILS</h3>
          <table>
            <thead>
              <tr>
                <th>S.No</th>
                <th>Item Description</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Unit Price (₹)</th>
                <th>Disc (%)</th>
                <th>Tax (%)</th>
                <th>Total (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${bill.billItems.map((item, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${item.itemName}</td>
                  <td style="text-transform: capitalize;">${item.itemType}</td>
                  <td style="text-align: center;">${item.quantity}</td>
                  <td style="text-align: right;">${item.unitPrice.toFixed(2)}</td>
                  <td style="text-align: center;">${item.discount ? item.discount + '%' : '-'}</td>
                  <td style="text-align: center;">${item.tax ? item.tax + '%' : '-'}</td>
                  <td style="text-align: right;">${item.totalPrice.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="summary">
            <div><span>Total Amount:</span> <span>₹${bill.totalAmount.toFixed(2)}</span></div>
            <div><span>Paid Amount:</span> <span style="color: #28a745;">₹${bill.paidAmount.toFixed(2)}</span></div>
            <div class="total"><span>Balance Due:</span> <span style="color: ${bill.balanceAmount > 0 ? '#dc3545' : '#28a745'};">₹${bill.balanceAmount.toFixed(2)}</span></div>
            ${bill.paymentMethod ? `<div><span>Payment Method:</span> <span style="text-transform: capitalize;">${bill.paymentMethod}</span></div>` : ''}
          </div>

          ${bill.notes ? `
          <div class="notes-section" style="margin-top: 20px;">
            <h3>NOTES</h3>
            <p style="border: 1px solid #eee; padding: 10px; border-radius: 5px;">${bill.notes}</p>
          </div>
          ` : ''}

        </body>
        </html>
      `;
    } else if (type === 'visit' && compactVersion) {
      // =====================================================
      // COMPACT PRINT VERSION - 1 page, tight layout
      // =====================================================
      const { visit, patient, doctor } = data;
      filename = `CompactRx_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date(visit.date).toLocaleDateString('en-IN').replace(/\//g, '-')}.pdf`;
      const impressionDetails = extractImpressionDetails(visit.doctorNotes);

      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Prescription - ${patient.name}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: Arial, sans-serif;
              font-size: 11px;
              color: #000;
              line-height: 1.35;
              padding: 12px 16px;
            }
            .top-bar {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 2px solid #000;
              padding-bottom: 6px;
              margin-bottom: 8px;
            }
            .top-bar .rx { font-size: 20px; font-weight: bold; }
            .top-bar .date { font-size: 10px; text-align: right; }
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 6px;
              margin-bottom: 8px;
              border: 1px solid #888;
              border-radius: 3px;
              padding: 6px;
            }
            .info-col p { margin-bottom: 2px; }
            .info-col strong { font-size: 10px; text-transform: uppercase; color: #444; }
            .section-title {
              font-size: 10px;
              font-weight: bold;
              text-transform: uppercase;
              background: #e8e8e8;
              padding: 2px 6px;
              margin: 6px 0 4px;
              border-left: 3px solid #000;
            }
            .compact-line {
              margin-bottom: 3px;
              padding-left: 4px;
            }
            table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
            th {
              background: #333;
              color: #fff;
              font-size: 10px;
              padding: 3px 5px;
              text-align: left;
              font-weight: bold;
            }
            td { font-size: 10px; padding: 3px 5px; border-bottom: 1px solid #ddd; vertical-align: top; }
            tr:nth-child(even) td { background: #f5f5f5; }
            .followup {
              border: 1px dashed #000;
              padding: 4px 8px;
              margin: 6px 0;
              font-size: 11px;
            }
            .advice-list { padding-left: 12px; }
            .advice-list li { margin-bottom: 2px; }
            .sig-row {
              display: flex;
              justify-content: space-between;
              margin-top: 10px;
              border-top: 1px solid #000;
              padding-top: 6px;
            }
            .sig-box { text-align: center; width: 45%; }
            .sig-line { border-bottom: 1px solid #000; margin-bottom: 3px; height: 20px; }
            .allergy-warn {
              background: #ffeeee;
              border: 1px solid #cc0000;
              padding: 3px 6px;
              margin-bottom: 6px;
              font-size: 10px;
              font-weight: bold;
              color: #cc0000;
            }
          </style>
        </head>
        <body>

          <div class="top-bar">
            <div>
              <div style="font-size:12px; font-weight:bold; margin-bottom:4px;">${data.clinicSettings?.clinicName || 'Clinic'}</div>
            </div>
            <div class="date">
              Date & Time: <strong>${new Date(visit.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}</strong>
            </div>
          </div>

          <!-- PATIENT / DOCTOR INFO -->
          <div class="info-grid">
            <div class="info-col">
              <p><strong>Patient</strong></p>
              <p><b>${patient.name}</b></p>
              <p>${patient.age ? patient.age + ' yrs' : ''} ${patient.gender ? '| ' + patient.gender : ''} ${patient.bloodGroup ? '| ' + patient.bloodGroup : ''}</p>
              <p>Ph: ${patient.phone || 'N/A'}</p>
              ${patient.address ? `<p>${patient.address}</p>` : ''}
            </div>
            <div class="info-col">
              <p><strong>Doctor</strong></p>
              <p><b>${formatDoctorName(doctor?.name || 'N/A')}</b></p>
              ${doctor?.specialization ? `<p>${doctor.specialization}</p>` : ''}
              ${doctor?.qualification ? `<p>${doctor.qualification}</p>` : ''}
              ${doctor?.registrationNo ? `<p>Reg: ${doctor.registrationNo}</p>` : ''}
            </div>
          </div>

          ${patient.allergies && patient.allergies.length > 0 ? `
          <div class="allergy-warn">&#9888; ALLERGIES: ${patient.allergies.join(', ')}</div>
          ` : ''}


          ${visit.chiefComplaint ? `
          <div class="section-title">Chief Complaint</div>
          <div class="compact-line">${visit.chiefComplaint}</div>
          ` : ''}

          ${visit.symptoms && visit.symptoms.length > 0 ? `
          <div class="section-title">Symptoms</div>
          <div class="compact-line">
            ${visit.symptoms.map(s => s.name + (s.severity ? ' (' + s.severity + ')' : '') + (s.duration ? ' - ' + s.duration : '')).join(' &nbsp;|&nbsp; ')}
          </div>
          ` : ''}

          ${impressionDetails.impressionItems.length > 0 ? `
          <div class="section-title">Impression</div>
          <div class="compact-line">
            ${impressionDetails.impressionItems.map((item, index) => (index + 1) + '. ' + item).join(' &nbsp;&nbsp; ')}
          </div>
          ` : ''}

          ${visit.diagnoses && visit.diagnoses.length > 0 ? `
          <div class="section-title">Diagnosis</div>
          <div class="compact-line">
            ${visit.diagnoses.map((d, i) => (i + 1) + '. ' + d.name + (d.isPrimary ? ' (Primary)' : '')).join(' &nbsp;&nbsp; ')}
          </div>
          ` : ''}

          ${visit.prescriptions && visit.prescriptions.length > 0 ? `
          <div class="section-title">Medications</div>
          <table>
            <thead>
              <tr>
                <th style="width:22px;">#</th>
                <th>Medicine</th>
                <th style="width:60px;">Dosage</th>
                <th style="width:80px;">Frequency</th>
                <th style="width:55px;">Duration</th>
                <th>Instructions</th>
              </tr>
            </thead>
            <tbody>
              ${visit.prescriptions.map((p, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><b>${p.medicine}</b></td>
                <td>${p.dosage || '-'}</td>
                <td>${p.frequency || '-'}</td>
                <td>${p.duration || '-'}</td>
                <td>${p.instructions || '-'}</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="font-size:9px; color:#555; margin-bottom:4px;">* Take medications as prescribed. Contact doctor if side effects occur.</div>
          ` : ''}
          ${visit.testsOrdered && visit.testsOrdered.length > 0 ? `
          <div class="section-title">Tests Ordered</div>
          <div class="compact-line">
            ${visit.testsOrdered.map((t, i) => (i + 1) + '. ' + t.testName + (t.urgency === 'urgent' ? ' [URGENT]' : '')).join(' &nbsp;&nbsp; ')}
          </div>
          ` : ''}

          ${visit.advice && visit.advice.length > 0 ? `
          <div class="section-title">Advice</div>
          <ul class="advice-list">
            ${visit.advice.map(a => `<li>${a}</li>`).join('')}
          </ul>
          ` : ''}

          ${visit.followUpDate ? `
          <div class="followup">
            <b>Follow-up:</b> ${new Date(visit.followUpDate).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </div>
          ` : ''}

          <!-- SIGNATURES -->
          <div class="sig-row">
            ${visit.id ? buildQrHtml(visit.id, 60) : ''}
            <div class="sig-box">
              <div class="sig-line"></div>
              <div>${patient.name}</div>
              <div style="font-size:9px;">Patient Signature</div>
            </div>
            <div class="sig-box">
              <div class="sig-line"></div>
              <div>${formatDoctorName(doctor?.name || '')}</div>
              <div style="font-size:9px;">Dr. Signature ${doctor?.registrationNo ? '| Reg: ' + doctor.registrationNo : ''}</div>
            </div>
          </div>

        </body>
        </html>
      `;
    } else if (type === 'visit') {
      const { visit, patient, doctor, clinicSettings } = data;
      filename = `VisitDetails_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date(visit.date).toLocaleDateString('en-IN').replace(/\//g, '-')}.pdf`;

      // Get Gemini API key for translation
      const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY');

      // Determine if we need regional language (support both camelCase and snake_case)
      const adviceLanguage = visit.adviceLanguage || visit.advice_language || 'english';
      const visitAdviceRegional = visit.adviceRegional || visit.advice_regional || '';
      const isRegionalLanguage = adviceLanguage !== 'english';

      // Debug logging
      console.log('Advice Language Fields:', {
        adviceLanguage_camelCase: visit.adviceLanguage,
        advice_language_snake: visit.advice_language,
        adviceRegional_camelCase: visit.adviceRegional,
        advice_regional_snake: visit.advice_regional,
        resolved_language: adviceLanguage,
        resolved_regional: visitAdviceRegional,
        isRegionalLanguage
      });

      // Language names map for prompts
      const languageNames: Record<string, string> = {
        'hindi': 'Hindi (हिंदी)',
        'bengali': 'Bengali (বাংলা)',
        'gujarati': 'Gujarati (ગુજરાતી)',
        'tamil': 'Tamil (தமிழ்)',
        'telugu': 'Telugu (తెలుగు)',
        'kannada': 'Kannada (ಕನ್ನಡ)',
        'malayalam': 'Malayalam (മലയാളം)',
        'marathi': 'Marathi (मराठी)',
        'punjabi': 'Punjabi (ਪੰਜਾਬੀ)',
        'oriya': 'Oriya (ଓଡ଼ିଆ)'
      };

      // AI Translation function
      const translateWithAI = async (content: {
        advice?: string[],
        diagnoses?: string[],
        prescriptions?: Array<{ medicine: string, dosage?: string, frequency?: string, duration?: string, instructions?: string }>
      }, targetLanguage: string): Promise<{
        translatedAdvice: string,
        translatedDiagnoses: Array<{ original: string, translated: string }>,
        translatedPrescriptions: Array<{ medicine: string, instructions: string }>
      }> => {
        if (!geminiApiKey || targetLanguage === 'english') {
          return { translatedAdvice: '', translatedDiagnoses: [], translatedPrescriptions: [] };
        }

        try {
          const prompt = `You are a medical translator. Translate the following medical advice and prescription instructions to ${languageNames[targetLanguage] || targetLanguage}.

IMPORTANT RULES:
1. Keep medical terms accurate
2. Use simple, patient-friendly language
3. Maintain the meaning precisely
4. Output ONLY valid JSON, no explanation

INPUT:
${JSON.stringify({
            advice: content.advice || [],
            diagnoses: content.diagnoses || [],
            prescriptions: content.prescriptions?.map(p => ({
              medicine: p.medicine,
              instructions: p.instructions || '',
              frequency: p.frequency || '',
              duration: p.duration || ''
            })) || []
          }, null, 2)}

OUTPUT JSON FORMAT:
{
  "translatedAdvice": "All advice combined in ${targetLanguage} as a single paragraph, using bullet points (•) to separate items",
  "translatedDiagnoses": [
    {
      "original": "Original diagnosis name in English",
      "translated": "Translated diagnosis name in ${targetLanguage}"
    }
  ],
  "translatedPrescriptions": [
    {
      "medicine": "Original medicine name (keep in English)",
      "instructions": "Translated instructions including frequency, duration, and special instructions in ${targetLanguage}"
    }
  ]
}

Translate now:`;

          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.3,
                  maxOutputTokens: 2048,
                }
              })
            }
          );

          if (!response.ok) {
            console.error('Gemini translation failed:', await response.text());
            return { translatedAdvice: '', translatedDiagnoses: [], translatedPrescriptions: [] };
          }

          const result = await response.json();
          const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

          // Extract JSON from response
          const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
              translatedAdvice: parsed.translatedAdvice || '',
              translatedDiagnoses: parsed.translatedDiagnoses || [],
              translatedPrescriptions: parsed.translatedPrescriptions || []
            };
          }

          return { translatedAdvice: '', translatedDiagnoses: [], translatedPrescriptions: [] };
        } catch (error) {
          console.error('Translation error:', error);
          return { translatedAdvice: '', translatedDiagnoses: [], translatedPrescriptions: [] };
        }
      };

      // Perform AI translation if regional language is selected
      let aiTranslation = { translatedAdvice: '', translatedDiagnoses: [] as Array<{ original: string, translated: string }>, translatedPrescriptions: [] as Array<{ medicine: string, instructions: string }> };

      // Helper to check if text contains non-English characters (Hindi, Gujarati, etc.)
      const isAlreadyRegionalText = (text: string): boolean => {
        if (!text) return false;
        // Check for Devanagari (Hindi, Marathi), Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi, Oriya scripts
        const regionalPattern = /[\u0900-\u097F\u0A80-\u0AFF\u0980-\u09FF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0A00-\u0A7F]/;
        return regionalPattern.test(text);
      };

      // Translate if regional language selected AND (there's content to translate OR regional advice is in English)
      const needsTranslation = isRegionalLanguage && (
        // Translate advice if it exists and isn't already in regional script
        (visit.advice?.length > 0) ||
        // Translate diagnoses if they exist
        (visit.diagnoses?.length > 0) ||
        // Translate prescriptions if they exist
        (visit.prescriptions?.length > 0) ||
        // Translate regional advice if it's in English (not already regional script)
        (visitAdviceRegional && !isAlreadyRegionalText(visitAdviceRegional))
      );

      // Track original English text for showing both in PDF
      let originalAdviceText = '';
      if (visitAdviceRegional && !isAlreadyRegionalText(visitAdviceRegional)) {
        originalAdviceText = visitAdviceRegional; // Store original English
      }

      if (needsTranslation) {
        console.log(`Translating content to ${adviceLanguage}...`);

        // Include regional advice for translation if it's in English
        const adviceToTranslate = [...(visit.advice || [])];
        if (visitAdviceRegional && !isAlreadyRegionalText(visitAdviceRegional)) {
          adviceToTranslate.push(visitAdviceRegional); // Add the English regional advice for translation
        }

        aiTranslation = await translateWithAI({
          advice: adviceToTranslate,
          diagnoses: visit.diagnoses?.map(d => d.name) || [],
          prescriptions: visit.prescriptions
        }, adviceLanguage);
        console.log('Translation complete:', aiTranslation.translatedAdvice ? 'Success' : 'No translation');
      }

      // Use AI translation if available, otherwise use manual regional advice
      // If regional advice was in English and we translated it, it's now in the translatedAdvice
      const regionalAdviceText = aiTranslation.translatedAdvice || visitAdviceRegional;

      // Helper function to format frequency codes to patient-friendly text
      const formatFrequency = (freq: string): string => {
        const freqMap: Record<string, string> = {
          'OD': 'Once Daily',
          'BD': 'Twice Daily (Morning & Evening)',
          'TDS': 'Three Times Daily',
          'QID': 'Four Times Daily',
          'QDS': 'Four Times Daily',
          'HS': 'At Bedtime',
          'SOS': 'As Needed',
          'PRN': 'As Needed',
          'STAT': 'Immediately',
          'AC': 'Before Meals',
          'PC': 'After Meals',
          'CC': 'With Meals',
          'BBF': 'Before Breakfast',
          'ABF': 'After Breakfast'
        };
        return freqMap[freq?.toUpperCase()] || freq;
      };

      // Helper function to format timing instructions with AI translation fallback
      const formatInstructions = (instructions: string, medicineName?: string): string => {
        if (!instructions) return '';

        // Check if we have AI-translated instructions for this medicine
        if (isRegionalLanguage && medicineName && aiTranslation.translatedPrescriptions.length > 0) {
          const translated = aiTranslation.translatedPrescriptions.find(
            p => p.medicine.toLowerCase() === medicineName.toLowerCase()
          );
          if (translated?.instructions) {
            return translated.instructions;
          }
        }

        // Language-specific instruction translations
        const instrByLanguage: Record<string, Record<string, string>> = {
          'hindi': {
            'before food': '🍽️ Take BEFORE meals (खाने से पहले)',
            'after food': '🍽️ Take AFTER meals (खाने के बाद)',
            'with food': '🍽️ Take WITH meals (खाने के साथ)',
            'before meal': '🍽️ Take BEFORE meals (खाने से पहले)',
            'after meal': '🍽️ Take AFTER meals (खाने के बाद)',
            'empty stomach': '⏰ On EMPTY stomach (खाली पेट)',
            'morning': '🌅 Morning (सुबह)',
            'evening': '🌆 Evening (शाम)',
            'night': '🌙 Night/Before bed (रात को)',
            'bedtime': '🌙 Before bed (सोने से पहले)'
          },
          'gujarati': {
            'before food': '🍽️ Take BEFORE meals (જમતા પહેલા)',
            'after food': '🍽️ Take AFTER meals (જમ્યા પછી)',
            'with food': '🍽️ Take WITH meals (જમવાની સાથે)',
            'before meal': '🍽️ Take BEFORE meals (જમતા પહેલા)',
            'after meal': '🍽️ Take AFTER meals (જમ્યા પછી)',
            'empty stomach': '⏰ On EMPTY stomach (ખાલી પેટે)',
            'morning': '🌅 Morning (સવારે)',
            'evening': '🌆 Evening (સાંજે)',
            'night': '🌙 Night/Before bed (રાત્રે)',
            'bedtime': '🌙 Before bed (સૂતા પહેલા)'
          },
          'bengali': {
            'before food': '🍽️ Take BEFORE meals (খাওয়ার আগে)',
            'after food': '🍽️ Take AFTER meals (খাওয়ার পরে)',
            'with food': '🍽️ Take WITH meals (খাওয়ার সাথে)',
            'before meal': '🍽️ Take BEFORE meals (খাওয়ার আগে)',
            'after meal': '🍽️ Take AFTER meals (খাওয়ার পরে)',
            'empty stomach': '⏰ On EMPTY stomach (খালি পেটে)',
            'morning': '🌅 Morning (সকালে)',
            'evening': '🌆 Evening (সন্ধ্যায়)',
            'night': '🌙 Night/Before bed (রাতে)',
            'bedtime': '🌙 Before bed (ঘুমানোর আগে)'
          },
          'marathi': {
            'before food': '🍽️ Take BEFORE meals (जेवणापूर्वी)',
            'after food': '🍽️ Take AFTER meals (जेवणानंतर)',
            'with food': '🍽️ Take WITH meals (जेवणासोबत)',
            'before meal': '🍽️ Take BEFORE meals (जेवणापूर्वी)',
            'after meal': '🍽️ Take AFTER meals (जेवणानंतर)',
            'empty stomach': '⏰ On EMPTY stomach (रिकाम्या पोटी)',
            'morning': '🌅 Morning (सकाळी)',
            'evening': '🌆 Evening (संध्याकाळी)',
            'night': '🌙 Night/Before bed (रात्री)',
            'bedtime': '🌙 Before bed (झोपण्यापूर्वी)'
          },
          'tamil': {
            'before food': '🍽️ Take BEFORE meals (சாப்பிடுவதற்கு முன்)',
            'after food': '🍽️ Take AFTER meals (சாப்பிட்ட பின்)',
            'with food': '🍽️ Take WITH meals (உணவுடன்)',
            'empty stomach': '⏰ On EMPTY stomach (வெறும் வயிற்றில்)',
            'morning': '🌅 Morning (காலை)',
            'evening': '🌆 Evening (மாலை)',
            'night': '🌙 Night/Before bed (இரவு)',
            'bedtime': '🌙 Before bed (தூங்குவதற்கு முன்)'
          },
          'telugu': {
            'before food': '🍽️ Take BEFORE meals (భోజనానికి ముందు)',
            'after food': '🍽️ Take AFTER meals (భోజనం తర్వాత)',
            'with food': '🍽️ Take WITH meals (భోజనంతో)',
            'empty stomach': '⏰ On EMPTY stomach (ఖాళీ కడుపుతో)',
            'morning': '🌅 Morning (ఉదయం)',
            'evening': '🌆 Evening (సాయంత్రం)',
            'night': '🌙 Night/Before bed (రాత్రి)',
            'bedtime': '🌙 Before bed (నిద్రకు ముందు)'
          }
        };

        // Get language-specific map or fallback to Hindi
        const instrMap = instrByLanguage[adviceLanguage] || instrByLanguage['hindi'] || {};

        let result = instructions;
        Object.entries(instrMap).forEach(([key, val]) => {
          if (instructions.toLowerCase().includes(key)) {
            result = val;
          }
        });
        return result;
      };

      const impressionDetails = extractImpressionDetails(visit.doctorNotes);

      htmlContent = `
        <!DOCTYPE html>
        <html lang="${adviceLanguage === 'hindi' ? 'hi' : adviceLanguage === 'bengali' ? 'bn' : 'en'}">
        <head>
          <meta charset="UTF-8">
          <title>Visit Details for ${patient.name}</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&family=Noto+Sans+Bengali:wght@400;700&family=Noto+Sans+Devanagari:wght@400;700&family=Noto+Sans+Gujarati:wght@400;700&family=Noto+Sans+Gurmukhi:wght@400;700&family=Noto+Sans+Kannada:wght@400;700&family=Noto+Sans+Malayalam:wght@400;700&family=Noto+Sans+Oriya:wght@400;700&family=Noto+Sans+Tamil:wght@400;700&family=Noto+Sans+Telugu:wght@400;700&display=swap" rel="stylesheet">
          <style>
            /* === PRINT VERSION STYLING === */
            ${printVersion ? `
            html, body {
              filter: grayscale(100%) !important;
              -webkit-filter: grayscale(100%) !important;
              print-color-adjust: exact !important;
              -webkit-print-color-adjust: exact !important;
            }
            
            /* Hide headers and footers for letterhead */
            .custom-header, .custom-footer, .header, .footer, .prescription-header {
              display: none !important;
            }
            
            /* Force black text for readability */
            body, p, div, span, li, td, th, h1, h2, h3, h4, h5, h6 {
              color: #000 !important;
            }
            
            /* Remove colored backgrounds */
            .section, .details-section > div, .vital-item, .patient-friendly-instr,
            .regional-advice, .warning-box, .signature-section {
              background: white !important;
            }
            
            /* Simplify borders to black */
            .header, .section, .details-section > div, table, th, td {
              border-color: #000 !important;
            }
            
            /* Remove gradients from table headers */
            th {
              background: #ddd !important;
              color: #000 !important;
            }

            /* === COMPACT SPACING: reduce gaps between components === */
            body { margin: 10px !important; line-height: 1.4 !important; }
            .section { margin-bottom: 8px !important; padding: 8px 10px !important; }
            .section h3 { padding-bottom: 4px !important; margin-bottom: 6px !important; font-size: 13px !important; }
            .details-section { margin-bottom: 8px !important; gap: 8px !important; }
            .details-section > div { padding: 8px 10px !important; }
            .details-section h3 { padding-bottom: 4px !important; margin-bottom: 4px !important; }
            .details-section p { margin: 2px 0 !important; }
            li { margin-bottom: 4px !important; padding: 5px 8px !important; }
            th, td { padding: 5px 6px !important; }
            .vitals-grid { gap: 6px !important; }
            .vital-item { padding: 6px 8px !important; }
            .vital-value { font-size: 15px !important; }
            .patient-friendly-instr { margin-top: 4px !important; padding: 4px 8px !important; }
            .regional-advice { margin-top: 6px !important; padding: 8px 10px !important; }
            .warning-box { margin-top: 4px !important; padding: 5px 8px !important; }
            .signature-section { margin-top: 16px !important; padding: 10px 16px !important; }
            .signature-line { margin: 16px auto 6px !important; }
            table { margin-top: 4px !important; }
            ` : ''}
            /* === END PRINT VERSION STYLING === */
            
            * { box-sizing: border-box; }
            body { 
              font-family: 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Gujarati', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Kannada', 'Noto Sans Malayalam', 'Noto Sans Oriya', 'Noto Sans Gurmukhi', Arial, sans-serif; 
              margin: 20px; 
              color: #333; 
              line-height: 1.6; 
              font-size: 14px;
            }
            .hindi-text { font-family: 'Noto Sans Devanagari', sans-serif; }
            .bengali-text { font-family: 'Noto Sans Bengali', sans-serif; }
            .gujarati-text { font-family: 'Noto Sans Gujarati', sans-serif; }
            .tamil-text { font-family: 'Noto Sans Tamil', sans-serif; }
            .telugu-text { font-family: 'Noto Sans Telugu', sans-serif; }
            .kannada-text { font-family: 'Noto Sans Kannada', sans-serif; }
            .malayalam-text { font-family: 'Noto Sans Malayalam', sans-serif; }
            .oriya-text { font-family: 'Noto Sans Oriya', sans-serif; }
            .punjabi-text { font-family: 'Noto Sans Gurmukhi', sans-serif; }
            .header { text-align: center; border-bottom: 3px solid #0066FF; padding-bottom: 20px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 26px; color: #0066FF; }
            .header p { margin: 5px 0; font-size: 12px; color: #666; }
            .prescription-header { background: linear-gradient(135deg, #0066FF 0%, #00AA55 100%); color: white; padding: 15px; text-align: center; margin: 20px 0; border-radius: 8px; }
            .prescription-header h2 { margin: 0; font-size: 20px; }
            .section { margin-bottom: 20px; border: 1px solid #e0e0e0; padding: 15px; border-radius: 8px; background: #fafafa; }
            .section h3 { margin-top: 0; font-size: 16px; color: #0066FF; border-bottom: 2px solid #0066FF; padding-bottom: 8px; display: flex; align-items: center; gap: 8px; }
            .section-icon { font-size: 18px; }
            .details-section { display: flex; justify-content: space-between; margin-bottom: 20px; gap: 15px; }
            .details-section > div { flex: 1; border: 1px solid #e0e0e0; padding: 15px; border-radius: 8px; background: white; }
            .details-section h3 { margin-top: 0; font-size: 14px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 8px; }
            ul { list-style-type: none; padding: 0; margin: 0; }
            li { margin-bottom: 8px; font-size: 13px; padding: 10px; background-color: white; border-radius: 5px; border-left: 3px solid #0066FF; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #ddd; padding: 12px 8px; text-align: left; font-size: 13px; }
            th { background: linear-gradient(135deg, #0066FF 0%, #0088FF 100%); color: white; font-weight: 600; }
            tr:nth-child(even) { background-color: #f8f9fa; }
            tr:hover { background-color: #e9f5ff; }
            .vitals-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
            .vital-item { border: 1px solid #e0e0e0; padding: 12px; border-radius: 8px; text-align: center; background: white; }
            .vital-item strong { color: #0066FF; font-size: 12px; display: block; margin-bottom: 5px; }
            .vital-value { font-size: 18px; font-weight: bold; color: #333; }
            .footer { text-align: center; font-size: 10px; color: #999; margin-top: 30px; border-top: 2px solid #eee; padding-top: 15px; }
            .signature-section { display: flex; justify-content: space-between; margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 8px; }
            .signature-box { text-align: center; width: 200px; }
            .signature-line { border-bottom: 2px solid #333; width: 150px; margin: 30px auto 10px; }
            .rx-symbol { font-size: 28px; font-weight: bold; color: #0066FF; margin-right: 10px; }
            .medicine-name { font-weight: bold; color: #0066FF; font-size: 14px; }
            .timing-badge { display: inline-block; background: #fff3cd; color: #856404; padding: 3px 8px; border-radius: 4px; font-size: 11px; margin-top: 5px; }
            .patient-friendly-instr { background: #e8f5e9; padding: 8px 12px; border-radius: 5px; margin-top: 8px; font-size: 12px; color: #2e7d32; }
            .regional-advice { margin-top: 15px; padding: 15px; background: #fff8e1; border-radius: 8px; border-left: 4px solid #ff9800; }
            .regional-advice h4 { margin: 0 0 10px 0; color: #e65100; font-size: 14px; }
            .warning-box { background: #ffebee; border: 1px solid #ef5350; border-radius: 5px; padding: 10px; margin-top: 10px; }
            .warning-box p { margin: 0; color: #c62828; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="prescription-header">
            <h2>📋 PATIENT VISIT SUMMARY</h2>
            <p style="margin: 5px 0; font-size: 12px;">Visit Date & Time: ${new Date(visit.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}</p>
          </div>

          <div class="details-section">
            <div>
              <h3>👤 PATIENT DETAILS</h3>
              <p><strong>Visit Date & Time:</strong> ${new Date(visit.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}</p>
              <p><strong>Name:</strong> ${patient.name}</p>
              <p><strong>Phone:</strong> ${patient.phone}</p>
              <p><strong>Age:</strong> ${patient.age} years | <strong>Gender:</strong> ${patient.gender}</p>
              ${patient.bloodGroup ? `<p><strong>Blood Group:</strong> ${patient.bloodGroup}</p>` : ''}
              <p><strong>Address:</strong> ${patient.address}</p>
              ${patient.allergies && patient.allergies.length > 0 ? `
                <div class="warning-box">
                  <p>⚠️ <strong>ALLERGIES:</strong> ${patient.allergies.join(', ')}</p>
                </div>
              ` : ''}
            </div>
            <div>
              <h3>👨‍⚕️ ATTENDING DOCTOR</h3>
              <p><strong>Name:</strong> ${formatDoctorName(doctor?.name || 'Not specified')}</p>
              ${doctor?.specialization ? `<p><strong>Specialization:</strong> ${doctor.specialization}</p>` : ''}
              ${doctor?.qualification ? `<p><strong>Qualification:</strong> ${doctor.qualification}</p>` : ''}
              ${doctor?.registrationNo ? `<p><strong>Registration No:</strong> ${doctor.registrationNo}</p>` : ''}
              ${doctor?.phone ? `<p><strong>Phone:</strong> ${doctor.phone}</p>` : ''}
            </div>
          </div>

          ${visit.chiefComplaint ? `
          <div class="section">
            <h3><span class="section-icon">📝</span> CHIEF COMPLAINT</h3>
            <p style="font-size: 15px; font-weight: 500;">${visit.chiefComplaint}</p>
          </div>
          ` : ''}

          ${Object.values(visit.vitals || {}).some(v => v) ? `
          <div class="section">
            <h3><span class="section-icon">💓</span> VITALS</h3>
            <div class="vitals-grid">
              ${visit.vitals.temperature ? `<div class="vital-item"><strong>🌡️ Temperature</strong><span class="vital-value">${visit.vitals.temperature}°F</span></div>` : ''}
              ${visit.vitals.bloodPressure ? `<div class="vital-item"><strong>🩸 Blood Pressure</strong><span class="vital-value">${visit.vitals.bloodPressure}</span></div>` : ''}
              ${visit.vitals.pulse ? `<div class="vital-item"><strong>❤️ Pulse</strong><span class="vital-value">${visit.vitals.pulse} BPM</span></div>` : ''}
              ${visit.vitals.weight ? `<div class="vital-item"><strong>⚖️ Weight</strong><span class="vital-value">${visit.vitals.weight} kg</span></div>` : ''}
              ${visit.vitals.height ? `<div class="vital-item"><strong>📏 Height</strong><span class="vital-value">${visit.vitals.height} cm</span></div>` : ''}
              ${visit.vitals.oxygenSaturation ? `<div class="vital-item"><strong>🫁 SpO2</strong><span class="vital-value">${visit.vitals.oxygenSaturation}%</span></div>` : ''}
            </div>
          </div>
          ` : ''}

          ${visit.physicalExamination?.sections && visit.physicalExamination.sections.length > 0 ? `
          <div class="section">
            <h3><span class="section-icon">🔍</span> ${escapeHtml(visit.physicalExamination.templateName?.trim() || 'PHYSICAL EXAMINATION')}</h3>
            ${visit.physicalExamination.sections.map(section => `
              <div style="margin-bottom: 15px;">
                <h4 style="font-size: 13px; color: #666; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">${section.title}</h4>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                  ${section.fields.filter(f => f.value).map(field => `
                    <div style="background: white; padding: 8px; border-radius: 4px; border: 1px solid #eee;">
                      <p style="font-size: 10px; color: #666; margin: 0 0 3px 0;">${field.label}</p>
                      <p style="font-size: 12px; font-weight: bold; margin: 0;">${typeof field.value === 'boolean' ? (field.value ? '✓ Present' : '✗ Absent') : field.value}</p>
                    </div>
                  `).join('')}
                </div>
                ${section.fields.filter(f => f.value).length === 0 ? '<p style="color: #999; font-size: 11px; font-style: italic;">No findings recorded</p>' : ''}
              </div>
            `).join('')}
          </div>
          ` : ''}

          ${visit.symptoms && visit.symptoms.length > 0 ? `
          <div class="section">
            <h3><span class="section-icon">🤒</span> SYMPTOMS</h3>
            <ul>
              ${visit.symptoms.map((symptom, index) => `
                <li>
                  <strong>${index + 1}. ${symptom.name}</strong>
                  ${symptom.severity ? ` <span style="background: ${symptom.severity === 'severe' ? '#ffcdd2' : symptom.severity === 'moderate' ? '#fff9c4' : '#c8e6c9'}; padding: 2px 8px; border-radius: 3px; font-size: 11px;">${symptom.severity}</span>` : ''}
                  ${symptom.duration ? ` - Duration: ${symptom.duration}` : ''}
                  ${symptom.notes ? `<br><em style="color: #666; font-size: 12px;">${symptom.notes}</em>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
          ` : ''}

          ${impressionDetails.impressionItems.length > 0 ? `
          <div class="section">
            <h3><span class="section-icon">IM</span> IMPRESSION</h3>
            <ul>
              ${impressionDetails.impressionItems.map((item, index) => `
                <li>
                  <strong>${index + 1}. ${item}</strong>
                </li>
              `).join('')}
            </ul>
          </div>
          ` : ''}

          ${visit.diagnoses && visit.diagnoses.length > 0 ? `
          <div class="section">
            <h3><span class="section-icon">🏥</span> DIAGNOSIS</h3>
            <ul>
              ${visit.diagnoses.map((diagnosis, index) => {
        // Find translation if available
        let displayName = diagnosis.name;
        if (isRegionalLanguage && aiTranslation.translatedDiagnoses.length > 0) {
          const translated = aiTranslation.translatedDiagnoses.find(
            d => d.original.toLowerCase() === diagnosis.name.toLowerCase()
          );
          if (translated?.translated) {
            displayName = `${diagnosis.name} <span class="hindi-text" style="color: #666; font-size: 0.9em;">(${translated.translated})</span>`;
          }
        }

        return `
                <li>
                  <strong>${index + 1}. ${displayName}</strong>
                  ${diagnosis.isPrimary ? ' <span style="background: #e3f2fd; color: #1565c0; padding: 2px 8px; border-radius: 3px; font-size: 11px;">Primary</span>' : ''}
                  ${diagnosis.icd10Code ? `<br><span style="color: #666; font-size: 11px;">ICD-10: ${diagnosis.icd10Code}</span>` : ''}
                  ${diagnosis.notes ? `<br><em style="color: #666; font-size: 12px;">${diagnosis.notes}</em>` : ''}
                </li>
              `}).join('')}
            </ul>
          </div>
          ` : ''}

          ${visit.prescriptions && visit.prescriptions.length > 0 ? `
          <div class="section" style="border: 2px solid #0066FF;">
            <h3><span class="rx-symbol">℞</span> MEDICATIONS</h3>
            <table>
              <thead>
                <tr>
                  <th style="width: 30px;">#</th>
                  <th>Medicine</th>
                  <th>Dosage</th>
                  <th>When to Take</th>
                  <th>Duration</th>
                  <th>Instructions</th>
                </tr>
              </thead>
              <tbody>
                ${visit.prescriptions.map((prescription, index) => `
                  <tr>
                    <td style="text-align: center; font-weight: bold;">${index + 1}</td>
                    <td>
                      <span class="medicine-name">${prescription.medicine}</span>
                    </td>
                    <td>${prescription.dosage || '-'}</td>
                    <td>
                      <strong>${formatFrequency(prescription.frequency)}</strong>
                    </td>
                    <td>${prescription.duration || '-'}</td>
                    <td>
                      ${prescription.instructions ? `<div class="patient-friendly-instr">${formatInstructions(prescription.instructions, prescription.medicine)}</div>` : '-'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <div style="margin-top: 15px; padding: 12px; background: #e3f2fd; border-radius: 5px;">
              <p style="margin: 0; font-size: 12px; color: #1565c0;">
                <strong>📌 Important:</strong> Take medications as prescribed. Consult your doctor if you experience any side effects.
              </p>
            </div>
          </div>
          ` : ''}

          ${visit.testsOrdered && visit.testsOrdered.length > 0 ? `
          <div class="section">
            <h3><span class="section-icon">🧪</span> TESTS ORDERED</h3>
            <ul>
              ${visit.testsOrdered.map((test, index) => `
                <li>
                  <strong>${index + 1}. ${test.testName}</strong>
                  <span style="background: ${test.urgency === 'urgent' ? '#ffcdd2' : '#e8f5e9'}; color: ${test.urgency === 'urgent' ? '#c62828' : '#2e7d32'}; padding: 2px 8px; border-radius: 3px; font-size: 11px; margin-left: 8px;">${test.urgency || 'Routine'}</span>
                  <span style="color: #666; font-size: 11px; margin-left: 8px;">(${test.testType})</span>
                  ${test.instructions ? `<br><em style="color: #666; font-size: 12px;">→ ${test.instructions}</em>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
          ` : ''}

          ${(visit.advice && visit.advice.length > 0) || regionalAdviceText ? `
          <div class="section" style="background: #f0f7ff;">
            <h3><span class="section-icon">💡</span> ADVICE FOR PATIENT</h3>
            ${visit.advice && visit.advice.length > 0 ? `
            <ul>
              ${visit.advice.map(advice => `<li style="border-left-color: #4caf50;">✓ ${advice}</li>`).join('')}
            </ul>
            ` : ''}
            ${originalAdviceText && regionalAdviceText && originalAdviceText !== regionalAdviceText ? `
            <div style="background: #f5f5f5; padding: 10px 15px; border-radius: 5px; margin-bottom: 10px; border-left: 3px solid #9e9e9e;">
              <p style="margin: 0; font-size: 12px; color: #666;">
                <strong>📝 Original (English):</strong> ${originalAdviceText}
              </p>
            </div>
            ` : ''}
            ${regionalAdviceText ? `
            <div class="regional-advice ${adviceLanguage === 'hindi' ? 'hindi-text' : adviceLanguage === 'bengali' ? 'bengali-text' : adviceLanguage === 'gujarati' ? 'gujarati-text' : adviceLanguage === 'tamil' ? 'tamil-text' : adviceLanguage === 'telugu' ? 'telugu-text' : adviceLanguage === 'marathi' ? 'hindi-text' : adviceLanguage === 'kannada' ? 'kannada-text' : adviceLanguage === 'malayalam' ? 'malayalam-text' : adviceLanguage === 'oriya' ? 'oriya-text' : adviceLanguage === 'punjabi' ? 'punjabi-text' : ''}">
              <h4>🗣️ ${adviceLanguage.charAt(0).toUpperCase() + adviceLanguage.slice(1)} Translation</h4>
              <p style="font-size: 14px; line-height: 1.8;">${regionalAdviceText}</p>
            </div>
            ` : ''}
          </div>
          ` : ''}

          ${visit.followUpDate ? `
          <div class="section" style="background: #fff3e0;">
            <h3><span class="section-icon">📅</span> FOLLOW-UP APPOINTMENT</h3>
            <p style="font-size: 16px; font-weight: bold; color: #e65100;">
              Please visit again on: <span style="background: #ff9800; color: white; padding: 5px 15px; border-radius: 5px;">${new Date(visit.followUpDate).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </p>
          </div>
          ` : ''}

          ${impressionDetails.remainingNotes ? `
          <div class="section">
            <h3><span class="section-icon">📋</span> DOCTOR'S NOTES</h3>
            <p style="font-style: italic; color: #555; background: white; padding: 12px; border-radius: 5px; border-left: 3px solid #9c27b0; white-space: pre-line;">${impressionDetails.remainingNotes}</p>
          </div>
          ` : ''}

          <div class="signature-section">
            <div style="display:flex;align-items:flex-end;gap:16px;">
              ${visit.id ? buildQrHtml(visit.id, 65) : ''}
              <div class="signature-box">
                <p><strong>Patient Signature</strong></p>
                <div class="signature-line"></div>
                <p style="font-size: 10px; color: #666;">${patient.name}</p>
              </div>
            </div>
            <div class="signature-box">
              <p><strong>Doctor's Signature</strong></p>
              <div class="signature-line"></div>
              <p style="font-size: 10px; color: #666;">${formatDoctorName(doctor?.name || '')}</p>
              ${doctor?.registrationNo ? `<p style="font-size: 9px; color: #999;">Reg: ${doctor.registrationNo}</p>` : ''}
            </div>
          </div>

        </body>
        </html>
      `;
    } else {
      return new Response(
        JSON.stringify({ error: 'Unsupported document type' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Get clinic PDF margins (default to letterhead margins for print, regular for display)
    const hasCustomDisplayMargins = Boolean(data.clinicSettings?.pdfMargins);
    const rawInvoiceMargins = String(data.clinicSettings?.invoiceMargins || '').trim();
    const legacyLetterheadInvoiceMargins = rawInvoiceMargins === "180px 20px 150px 20px";
    const hasCustomInvoiceMargins = Boolean(rawInvoiceMargins) && !legacyLetterheadInvoiceMargins;

    // Determine paper size (A4 default, A5 for invoices if configured)
    const invoicePaperSize = data.clinicSettings?.invoicePaperSize || 'A4';
    const paperSize = (type === 'bill') ? invoicePaperSize : 'A4';
    const isA5Invoice = type === 'bill' && paperSize === 'A5';

    // === LETTERHEAD MODE RESOLUTION ===
    // Read straight from the DB rather than trusting the payload: callers build
    // `clinicSettings` from the cached user profile, which carries only the
    // columns that existed when it was written. Anything unreadable (columns not
    // migrated yet, no clinic id) falls back to band mode — i.e. exactly the
    // output every clinic gets today.
    let letterheadMode: 'bands' | 'full' = 'bands';
    let letterheadUrl = '';
    let letterheadSpacing: LetterheadSpacing = { ...DEFAULT_LETTERHEAD_SPACING };
    let printBranding = false;

    const clinicId = data.clinicSettings?.id;
    if (clinicId) {
      try {
        const { data: lhRow, error: lhError } = await supabaseAdmin
          .from('clinic_settings')
          .select('pdf_letterhead_mode, pdf_letterhead_url, pdf_letterhead_spacing, pdf_print_branding')
          .eq('id', clinicId)
          .maybeSingle();

        if (lhError) throw lhError;

        if (lhRow) {
          letterheadMode = lhRow.pdf_letterhead_mode === 'full' ? 'full' : 'bands';
          letterheadUrl = String(lhRow.pdf_letterhead_url || '').trim();
          printBranding = lhRow.pdf_print_branding === true;
          const saved = lhRow.pdf_letterhead_spacing || {};
          letterheadSpacing = {
            top: Number.isFinite(Number(saved.top)) ? Number(saved.top) : DEFAULT_LETTERHEAD_SPACING.top,
            bottom: Number.isFinite(Number(saved.bottom)) ? Number(saved.bottom) : DEFAULT_LETTERHEAD_SPACING.bottom,
            left: Number.isFinite(Number(saved.left)) ? Number(saved.left) : DEFAULT_LETTERHEAD_SPACING.left,
            right: Number.isFinite(Number(saved.right)) ? Number(saved.right) : DEFAULT_LETTERHEAD_SPACING.right,
          };
        }
      } catch (e) {
        console.warn(
          `[PDF GEN] Letterhead settings unavailable (${e instanceof Error ? e.message : e}) — using header/footer band mode`
        );
      }
    }

    // Print and compact copies default to no digital branding at all — they are
    // meant to go onto pre-printed letterhead stationery, which already carries
    // it. Clinics printing on plain paper opt in with pdf_print_branding, and
    // then get whichever style is configured, rendered in black and white to
    // match the rest of those documents.
    const isPrintCopy = Boolean(printVersion || compactVersion);
    const brandingEnabled = !isPrintCopy || printBranding;
    const grayscaleBranding = isPrintCopy;

    const useFullLetterhead = letterheadMode === 'full' && Boolean(letterheadUrl) && brandingEnabled;

    if (useFullLetterhead) {
      // A5 invoices get the same artwork scaled to the smaller sheet; the saved
      // spacers are measured against A4, so scale them by the A5/A4 ratio too.
      const paper = isA5Invoice
        ? { width: '148mm', height: '210mm' }
        : { width: '210mm', height: '297mm' };
      const scale = isA5Invoice ? 210 / 297 : 1;
      const scaledSpacing: LetterheadSpacing = {
        top: Math.round(letterheadSpacing.top * scale),
        bottom: Math.round(letterheadSpacing.bottom * scale),
        left: Math.round(letterheadSpacing.left * scale),
        right: Math.round(letterheadSpacing.right * scale),
      };

      console.log(
        `[PDF GEN] Full-page letterhead mode${grayscaleBranding ? ' (B&W)' : ''} — paper ${paper.width}x${paper.height}, ` +
        `spacers T${scaledSpacing.top}/B${scaledSpacing.bottom}, padding L${scaledSpacing.left}/R${scaledSpacing.right}`
      );
      htmlContent = applyFullLetterhead(htmlContent, letterheadUrl, scaledSpacing, paper, grayscaleBranding);
    }
    // === END LETTERHEAD MODE RESOLUTION ===

    // Prepare header/footer for PDF.co (only for display version)
    // Convert to Base64 because some URLs might be private
    let pdfHeader = "";
    let pdfFooter = "";
    let fallbackHeaderFooterUsed = false;
    // These drive headerheight/footerheight below, so they must reflect what is
    // actually rendered — not merely that a URL is configured. An image that
    // failed to inline falls back to the text band, which needs the smaller band.
    let hasHeaderImage = false;
    let hasFooterImage = false;

    // Apply header/footer for visits AND bills, on display copies always and on
    // print copies when the clinic opted in.
    //
    // The two branding modes are mutually exclusive — in full-letterhead mode the
    // artwork is already painted behind the page, and adding API header/footer
    // bands on top would shift and clip it.
    const useBands = brandingEnabled && !useFullLetterhead;

    if (useBands) {
      // Uploaded artwork can only be desaturated with a CSS filter, since it is an
      // image. The generated text band instead just uses ink-black and greys — the
      // header/footer template renders in its own isolated print context, so
      // relying on a filter alone there is a gamble not worth taking.
      const bwImage = grayscaleBranding ? 'filter: grayscale(100%); -webkit-filter: grayscale(100%);' : '';
      const headerTextColor = grayscaleBranding ? '#000000' : '#111827';
      const footerTextColor = grayscaleBranding ? '#333333' : '#4b5563';
      const footerNoteColor = grayscaleBranding ? '#555555' : '#6b7280';
      const ruleColor = grayscaleBranding ? '#000000' : '#d1d5db';

      const headerSrc = data.clinicSettings?.pdfHeaderUrl
        ? await inlineBandImage(data.clinicSettings.pdfHeaderUrl, 'Header')
        : null;
      const footerSrc = data.clinicSettings?.pdfFooterUrl
        ? await inlineBandImage(data.clinicSettings.pdfFooterUrl, 'Footer')
        : null;
      hasHeaderImage = Boolean(headerSrc);
      hasFooterImage = Boolean(footerSrc);

      if (headerSrc) {
        pdfHeader = `<div style="width: 100%; text-align: center; margin: 0; padding: 0; ${bwImage}"><img src="${headerSrc}" style="width: 100%; height: auto; display: block;" /></div>`;
      } else {
        fallbackHeaderFooterUsed = true;
        const clinicName = escapeHtml(data.clinicSettings?.clinicName || 'Clinic');
        const clinicAddress = escapeHtml(data.clinicSettings?.address || '');
        const clinicPhone = escapeHtml(data.clinicSettings?.phone || '');
        const clinicEmail = escapeHtml(data.clinicSettings?.email || '');
        const regNumber = escapeHtml(data.clinicSettings?.registrationNumber || '');
        const headerPadding = isA5Invoice ? '4px 10px 3px' : '8px 16px 6px';
        const headerNameSize = isA5Invoice ? '12px' : '16px';
        const headerDetailSize = isA5Invoice ? '8px' : '10px';
        pdfHeader = `
          <div style="width: 100%; padding: ${headerPadding}; border-bottom: 1px solid ${ruleColor}; font-family: Arial, sans-serif; color: ${headerTextColor};">
            <div style="font-size: ${headerNameSize}; font-weight: 700; line-height: 1.15;">${clinicName}</div>
            <div style="font-size: ${headerDetailSize}; line-height: 1.25; margin-top: 1px;">
              ${clinicAddress ? `<div>${clinicAddress}</div>` : ''}
              ${(clinicPhone || clinicEmail || regNumber) ? `<div>${[clinicPhone ? `Phone: ${clinicPhone}` : '', clinicEmail ? `Email: ${clinicEmail}` : '', regNumber ? `Reg: ${regNumber}` : ''].filter(Boolean).join(' | ')}</div>` : ''}
            </div>
          </div>
        `;
      }

      if (footerSrc) {
        pdfFooter = `<div style="width: 100%; text-align: center; margin: 0; padding: 0; ${bwImage}"><img src="${footerSrc}" style="width: 100%; height: auto; display: block;" /></div>`;
      } else {
        fallbackHeaderFooterUsed = true;
        const website = escapeHtml(data.clinicSettings?.website || '');
        const taxId = escapeHtml(data.clinicSettings?.taxId || '');
        const clinicName = escapeHtml(data.clinicSettings?.clinicName || 'Clinic');
        const footerPadding = isA5Invoice ? '3px 10px' : '6px 16px';
        const footerSize = isA5Invoice ? '7px' : '10px';
        const footerNoteSize = isA5Invoice ? '7px' : '9px';
        pdfFooter = `
          <div style="width: 100%; padding: ${footerPadding}; border-top: 1px solid ${ruleColor}; font-family: Arial, sans-serif; color: ${footerTextColor}; font-size: ${footerSize}; line-height: 1.2; text-align: center;">
            <div>${clinicName}${website ? ` | ${website}` : ''}${taxId ? ` | Tax ID: ${taxId}` : ''}</div>
            <div style="font-size: ${footerNoteSize}; color: ${footerNoteColor};">This is a computer-generated medical document.</div>
          </div>
        `;
      }
    }

    // Determine margins based on document type and version
    let clinicMargins: string;
    if (useFullLetterhead) {
      // Zero margins so the fixed background starts at 0,0 and bleeds to the
      // edges. Any non-zero margin pushes the page box down and takes the
      // letterhead with it. All spacing lives in the HTML instead.
      clinicMargins = "0px 0px 0px 0px";
    } else if (compactVersion || printVersion) {
      // Print/letterhead version - use print margins
      clinicMargins = data.clinicSettings?.pdfPrintMargins || "180px 20px 150px 20px";
    } else if (type === 'bill') {
      // Invoice display version - use invoice-specific margins if set
      clinicMargins = hasCustomInvoiceMargins
            ? rawInvoiceMargins
            : (isA5Invoice ? (fallbackHeaderFooterUsed ? "50px 10px 34px 10px" : "10px") : (hasCustomDisplayMargins ? data.clinicSettings?.pdfMargins : (fallbackHeaderFooterUsed ? "70px 20px 55px 20px" : "20px")));
    } else {
      // Visit/prescription display version
      clinicMargins = hasCustomDisplayMargins
        ? data.clinicSettings?.pdfMargins
        : (fallbackHeaderFooterUsed ? "70px 20px 55px 20px" : "20px");
    }

    console.log(`[PDF GEN] Calling PDF.co with ${printVersion ? 'PRINT' : 'DISPLAY'} settings...`);
    console.log(`[PDF GEN] Paper size: ${paperSize}`);
    console.log(`[PDF GEN] Margins: ${clinicMargins}`);
    const brandingLabel = !brandingEnabled
      ? 'NONE (print copy, branding not enabled)'
      : `${useFullLetterhead ? 'FULL-PAGE LETTERHEAD' : 'HEADER/FOOTER BANDS'}${grayscaleBranding ? ' (B&W)' : ''}`;
    console.log(`[PDF GEN] Branding mode: ${brandingLabel}`);
    const bandKind = (html: string, isImage: boolean) => !html ? 'None' : isImage ? 'Letterhead image (inlined)' : 'Text band';
    console.log(`[PDF GEN] Header: ${bandKind(pdfHeader, hasHeaderImage)}`);
    console.log(`[PDF GEN] Footer: ${bandKind(pdfFooter, hasFooterImage)}`);
    if (pdfHeader) console.log(`[PDF GEN] Header length: ${pdfHeader.length} chars`);
    if (pdfFooter) console.log(`[PDF GEN] Footer length: ${pdfFooter.length} chars`);


    // Call PDF.co API with proper parameters
    const pdfCoResponse = await fetch('https://api.pdf.co/v1/pdf/convert/from/html', {
      method: 'POST',
      headers: {
        'x-api-key': pdfCoApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: filename,
        html: htmlContent,
        async: true,
        margins: clinicMargins,
        papersize: paperSize,
        displayheaderfooter: useBands,
        header: pdfHeader,
        footer: pdfFooter,
        headerheight: useBands ? (isA5Invoice ? (hasHeaderImage ? "70px" : "42px") : (hasHeaderImage ? "120px" : "58px")) : "0px",
        footerheight: useBands ? (isA5Invoice ? (hasFooterImage ? "42px" : "26px") : (hasFooterImage ? "80px" : "42px")) : "0px",
        scale: 1,
        mediatype: "print",
        // Colors only for display version — except the full-page letterhead,
        // which is a CSS background Chromium drops entirely without this.
        printbackground: !printVersion || useFullLetterhead,
      }),
    })

    if (!pdfCoResponse.ok) {
      const errorText = await pdfCoResponse.text()
      throw new Error(`PDF.co API Error: ${pdfCoResponse.status} - ${errorText}`)
    }

    const pdfCoData = await pdfCoResponse.json()
    console.log(`[PDF GEN] PDF.co initial response:`, JSON.stringify(pdfCoData));

    let pdfUrl: string | null = null;

    // With async:true PDF.co returns BOTH `jobId` and `url` — that url is the
    // *future* S3 location and 404s until the job finishes writing it. So the
    // jobId branch must be checked FIRST; treating the url as ready skips
    // polling entirely and the download fails with S3 NoSuchKey.
    // Handle async response - need to poll for completion
    if (pdfCoData.jobId) {
      console.log(`[PDF GEN] PDF.co async job started: ${pdfCoData.jobId}`);

      // --- Poll PDF.co job status until complete ---
      const PDFCO_JOB_STATUS_URL = 'https://api.pdf.co/v1/job/check';
      const maxPollAttempts = 60; // 60 attempts = ~2 minutes max
      const pollInterval = 2000; // 2 seconds

      for (let pollAttempt = 1; pollAttempt <= maxPollAttempts; pollAttempt++) {
        console.log(`[PDF GEN] Polling job status (attempt ${pollAttempt}/${maxPollAttempts})...`);

        // Only transient transport faults are retried. The job's own verdict is
        // evaluated outside the try so a terminal failure aborts immediately
        // instead of being swallowed by the catch and re-polled for 2 minutes.
        let statusData: any;
        try {
          const statusResponse = await fetch(`${PDFCO_JOB_STATUS_URL}?jobid=${pdfCoData.jobId}`, {
            method: 'GET',
            headers: {
              'x-api-key': pdfCoApiKey,
            }
          });

          if (!statusResponse.ok) {
            throw new Error(`Job status check failed: ${statusResponse.status}`);
          }

          statusData = await statusResponse.json();
        } catch (error) {
          console.error(`[PDF GEN] Polling error:`, error);
          if (pollAttempt >= maxPollAttempts) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }

        console.log(`[PDF GEN] Job status:`, JSON.stringify(statusData));

        // Check for success (polling returns status: "success")
        if (statusData.status === 'success') {
          // job/check does not always echo the url back — fall back to the
          // pre-signed url handed to us when the job was created.
          pdfUrl = statusData.url || pdfCoData.url;
          console.log(`[PDF GEN] ✅ Job complete! PDF URL: ${pdfUrl}`);
          break;
        }

        // Terminal verdict — retrying cannot change it.
        if (statusData.status === 'failed' || statusData.status === 'error' || statusData.status === 'aborted') {
          throw new Error(`PDF.co job failed: ${statusData.message || 'Unknown error'}`);
        }

        // Job still processing, wait before next poll
        if (pollAttempt < maxPollAttempts) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      }
    }
    // Handle synchronous response - URL returned directly, no job to wait on
    else if (pdfCoData.url && pdfCoData.error === false) {
      console.log(`[PDF GEN] ✅ PDF generated synchronously!`);
      pdfUrl = pdfCoData.url;
    } else {
      throw new Error('PDF.co did not return a URL or jobId');
    }

    if (!pdfUrl) {
      throw new Error('PDF.co job did not complete within timeout period (2 minutes)');
    }

    // === Hook (b): publish the temp URL the instant PDF.co hands one over ===
    //
    // This is where the latency win lands. Everything below — the 3s settle, up
    // to 10 availability checks at 2s apart, up to 5 download retries with
    // escalating backoff, the Storage upload and the DB write — happens *after*
    // the PDF already exists at PDF.co. Publishing here makes the share link
    // openable during all of it, instead of only once the tail finishes.
    //
    // Deliberately after the job completes, not at job *creation*: with
    // async:true PDF.co hands back the future S3 location up front, and that
    // URL 404s until the job writes it.
    if (linkToken && entityType && entityId) {
      await publishTempUrl(supabaseAdmin, entityType, entityId, variant, pdfUrl)
    }

    // --- Reliability Logic: Verify file availability before returning (Avoid "Broken" PDF) ---
    // This addresses the issue where PDF.co returns a URL but the file is not yet available on S3
    console.log(`[PDF GEN] ⏳ Applying safety delay (3s) for file stabilization...`);
    await new Promise(r => setTimeout(r, 3000));

    let isFileActuallyReady = false;
    const verificationAttempts = 10;
    console.log(`[PDF GEN] Verifying file availability at: ${pdfUrl}`);

    for (let i = 1; i <= verificationAttempts; i++) {
      try {
        console.log(`[PDF GEN] Polling job status (attempt ${i})...`);
        const checkRes = await fetch(pdfUrl);
        const contentType = checkRes.headers.get('content-type');

        if (checkRes.ok && contentType && contentType.includes('application/pdf')) {
          isFileActuallyReady = true;
          console.log(`[PDF GEN] ✅ Job status: success (verified at attempt ${i})`);
          break;
        }
        console.warn(`[PDF GEN] Job status: pending (Attempt ${i}/10 - Status: ${checkRes.status}, Content: ${contentType})`);
      } catch (e) {
        console.error(`[PDF GEN] Job status: failed (Attempt ${i}):`, e.message);
      }

      if (i < verificationAttempts) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!isFileActuallyReady) {
      console.error('[PDF GEN] Job status: failed (Verification timed out after 10 attempts)');
      // If verification fails, we throw an error so the user knows to retry instead of getting a broken tab
      throw new Error('PDF file failed to stabilize on PDF.co servers. Please try again in a few seconds.');
    }

    // --- Persist to Supabase Storage before responding ---
    // Must be awaited: the isolate is torn down the moment we return a Response,
    // so a fire-and-forget promise here would never run.
    console.log('[PDF GEN] File verified, persisting to Storage...');

    const persistToStorage = async (): Promise<string | null> => {
      try {
        let pdfBlob: Blob | null = null;
        const maxRetries = 5;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`[PDF GEN] Persist: Download ${attempt}/${maxRetries}...`);
            const res = await fetch(pdfUrl!);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            pdfBlob = await res.blob();
            if (pdfBlob.size === 0) throw new Error('Empty');
            console.log(`[PDF GEN] Persist: ✅ Downloaded (${pdfBlob.size} bytes)`);
            break;
          } catch (e) {
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }

        if (!pdfBlob) {
          console.error('[PDF GEN] Persist: ❌ Download failed');
          return null;
        }

        const bucketName = 'pdfs';
        let storagePath = '';
        if (type === 'bill' && data.bill?.id) {
          storagePath = `bills/${data.bill.id}/${printVersion ? 'print' : 'display'}/${filename}`;
        } else if (type === 'visit' && data.visit?.id) {
          if (compactVersion) {
            storagePath = `visits/${data.visit.id}/compact/${filename}`;
          } else {
            storagePath = `visits/${data.visit.id}/${printVersion ? 'print' : 'display'}/${filename}`;
          }
        } else {
          storagePath = `temp/${crypto.randomUUID()}/${filename}`;
        }

        const { error: uploadError } = await supabaseAdmin.storage
          .from(bucketName)
          .upload(storagePath, pdfBlob, { contentType: 'application/pdf', upsert: true });

        if (uploadError) {
          console.error('[PDF GEN] Persist: ❌ Upload failed:', uploadError.message);
          return null;
        }

        const { data: { publicUrl } } = supabaseAdmin.storage.from(bucketName).getPublicUrl(storagePath);
        console.log('[PDF GEN] Persist: ✅ Uploaded:', publicUrl);

        if (entityId) {
          // The generated-at stamp is not cosmetic: the link resolver dates any
          // URL it reads back out of this table against it, because a URL in a
          // column carries no expiry of its own and an ephemeral one left by an
          // old failed run would otherwise look live forever.
          const stampColumn = compactVersion
            ? null
            : printVersion
              ? (type === 'bill' ? null : 'print_pdf_generated_at')
              : 'pdf_generated_at';

          const patch: Record<string, string> = { [urlColumn]: publicUrl };
          if (stampColumn) patch[stampColumn] = new Date().toISOString();

          const { error: dbError } = await supabaseAdmin.from(sourceTable).update(patch).eq('id', entityId);
          if (dbError) {
            console.error('[PDF GEN] Persist: ❌ DB update failed:', dbError.message);
          } else {
            console.log('[PDF GEN] Persist: ✅ DB updated with column:', urlColumn);
          }
        }

        // === Hook (c): stamp the permanent URL on the share token ===
        // stampPermanentUrl refuses ephemeral input, so a PDF.co URL can never
        // be frozen into a link that dies within the hour.
        if (linkToken && entityType && entityId) {
          await stampPermanentUrl(supabaseAdmin, entityType, entityId, variant, publicUrl);
        }

        return publicUrl;
      } catch (err) {
        console.error('[PDF GEN] Persist error:', err);
        return null;
      }
    };

    const permanentUrl = await persistToStorage();

    if (permanentUrl) {
      console.log('[PDF GEN] ✅ Returning permanent Storage URL');
      return new Response(
        JSON.stringify({
          success: true,
          url: permanentUrl,
          filename,
          temporary: false,
          token: linkToken,
          shareUrl
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Storage persistence failed — fall back to the (1 hour) PDF.co temp URL
    // so the user still gets their document.
    //
    // The share token stays on 'temp' here (hook (c) refused the ephemeral URL),
    // so it keeps resolving for the rest of the signature window and can be
    // revived by a later regeneration. Share `shareUrl`, not `url`, when
    // anything is going out over WhatsApp: `url` dies within the hour.
    console.warn('[PDF GEN] ⚠️ Storage persist failed, falling back to temp URL');
    return new Response(
      JSON.stringify({
        success: true,
        url: pdfUrl,
        filename,
        temporary: true,
        token: linkToken,
        shareUrl,
        message: 'PDF ready, but permanent storage failed. This link expires in 1 hour.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('PDF Generation Edge Function Error:', error)

    if (failedLinkCtx) {
      await markLinkFailed(
        failedLinkCtx.admin,
        failedLinkCtx.entityType,
        failedLinkCtx.entityId,
        failedLinkCtx.variant,
      )
    }

    return new Response(
      JSON.stringify({
        error: 'Failed to generate PDF',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
