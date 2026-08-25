// ABHA enrolment, step 6b — create the ABHA address.
// Spec section 3, Step 6b. POST {abhaBase}/v3/enrollment/enrol/abha-address
//
// `preferred: 1` marks it as the patient's primary address. The spec accepts
// only that value, so it is hardcoded rather than exposed — an OPD desk has no
// reason to create a non-preferred secondary address.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { getAccessToken, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, assertPatientInCallerClinic } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { claimFlowSession, completeFlowSession } from '../_shared/abdmFlowSession.ts';

/**
 * ABDM address rules: lowercase letters, digits, dot and underscore, starting
 * with a letter. Validating here turns a confusing upstream rejection into a
 * message the person at the desk can act on.
 */
const ABHA_ADDRESS_RE = /^[a-z][a-z0-9._]{3,29}$/;

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    const sessionId: string = String(body?.sessionId ?? '');
    const abhaAddress: string = String(body?.abhaAddress ?? '').trim().toLowerCase();

    if (!sessionId) {
      return jsonResponse(req, { error: 'A session is required', requestId }, 400);
    }
    if (!ABHA_ADDRESS_RE.test(abhaAddress)) {
      return jsonResponse(
        req,
        {
          error:
            'ABHA address must be 4–30 characters, start with a letter, and use only lowercase letters, numbers, dot or underscore.',
          requestId,
        },
        400,
      );
    }

    const flow = await claimFlowSession(caller, sessionId, 'enrolment');
    patientId = flow.patientId;
    if (!flow.txnId) {
      return jsonResponse(req, { error: 'This enrolment has expired. Please start again.', requestId }, 410);
    }

    const cfg = getAbdmConfig();
    const accessToken = await getAccessToken(caller.admin, cfg);

    const res = await fetch(`${cfg.abhaBase}/v3/enrollment/enrol/abha-address`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId),
      body: JSON.stringify({ txnId: flow.txnId, abhaAddress, preferred: 1 }),
    });

    if (!res.ok) {
      const upstream = await res.text();
      // 409/400 here is nearly always "already taken" — the suggestion list
      // goes stale as soon as someone else claims one.
      if (res.status === 409 || res.status === 400) {
        console.error(`[abdm][${requestId}] address rejected:`, upstream);
        return jsonResponse(
          req,
          { error: 'That ABHA address is not available. Please choose another.', requestId },
          409,
        );
      }
      throw new AbdmUpstreamError('ABHA address creation failed', res.status, upstream);
    }

    const data = await res.json();
    const created: string =
      (typeof data.preferredAbhaAddress === 'string' && data.preferredAbhaAddress) ||
      (typeof data.abhaAddress === 'string' && data.abhaAddress) ||
      (typeof data.healthId === 'string' && data.healthId) ||
      abhaAddress;

    // Keep the patient record in step with ABDM. Guarded on clinic as defence
    // in depth, and only when we know which patient this enrolment was for.
    if (patientId) {
      await assertPatientInCallerClinic(caller, patientId);
      const { error } = await caller.admin
        .from('patients')
        .update({ abha_address: created })
        .eq('id', patientId)
        .eq('clinic_id', caller.clinicId);
      if (error) {
        // The address exists at ABDM either way; failing the whole call here
        // would tell the user it did not, which is worse than a stale column.
        console.error(`[abdm][${requestId}] abha_address write failed:`, error.message);
      }
    }

    // End of the enrolment chain — nothing further needs the txnId.
    await completeFlowSession(caller, sessionId);

    await writeAudit(caller, { action: 'abha_address_create', requestId, status: 'success', patientId });

    return jsonResponse(req, { abhaAddress: created, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'abha_address_create',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
