// Read-only view of a visit's ABDM linking state.
//
// This exists as its own function, rather than a mode on
// `abdm-link-carecontext`, for one reason: that function's whole contract is
// that calling it changes something permanently. Putting a harmless read
// behind the same door invites a UI that renders a page by calling the
// endpoint that announces care contexts to the national registry.
//
// So: NOTHING here writes, and nothing here talks to ABDM. It reads our own
// records and reports what a link attempt WOULD do.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authenticateCaller, assertPatientInCallerClinic } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse } from '../_shared/abdmHttp.ts';
import { careContextsForVisit, careContextReference } from '../_shared/careContext.ts';

/** Far enough ahead that a link never starts on a token about to die —
 *  the same window `abdmLinkToken.ts` applies when reading the cache. */
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();

  try {
    const caller = await authenticateCaller(req);

    const body = await req.json();
    const visitId = String(body?.visitId ?? '');
    const patientId = String(body?.patientId ?? '');

    if (!visitId || !patientId) {
      return jsonResponse(req, { error: 'A visit and patient are required', requestId }, 400);
    }

    await assertPatientInCallerClinic(caller, patientId);

    const { data: patient } = await caller.admin
      .from('patients')
      .select('abha_number, abha_address, abha_consent_given')
      .eq('id', patientId)
      .maybeSingle();

    const { data: clinic } = await caller.admin
      .from('clinic_settings')
      .select('abdm_hip_id')
      .eq('id', caller.clinicId)
      .maybeSingle();

    const { data: visit } = await caller.admin
      .from('visits')
      .select('id, date')
      .eq('id', visitId)
      .eq('patient_id', patientId)
      .maybeSingle();

    // Every blocker the link endpoint would raise, gathered rather than
    // returned one at a time. The desk should see the whole list at once —
    // fixing them one refusal per attempt is how an operator gives up.
    const blockers: string[] = [];
    if (!visit) blockers.push('This visit does not belong to this patient.');
    if (!patient?.abha_address) blockers.push('This patient has no ABHA linked.');
    else if (!patient.abha_consent_given) blockers.push('This patient has not given ABDM consent.');
    if (!clinic?.abdm_hip_id) blockers.push('This clinic has no ABDM HIP ID yet.');

    const abhaAddress = (patient?.abha_address as string | null) ?? null;

    // A visit with a prescription is two care contexts, not one.
    const { count: rxCount } = await caller.admin
      .from('prescriptions')
      .select('id', { count: 'exact', head: true })
      .eq('visit_id', visitId);

    const planned = visit
      ? careContextsForVisit({
          id: visit.id as string,
          date: String(visit.date),
          hasPrescription: (rxCount ?? 0) > 0,
        })
      : [];

    const { data: rows } = await caller.admin
      .from('abdm_care_contexts')
      .select('reference_number, display, hi_type, status, error_message, linked_at')
      .eq('source_type', 'visit')
      .eq('source_id', visitId);

    const byReference = new Map((rows ?? []).map((r) => [r.reference_number as string, r]));

    // Planned drives the list, not the stored rows: before a first attempt
    // there are no rows at all, and the operator still needs to see what
    // would be announced.
    const careContexts = planned.map((p) => {
      const reference = careContextReference(p.sourceType, p.sourceId, p.hiType);
      const row = byReference.get(reference);
      return {
        referenceNumber: reference,
        display: p.display,
        hiType: p.hiType,
        status: (row?.status as string | undefined) ?? 'not-recorded',
        errorMessage: (row?.error_message as string | null) ?? null,
        linkedAt: (row?.linked_at as string | null) ?? null,
      };
    });

    // Whether a usable link token is cached. This is the difference between
    // "pressing the button links" and "pressing the button spends one of the
    // three generate-token calls allowed today", and the operator should be
    // told which before pressing it.
    let linkToken: { present: boolean; expiresAt: string | null } = { present: false, expiresAt: null };
    if (abhaAddress) {
      const { data: token } = await caller.admin
        .from('abdm_link_tokens')
        .select('expires_at')
        .eq('clinic_id', caller.clinicId)
        .eq('abha_address', abhaAddress)
        .gt('expires_at', new Date(Date.now() + RENEW_BEFORE_MS).toISOString())
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (token) linkToken = { present: true, expiresAt: token.expires_at as string };
    }

    return jsonResponse(req, {
      ready: blockers.length === 0,
      blockers,
      abhaAddress,
      abhaNumber: (patient?.abha_number as string | null) ?? null,
      hipId: (clinic?.abdm_hip_id as string | null) ?? null,
      linkToken,
      careContexts,
      requestId,
    });
  } catch (err) {
    return errorResponse(req, err, requestId);
  }
});
