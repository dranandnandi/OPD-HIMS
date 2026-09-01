// M2 §4.3.3 — announce a visit's care contexts to ABDM.
//
//   POST {gateway}/hip/v3/link/carecontext
//   headers: X-HIP-ID, X-CM-ID, X-LINK-TOKEN
//
// This is the point at which a clinical event becomes visible in the patient's
// ABHA app. Called after a visit is completed, not while it is being written.
//
// ############ TWO IRREVERSIBLE THINGS HAPPEN HERE ##########################
//
// 1. **Care contexts cannot be unlinked** (FAQ Q33). A wrong reference is
//    permanent — there is no delete, no rename, no withdraw.
// 2. **Announcing twice is an error**, ABDM-1090 "Duplicate HIP link request",
//    so the reference must be deterministic and the row must be the guard.
//
// Hence: nothing is announced that is not already recorded as a care context,
// and anything already `linked` is skipped rather than re-sent.
// ###########################################################################
//
// Response is 202. Confirmation arrives on the callback, so a success here
// means "accepted", never "linked" — the rows stay `pending` until then.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAbdmConfig, abdmHeaders } from '../_shared/abdmConfig.ts';
import { getAccessToken, AbdmUpstreamError } from '../_shared/abdmSession.ts';
import { authenticateCaller, assertPatientInCallerClinic } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';
import { readCachedLinkToken, requestLinkToken } from '../_shared/abdmLinkToken.ts';
import { careContextsForVisit, upsertCareContext } from '../_shared/careContext.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    const visitId = String(body?.visitId ?? '');
    patientId = body?.patientId ? String(body.patientId) : null;

    if (!visitId || !patientId) {
      return jsonResponse(req, { error: 'A visit and patient are required', requestId }, 400);
    }

    await assertPatientInCallerClinic(caller, patientId);

    // The patient must actually have an ABHA linked, with consent recorded.
    // Announcing health data for a patient who has not consented is the single
    // worst thing this endpoint could do, so it is checked here rather than
    // assumed from the caller's intent.
    const { data: patient } = await caller.admin
      .from('patients')
      .select('id, abha_number, abha_address, abha_consent_given')
      .eq('id', patientId)
      .maybeSingle();

    if (!patient?.abha_address || !patient.abha_consent_given) {
      return jsonResponse(
        req,
        { error: 'This patient has no linked ABHA with recorded consent', requestId },
        409,
      );
    }

    const { data: clinic } = await caller.admin
      .from('clinic_settings')
      .select('id, abdm_hip_id')
      .eq('id', caller.clinicId)
      .maybeSingle();

    if (!clinic?.abdm_hip_id) {
      return jsonResponse(
        req,
        { error: 'This clinic is not registered with ABDM yet (no HIP ID)', requestId },
        409,
      );
    }

    // Visit must belong to this patient — a visitId is client-supplied.
    const { data: visit } = await caller.admin
      .from('visits')
      .select('id, patient_id, date')
      .eq('id', visitId)
      .eq('patient_id', patientId)
      .maybeSingle();

    if (!visit) {
      return jsonResponse(req, { error: 'Visit not found for this patient', requestId }, 404);
    }

    const { count: rxCount } = await caller.admin
      .from('prescriptions')
      .select('id', { count: 'exact', head: true })
      .eq('visit_id', visitId);

    const planned = careContextsForVisit({
      id: visit.id as string,
      date: String(visit.date),
      hasPrescription: (rxCount ?? 0) > 0,
    });

    const rows = [];
    for (const p of planned) {
      rows.push(
        await upsertCareContext(caller.admin, {
          clinicId: caller.clinicId,
          patientId,
          abhaAddress: patient.abha_address as string,
          sourceType: p.sourceType,
          sourceId: p.sourceId,
          hiType: p.hiType,
          display: p.display,
        }),
      );
    }

    const toLink = rows.filter((r) => r.status !== 'linked');
    if (!toLink.length) {
      return jsonResponse(req, { alreadyLinked: true, careContexts: rows, requestId });
    }

    // A link token is required, is valid six months, and is capped at three
    // generate calls per ABHA per facility per day. If none is cached we can
    // only REQUEST one — it arrives on a callback — so this returns "pending"
    // rather than blocking. The desk is not made to wait on ABDM.
    const token = await readCachedLinkToken(caller.admin, caller.clinicId, patient.abha_address as string);
    if (!token) {
      await requestLinkToken(getAbdmConfig(), await getAccessToken(caller.admin, getAbdmConfig()), requestId, {
        hipId: clinic.abdm_hip_id as string,
        abhaAddress: patient.abha_address as string,
        abhaNumber: (patient.abha_number as string | null) ?? null,
      });

      await writeAudit(caller, { action: 'link_carecontext', requestId, status: 'success', patientId, errorMessage: 'link_token_requested' });

      return jsonResponse(
        req,
        {
          pending: true,
          reason: 'A link token has been requested from ABDM. Try again once it arrives.',
          careContexts: rows,
          requestId,
        },
        202,
      );
    }

    const cfg = getAbdmConfig();
    const accessToken = await getAccessToken(caller.admin, cfg);

    // FAQ Q32: the ABHA number must be sent here if and only if it was sent
    // when the token was generated. `token.abhaNumber` records that choice, so
    // the two calls cannot drift apart.
    const res = await fetch(`${cfg.gatewayBase}/hip/v3/link/carecontext`, {
      method: 'POST',
      headers: abdmHeaders(cfg, accessToken, requestId, {
        'X-HIP-ID': clinic.abdm_hip_id as string,
        'X-LINK-TOKEN': token.linkToken,
      }),
      body: JSON.stringify({
        ...(token.abhaNumber ? { abhaNumber: token.abhaNumber } : {}),
        abhaAddress: patient.abha_address,
        patient: [
          {
            // Our patient id — how ABDM's later discovery/consent callbacks
            // refer back to this person.
            referenceNumber: patientId,
            display: `Visit ${String(visit.date).slice(0, 10)}`,
            careContexts: toLink.map((c) => ({
              referenceNumber: c.referenceNumber,
              display: c.display,
            })),
            hiType: toLink[0].hiType,
            count: toLink.length,
          },
        ],
      }),
    });

    if (!res.ok) {
      throw new AbdmUpstreamError('Care context link rejected', res.status, await res.text());
    }
    await res.text();

    await writeAudit(caller, { action: 'link_carecontext', requestId, status: 'success', patientId });

    // 202 from ABDM: accepted, not linked. Rows stay `pending` until the
    // callback confirms, so the UI must not claim success yet.
    return jsonResponse(req, { accepted: true, careContexts: toLink, requestId }, 202);
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'link_carecontext',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
