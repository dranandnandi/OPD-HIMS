// Fetch ABHA details — step 3 of 3. Spec §7.6.1.3 (mobile) / §7.6.2.3 (Aadhaar).
//
//   POST {abhaBase}/v3/profile/login/verify
//
// Completes VRFY_ABHA_301–305 and VRFY_ABHA_401–405. Same endpoint as the
// mobile-OTP login (§7.4) — only the scope differs, carrying 'search-abha' and
// the verification method the OTP was sent under.
//
// **This flow returns the X-token directly**, unlike §7.4, which returns a
// 300-second T-token that must be exchanged on `/verify/user`. There is no
// account-selection step here because the account was already chosen by index
// at the OTP step. Confirmed against the spec's own response samples: §7.6.1.3
// shows `expiresIn: 1800`, §7.4 shows `300`.
//
// So the profile comes straight back, and — as in `abha-login-verify-user` —
// Get Profile is enrichment rather than a gate: the accounts payload already
// carries everything we store.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError, AbdmResponseShapeError } from '../_shared/abdmSession.ts';
import { authenticateCaller } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { claimFlowSession, completeFlowSession, createFlowSession } from '../_shared/abdmFlowSession.ts';
import { fetchAbhaProfile, normaliseAccountChoices, type AbhaProfile } from '../_shared/abhaProfile.ts';

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

    const flow = await claimFlowSession(caller, sessionId, 'abha-search');
    patientId = flow.patientId;
    if (!flow.txnId) {
      return jsonResponse(req, { error: 'This verification step has expired. Please start again.', requestId }, 410);
    }

    const cfg = getAbdmConfig();
    const { accessToken, certificate } = await getAbdmCredentials(caller.admin, cfg);

    const res = await fetch(`${cfg.abhaBase}/v3/profile/login/verify`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({
        // Must mirror the scope the OTP was requested under, or ABDM rejects
        // the pair.
        scope:
          otpSystem === 'aadhaar'
            ? ['abha-login', 'aadhaar-verify']
            : ['abha-login', 'mobile-verify'],
        authData: {
          authMethods: ['otp'],
          otp: { txnId: flow.txnId, otpValue: await abdmEncrypt(otp, certificate) },
        },
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('Fetch-details OTP verification rejected', res.status, await res.text());
    }

    const data = await res.json();
    await completeFlowSession(caller, sessionId);

    const xToken: string | null = data.token ?? null;
    const accounts = normaliseAccountChoices(data.accounts);

    // The account list is authoritative for what we store — Get Profile only
    // adds the masked mobile. Attempted, never required. See §4f of
    // session-log-2026-08-25.md for why this endpoint cannot be relied on.
    // Narrowed to AbhaProfile deliberately: `status` from the accounts payload
    // is picker metadata (ACTIVE / DEACTIVATED), not part of the record we
    // store, and letting it leak into the profile shape would make the two
    // sources structurally different for no benefit.
    // ############ WHY kycVerified IS NULL, NOT false, ON THIS PATH ##########
    //
    // The accounts payload for §7.6.1.3 / §7.6.2.3 is THINNER than §7.4's. Per
    // the spec's own sample it carries only ABHANumber, preferredAbhaAddress,
    // name, status and profilePhoto — **no gender, no dob, no kycVerified**.
    // Confirmed against sandbox 2026-08-27.
    //
    // Reporting `kycVerified: false` for a field ABDM never sent would be a
    // false negative on a KYC flag: reception would read "this ABHA is not
    // KYC-verified" when the truth is "ABDM did not say". For an identity
    // assurance flag that distinction matters, so unknown is null.
    //
    // gender/dob stay as empty strings, where absent already reads as unknown.
    // #######################################################################
    const chosen = accounts[0];
    let profile: AbhaProfile | null = chosen
      ? {
          abhaNumber: chosen.abhaNumber,
          abhaAddress: chosen.abhaAddress,
          name: chosen.name,
          gender: chosen.gender,
          dob: chosen.dob,
          mobileMasked: '',
          kycVerified: null,
        }
      : null;

    let enriched = false;
    if (xToken) {
      try {
        profile = await fetchAbhaProfile(cfg, accessToken, xToken, requestId);
        enriched = true;
      } catch {
        console.warn(
          `[abdm][${requestId}] profile enrichment unavailable after fetch-verify; ` +
            'using the account payload.',
        );
      }
    }

    if (!profile) {
      throw new AbdmResponseShapeError(
        'Fetch-details verification returned no ABHA details',
        '<no accounts in the verify response>',
      );
    }

    // Retained for one TTL so the QR/card can be produced without a second OTP,
    // exactly as the mobile-login path does. Expires on its own if unused.
    const nextSessionId = xToken
      ? await createFlowSession(caller, 'mobile-login', {
          txnId: data.txnId ?? flow.txnId,
          tToken: null,
          xToken,
          patientId,
        })
      : null;

    await writeAudit(caller, {
      action: 'fetch_otp_verify',
      requestId,
      status: 'success',
      patientId,
      errorMessage: enriched ? null : 'profile_enrichment_unavailable',
    });

    return jsonResponse(req, { profile, sessionId: nextSessionId, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'fetch_otp_verify',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
