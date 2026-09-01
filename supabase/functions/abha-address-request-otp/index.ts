// ABHA **address** verification, step 2 of 3 — spec §14.1/§14.2 Step 2.
//
//   POST {phrBase}/login/abha/request/otp
//
// One implementation, two mandatory M1 tests, exactly as with fetch-details:
//
//   VRFY_ABHA_202  via mobile OTP   -> otpSystem 'abdm',    scope mobile-verify
//   VRFY_ABHA_102  via Aadhaar OTP  -> otpSystem 'aadhaar', scope aadhaar-verify
//
// Note the scope: **`abha-address-login`**, not `abha-login`. Different flow,
// different scope token — reusing the login scope here is rejected.
//
// The ABHA address IS encrypted at this step, even though step 1 sends it in
// clear. That asymmetry is ABDM's, not ours: step 1 is a lookup, step 2
// authenticates.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt, hashIdentifier } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, assertPatientInCallerClinic, enforceRateLimit } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { createFlowSession } from '../_shared/abdmFlowSession.ts';

const ABHA_ADDRESS = /^[A-Za-z0-9._-]{1,}@[A-Za-z0-9]+$/;
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
    patientId = body?.patientId ? String(body.patientId) : null;
    // NOT lowercased. ABHA addresses are user-chosen and routinely contain
    // capitals — "Jain.nitesh123@sbx", "Varun2001@sbx". Normalising the case
    // would silently mangle those into an address ABDM does not hold, and the
    // failure would look like "no such ABHA" rather than a bug on our side.
    const abhaAddress = String(body?.abhaAddress ?? '').trim();
    const otpSystem = String(body?.otpSystem ?? 'abdm') as OtpSystem;

    if (!ABHA_ADDRESS.test(abhaAddress)) {
      return jsonResponse(req, { error: 'A valid ABHA address is required', requestId }, 400);
    }
    if (!OTP_SYSTEMS.includes(otpSystem)) {
      return jsonResponse(req, { error: 'otpSystem must be abdm or aadhaar', requestId }, 400);
    }

    if (patientId) await assertPatientInCallerClinic(caller, patientId);

    // Per-address cap: this one sends a real SMS, so it is the anti-bombing
    // control for the address flow (G-08).
    await enforceRateLimit(caller, 'abha_address_otp_request', await hashIdentifier(abhaAddress));

    const cfg = getAbdmConfig();
    const { accessToken, certificate } = await getAbdmCredentials(caller.admin, cfg);

    const res = await fetch(`${cfg.phrBase}/login/abha/request/otp`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({
        scope: ['abha-address-login', otpSystem === 'aadhaar' ? 'aadhaar-verify' : 'mobile-verify'],
        loginHint: 'abha-address',
        loginId: await abdmEncrypt(abhaAddress, certificate),
        otpSystem,
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('ABHA address OTP request rejected', res.status, await res.text());
    }

    const data = await res.json();

    // 'abha-address' flow, kept distinct from 'mobile-login' so a handle from
    // one cannot be spent on the other — claimFlowSession makes the flow part
    // of the SQL predicate.
    const sessionId = await createFlowSession(caller, 'abha-address', {
      txnId: data.txnId ?? null,
      tToken: null,
      xToken: null,
      patientId,
    });

    await writeAudit(caller, { action: 'abha_address_otp_request', requestId, status: 'success', patientId });

    return jsonResponse(req, {
      sessionId,
      message: data.message ?? null,
      otpSystem,
      requestId,
    });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'abha_address_otp_request',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
