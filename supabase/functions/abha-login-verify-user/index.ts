// Mobile-OTP ABHA verification, step 3 of 3 — spec section 7.4, Step 3.
// POST {abhaBase}/v3/profile/login/verify/user   (T-token header)
// then GET {abhaBase}/v3/profile/account         (X-token header)
//
// Exchanges the chosen ABHA number plus the T-token for an X-token, then spends
// that X-token server-side to fetch the profile. Both tokens die with this
// request — the client only ever sees the normalised profile.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { claimFlowSession, extendFlowSession } from '../_shared/abdmFlowSession.ts';
import { fetchAbhaProfile } from '../_shared/abhaProfile.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    const sessionId: string = String(body?.sessionId ?? '');
    const abhaNumber: string = String(body?.abhaNumber ?? '').trim();

    if (!sessionId || !abhaNumber) {
      return jsonResponse(req, { error: 'A session and ABHA number are required', requestId }, 400);
    }

    // Claimed rather than consumed: if the picked account is rejected, the
    // user can pick a different one from the same list without re-doing the OTP.
    const flow = await claimFlowSession(caller, sessionId, 'mobile-login');
    patientId = flow.patientId;
    if (!flow.tToken || !flow.txnId) {
      return jsonResponse(req, { error: 'This verification step has expired. Please start again.', requestId }, 410);
    }

    const cfg = getAbdmConfig();
    const { accessToken } = await getAbdmCredentials(caller.admin, cfg);

    const res = await fetch(`${cfg.abhaBase}/v3/profile/login/verify/user`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId, {
        'T-token': flow.tToken.startsWith('Bearer ') ? flow.tToken : `Bearer ${flow.tToken}`,
      }),
      // ABDM expects the selected number verbatim, including its mask, exactly
      // as it appeared in the accounts list from step 2.
      body: JSON.stringify({ ABHANumber: abhaNumber, txnId: flow.txnId }),
    });

    if (!res.ok) {
      // 401 here is nearly always the 5-minute T-token expiring while the
      // patient decided. Translate it into the one instruction that helps.
      if (res.status === 401 || res.status === 403) {
        await res.text();
        return jsonResponse(
          req,
          { error: 'This verification step has expired. Please start again.', requestId },
          410,
        );
      }
      throw new AbdmUpstreamError('ABHA selection rejected', res.status, await res.text());
    }

    const data = await res.json();
    const xToken: string | null = data.token ?? data.xToken ?? null;
    if (!xToken) {
      throw new AbdmUpstreamError('ABDM returned no user token', 502, '<token absent>');
    }

    // Which token the profile call actually accepted. ABDM returns two shapes
    // from `login/verify` (spec 7.4 vs 7.6.1.3): a 300s T-token that must be
    // exchanged here, or a 1800s X-token that is already the user token. When
    // it is the latter, the token minted by /verify/user is refused by the
    // profile endpoint with a *gateway-level, empty-bodied* 401 — no ABDM error
    // code, nothing in the logs to read. Observed on sandbox 2026-08-25.
    //
    // So: try the exchanged token, and on 401/403 fall back to the one from
    // step 2. Narrow on purpose — 401/403 only, and only here. Whichever
    // answers is the token retained for the card, or the card breaks the same
    // way. COLLAPSE THIS once `tokenExpiresIn` has shown which shape sandbox
    // and production each return.
    // Spec 9.0 is ENRICHMENT here, not the source of truth.
    //
    // `login/verify` already returned this account in full — ABHA number,
    // address, name, gender, DOB, status, kycVerified — and the desk has it on
    // screen. Get Profile adds only `mobileMasked`, which is the number the
    // desk just typed. So a refusal here must not fail a verification that
    // ABDM has already completed: the patient answered their OTP and the
    // account was selected.
    //
    // It is not hypothetical. On sandbox this endpoint refuses every token we
    // can present with an empty-bodied 401 — no ABDM error code, nothing
    // logged upstream — most likely a client-ID entitlement, which is an NHA
    // question and not something the front desk can wait on. See
    // session-log-2026-08-25.md 4e.
    let profile: Awaited<ReturnType<typeof fetchAbhaProfile>> | null = null;
    try {
      profile = await fetchAbhaProfile(cfg, accessToken, xToken, requestId);
    } catch (e) {
      console.warn(
        `[abdm][${requestId}] profile enrichment unavailable ` +
          `(${e instanceof AbdmUpstreamError ? e.status : 'error'}); ` +
          'continuing on the account returned by login/verify.',
      );
    }
    const effectiveXToken = xToken;

    // The T-token is spent, but the X-token is retained for one more TTL so the
    // desk can print the ABHA card and QR (spec 10/11) without a second OTP —
    // those endpoints have no other way to authenticate as the patient. The
    // token stays server-side; the client only ever holds the opaque handle.
    // If the card is not requested, the row expires on its own within minutes.
    await extendFlowSession(caller, sessionId, { tToken: null, xToken: effectiveXToken });

    await writeAudit(caller, {
      action: 'login_verify_user',
      requestId,
      status: 'success',
      patientId,
      // Recorded so the trail shows WHICH verifications ran without the
      // profile call. An assessor asking "was this identity confirmed against
      // ABDM?" needs to see that the answer is yes either way — the OTP and
      // the account selection are what confirm it — and needs to be able to
      // count how often enrichment was unavailable.
      errorMessage: profile ? null : 'profile_enrichment_unavailable',
    });

    // `profile: null` means "verified, but Get Profile did not answer". The
    // client falls back to the account it already chose. It is NOT a failure
    // and must not be rendered as one.
    return jsonResponse(req, { profile, sessionId, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'login_verify_user',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
