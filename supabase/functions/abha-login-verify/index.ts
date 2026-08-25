// Mobile-OTP ABHA verification, step 2 of 3 — spec section 7.4, Step 2.
// POST {abhaBase}/v3/profile/login/verify
//
// Returns the list of ABHA accounts registered against that mobile number, plus
// a T-token valid for 300 seconds.
//
// The account list is the part people get wrong. One mobile number commonly
// carries several ABHAs — a whole family often shares the mother's or father's
// number. Auto-selecting the first entry links the wrong person's health
// account to the patient record, which is a data-integrity failure an assessor
// will specifically test for. So this endpoint returns the choices and refuses
// to decide; step 3 takes the selection.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { claimFlowSession, completeFlowSession, createFlowSession } from '../_shared/abdmFlowSession.ts';
import { normaliseAccountChoices } from '../_shared/abhaProfile.ts';

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

    // Claims an attempt but keeps the session alive, so a mistyped OTP can be
    // retried against the same txnId instead of costing the patient a new SMS.
    // The attempt cap in SQL is what bounds guessing.
    const flow = await claimFlowSession(caller, sessionId, 'mobile-login');
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
        scope: ['abha-login', 'mobile-verify'],
        authData: {
          authMethods: ['otp'],
          otp: { txnId: flow.txnId, otpValue: await abdmEncrypt(otp, certificate) },
        },
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('OTP verification rejected', res.status, await res.text());
    }

    const data = await res.json();
    const tToken: string | null = data.token ?? null;
    if (!tToken) {
      throw new AbdmUpstreamError('ABDM returned no login token', 502, '<token absent>');
    }

    // OTP accepted — the old handle has done its job either way.
    await completeFlowSession(caller, sessionId);

    const accounts = normaliseAccountChoices(data.accounts);
    if (accounts.length === 0) {
      // A verified OTP with no accounts means the mobile has no ABHA against
      // it. That is a real outcome, not an error: the desk should switch to
      // the Aadhaar creation path.
      await writeAudit(caller, { action: 'login_otp_verify', requestId, status: 'success', patientId });
      return jsonResponse(req, { accounts: [], sessionId: null, requestId });
    }

    // Fresh handle carrying the T-token into step 3.
    const nextSessionId = await createFlowSession(caller, 'mobile-login', {
      txnId: data.txnId ?? flow.txnId,
      tToken,
      xToken: null,
      patientId,
    });

    await writeAudit(caller, { action: 'login_otp_verify', requestId, status: 'success', patientId });

    // Accounts only — no T-token, no profile photos (stripped in the mapper).
    return jsonResponse(req, { sessionId: nextSessionId, accounts, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'login_otp_verify',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
