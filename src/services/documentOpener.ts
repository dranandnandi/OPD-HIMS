import { documentLinkService, DocumentEntityType, DocumentVariant } from './documentLinkService';
import type { GeneratedPdf } from './pdfService';

/**
 * Open a generated PDF without waiting for it to be generated.
 *
 * The slow part of PDF generation happens *after* the document already exists at
 * PDF.co: a settle delay, an availability poll, download retries, the Storage
 * upload and the DB write. Measured on this app, a fresh prescription took ~23s
 * end to end. Because the share token is minted before rendering starts and the
 * PDF.co URL is published onto it the moment it appears, the link is openable
 * long before any of that finishes — the resolver serves a self-refreshing
 * "preparing" page and then redirects, first to the temp copy and later to the
 * permanent one, all under one unchanging URL.
 *
 * So: open the tab now, point it at the token, and let generation finish in the
 * background.
 */

/**
 * Claim a tab synchronously, inside the click handler.
 *
 * Must be called before any `await`. Popup blockers allow `window.open` only
 * while a user gesture is being handled, and every one of these flows does async
 * work (reloading the visit, resolving the doctor) before it knows the URL.
 * Claiming the tab first and navigating it later is what keeps it unblocked.
 */
export function claimTab(): Window | null {
  const tab = window.open('', '_blank');
  if (!tab) return null;
  try {
    tab.document.write(
      `<!doctype html><meta charset="utf-8"><title>Preparing document…</title>
       <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
                    font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
                    background:#f8fafc;color:#0f172a">
         <p>Preparing your document…</p>
       </body>`,
    );
    tab.document.close();
  } catch {
    // Cross-origin or blocked document access; navigation below still works.
  }
  return tab;
}

interface OpenOptions {
  entityType: DocumentEntityType;
  entityId: string;
  variant: DocumentVariant;
  /** Kicks off generation. Not awaited when a share link is available. */
  generate: () => Promise<GeneratedPdf>;
  /** Whether this run replaces an existing copy. */
  forceRegenerate?: boolean;
  /** Runs when generation actually finishes, with the real Storage URL. */
  onComplete?: (result: GeneratedPdf) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

/**
 * Navigate a claimed tab to the document, as early as possible.
 *
 * With stable links on, the tab goes to the token immediately and generation
 * runs unawaited. Without them (clinic not enabled, no link base configured),
 * this falls back to the original behaviour — await generation, then navigate —
 * so nothing regresses for clinics that have not been switched on.
 *
 * Resolves once the tab has been pointed somewhere; it does NOT wait for
 * generation unless it had to fall back.
 */
export async function openDocument(tab: Window | null, opts: OpenOptions): Promise<void> {
  const { entityType, entityId, variant, generate, forceRegenerate, onComplete, onError } = opts;

  const navigate = (url: string) => {
    if (tab && !tab.closed) tab.location.replace(url);
    else window.open(url, '_blank');
  };

  const link = await documentLinkService.ensureShareUrl(
    entityType,
    entityId,
    variant,
    // A regeneration must retire the previous copy, or the resolver keeps
    // serving it and the user sees the document they just asked to replace.
    { restart: Boolean(forceRegenerate) },
  );

  if (link?.url) {
    navigate(link.url);

    // Nothing awaits this, so its failure has to be surfaced explicitly —
    // otherwise a failed render is an unhandled rejection and the user is left
    // staring at a "preparing" page that never resolves.
    generate()
      .then((result) => onComplete?.(result))
      .catch((error) => {
        console.error('[doc-open] background generation failed:', error);
        onError?.(error);
      });
    return;
  }

  // Fallback: no usable share link, so behave as before.
  try {
    const result = await generate();
    navigate(result.url);
    await onComplete?.(result);
  } catch (error) {
    if (tab && !tab.closed) tab.close();
    onError?.(error);
    throw error;
  }
}
