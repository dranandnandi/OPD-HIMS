/**
 * The consent wording shown before an ABHA is linked.
 *
 * Kept in one place and passed to the server verbatim so the stored artefact is
 * provably the text the patient saw. Building the string at the point of
 * display and sending it with the link request is the whole mechanism: if the
 * server reconstructed the wording from a template id, a later copy edit would
 * silently rewrite history for every consent already on file.
 *
 * If you change this text, bump CONSENT_TEXT_VERSION. Existing artefacts keep
 * their original wording — that is intended.
 */

export const CONSENT_TEXT_VERSION = '1.0';

/** ABDM's own versioned consent identifiers, sent upstream on enrolment. */
export const ABDM_CONSENT = { code: 'abha-enrollment', version: '1.4' } as const;

export function buildAbhaConsentText(params: {
  patientName: string;
  clinicName: string;
}): string {
  const patient = params.patientName?.trim() || 'the patient';
  const clinic = params.clinicName?.trim() || 'this clinic';

  return [
    `I, ${patient}, give my explicit consent to link my Ayushman Bharat Health Account (ABHA) with ${clinic}.`,
    `I understand that ${clinic} will record my ABHA number against my patient record, and may use it to share and retrieve my health records through the ABDM network in accordance with ABDM guidelines.`,
    'I understand that I may withdraw this consent at any time by informing the clinic.',
  ].join(' ');
}
