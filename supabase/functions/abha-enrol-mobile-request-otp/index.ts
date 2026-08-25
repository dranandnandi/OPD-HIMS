// ABHA enrolment, step 4a — verify a mobile that is NOT the Aadhaar-linked one.
// Spec section 3, Step 4a. POST {abhaBase}/v3/enrollment/request/otp
//
// Why this exists: Aadhaar OTP goes to whatever mobile UIDAI has on file, which
// is frequently not the number the patient gives at reception — an old SIM, a
// relative's phone, a number changed years ago. Without this step the new ABHA
// carries a mobile the clinic cannot reach, and `mobile_verified` on the
// patient record would be claiming something untrue.
//
// Distinct from abha-login-request-otp: this is the *enrolment* API family
// (/v3/enrollment/*, scope ["abha-enrol","mobile-verify"]) and it chains off
// the enrolment txnId. The login family cannot be substituted here.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt, hashIdentifier, normaliseMobile } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, enforceRateLimit } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { claimFlowSession, extendFlowSession } from '../_shared/abdmFlowSession.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    const sessionId: string = String(body?.sessionId ?? '');
    const mobile = normaliseMobile(body?.mobile);

    if (!sessionId) {
      return jsonResponse(req, { error: 'A session is required', requestId }, 400);
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return jsonResponse(req, { error: 'A valid 10-digit mobile number is required', requestId }, 400);
    }

    const flow = await claimFlowSession(caller, sessionId, 'enrolment');
    patientId = flow.patientId;
    if (!flow.txnId) {
      return jsonResponse(req, { error: 'This enrolment has expired. Please start again.', requestId }, 410);
    }

    await enforceRateLimit(caller, 'login_otp_request', await hashIdentifier(mobile));

    const cfg = getAbdmConfig();
    const { accessToken, certificate } = await getAbdmCredentials(caller.admin, cfg);

    const res = await fetch(`${cfg.abhaBase}/v3/enrollment/request/otp`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({
        // txnId chains this back to the enrol call — omitting it makes ABDM
        // treat the request as a brand new enrolment.
        txnId: flow.txnId,
        scope: ['abha-enrol', 'mobile-verify'],
        loginHint: 'mobile',
        loginId: await abdmEncrypt(mobile, certificate),
        otpSystem: 'abdm',
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('Mobile OTP request rejected', res.status, await res.text());
    }

    const data = await res.json();
    // ABDM issues a new txnId for this leg; the old one is spent.
    const nextTxnId: string = data.txnId ?? flow.txnId;
    await extendFlowSession(caller, sessionId, { txnId: nextTxnId });

    await writeAudit(caller, { action: 'enrol_mobile_otp_request', requestId, status: 'success', patientId });

    return jsonResponse(req, { sessionId, message: data.message ?? null, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'enrol_mobile_otp_request',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
