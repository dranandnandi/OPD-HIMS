// Withdraw ABHA consent and unlink — closes G-13.
//
// A patient must be able to take it back. Without this the clinic could record
// consent but never honour its withdrawal, which fails the data-principal
// rights section of the audit and the equivalent obligation under DPDP.
//
// Nothing is called upstream: linking an ABHA to a patient record is a local
// act, so withdrawing it is too. The patient's ABHA itself is untouched and
// remains theirs — this only severs the clinic's copy.
//
// The consent artefact is marked revoked rather than deleted. Erasing it would
// destroy the evidence that consent was properly obtained at the time, which is
// the opposite of what an auditor needs; the record of a lawful link and its
// later withdrawal is the complete, honest story.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authenticateCaller, assertPatientInCallerClinic } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    patientId = body?.patientId ? String(body.patientId) : null;
    const reason = String(body?.reason ?? '').trim();

    if (!patientId) {
      return jsonResponse(req, { error: 'A patient is required', requestId }, 400);
    }

    const patient = await assertPatientInCallerClinic(caller, patientId);
    if (!patient.abhaNumber) {
      return jsonResponse(req, { error: 'This patient has no linked ABHA.', requestId }, 409);
    }

    const now = new Date().toISOString();

    // Revoke every live artefact for this patient, not just the newest. A
    // patient re-linked after an earlier withdrawal has more than one, and
    // leaving any un-revoked would still show as active consent.
    const { error: revokeError } = await caller.admin
      .from('abha_consent_artefacts')
      .update({
        revoked_at: now,
        revoked_by: caller.userId,
        revoke_reason: reason || 'Withdrawn at patient request',
      })
      .eq('patient_id', patientId)
      .eq('clinic_id', caller.clinicId)
      .is('revoked_at', null);

    if (revokeError) {
      throw new Error(`consent revocation failed: ${revokeError.message}`);
    }

    // Revoke first, clear second. If this half fails the consent is already
    // withdrawn and the link is merely stale — recoverable. The reverse would
    // leave the clinic holding an ABHA with no consent behind it.
    const { error: patientError } = await caller.admin
      .from('patients')
      .update({
        abha_number: null,
        abha_address: null,
        abha_linked_at: null,
        abha_consent_given: false,
        abha_consent_at: null,
        // mobile_verified is deliberately left alone: the mobile really was
        // verified, and that fact does not depend on the ABHA link.
      })
      .eq('id', patientId)
      .eq('clinic_id', caller.clinicId);

    if (patientError) {
      throw new Error(`patient unlink failed: ${patientError.message}`);
    }

    await writeAudit(caller, { action: 'abha_unlink', requestId, status: 'success', patientId });

    return jsonResponse(req, { unlinked: true, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'abha_unlink',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
