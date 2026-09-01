// Fetch ABHA details — step 2 of 3. Spec §7.6.1.2 (mobile) and §7.6.2.2 (Aadhaar).
//
//   POST {abhaBase}/v3/profile/login/request/otp
//
// Covers TWO mandatory M1 test groups with one implementation, because the only
// real difference between them is where the OTP is sent:
//
//   VRFY_ABHA_301–305  Fetch ABHA details using mobile   -> otpSystem 'abdm'
//   VRFY_ABHA_401–405  Fetch ABHA details using Aadhaar  -> otpSystem 'aadhaar'
//
// `otpSystem: 'abdm'` sends the OTP to the ABHA's *communication* number;
// `'aadhaar'` sends it to the **Aadhaar-registered** number, which may be a
// different phone the patient does not have on them. That distinction is the
// whole point of having both, and it is what reception has to be told when the
// SMS does not arrive.
//
// The account is addressed by its `index` from the search — ABDM sends
// `loginHint: "index"` with the index RSA-encrypted like any other loginId, not
// by ABHA number. The search txnId must be the same one, which is why this
// takes a session handle rather than loose parameters.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt, hashIdentifier } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, enforceRateLimit } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { claimFlowSession, createFlowSession } from '../_shared/abdmFlowSession.ts';

const OTP_SYSTEMS = ['abdm', 'aadhaar'] as const;
type OtpSystem = (typeof OTP_SYSTEMS)[number];

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    const sessionId = String(body?.sessionId ?? '');
    const index = Number(body?.index);
    const otpSystem = String(body?.otpSystem ?? 'abdm') as OtpSystem;

    if (!sessionId || !Number.isInteger(index) || index < 1) {
      return jsonResponse(req, { error: 'A search session and account index are required', requestId }, 400);
    }
    if (!OTP_SYSTEMS.includes(otpSystem)) {
      return jsonResponse(req, { error: 'otpSystem must be abdm or aadhaar', requestId }, 400);
    }

    const flow = await claimFlowSession(caller, sessionId, 'abha-search');
    patientId = flow.patientId;
    if (!flow.txnId) {
      return jsonResponse(req, { error: 'This search has expired. Please search again.', requestId }, 410);
    }

    // Rate limited on the SEARCH transaction, not the mobile: at this point we
    // hold no identifier for the patient, only an opaque index into a list. The
    // txnId is the closest thing to a target, and capping per-txn stops one
    // search being walked account by account to spray OTPs.
    await enforceRateLimit(caller, 'fetch_otp_request', await hashIdentifier(flow.txnId));

    const cfg = getAbdmConfig();
    const { accessToken, certificate } = await getAbdmCredentials(caller.admin, cfg);

    const res = await fetch(`${cfg.abhaBase}/v3/profile/login/request/otp`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({
        // 'search-abha' must stay in scope: this OTP belongs to the search
        // transaction, not to a fresh login.
        scope:
          otpSystem === 'aadhaar'
            ? ['abha-login', 'search-abha', 'aadhaar-verify']
            : ['abha-login', 'search-abha', 'mobile-verify'],
        loginHint: 'index',
        // The index is encrypted like any other loginId. It looks pointless —
        // it is a small integer — but ABDM rejects it in clear text.
        loginId: await abdmEncrypt(String(index), certificate),
        otpSystem,
        txnId: flow.txnId,
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('Fetch-details OTP request rejected', res.status, await res.text());
    }

    const data = await res.json();

    // ABDM rotates the txnId between legs, so the verify step must use the new
    // one. A fresh handle carries it rather than mutating the search session,
    // which stays claimable if the operator picks a different account.
    const nextSessionId = await createFlowSession(caller, 'abha-search', {
      txnId: data.txnId ?? flow.txnId,
      tToken: null,
      xToken: null,
      patientId,
    });

    await writeAudit(caller, { action: 'fetch_otp_request', requestId, status: 'success', patientId });

    return jsonResponse(req, {
      sessionId: nextSessionId,
      // ABDM's own masked confirmation — and the only way the desk learns the
      // OTP went to an Aadhaar number they were not expecting.
      message: data.message ?? null,
      otpSystem,
      requestId,
    });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'fetch_otp_request',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
