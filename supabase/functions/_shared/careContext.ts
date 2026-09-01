// Turning clinical events into ABDM care contexts.
//
// A care context is the unit of shareable health data: one visit, one
// admission, one lab report. Everything in M2/M3 is expressed in terms of them
// — linking announces them, discovery finds them, consent authorises them, data
// flow transmits them.
//
// ############ THE REFERENCE IS PERMANENT ###################################
//
// Care contexts CANNOT be unlinked or renamed once announced (FAQ v1.4 Q33).
// So `reference_number` must be derived deterministically from the clinical
// event and never regenerated — if it changed, the patient's ABHA app would
// show a duplicate and the original would dangle forever with no way to
// withdraw it.
//
// That is why the reference is `<source_type>:<source_id>:<hi_type>` rather
// than a random id: it is reproducible from the row itself, so re-deriving it
// after a restore, a migration or a bug still yields the same value.
// ###########################################################################

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import type { HiType } from './fhir/bundle.ts';

export type CareContextSource = 'visit' | 'admission' | 'lab_order' | 'document';

export interface CareContextInput {
  clinicId: string;
  patientId: string;
  abhaAddress: string;
  sourceType: CareContextSource;
  sourceId: string;
  hiType: HiType;
  /** Patient-facing label shown in the ABHA app. */
  display: string;
}

export interface CareContextRow {
  id: string;
  referenceNumber: string;
  display: string;
  hiType: HiType;
  status: 'pending' | 'linked' | 'failed';
}

/** Deterministic and stable for the life of the clinical event. */
export function careContextReference(
  sourceType: CareContextSource,
  sourceId: string,
  hiType: HiType,
): string {
  return `${sourceType}:${sourceId}:${hiType}`;
}

/**
 * Records a care context as `pending`, or returns the existing one.
 *
 * Idempotent on (source, hi_type) — the same unique key the migration
 * enforces. Announcing a care context twice is answered by ABDM with
 * ABDM-1090 "Duplicate HIP link request", so the guard is here as well as in
 * the database: the cheapest place to notice is before the network call.
 */
export async function upsertCareContext(
  admin: SupabaseClient,
  input: CareContextInput,
): Promise<CareContextRow> {
  const referenceNumber = careContextReference(input.sourceType, input.sourceId, input.hiType);

  const { data: existing } = await admin
    .from('abdm_care_contexts')
    .select('id, reference_number, display, hi_type, status')
    .eq('source_type', input.sourceType)
    .eq('source_id', input.sourceId)
    .eq('hi_type', input.hiType)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id as string,
      referenceNumber: existing.reference_number as string,
      display: existing.display as string,
      hiType: existing.hi_type as HiType,
      status: existing.status as CareContextRow['status'],
    };
  }

  const { data, error } = await admin
    .from('abdm_care_contexts')
    .insert({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      reference_number: referenceNumber,
      display: input.display,
      hi_type: input.hiType,
      abha_address: input.abhaAddress,
      status: 'pending',
    })
    .select('id, reference_number, display, hi_type, status')
    .single();

  if (error) throw new Error(`care context insert failed: ${error.message}`);

  return {
    id: data.id as string,
    referenceNumber: data.reference_number as string,
    display: data.display as string,
    hiType: data.hi_type as HiType,
    status: data.status as CareContextRow['status'],
  };
}

/**
 * Which care contexts one visit produces.
 *
 * A visit is TWO care contexts, not one: ABDM models the consultation and the
 * prescription as separate HI types that a consent may authorise
 * independently. A visit with no prescription produces only the first.
 *
 * `display` is patient-facing — it is what appears in the ABHA app — so it
 * carries a readable date rather than an id.
 */
export function careContextsForVisit(visit: {
  id: string;
  date: string;
  hasPrescription: boolean;
}): Array<{ hiType: HiType; display: string; sourceType: CareContextSource; sourceId: string }> {
  const day = visit.date.slice(0, 10);
  const out: Array<{ hiType: HiType; display: string; sourceType: CareContextSource; sourceId: string }> = [
    { hiType: 'OPConsultation', display: `OPD Consultation - ${day}`, sourceType: 'visit', sourceId: visit.id },
  ];
  if (visit.hasPrescription) {
    out.push({ hiType: 'Prescription', display: `Prescription - ${day}`, sourceType: 'visit', sourceId: visit.id });
  }
  return out;
}

/** Mark linked once ABDM's callback confirms. */
export async function markCareContextsLinked(
  admin: SupabaseClient,
  ids: string[],
  linkRequestId: string,
): Promise<void> {
  if (!ids.length) return;
  await admin
    .from('abdm_care_contexts')
    .update({ status: 'linked', linked_at: new Date().toISOString(), link_request_id: linkRequestId })
    .in('id', ids);
}

/**
 * Mark failed, with the reason.
 *
 * Deliberately NOT deleted: a failed link is evidence. Without the row there is
 * nothing to retry from and nothing to explain to a patient asking why their
 * visit is not in their ABHA app.
 */
export async function markCareContextsFailed(
  admin: SupabaseClient,
  ids: string[],
  reason: string,
): Promise<void> {
  if (!ids.length) return;
  await admin
    .from('abdm_care_contexts')
    .update({ status: 'failed', error_message: reason.slice(0, 500) })
    .in('id', ids);
}
