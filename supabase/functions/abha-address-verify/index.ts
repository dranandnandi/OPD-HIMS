// ABHA **address** verification, step 3 of 3 — spec §14.1/§14.2 Step 3.
//
//   POST {phrBase}/login/abha/verify
//
// Completes VRFY_ABHA_102 and VRFY_ABHA_202, the last mandatory M1 gap.
//
// This is the ONE flow where FAQ v1.4 Q21's PHR profile endpoints are correct:
// the X-token minted here belongs to the `abha-address` family, so its profile
// lives at `{phrBase}/login/profile/abha-profile`, NOT at
// `{abhaBase}/v3/profile/account`. `abhaEndpoints(cfg, 'abha-address')` was
// stubbed on 2026-08-26 for exactly this and is finally reachable.
//
// Q21's whole point is that mixing the two families produces a misleading
// "X-token expired" — so this is the one place that must NOT reuse
// fetchAbhaProfile().

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError, AbdmResponseShapeError } from '../_shared/abdmSession.ts';
import { authenticateCaller } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { claimFlowSession, completeFlowSession, createFlowSession } from '../_shared/abdmFlowSession.ts';
import { abhaEndpoints, normaliseAbhaProfile, xTokenHeader, type AbhaProfile } from '../_shared/abhaProfile.ts';

const OTP_SYSTEMS = ['abdm', 'aadhaar'] as const;

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    const sessionId = String(body?.sessionId ?? '');
    const otp = String(body?.otp ?? '');
    const otpSystem = String(body?.otpSystem ?? 'abdm');

    if (!sessionId || !otp) {
      return jsonResponse(req, { error: 'A session and OTP are required', requestId }, 400);
    }
    if (!OTP_SYSTEMS.includes(otpSystem as typeof OTP_SYSTEMS[number])) {
      return jsonResponse(req, { error: 'otpSystem must be abdm or aadhaar', requestId }, 400);
    }

    const flow = await claimFlowSession(caller, sessionId, 'abha-address');
    patientId = flow.patientId;
    if (!flow.txnId) {
      return jsonResponse(req, { error: 'This verification step has expired. Please start again.', requestId }, 410);
    }

    const cfg = getAbdmConfig();
    const { accessToken, certificate } = await getAbdmCredentials(caller.admin, cfg);

    const res = await fetch(`${cfg.phrBase}/login/abha/verify`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({
        // Must mirror the request/otp scope exactly.
        scope: ['abha-address-login', otpSystem === 'aadhaar' ? 'aadhaar-verify' : 'mobile-verify'],
        authData: {
          authMethods: ['otp'],
          otp: { txnId: flow.txnId, otpValue: await abdmEncrypt(otp, certificate) },
        },
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('ABHA address verification rejected', res.status, await res.text());
    }

    const data = await res.json();
    await completeFlowSession(caller, sessionId);

    // Spec 14.1 Step 3 nests the token under `tokens`, unlike the ABHA-family
    // flows which return it at the top level. Both tolerated.
    const xToken: string | null = data.tokens?.token ?? data.token ?? data.xToken ?? null;

    // Whatever the verify response already carries is the baseline. Profile
    // enrichment is attempted on top and is never a gate — same posture as
    // every other flow here, after Get Profile proved unreliable.
    // The details live under `users[]` here — NOT `ABHAProfile` as in the
    // enrolment response, nor at the top level as in the login flows. A third
    // shape for the same information; reading the wrong one yields an empty
    // profile and a misleading 502.
    const user = Array.isArray(data.users) && data.users.length ? data.users[0] : null;
    let profile: AbhaProfile = normaliseAbhaProfile(user ?? data.ABHAProfile ?? data.profile ?? data);
    let enriched = false;

    if (xToken) {
      const urls = abhaEndpoints(cfg, 'abha-address');
      try {
        const pRes = await fetch(urls.profile, {
          method: 'GET',
          headers: abdmHeaders(cfg, accessToken, requestId, xTokenHeader(xToken)),
        });
        if (pRes.ok) {
          profile = normaliseAbhaProfile(await pRes.json());
          enriched = true;
        } else {
          console.warn(`[abdm][${requestId}] abha-address profile ${pRes.status} at ${urls.profile}`);
        }
      } catch (e) {
        console.warn(`[abdm][${requestId}] abha-address profile fetch failed:`, e instanceof Error ? e.message : e);
      }
    }

    if (!profile.abhaAddress && !profile.abhaNumber) {
      throw new AbdmResponseShapeError(
        'ABHA address verification returned no ABHA details',
        '<profile absent: neither users[] nor ABHAProfile carried an address or number>',
      );
    }

    // Retained one TTL so the address-family QR/card can be produced without a
    // second OTP, mirroring the mobile-login path.
    const nextSessionId = xToken
      ? await createFlowSession(caller, 'abha-address', {
          txnId: data.txnId ?? flow.txnId,
          tToken: null,
          xToken,
          patientId,
        })
      : null;

    await writeAudit(caller, {
      action: 'abha_address_verify',
      requestId,
      status: 'success',
      patientId,
      errorMessage: enriched ? null : 'profile_enrichment_unavailable',
    });

    return jsonResponse(req, { profile, sessionId: nextSessionId, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'abha_address_verify',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
