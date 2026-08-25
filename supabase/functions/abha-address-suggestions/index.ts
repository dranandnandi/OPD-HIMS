// ABHA enrolment, step 6a — fetch ABHA address suggestions.
// Spec section 3, Step 6a. GET {abhaBase}/v3/enrollment/enrol/suggestion
//
// Without an ABHA address the new account is barely usable: it is the handle
// (name@sbx / name@abdm) that M2/M3 care-context linking addresses records to.
// An ABHA number alone is not enough for the later milestones, which is why
// this is part of finishing M1 rather than a cosmetic extra.
//
// The transaction id travels in a `Transaction_Id` **header** here, not in the
// body — this endpoint is a GET and has no body at all.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { getAccessToken, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse } from '../_shared/abdmHttp.ts';
import { claimFlowSession, extendFlowSession } from '../_shared/abdmFlowSession.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    const sessionId: string = String(body?.sessionId ?? '');
    if (!sessionId) {
      return jsonResponse(req, { error: 'A session is required', requestId }, 400);
    }

    const flow = await claimFlowSession(caller, sessionId, 'enrolment');
    if (!flow.txnId) {
      return jsonResponse(req, { error: 'This enrolment has expired. Please start again.', requestId }, 410);
    }

    const cfg = getAbdmConfig();
    // No certificate needed: nothing on this call is encrypted.
    const accessToken = await getAccessToken(caller.admin, cfg);

    const res = await fetch(`${cfg.abhaBase}/v3/enrollment/enrol/suggestion`, {
      method: 'GET',
      headers: abdmHeaders(cfg, accessToken, requestId, {
        Transaction_Id: flow.txnId,
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('ABHA address suggestions failed', res.status, await res.text());
    }

    const data = await res.json();
    const suggestions: string[] = Array.isArray(data.abhaAddressList)
      ? data.abhaAddressList.filter((s: unknown): s is string => typeof s === 'string')
      : [];

    // ABDM may rotate the txnId on this call; keep whichever it just gave us.
    await extendFlowSession(caller, sessionId, { txnId: data.txnId ?? flow.txnId });

    return jsonResponse(req, { sessionId, suggestions, requestId });
  } catch (err) {
    return errorResponse(req, err, requestId);
  }
});
