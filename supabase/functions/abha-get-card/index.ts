// ABHA QR code and card — spec sections 10.0 and 11.0.
// GET {abhaBase}/v3/profile/account/qrCode
// GET {abhaBase}/v3/profile/account/abha-card
//
// Both require the patient's X-token, which only exists while a verification
// flow is live. That is the whole constraint on this feature: the card can be
// produced at the end of a verify/enrol flow, but **not** on demand weeks later
// from a linked patient record — we deliberately do not retain X-tokens (G-02).
// Re-printing later means re-verifying, which is the correct trade: the card is
// the patient's identity document, not the clinic's.
//
// Nothing is persisted. The bytes go straight to the browser for display or
// printing, so the clinic never becomes a store of ABHA cards at rest.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { getAccessToken, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { claimFlowSessionAny } from '../_shared/abdmFlowSession.ts';

/** Base64 in chunks — a spread over a large Uint8Array blows the arg limit. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Fetches one artefact, tolerating either response shape.
 *
 * ABDM returns the QR as JSON in some environments and as image bytes in
 * others, and the card as raw bytes with a 202. Sniffing the content type is
 * more robust than assuming, and both end up as a data URI the browser can
 * render directly.
 */
async function fetchArtefact(
  url: string,
  cfg: ReturnType<typeof getAbdmConfig>,
  accessToken: string,
  xToken: string,
  requestId: string,
): Promise<string | null> {
  const res = await fetch(url, {
    method: 'GET',
    headers: abdmHeaders(cfg, accessToken, requestId, {
      'X-Token': xToken.startsWith('Bearer ') ? xToken : `Bearer ${xToken}`,
    }),
  });

  // Card/QR are a bonus on top of a successful verification. A failure here
  // must not fail the caller — it returns null and the UI hides the option.
  if (!res.ok) {
    console.error(`[abdm][${requestId}] artefact ${url} -> ${res.status}`);
    return null;
  }

  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const data = await res.json();
    const value = data.qrCode ?? data.qr ?? data.data ?? data.abhaCard ?? null;
    if (typeof value !== 'string' || !value) return null;
    // Already a data URI, or a bare base64 payload we can wrap.
    return value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) return null;
  const mime = contentType.split(';')[0].trim() || 'image/png';
  return `data:${mime};base64,${toBase64(bytes)}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    const sessionId: string = String(body?.sessionId ?? '');
    if (!sessionId) {
      return jsonResponse(req, { error: 'A session is required', requestId }, 400);
    }

    // Reachable from both paths: mobile-OTP verification and Aadhaar enrolment.
    const { data: flow } = await claimFlowSessionAny(caller, sessionId, [
      'mobile-login',
      'enrolment',
    ]);
    patientId = flow.patientId;
    if (!flow.xToken) {
      return jsonResponse(
        req,
        { error: 'This verification has expired. Please verify again to print the card.', requestId },
        410,
      );
    }

    const cfg = getAbdmConfig();
    const accessToken = await getAccessToken(caller.admin, cfg);

    // Sequential, not parallel: both spend the same X-token, and ABDM has been
    // known to invalidate it on concurrent use.
    const qrCode = await fetchArtefact(
      `${cfg.abhaBase}/v3/profile/account/qrCode`,
      cfg, accessToken, flow.xToken, requestId,
    );
    const card = await fetchArtefact(
      `${cfg.abhaBase}/v3/profile/account/abha-card`,
      cfg, accessToken, flow.xToken, requestId,
    );

    if (!qrCode && !card) {
      throw new AbdmUpstreamError('ABDM returned neither QR nor card', 502, '<both empty>');
    }

    await writeAudit(caller, { action: 'abha_card_fetch', requestId, status: 'success', patientId });

    // Session is left alive so a failed print can be retried within its TTL.
    return jsonResponse(req, { qrCode, card, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'abha_card_fetch',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
