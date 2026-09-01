// M2 / Scan & Share §4.3.2 — the patient's KYC profile arrives here.
//
//   POST {base}/api/v3/hip/patient/share
//
// A patient scanned the counter QR in their ABHA app. We register or match
// them, then answer on §4.3.3 `patient-share/v3/on-share` with the token number
// they will be called by.
//
// Runs after the dispatcher has already verified ABDM's signature and sent the
// 202, so nothing here can influence the HTTP response — failure is reported to
// ABDM on the on-share reply instead.

import { abdmHeaders } from '../abdmConfig.ts';
import { getAccessToken } from '../abdmSession.ts';
import { type CallbackContext, clinicForHipId } from './types.ts';

interface SharedPatient {
  abhaNumber?: string;
  abhaAddress?: string;
  name?: string;
  gender?: string;
  dayOfBirth?: string;
  monthOfBirth?: string;
  yearOfBirth?: string;
  phoneNumber?: string;
  address?: { line?: string; district?: string; state?: string; pincode?: string };
}

/** ABDM sends DOB in three parts, any of which may be absent for a partial KYC. */
function toIsoDob(p: SharedPatient): string | null {
  const y = (p.yearOfBirth ?? '').trim();
  if (!/^\d{4}$/.test(y)) return null;
  const m = (p.monthOfBirth ?? '').trim().padStart(2, '0');
  const d = (p.dayOfBirth ?? '').trim().padStart(2, '0');
  if (!/^\d{2}$/.test(m) || m === '00') return `${y}-01-01`;
  if (!/^\d{2}$/.test(d) || d === '00') return `${y}-${m}-01`;
  return `${y}-${m}-${d}`;
}

/** ABDM's 'M'/'F'/'O' onto the app's gender_enum. */
function toGender(raw: string | undefined): string | null {
  switch ((raw ?? '').trim().toUpperCase()) {
    case 'M': return 'male';
    case 'F': return 'female';
    case 'O': return 'other';
    default: return null;
  }
}

export async function handlePatientShare(ctx: CallbackContext): Promise<void> {
  const { admin, cfg, requestId, hipId, body } = ctx;

  const meta = (body.metaData ?? {}) as Record<string, string>;
  const patient = (((body.profile ?? {}) as Record<string, unknown>).patient ?? {}) as SharedPatient;
  const context = String(meta.context ?? '').trim() || '1';
  const abhaAddress = (patient.abhaAddress ?? '').trim();

  try {
    const abhaNumber = (patient.abhaNumber ?? '').replace(/\D/g, '');

    const clinic = await clinicForHipId(admin, hipId);
    if (!clinic) {
      console.error(`[abdm-cb][${requestId}] no clinic for HIP ID ${hipId}`);
      await sendOnShare(cfg, admin, requestId, abhaAddress, context, null, 'failed');
      return;
    }

    // Match on ABHA number only. Phone is not usable as an identity: families
    // share mobile numbers, and merging two patients is far worse than a
    // duplicate. Both stored formats are checked because rows predating the
    // 14-digit guard hold the dashed form.
    let patientId: string | null = null;
    if (abhaNumber) {
      const dashed = abhaNumber.replace(/^(\d{2})(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3-$4');
      const { data } = await admin
        .from('patients')
        .select('id')
        .eq('clinic_id', clinic.id)
        .or(`abha_number.eq.${abhaNumber},abha_number.eq.${dashed}`)
        .limit(1)
        .maybeSingle();
      patientId = data?.id ?? null;
    }

    if (!patientId) {
      const { data, error } = await admin
        .from('patients')
        .insert({
          clinic_id: clinic.id,
          name: (patient.name ?? '').trim() || 'ABHA Patient',
          phone: (patient.phoneNumber ?? '').replace(/\D/g, '') || null,
          gender: toGender(patient.gender),
          date_of_birth: toIsoDob(patient),
          address: patient.address?.line ?? null,
          abha_number: abhaNumber || null,
          abha_address: abhaAddress || null,
          abha_linked_at: new Date().toISOString(),
          // The patient acted from their own ABHA app against a KYC-verified
          // identity. That IS the consent; there is no OTP for us to collect.
          abha_consent_given: true,
          abha_consent_at: new Date().toISOString(),
          mobile_verified: true,
        })
        .select('id')
        .single();

      if (error) throw new Error(`patient insert failed: ${error.message}`);
      patientId = data.id;

      await admin.from('abha_consent_artefacts').insert({
        patient_id: patientId,
        clinic_id: clinic.id,
        consent_code: 'abha-scan-share',
        consent_version: '1.0',
        consent_text:
          'Patient shared their ABHA profile with this facility by scanning the facility QR code in their ABHA application.',
        purpose: 'scan-and-share',
        // Existing vocabulary from abha-link-patient. A new spelling would
        // silently drop out of an auditor's filter.
        auth_method: 'qr-scan',
        request_id: requestId,
      });
    }

    const { count } = await admin
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinic.id)
      .gte('created_at', new Date().toISOString().slice(0, 10));

    await sendOnShare(cfg, admin, requestId, abhaAddress, context, count ?? 1, 'success');
  } catch (e) {
    console.error(`[abdm-cb][${requestId}] share processing failed:`, e instanceof Error ? e.message : e);
    await sendOnShare(cfg, admin, requestId, abhaAddress, context, null, 'failed').catch(() => {});
  }
}

/** Spec §4.3.3 — our answer, carrying the patient's token number. */
async function sendOnShare(
  cfg: CallbackContext['cfg'],
  admin: CallbackContext['admin'],
  requestId: string,
  abhaAddress: string,
  context: string,
  tokenNumber: number | null,
  status: 'success' | 'failed',
): Promise<void> {
  const accessToken = await getAccessToken(admin, cfg);
  const res = await fetch(`${cfg.gatewayBase}/patient-share/v3/on-share`, {
    method: 'POST',
    headers: abdmHeaders(cfg, accessToken, crypto.randomUUID()),
    body: JSON.stringify({
      acknowledgement: {
        abhaAddress,
        status,
        profile: {
          context,
          tokenNumber: String(tokenNumber ?? ''),
          // Minutes the token stays valid. The spec's parameter table
          // mislabels this as "Patient year of birth" — a copy-paste error;
          // its own sample sends "600".
          expiry: '600',
        },
      },
      response: { requestId },
    }),
  });

  if (!res.ok) {
    console.error(`[abdm-share][${requestId}] on-share ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
