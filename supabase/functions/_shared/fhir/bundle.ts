// FHIR R4 DocumentBundle construction for ABDM (NRCeS India profiles).
//
// Every HI type ABDM accepts is a **Composition**-based document wrapped in a
// Bundle of `type: "document"`. The rules that actually matter, and that the
// validator enforces:
//
//  1. `Bundle.type` is "document", and **the first entry MUST be the
//     Composition**. Not "should" — a Bundle whose first entry is anything else
//     is rejected outright.
//  2. Every reference inside the document must resolve to another entry in the
//     same Bundle. There are no external references in a document bundle, so a
//     Practitioner referenced by the Composition has to be carried with it.
//  3. `Bundle.identifier`, `Bundle.timestamp` and `Composition.date` are all
//     required, and `meta.profile` must name the NRCeS profile.
//
// Entries use **urn:uuid:** fullUrls rather than server URLs. The alternative
// is minting resolvable URLs for resources that exist nowhere outside this
// document, which would be a claim we cannot honour.
//
// Deliberately hand-built rather than pulled from a FHIR library: the Deno
// edge runtime has no mature R4 builder, the subset ABDM needs is small and
// fixed, and a library would not encode the India-profile constraints anyway.

/** ABDM's eight HI types. All eight are mandatory for an HMIS (FAQ v1.4 Q2). */
export type HiType =
  | 'Prescription'
  | 'DiagnosticReport'
  | 'OPConsultation'
  | 'DischargeSummary'
  | 'ImmunizationRecord'
  | 'HealthDocumentRecord'
  | 'WellnessRecord'
  | 'Invoice';

const NRCES = 'https://nrces.in/ndhm/fhir/r4/StructureDefinition';

/**
 * NRCeS profile URL and Composition type coding per HI type.
 *
 * The SNOMED codes are not decorative — the validator checks that
 * `Composition.type` matches the profile, so a Prescription document carrying
 * an OPConsultation code fails even though both are well-formed FHIR.
 */
const HI_TYPE_META: Record<HiType, { profile: string; code: string; display: string }> = {
  Prescription: { profile: `${NRCES}/PrescriptionRecord`, code: '440545006', display: 'Prescription record' },
  DiagnosticReport: { profile: `${NRCES}/DiagnosticReportRecord`, code: '721981007', display: 'Diagnostic studies report' },
  OPConsultation: { profile: `${NRCES}/OPConsultRecord`, code: '371530004', display: 'Clinical consultation report' },
  DischargeSummary: { profile: `${NRCES}/DischargeSummaryRecord`, code: '373942005', display: 'Discharge summary' },
  ImmunizationRecord: { profile: `${NRCES}/ImmunizationRecord`, code: '41000179103', display: 'Immunization record' },
  HealthDocumentRecord: { profile: `${NRCES}/HealthDocumentRecord`, code: '419891008', display: 'Record artifact' },
  WellnessRecord: { profile: `${NRCES}/WellnessRecord`, code: '419891008', display: 'Record artifact' },
  Invoice: { profile: `${NRCES}/InvoiceRecord`, code: '721912009', display: 'Medical record' },
};

export interface FhirEntry {
  fullUrl: string;
  resource: Record<string, unknown>;
}

/** Stable urn:uuid fullUrl for a resource built in this bundle. */
export function urn(id: string): string {
  return `urn:uuid:${id}`;
}

export interface PatientInput {
  id: string;
  name: string;
  gender?: string | null;
  dob?: string | null;
  phone?: string | null;
  abhaAddress?: string | null;
  abhaNumber?: string | null;
}

export interface PractitionerInput {
  id: string;
  name: string;
  /** Health Professional Registry id, when the clinic has recorded one. */
  hprId?: string | null;
}

export interface OrganizationInput {
  id: string;
  name: string;
  /** HFR facility id — the organisation's identity in the national registry. */
  facilityId?: string | null;
}

/** ABDM wants 'male' | 'female' | 'other' | 'unknown'; our enum is close. */
function fhirGender(raw?: string | null): string {
  const g = (raw ?? '').trim().toLowerCase();
  if (g === 'male' || g === 'female' || g === 'other') return g;
  return 'unknown';
}

export function patientResource(p: PatientInput): FhirEntry {
  const identifiers: Record<string, unknown>[] = [];

  // The ABHA number is the identifier that makes this patient findable
  // nationally. Without it the document is valid FHIR and useless to ABDM.
  if (p.abhaNumber) {
    identifiers.push({
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR', display: 'Medical record number' }] },
      system: 'https://healthid.ndhm.gov.in',
      value: p.abhaNumber,
    });
  }

  return {
    fullUrl: urn(p.id),
    resource: {
      resourceType: 'Patient',
      id: p.id,
      meta: { profile: [`${NRCES}/Patient`] },
      identifier: identifiers.length ? identifiers : undefined,
      name: [{ text: p.name }],
      gender: fhirGender(p.gender),
      birthDate: p.dob ?? undefined,
      telecom: p.phone ? [{ system: 'phone', value: p.phone, use: 'mobile' }] : undefined,
    },
  };
}

export function practitionerResource(d: PractitionerInput): FhirEntry {
  return {
    fullUrl: urn(d.id),
    resource: {
      resourceType: 'Practitioner',
      id: d.id,
      meta: { profile: [`${NRCES}/Practitioner`] },
      identifier: d.hprId
        ? [{
            type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MD', display: 'Medical License number' }] },
            system: 'https://doctor.ndhm.gov.in',
            value: d.hprId,
          }]
        : undefined,
      name: [{ text: d.name }],
    },
  };
}

export function organizationResource(o: OrganizationInput): FhirEntry {
  return {
    fullUrl: urn(o.id),
    resource: {
      resourceType: 'Organization',
      id: o.id,
      meta: { profile: [`${NRCES}/Organization`] },
      identifier: o.facilityId
        ? [{
            type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'PRN', display: 'Provider number' }] },
            system: 'https://facility.ndhm.gov.in',
            value: o.facilityId,
          }]
        : undefined,
      name: o.name,
    },
  };
}

export interface BuildBundleArgs {
  hiType: HiType;
  /** Bundle id and identifier value. Caller supplies so it can be recorded. */
  bundleId: string;
  compositionId: string;
  /** ISO 8601. Must be a real clinical timestamp, not "now" at transmit time. */
  timestamp: string;
  title: string;
  patient: FhirEntry;
  author: FhirEntry;
  custodian: FhirEntry;
  /** Composition.section[] — the clinical content, already built. */
  sections: Record<string, unknown>[];
  /** Everything the sections reference. Order irrelevant; presence is not. */
  supporting: FhirEntry[];
}

/**
 * Assembles a DocumentBundle.
 *
 * The Composition is always entry[0]. Everything else follows in whatever
 * order, but every reference in `sections` must appear in `supporting` or the
 * bundle will not validate — that is the single most common failure when
 * building these by hand, and it fails at ABDM rather than here.
 */
export function buildDocumentBundle(args: BuildBundleArgs): Record<string, unknown> {
  const meta = HI_TYPE_META[args.hiType];

  const composition: FhirEntry = {
    fullUrl: urn(args.compositionId),
    resource: {
      resourceType: 'Composition',
      id: args.compositionId,
      meta: { profile: [meta.profile], versionId: '1', lastUpdated: args.timestamp },
      // 'final' rather than 'preliminary': we only ever transmit records the
      // clinician has completed. A preliminary document invites the patient's
      // app to show unfinished notes.
      status: 'final',
      type: { coding: [{ system: 'http://snomed.info/sct', code: meta.code, display: meta.display }], text: meta.display },
      subject: { reference: args.patient.fullUrl },
      date: args.timestamp,
      author: [{ reference: args.author.fullUrl }],
      title: args.title,
      custodian: { reference: args.custodian.fullUrl },
      section: args.sections,
    },
  };

  // Deduplicate: the patient or practitioner is frequently referenced from
  // several sections, and repeating an entry makes the bundle invalid.
  const seen = new Set<string>();
  const entries: FhirEntry[] = [];
  for (const e of [composition, args.patient, args.author, args.custodian, ...args.supporting]) {
    if (seen.has(e.fullUrl)) continue;
    seen.add(e.fullUrl);
    entries.push(e);
  }

  return {
    resourceType: 'Bundle',
    id: args.bundleId,
    meta: { profile: [`${NRCES}/DocumentBundle`], versionId: '1', lastUpdated: args.timestamp },
    identifier: { system: 'https://ndhm.in/phr', value: args.bundleId },
    type: 'document',
    timestamp: args.timestamp,
    entry: entries,
  };
}
