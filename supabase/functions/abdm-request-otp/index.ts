// ABHA creation, step 1 — request an OTP to the Aadhaar-linked mobile.
// Spec section 3, Step 1. POST {abhaBase}/v3/enrollment/request/otp
//
// This is the *creation* path and it is retained deliberately: Aadhaar OTP is
// the mainstream way HMS software creates a new ABHA, and it yields an
// immediately KYC-verified 14-digit number. See section 6.3 of
// docs/abdm-production-readiness/roadmap-m1-m4-and-security-gaps.md.
//
// Aadhaar is encrypted here and never persisted, logged, or echoed back.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt, hashIdentifier } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, assertPatientInCallerClinic, enforceRateLimit } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    // Authorization before anything else — this endpoint sends a real SMS to a
    // real person, so an unauthorized caller must not get as far as ABDM.
    caller = await authenticateCaller(req);

    const body = await req.json();
    const aadhaar: string = String(body?.aadhaar ?? '');
    patientId = body?.patientId ? String(body.patientId) : null;

    if (!/^\d{12}$/.test(aadhaar)) {
      return jsonResponse(req, { error: 'A valid 12-digit Aadhaar number is required', requestId }, 400);
    }

    // clinicId is taken from the caller's JWT, never from the body (G-05).
    if (patientId) await assertPatientInCallerClinic(caller, patientId);

    // Hash, never store, the target (G-08).
    await enforceRateLimit(caller, 'otp_request', await hashIdentifier(aadhaar));

    const cfg = getAbdmConfig();
    const { accessToken, certificate } = await getAbdmCredentials(caller.admin, cfg);
    const encryptedAadhaar = await abdmEncrypt(aadhaar, certificate);

    const res = await fetch(`${cfg.abhaBase}/v3/enrollment/request/otp`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({
        txnId: '',
        // Aadhaar OTP uses the enrolment scope alone. Adding "mobile-verify"
        // makes ABDM validate this as a mobile flow and reject it.
        scope: ['abha-enrol'],
        loginHint: 'aadhaar',
        loginId: encryptedAadhaar,
        otpSystem: 'aadhaar',
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('OTP request rejected', res.status, await res.text());
    }

    const data = await res.json();
    const txnId: string | undefined = data.txnId ?? data.transactionId;
    if (!txnId) {
      throw new AbdmUpstreamError('ABDM returned no transaction id', 502, '<txnId absent>');
    }

    await writeAudit(caller, { action: 'otp_request', requestId, status: 'success', patientId });

    // txnId and a masked hint only. The upstream body is not forwarded (G-02).
    return jsonResponse(req, { txnId, message: data.message ?? null, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'otp_request',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
