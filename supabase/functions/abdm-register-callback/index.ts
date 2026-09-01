// Register (or re-register) our callback base URL with ABDM. Spec §3.2.4.
//
//   PATCH {gateway}/v3/bridge/url    body: { "url": "<base>" }
//
// This is an ADMIN operation, not part of any patient flow. It tells ABDM where
// to send patient data for this bridge, so it is deliberately behind an
// authenticated admin caller rather than run as a script with the client
// secret pasted into a terminal.
//
// ############ THE TRAP, worth reading before you change anything ###########
//
// Register the BASE only. ABDM appends its own paths — `/api/v3/hip/patient/
// share`, `/api/v3/hip/token/on-generate-token`, and so on. Register a full
// endpoint and ABDM appends *again*, producing
//
//   https://x/functions/v1/f/api/v3/hip/patient/share/api/v3/hip/patient/share
//
// which never resolves. Nothing errors: callbacks simply stop arriving, and
// there is nothing in any log to explain it. This is FAQ v1.4 Q30, and it is
// the single most reported ABDM integration failure.
//
// The base we register ends at the Supabase function name. Supabase routes
// `/functions/v1/<name>/<anything>` to `<name>`, so whatever ABDM appends
// still lands on the handler, which ignores the path.
// ###########################################################################

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { getAccessToken, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, AbdmAuthError } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';

/** ABDM's own paths, so we can refuse a URL that already contains one. */
const ABDM_CALLBACK_PATHS = [
  '/api/v3/hip/',
  '/api/v3/hiu/',
  '/api/v3/consent/',
  '/v3/hip/',
  '/v3/hiu/',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;

  try {
    caller = await authenticateCaller(req);

    // Roles permitted to repoint the ABDM callback.
    //
    // 'doctor' is included at the owner's instruction (2026-08-26): in this
    // product a doctor IS the administrator of their clinic, and gating this
    // on 'admin' alone would lock the actual operator out of their own setup.
    //
    // ###################################################################
    // ###  REVISIT THIS WHEN A SECOND CLINIC JOINS THE SAME BRIDGE.   ###
    // ###################################################################
    // The callback URL is BRIDGE-WIDE, not per-clinic: changing it moves
    // where ABDM delivers patient data for EVERY clinic on this bridge. With
    // a single clinic that distinction is academic. With several, one
    // clinic's doctor could redirect another clinic's patient records, which
    // is a cross-tenant escalation and a certain audit finding.
    //
    // The fix at that point is not to remove 'doctor' — it is to make this
    // an integrator-level operation that no clinic-scoped role can reach,
    // because no clinic role should own a bridge-wide setting.
    const ALLOWED_ROLES = ['doctor', 'admin', 'super_admin'];
    if (!ALLOWED_ROLES.includes((caller.roleName ?? '').toLowerCase())) {
      throw new AbdmAuthError('You are not permitted to change the ABDM callback URL', 403);
    }

    const body = await req.json();
    const url = String(body?.url ?? '').trim().replace(/\/+$/, '');

    if (!/^https:\/\/[^\s]+$/i.test(url)) {
      return jsonResponse(req, { error: 'An https:// base URL is required', requestId }, 400);
    }

    // ABDM requires a domain name, not an IP or a port (FAQ Q29).
    const host = new URL(url).hostname;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return jsonResponse(
        req,
        { error: 'ABDM requires a domain name, not an IP address', requestId },
        400,
      );
    }

    // The doubling trap. Refuse rather than register something that will fail
    // silently weeks later.
    const lower = url.toLowerCase();
    if (ABDM_CALLBACK_PATHS.some((p) => lower.includes(p))) {
      return jsonResponse(
        req,
        {
          error:
            'This looks like a full ABDM endpoint, not a base URL. ABDM appends its own path, so registering this would produce a doubled URL that silently never delivers. Register only the base.',
          requestId,
        },
        400,
      );
    }

    const cfg = getAbdmConfig();
    const accessToken = await getAccessToken(caller.admin, cfg);

    // Note the `/gateway` segment. `gatewayBase` stops at `/api/hiecm`, and the
    // gateway's own APIs live under `/gateway` beneath it — the same shape as
    // `/gateway/v3/sessions`. Omitting it returns a 404 that ABDM renders as
    // "No matching ABHA record was found", which sends you looking in entirely
    // the wrong place. Sibling families (`patient-share/...`) sit directly
    // under `/api/hiecm` with no `/gateway`, so this is not uniform.
    const res = await fetch(`${cfg.gatewayBase}/gateway/v3/bridge/url`, {
      method: 'PATCH',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('Callback URL registration rejected', res.status, await res.text());
    }
    await res.text();

    await writeAudit(caller, {
      action: 'callback_url_register',
      requestId,
      status: 'success',
      errorMessage: url,
    });

    return jsonResponse(req, { registered: true, url, env: cfg.env, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'callback_url_register',
        requestId,
        status: 'failure',
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
