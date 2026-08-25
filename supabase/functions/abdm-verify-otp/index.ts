// ABHA creation, step 2 — verify the Aadhaar OTP and enrol.
// Spec section 3, Step 3. POST {abhaBase}/v3/enrollment/enrol/byAadhaar
//
// G-02 lived here: the previous version returned `_raw: abdmData` to the
// browser, handing the patient's ABHA X-token, full KYC profile and base64
// photo to the client — where the modal then console.log'd the lot. The X-token
// is a bearer credential for that patient's ABHA profile; it now stays on the
// server and only a normalised profile crosses the wire.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt, abdmBodyTimestamp, normaliseMobile } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, assertPatientInCallerClinic } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { normaliseAbhaProfile, fetchAbhaProfile } from '../_shared/abhaProfile.ts';
import { createFlowSession } from '../_shared/abdmFlowSession.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    const txnId: string = String(body?.txnId ?? '');
    const otp: string = String(body?.otp ?? '');
    patientId = body?.patientId ? String(body.patientId) : null;
    const mobile = normaliseMobile(body?.mobile);

    if (!txnId || !/^\d{4,8}$/.test(otp)) {
      return jsonResponse(req, { error: 'A transaction id and OTP are required', requestId }, 400);
    }

    if (patientId) await assertPatientInCallerClinic(caller, patientId);

    const cfg = getAbdmConfig();
    const { accessToken, certificate } = await getAbdmCredentials(caller.admin, cfg);

    // Spec: RSA/ECB/OAEPWithSHA-1AndMGF1Padding over the raw OTP — no pre-hashing.
    const encryptedOtp = await abdmEncrypt(otp, certificate);

    const otpPayload: Record<string, string> = {
      timeStamp: abdmBodyTimestamp(),
      txnId,
      otpValue: encryptedOtp,
    };
    if (mobile) otpPayload.mobile = mobile;

    const res = await fetch(`${cfg.abhaBase}/v3/enrollment/enrol/byAadhaar`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({
        authData: { authMethods: ['otp'], otp: otpPayload },
        consent: { code: 'abha-enrollment', version: '1.4' },
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('OTP verification rejected', res.status, await res.text());
    }

    const data = await res.json();

    // ABDM has used several names for the user token across environments.
    const xToken: string | null =
      data.tokens?.token ?? data.token ?? data.xToken ?? data['X-token'] ??
      data.jwtResponse?.token ?? null;

    const succeeded =
      data.authResult === 'success' || Boolean(xToken) || Boolean(data.ABHAProfile);
    if (!succeeded) {
      throw new AbdmUpstreamError('OTP verification did not succeed', 400, JSON.stringify(data));
    }

    // Prefer the profile ABDM already returned; only spend a second round-trip
    // when the enrol response did not carry one.
    let profile = normaliseAbhaProfile(data.ABHAProfile ?? data);
    if (!profile.abhaNumber && xToken) {
      profile = await fetchAbhaProfile(cfg, accessToken, xToken, requestId);
    }
    if (!profile.abhaNumber) {
      throw new AbdmUpstreamError('ABDM returned no ABHA number', 502, '<profile absent>');
    }

    await writeAudit(caller, { action: 'otp_verify', requestId, status: 'success', patientId });

    // The enrolment does not end here. Two steps still chain off this txnId:
    // mobile verification (3.4) when the Aadhaar-linked number is not the one
    // the clinic has, and ABHA address creation (3.6) — without which the new
    // account has no handle for M2/M3 linking. Both are identified upstream by
    // the txnId, so it is held server-side and the client gets a handle.
    const sessionId = await createFlowSession(caller, 'enrolment', {
      txnId: data.txnId ?? txnId,
      tToken: null,
      xToken,
      patientId,
    });

    // No `_raw`, no X-token. The client gets what it needs to render the
    // consent screen and nothing that could be replayed against ABDM.
    return jsonResponse(req, {
      sessionId,
      profile,
      // Drives the follow-up steps in the UI rather than making it guess.
      needsAbhaAddress: !profile.abhaAddress,
      requestId,
    });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'otp_verify',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
