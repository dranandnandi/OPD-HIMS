// Find ABHA by mobile — spec section 7.6.1.1.
// POST {abhaBase}/v3/profile/account/abha/search
//
// A front-desk pre-check: does this mobile have an ABHA at all? Answering that
// before sending an OTP means reception can route straight to the Aadhaar
// creation path for patients who have none, instead of burning an OTP to find
// out. The numbers ABDM returns are already masked (91-5259-8743-XXXX).
//
// Privacy note: this discloses that a mobile number has health accounts, with
// names, and it does so without the patient authenticating. That is why it is
// rate-limited harder than the OTP endpoints and always audited — a staff
// member should not be able to sweep numbers through it.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { abdmEncrypt, hashIdentifier, normaliseMobile } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, assertPatientInCallerClinic, enforceRateLimit } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { createFlowSession } from '../_shared/abdmFlowSession.ts';

interface AbhaSearchHit {
  /**
   * ABDM's 1-based position in the result list.
   *
   * This is how the follow-up OTP step addresses an account (spec 7.6.1.2 /
   * 7.6.2.2 send `loginHint: "index"`), so it must survive to the client even
   * though it means nothing on its own. Without it the search is a dead end:
   * you can see the accounts but cannot act on one.
   */
  index: number;
  abhaNumber: string;
  name: string;
  gender: string;
  /** null = ABDM did not state it, NOT a failed KYC. */
  kycVerified: boolean | null;
  /** Which verification methods this ABHA supports, e.g. ["MOBILE_OTP"]. */
  authMethods: string[];
}

/** ABDM wraps the result in a single-element array; tolerate both shapes. */
function unwrap(payload: unknown): Record<string, unknown> {
  if (Array.isArray(payload)) {
    const first = payload[0];
    return (first && typeof first === 'object' ? first : {}) as Record<string, unknown>;
  }
  return (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
}

function mapHits(raw: unknown): AbhaSearchHit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const src = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      return {
        index: typeof src.index === 'number' ? src.index : 0,
        abhaNumber: typeof src.ABHANumber === 'string' ? src.ABHANumber : '',
        name: typeof src.name === 'string' ? src.name : '',
        gender: typeof src.gender === 'string' ? src.gender : '',
        // ABDM sends this as the string "true" here, not a boolean — and omits
        // it entirely on other endpoints, so absent must stay absent rather
        // than collapsing to "not KYC verified".
        kycVerified:
          src.kycVerified === true || src.kycVerified === 'true'
            ? true
            : src.kycVerified === false || src.kycVerified === 'false'
              ? false
              : null,
        authMethods: Array.isArray(src.authMethods)
          ? src.authMethods.filter((m): m is string => typeof m === 'string')
          : [],
      };
    })
    .filter((h) => h.abhaNumber);
}

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
    const chain = body?.chain === true;

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return jsonResponse(req, { error: 'A valid 10-digit mobile number is required', requestId }, 400);
    }

    if (patientId) await assertPatientInCallerClinic(caller, patientId);

    // Tighter than the OTP limits: no SMS is sent, so the only thing to abuse
    // here is disclosure, and enumeration is exactly the abuse to prevent.
    await enforceRateLimit(caller, 'abha_search', await hashIdentifier(mobile));

    const cfg = getAbdmConfig();
    const { accessToken, certificate } = await getAbdmCredentials(caller.admin, cfg);

    const res = await fetch(`${cfg.abhaBase}/v3/profile/account/abha/search`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({
        scope: ['search-abha'],
        mobile: await abdmEncrypt(mobile, certificate),
      }),
    });

    if (!res.ok) {
      // 404 is a legitimate "no ABHA on this number", not a failure to report.
      if (res.status === 404) {
        await res.text();
        await writeAudit(caller, { action: 'abha_search', requestId, status: 'success', patientId });
        return jsonResponse(req, { found: false, accounts: [], requestId });
      }
      throw new AbdmUpstreamError('ABHA search rejected', res.status, await res.text());
    }

    const data = unwrap(await res.json());
    const accounts = mapHits(data.ABHA);
    const txnId = typeof data.txnId === 'string' ? data.txnId : null;

    await writeAudit(caller, { action: 'abha_search', requestId, status: 'success', patientId });

    // Default stays a pure pre-check: no txnId, no session, nothing to splice.
    //
    // `chain: true` opts into the fetch-details flow (spec 7.6.1 / 7.6.2), where
    // the search txnId must survive into the OTP step. Even then the txnId
    // itself never leaves the server — the client gets an opaque handle, same
    // contract as every other ABDM flow here.
    if (chain && txnId && accounts.length > 0) {
      const sessionId = await createFlowSession(caller, 'abha-search', {
        txnId,
        tToken: null,
        xToken: null,
        patientId,
      });
      return jsonResponse(req, { found: true, accounts, sessionId, requestId });
    }

    return jsonResponse(req, { found: accounts.length > 0, accounts, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'abha_search',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
