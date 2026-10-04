// The single inbound door for every ABDM callback.
//
// ############ WHY ONE FUNCTION AND NOT ONE PER CALLBACK ####################
//
// ABDM stores ONE base URL per bridge (§3.2.4) and appends its own path to it
// for every flow:
//
//   {base}/api/v3/hip/token/on-generate-token
//   {base}/api/v3/hip/patient/share
//   {base}/api/v3/hip/patient/care-context/discover
//   {base}/api/v3/consent/request/hip/notify
//   ...
//
// So a per-flow function is impossible — they would each need their own base,
// and there is only one. This dispatches on the appended path instead.
//
// Supabase routes `/functions/v1/abdm-callback/<anything>` here, so registering
// `https://<host>/functions/v1/abdm-callback` as the base gives ABDM a path it
// can append to freely.
// ###########################################################################
//
// PUBLIC ENDPOINT. `verify_jwt = false` is forced — ABDM holds no Supabase
// session. Authentication is ABDM's own signed JWT, verified against ABDM's
// JWKS BEFORE any body is acted on. That check happens once, here, so no
// handler can forget it.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig } from '../_shared/abdmConfig.ts';
import { getAccessToken } from '../_shared/abdmSession.ts';
import { createAdminClient } from '../_shared/abdmAuthz.ts';
import { verifyAbdmCallback, AbdmCallbackAuthError } from '../_shared/abdmCallbackAuth.ts';
import { handlePatientShare } from '../_shared/callbacks/patientShare.ts';
import { handleOnGenerateToken } from '../_shared/callbacks/onGenerateToken.ts';
import { handleOnLinkCareContext } from '../_shared/callbacks/onLinkCareContext.ts';
import { handleDiscover } from '../_shared/callbacks/discover.ts';

/**
 * Match on the path SUFFIX, not equality.
 *
 * The incoming path is `/abdm-callback/api/v3/hip/...` after Supabase's own
 * prefix, and ABDM has been known to vary the leading segments between
 * environments. Anchoring on the distinctive tail is stable; matching the whole
 * path is not.
 */
const ROUTES: Array<{ suffix: string; handler: typeof handlePatientShare }> = [
  { suffix: '/hip/token/on-generate-token', handler: handleOnGenerateToken },
  { suffix: '/hip/patient/share', handler: handlePatientShare },
  // Spec 4.3.4. ABDM has used more than one spelling for this path across
  // environments, so both are routed rather than guessing which arrives.
  { suffix: '/hip/link/care-context/on-add-contexts', handler: handleOnLinkCareContext },
  { suffix: '/link/on-add-contexts', handler: handleOnLinkCareContext },
  // Spec 5.3.2, user-initiated linking. Suffix confirmed against a live
  // sandbox delivery on 2026-09-02, not read off the spec:
  //   /abdm-callback/api/v3/hip/patient/care-context/discover
  { suffix: '/hip/patient/care-context/discover', handler: handleDiscover },
];

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const requestId = crypto.randomUUID();
  // ABDM's own id for this delivery. Several `on-*` replies must echo it, and
  // it is only ever available here — the body does not carry it.
  const abdmRequestId = req.headers.get('REQUEST-ID');
  const path = new URL(req.url).pathname;
  const cfg = getAbdmConfig();
  const admin = createAdminClient();

  let body: Record<string, unknown>;
  let hipId: string;

  try {
    body = await req.json();
    const accessToken = await getAccessToken(admin, cfg);
    const verified = await verifyAbdmCallback(req, cfg, accessToken);
    hipId = verified.hipId;
  } catch (err) {
    const status = err instanceof AbdmCallbackAuthError ? err.status : 400;
    console.error(`[abdm-cb][${requestId}] ${path} rejected (${status}):`, err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Rejected' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const route = ROUTES.find((r) => path.endsWith(r.suffix));
  if (!route) {
    // 202, not 404. An unrecognised callback is a flow we have not built yet,
    // and ABDM retries anything it considers failed. Acknowledging stops a
    // retry storm; the log line is what tells us to go build it.
    console.warn(`[abdm-cb][${requestId}] no handler for ${path} — acknowledged unhandled`);
    return new Response(JSON.stringify({}), { status: 202, headers: { 'Content-Type': 'application/json' } });
  }

  // Acknowledge immediately; ABDM's callback timeout is short and the work
  // (matching, registration, the outbound reply) can outlive it.
  void route.handler({ admin, cfg, requestId, abdmRequestId, hipId, body }).catch((e) => {
    console.error(`[abdm-cb][${requestId}] ${path} handler failed:`, e instanceof Error ? e.message : e);
  });

  return new Response(JSON.stringify({}), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
});
