// M2 §5.3.2 — the patient is looking for their records at this clinic.
//
//   inbound   {base}/api/v3/hip/patient/care-context/discover
//   our reply POST {gateway}/user-initiated-linking/v3/patient/care-context/on-discover
//
// User-initiated linking starts here: the patient searched for this facility in
// their ABHA app, and ABDM is asking whether we hold anything for them. Whatever
// we answer is what the patient sees offered for linking.
//
// ############ THE MATCHING RULE, AND WHY IT IS THIS STRICT #################
//
// FAQ v1.4 Q34 is explicit that the matching logic is the HIP's to write —
// ABDM hands over identifiers and demographics and specifies nothing about how
// they map to our records.
//
// The failure mode that matters is not a missed match. It is a WRONG match:
// answering with patient A's care contexts to patient B's discovery hands B a
// permanent link to A's medical history, and care contexts cannot be unlinked
// (Q33). A false negative costs the patient one manual registration at the
// desk; a false positive is an unrecoverable disclosure.
//
// So:
//   - a verified ABHA address or ABHA number is the only strong match, and is
//     tried first;
//   - a verified MOBILE is corroborating evidence, never proof — in India a
//     household routinely shares one number, so it is accepted only alongside
//     year of birth AND gender;
//   - ambiguity is never resolved by picking. Two candidates means no match.
// ###########################################################################

import { abdmHeaders } from '../abdmConfig.ts';
import { getAccessToken } from '../abdmSession.ts';
import { careContextsForVisit, careContextReference } from '../careContext.ts';
import type { HiType } from '../fhir/bundle.ts';
import { type CallbackContext, clinicForHipId } from './types.ts';

interface Identifier {
  type?: string;
  value?: string;
}

/**
 * ABDM's discovery hiType enum.
 *
 * ############ THE SPEC IS WRONG ABOUT THIS ONE ############################
 *
 * The M2 document (§5.3.3, error table) documents the enum as UPPERCASE —
 * PRESCRIPTION, DIAGNOSTICREPORT, OPCONSULTATION, … — and omits Invoice.
 * Sending exactly that is rejected by the live sandbox:
 *
 *   ABDM-9999 "Invalid HIType, it must be in Prescription,DiagnosticReport,
 *   OPConsultation,DischargeSummary,ImmunizationRecord,HealthDocumentRecord,
 *   WellnessRecord,Invoice"
 *
 * So the real enum is CamelCase and DOES include Invoice. Confirmed against
 * sandbox on 2026-09-02 — believe the gateway, not the document.
 * #########################################################################
 *
 * That list is character-for-character our own `HiType` union, so the value
 * passes through unchanged. This set exists to keep that coupling explicit and
 * to fail closed if an internal HI type is ever added that ABDM does not know.
 */
const DISCOVERY_HI_TYPES: ReadonlySet<string> = new Set<HiType>([
  'Prescription',
  'DiagnosticReport',
  'OPConsultation',
  'DischargeSummary',
  'ImmunizationRecord',
  'HealthDocumentRecord',
  'WellnessRecord',
  'Invoice',
]);

/** ABDM caps a discovery reply at 20 care contexts per entry. */
const MAX_CARE_CONTEXTS = 20;

/** ABDM's 'M'/'F'/'O' onto the app's gender_enum. */
function toGender(raw: unknown): string | null {
  switch (String(raw ?? '').trim().toUpperCase()) {
    case 'M': return 'male';
    case 'F': return 'female';
    case 'O': return 'other';
    default: return null;
  }
}

/** Last ten digits, so +91/0 prefixes compare equal to a bare number. */
function normaliseMobile(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function findIdentifier(list: Identifier[], type: string): string | null {
  const hit = list.find((i) => String(i?.type ?? '').trim().toUpperCase() === type);
  const value = (hit?.value ?? '').trim();
  return value ? value : null;
}

export async function handleDiscover(ctx: CallbackContext): Promise<void> {
  const { admin, requestId, hipId, body } = ctx;

  const transactionId = String(body.transactionId ?? '').trim();
  const patient = (body.patient ?? {}) as Record<string, unknown>;

  const verified = (patient.verifiedIdentifiers ?? []) as Identifier[];
  const unverified = (patient.unverifiedIdentifiers ?? []) as Identifier[];

  const abhaAddress = String(patient.id ?? '').trim();
  const abhaNumber = (findIdentifier(verified, 'ABHA_NUMBER') ?? '').replace(/\D/g, '');
  const mobileRaw = findIdentifier(verified, 'MOBILE');
  const mobile = normaliseMobile(mobileRaw);
  const yearOfBirth = String(patient.yearOfBirth ?? '').trim();
  const gender = toGender(patient.gender);

  // The spec's own samples show masked identifiers. If a real payload ever
  // arrives masked, matching silently degrades to "patient not found" for
  // everyone — so say so in the log rather than leave it to be inferred.
  if (mobileRaw && !mobile) {
    console.warn(`[abdm-cb][${requestId}] discovery MOBILE unusable for matching: ${mobileRaw}`);
  }

  const reply = (payload: Record<string, unknown>) =>
    sendOnDiscover(ctx, { transactionId, ...payload });

  const clinic = await clinicForHipId(admin, hipId);
  if (!clinic) {
    console.error(`[abdm-cb][${requestId}] discovery for unknown HIP ID ${hipId}`);
    await reply({ error: { code: 'ABDM-1010', message: 'Patient not found' } });
    return;
  }

  // --- Tier 1: a verified ABHA identifier. -------------------------------
  let matched: { id: string; name: string | null } | null = null;
  let matchedBy: string[] = [];

  if (abhaAddress || abhaNumber) {
    const filters: string[] = [];
    // Case-insensitive, no wildcards: ABHA addresses are case-insensitive to
    // ABDM, and an exact `eq` would miss a row stored with different casing.
    if (abhaAddress) filters.push(`abha_address.ilike.${abhaAddress}`);
    if (abhaNumber) {
      // Bare digits is the stored format (20260826010000 normalised it), but a
      // row that escaped that migration holds the dashed form and would be
      // invisible to an exact match — silently, as "patient not found".
      // Matching both spellings costs nothing and removes the failure mode.
      const spellings = [abhaNumber];
      if (abhaNumber.length === 14) {
        spellings.push(
          `${abhaNumber.slice(0, 2)}-${abhaNumber.slice(2, 6)}-${abhaNumber.slice(6, 10)}-${abhaNumber.slice(10)}`,
        );
      }
      filters.push(`abha_number.in.(${spellings.map((s) => `"${s}"`).join(',')})`);
    }

    const { data } = await admin
      .from('patients')
      .select('id, name, abha_address, abha_number')
      .eq('clinic_id', clinic.id)
      .or(filters.join(','));

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 1) {
      matched = { id: rows[0].id as string, name: (rows[0].name as string | null) ?? null };
      const rowAddress = String(rows[0].abha_address ?? '').toLowerCase();
      matchedBy = rowAddress && rowAddress === abhaAddress.toLowerCase()
        ? ['HEALTH_ID']
        : ['ABHA_NUMBER'];
    } else if (rows.length > 1) {
      // Two of our records carry the same ABHA. That is our data problem, not
      // the patient's, and it must not be resolved by choosing one.
      console.error(
        `[abdm-cb][${requestId}] ${rows.length} patients share ABHA ${abhaAddress || abhaNumber} at ${clinic.clinic_name}`,
      );
      await reply({ error: { code: 'ABDM-1010', message: 'Patient not found' } });
      return;
    }
  }

  // --- Tier 2: mobile, corroborated by year of birth AND gender. ----------
  if (!matched && mobile && yearOfBirth && gender) {
    const { data } = await admin
      .from('patients')
      .select('id, name, phone, gender, date_of_birth, age')
      .eq('clinic_id', clinic.id)
      .eq('gender', gender);

    const candidates = ((data ?? []) as Array<Record<string, unknown>>).filter((row) => {
      if (normaliseMobile(row.phone) !== mobile) return false;
      // A recorded date of birth, never one derived from `age`. Age gives a
      // year that is right to within a year, and "within a year" is exactly
      // the tolerance that lets a sibling on the household phone through.
      // Patients registered by age simply do not match this tier; if they
      // hold an ABHA at all, tier 1 already matched them.
      const dob = row.date_of_birth ? String(row.date_of_birth).slice(0, 4) : null;
      return dob === yearOfBirth;
    });

    if (candidates.length === 1) {
      matched = { id: candidates[0].id as string, name: (candidates[0].name as string | null) ?? null };
      matchedBy = ['MOBILE'];
    } else if (candidates.length > 1) {
      // The shared-household case this tier exists to be careful about.
      console.warn(
        `[abdm-cb][${requestId}] ${candidates.length} patients match mobile+YOB+gender — refusing to guess`,
      );
    }
  }

  if (!matched) {
    console.log(
      `[abdm-cb][${requestId}] no patient matched for discovery ${transactionId} ` +
        `(address=${abhaAddress || '-'} number=${abhaNumber ? 'yes' : '-'} mobile=${mobile ? 'yes' : '-'} ` +
        `unverified=${unverified.length})`,
    );
    await reply({ error: { code: 'ABDM-1010', message: 'Patient not found' } });
    return;
  }

  // --- What we hold for them. --------------------------------------------
  //
  // Discovery is a read. Nothing is recorded as a care context here: the
  // patient has been offered these, not linked to them, and a `pending` row
  // written now would be indistinguishable from an announcement that failed.
  const { data: visits } = await admin
    .from('visits')
    .select('id, date')
    .eq('patient_id', matched.id)
    .order('date', { ascending: false })
    .limit(MAX_CARE_CONTEXTS);

  const visitRows = (visits ?? []) as Array<{ id: string; date: string }>;

  const { data: rxRows } = await admin
    .from('prescriptions')
    .select('visit_id')
    .in('visit_id', visitRows.map((v) => v.id));

  const visitsWithRx = new Set(
    ((rxRows ?? []) as Array<{ visit_id: string }>).map((r) => r.visit_id),
  );

  // Grouped by HI type: ABDM's reply shape carries ONE hiType per patient
  // entry, with `count` that must equal that entry's care contexts.
  const byHiType = new Map<string, Array<{ referenceNumber: string; display: string }>>();

  for (const visit of visitRows) {
    for (const planned of careContextsForVisit({
      id: visit.id,
      date: String(visit.date),
      hasPrescription: visitsWithRx.has(visit.id),
    })) {
      if (!DISCOVERY_HI_TYPES.has(planned.hiType)) continue;

      const list = byHiType.get(planned.hiType) ?? [];
      if (list.length >= MAX_CARE_CONTEXTS) continue;
      list.push({
        // The SAME deterministic reference HIP-initiated linking would use.
        // Two spellings of one clinical event would show the patient a
        // duplicate that can never be withdrawn.
        referenceNumber: careContextReference(planned.sourceType, planned.sourceId, planned.hiType),
        display: planned.display,
      });
      byHiType.set(planned.hiType, list);
    }
  }

  if (byHiType.size === 0) {
    // Matched, but nothing to offer. The spec's error is the correct answer:
    // "no details are found for the patient at HIP".
    console.log(`[abdm-cb][${requestId}] patient ${matched.id} matched but holds no shareable records`);
    await reply({ error: { code: 'ABDM-1010', message: 'Patient not found' } });
    return;
  }

  const entries = [...byHiType.entries()].map(([hiType, careContexts]) => ({
    referenceNumber: matched!.id,
    display: matched!.name ?? '',
    careContexts,
    hiType,
    count: careContexts.length,
  }));

  console.log(
    `[abdm-cb][${requestId}] discovery ${transactionId}: patient ${matched.id} matched by ` +
      `${matchedBy.join(',')}, offering ${entries.reduce((n, e) => n + e.count, 0)} care contexts`,
  );

  await reply({ patient: entries, matchedBy });
}

/**
 * The reply. `response.requestId` MUST echo ABDM's REQUEST-ID **header** from
 * the inbound callback — not our own correlation id, and not the transaction
 * id. ABDM answers a mismatch with ABDM-1015 "Invalid Response", which reads
 * like a payload problem and is not one.
 */
async function sendOnDiscover(
  ctx: CallbackContext,
  payload: Record<string, unknown>,
): Promise<void> {
  const { admin, cfg, requestId, abdmRequestId } = ctx;

  if (!abdmRequestId) {
    console.error(`[abdm-cb][${requestId}] cannot answer discovery: inbound REQUEST-ID was absent`);
    return;
  }

  try {
    const accessToken = await getAccessToken(admin, cfg);
    const res = await fetch(
      `${cfg.gatewayBase}/user-initiated-linking/v3/patient/care-context/on-discover`,
      {
        method: 'POST',
        headers: abdmHeaders(cfg, accessToken, crypto.randomUUID()),
        body: JSON.stringify({ ...payload, response: { requestId: abdmRequestId } }),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      console.error(`[abdm-cb][${requestId}] on-discover rejected ${res.status}: ${text.slice(0, 400)}`);
      return;
    }
    console.log(`[abdm-cb][${requestId}] on-discover accepted (${res.status})`);
  } catch (e) {
    console.error(`[abdm-cb][${requestId}] on-discover failed:`, e instanceof Error ? e.message : e);
  }
}
