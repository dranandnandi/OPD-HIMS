// Mobile-OTP ABHA verification, step 1 of 3 — spec section 7.4, Step 1.
// POST {abhaBase}/v3/profile/login/request/otp
//
// This is the primary OPD path: most walk-in patients already have an ABHA and
// need it verified, not created. It never touches Aadhaar.
//
// Note this is a different API family from enrolment: base path
// /v3/profile/login/*, and scope ["abha-login","mobile-verify"] rather than
// ["abha-enrol"]. Reusing the enrolment scope here fails upstream.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt, hashIdentifier, normaliseMobile } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, assertPatientInCallerClinic, enforceRateLimit } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { createFlowSession, purgeExpiredFlowSessions } from '../_shared/abdmFlowSession.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    patientId = body?.patientId ? String(body.patientId) : null;
    const mobile = normaliseMobile(body?.mobile);

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return jsonResponse(req, { error: 'A valid 10-digit mobile number is required', requestId }, 400);
    }

    if (patientId) await assertPatientInCallerClinic(caller, patientId);

    // Per-target throttle is the anti-SMS-bombing control (G-08).
    await enforceRateLimit(caller, 'login_otp_request', await hashIdentifier(mobile));

    const cfg = getAbdmConfig();
    const { accessToken, certificate } = await getAbdmCredentials(caller.admin, cfg);

    const res = await fetch(`${cfg.abhaBase}/v3/profile/login/request/otp`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({
        scope: ['abha-login', 'mobile-verify'],
        loginHint: 'mobile',
        loginId: await abdmEncrypt(mobile, certificate),
        otpSystem: 'abdm',
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('Login OTP request rejected', res.status, await res.text());
    }

    const data = await res.json();
    const txnId: string | undefined = data.txnId;
    if (!txnId) {
      throw new AbdmUpstreamError('ABDM returned no transaction id', 502, '<txnId absent>');
    }

    // txnId is held server-side rather than round-tripped through the client,
    // so the browser cannot substitute a transaction it did not initiate.
    const sessionId = await createFlowSession(caller, 'mobile-login', {
      txnId,
      tToken: null,
      xToken: null,
      patientId,
    });

    await writeAudit(caller, { action: 'login_otp_request', requestId, status: 'success', patientId });
    void purgeExpiredFlowSessions(caller);

    return jsonResponse(req, {
      sessionId,
      // ABDM's own masked confirmation, e.g. "OTP sent to ... ending ******9260".
      message: data.message ?? null,
      requestId,
    });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'login_otp_request',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
