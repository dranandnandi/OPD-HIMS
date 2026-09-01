// ABHA **address** verification, step 1 of 3 — spec §14.1 Step 1.
//
//   POST {phrBase}/login/abha/search
//
// Closes the last mandatory M1 gap: VRFY_ABHA_102 (via Aadhaar OTP) and
// VRFY_ABHA_202 (via mobile OTP). Both start here.
//
// ############ THIS IS THE PHR HOST, NOT THE ABHA HOST ######################
//
// `phrBase` — `https://abhasbx.abdm.gov.in/abha/api/v3/phr/web` on sandbox —
// has been defined in abdmConfig.ts since Phase 1 and used by nothing. This is
// the flow it was for. Everything else in this project lives on `abhaBase`, and
// on 2026-08-26 an attempt to route the mobile-login profile fetch through
// `phrBase` failed with 400/404 precisely because that token belongs to the
// other family. Do not generalise from this function to the others.
// ###########################################################################
//
// Unlike search-by-mobile, this returns which auth methods the account actually
// supports — and which are BLOCKED. That matters: offering a patient an OTP
// route ABDM has blocked produces a failure the desk cannot explain, so the UI
// should only offer what comes back in `authMethods`.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { hashIdentifier } from '../_shared/abdmCrypto.ts';
import { getAbdmCredentials, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, assertPatientInCallerClinic, enforceRateLimit } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { maskMobile } from '../_shared/abhaProfile.ts';

/** `user@sbx` / `user@abdm`. Deliberately permissive on the domain part. */
const ABHA_ADDRESS = /^[A-Za-z0-9._-]{1,}@[A-Za-z0-9]+$/;

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

    if (!ABHA_ADDRESS.test(abhaAddress)) {
      return jsonResponse(req, { error: 'A valid ABHA address is required, e.g. name@abdm', requestId }, 400);
    }

    if (patientId) await assertPatientInCallerClinic(caller, patientId);

    // Same reasoning as abha-search: no OTP is sent, so the only thing to abuse
    // is disclosure — this reveals a person's name and masked mobile from an
    // address alone. Enumeration is exactly what to prevent.
    await enforceRateLimit(caller, 'abha_address_search', await hashIdentifier(abhaAddress));

    const cfg = getAbdmConfig();
    const { accessToken } = await getAbdmCredentials(caller.admin, cfg);

    const res = await fetch(`${cfg.phrBase}/login/abha/search`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      // Not encrypted: unlike Aadhaar or mobile, the ABHA address is the
      // patient's public handle and the spec sends it in clear here.
      body: JSON.stringify({ abhaAddress }),
    });

    if (!res.ok) {
      if (res.status === 404) {
        await res.text();
        await writeAudit(caller, { action: 'abha_address_search', requestId, status: 'success', patientId });
        return jsonResponse(req, { found: false, requestId });
      }
      throw new AbdmUpstreamError('ABHA address search rejected', res.status, await res.text());
    }

    const data = await res.json();

    await writeAudit(caller, { action: 'abha_address_search', requestId, status: 'success', patientId });

    return jsonResponse(req, {
      found: true,
      abhaAddress: typeof data.abhaAddress === 'string' ? data.abhaAddress : abhaAddress,
      // ABDM already masks this one.
      abhaNumber: typeof data.healthIdNumber === 'string' ? data.healthIdNumber : '',
      name: typeof data.fullName === 'string' ? data.fullName : '',
      status: typeof data.status === 'string' ? data.status : 'UNKNOWN',
      // ABDM already masks this ("******9340"). Passed through as-is; masking
      // an already-masked value would only corrupt it. Re-masked defensively
      // only if a future response ever arrives unmasked.
      mobileMasked:
        typeof data.mobile === 'string'
          ? (data.mobile.includes('*') ? data.mobile : maskMobile(data.mobile))
          : '',
      /** Offer ONLY these to the operator. */
      authMethods: Array.isArray(data.authMethods)
        ? data.authMethods.filter((m: unknown): m is string => typeof m === 'string')
        : [],
      /** Shown so the desk can explain why a route is unavailable. */
      blockedAuthMethods: Array.isArray(data.blockedAuthMethods)
        ? data.blockedAuthMethods.filter((m: unknown): m is string => typeof m === 'string')
        : [],
      requestId,
    });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'abha_address_search',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
