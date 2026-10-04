// Persist a verified ABHA onto a patient record, with a consent artefact.
//
// Linking used to happen client-side: abhaService wrote abha_number and set
// abha_consent_given = true straight from the browser. Two problems with that.
// A client can claim a consent that never happened, and a boolean records that
// consent occurred without recording what the patient actually agreed to
// (G-12). ABDM consent is versioned and an assessor will ask to see the exact
// wording that was on screen.
//
// So the write moves here: the artefact and the patient update happen together,
// server-side, and the artefact stores the consent text verbatim.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authenticateCaller, assertPatientInCallerClinic } from '../_shared/abdmAuthz.ts';
import { jsonResponse, preflight, errorResponse, writeAudit, auditReason } from '../_shared/abdmHttp.ts';

/** Identity assurance behind the link — recorded on the artefact. */
const AUTH_METHODS = ['aadhaar-otp', 'mobile-otp', 'qr-scan'] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);

  const requestId = crypto.randomUUID();
  let caller;
  let patientId: string | null = null;

  try {
    caller = await authenticateCaller(req);

    const body = await req.json();
    patientId = body?.patientId ? String(body.patientId) : null;
    const abhaNumber = String(body?.abhaNumber ?? '').trim();
    const abhaAddress = String(body?.abhaAddress ?? '').trim();
    const consentText = String(body?.consentText ?? '').trim();
    const authMethod = String(body?.authMethod ?? '') as AuthMethod;

    if (!patientId || !abhaNumber) {
      return jsonResponse(req, { error: 'A patient and ABHA number are required', requestId }, 400);
    }
    if (!AUTH_METHODS.includes(authMethod)) {
      return jsonResponse(req, { error: 'A valid verification method is required', requestId }, 400);
    }
    // The artefact is worthless without the wording, so refuse to create a
    // link that would leave an unprovable consent behind.
    if (consentText.length < 20) {
      return jsonResponse(req, { error: 'Consent text is required', requestId }, 400);
    }

    await assertPatientInCallerClinic(caller, patientId);

    // A masked number would poison the record — ABDM masks numbers in the
    // accounts list (91-2568-7073-XXXX) and only the profile carries the real
    // one. Storing the mask would silently break every later ABDM call.
    const digits = abhaNumber.replace(/\D/g, '');
    if (digits.length !== 14) {
      return jsonResponse(req, { error: 'A complete 14-digit ABHA number is required', requestId }, 400);
    }

    // Artefact first: if the patient update fails we are left with a consent
    // record and no link, which is recoverable. The reverse — a linked ABHA
    // with no consent on file — is exactly the audit finding to avoid.
    const { error: consentError } = await caller.admin
      .from('abha_consent_artefacts')
      .insert({
        patient_id: patientId,
        clinic_id: caller.clinicId,
        consent_code: 'abha-enrollment',
        consent_version: '1.4',
        consent_text: consentText,
        purpose: 'abha-link',
        auth_method: authMethod,
        collected_by: caller.userId,
        request_id: requestId,
      });

    if (consentError) {
      throw new Error(`consent artefact insert failed: ${consentError.message}`);
    }

    const { data: updated, error: patientError } = await caller.admin
      .from('patients')
      .update({
        abha_number: digits,
        abha_address: abhaAddress || null,
        abha_linked_at: new Date().toISOString(),
        abha_consent_given: true,
        abha_consent_at: new Date().toISOString(),
        // Both supported paths prove control of a mobile: Aadhaar OTP goes to
        // the Aadhaar-linked number, mobile OTP to the number itself.
        mobile_verified: true,
      })
      .eq('id', patientId)
      // Defence in depth behind assertPatientInCallerClinic: even a bug above
      // cannot write across clinics.
      .eq('clinic_id', caller.clinicId)
      // ############ WHY THIS SELECT IS NOT DECORATION ######################
      //
      // PostgREST reports NO ERROR when an UPDATE matches zero rows. Without
      // reading back what changed, a filter that matches nothing — a deleted
      // patient, a clinic_id that moved — returns `error: null`, this function
      // returns `{ linked: true }`, and the audit log records SUCCESS for a
      // write that touched nothing.
      //
      // That is worse than a failure: the consent artefact above IS written,
      // so the records disagree, and the only symptom appears much later as
      // "no patient matched" in a discovery callback.
      // ####################################################################
      .select('id');

    if (!patientError && (updated?.length ?? 0) === 0) {
      throw new Error(
        `patient update matched no rows (patient ${patientId}, clinic ${caller.clinicId}) — ` +
          'consent artefact was written but the ABHA was NOT linked',
      );
    }

    if (patientError) {
      // The unique partial index on abha_number is the guard against linking
      // one ABHA to two patient records.
      if (patientError.code === '23505') {
        return jsonResponse(
          req,
          { error: 'This ABHA number is already linked to another patient record.', requestId },
          409,
        );
      }
      throw new Error(`patient update failed: ${patientError.message}`);
    }

    await writeAudit(caller, { action: 'abha_link', requestId, status: 'success', patientId });

    return jsonResponse(req, { linked: true, requestId });
  } catch (err) {
    if (caller) {
      await writeAudit(caller, {
        action: 'abha_link',
        requestId,
        status: 'failure',
        patientId,
        errorMessage: auditReason(err),
      });
    }
    return errorResponse(req, err, requestId);
  }
});
