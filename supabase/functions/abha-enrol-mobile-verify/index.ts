// ABHA enrolment, step 4b — verify the mobile OTP.
// Spec section 3, Step 4b. POST {abhaBase}/v3/enrollment/auth/byAbdm
//
// Note the endpoint: `auth/byAbdm`, not `enrol/byAadhaar`. Same enrolment
// family, different verb — this one confirms control of a mobile number
// against the enrolment transaction rather than creating an account.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt, abdmBodyTimestamp } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller } from '../_shared/abdmAuthz.ts';
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
    const otp: string = String(body?.otp ?? '');

    if (!sessionId || !/^\d{4,8}$/.test(otp)) {
      return jsonResponse(req, { error: 'A session and OTP are required', requestId }, 400);
    }

    const flow = await claimFlowSession(caller, sessionId, 'enrolment');
    patientId = flow.patientId;
    if (!flow.txnId) {
      return jsonResponse(req, { error: 'This enrolment has expired. Please start again.', requestId }, 410);
    }

    const cfg = getAbdmConfig();
    const { accessToken, certificate } = await getAbdmCredentials(caller.admin, cfg);

    const res = await fetch(`${cfg.abhaBase}/v3/enrollment/auth/byAbdm`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({
        scope: ['abha-enrol', 'mobile-verify'],
        authData: {
          authMethods: ['otp'],
          otp: {
            // Body timestamp is `YYYY-MM-DD HH:mm:ss`, not the ISO-8601 the
            // headers carry. ABDM rejects the ISO form here.
            timeStamp: abdmBodyTimestamp(),
            txnId: flow.txnId,
            otpValue: await abdmEncrypt(otp, certificate),
          },
        },
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('Mobile OTP verification rejected', res.status, await res.text());
    }

    const data = await res.json();
    if (data.authResult && data.authResult !== 'success') {
      throw new AbdmUpstreamError('Mobile verification did not succeed', 400, JSON.stringify(data));
    }

    // Keep the session: address creation (3.6) chains off the same txnId.
    await extendFlowSession(caller, sessionId, { txnId: data.txnId ?? flow.txnId });

    await writeAudit(caller, { action: 'enrol_mobile_otp_verify', requestId, status: 'success', patientId });

    return jsonResponse(req, { sessionId, verified: true, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'enrol_mobile_otp_verify',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
