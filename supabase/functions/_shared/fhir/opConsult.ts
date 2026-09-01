// OPConsultRecord and PrescriptionRecord — the two HI types an OPD visit
// produces, and the two that matter most for this app's certification.
//
// One visit yields TWO care contexts, not one: ABDM models the consultation
// and the prescription as separate documents with separate HI types, and a
// consent may authorise one without the other. That is why
// `abdm_care_contexts` is unique on (source, hi_type) rather than on source.
//
// What is deliberately NOT invented here: nothing is emitted for a section the
// visit has no data for. An empty Condition or a placeholder medication would
// validate and then sit in a patient's national health record as a clinical
// assertion nobody made. Absent is correct; fabricated is not.

import {
  buildDocumentBundle,
  organizationResource,
  patientResource,
  practitionerResource,
  urn,
  type FhirEntry,
  type OrganizationInput,
  type PatientInput,
  type PractitionerInput,
} from './bundle.ts';

export interface VisitDiagnosis {
  id: string;
  name: string;
  icd10Code?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}

export interface VisitPrescription {
  id: string;
  medicine: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  route?: string | null;
}

export interface VisitInput {
  id: string;
  /** ISO 8601 — the clinical date, not the transmission date. */
  date: string;
  chiefComplaint?: string | null;
  doctorNotes?: string | null;
  advice?: string[] | null;
  diagnoses: VisitDiagnosis[];
  prescriptions: VisitPrescription[];
  vitals?: Record<string, number | string | undefined> | null;
}

export interface ComposeContext {
  patient: PatientInput;
  practitioner: PractitionerInput;
  organization: OrganizationInput;
  visit: VisitInput;
  /** Stable ids so a regenerated bundle is byte-comparable. */
  ids: { bundleId: string; compositionId: string };
}

/** A Condition per diagnosis. ICD-10 when coded; free text is still valid. */
function conditionResources(ctx: ComposeContext): FhirEntry[] {
  return ctx.visit.diagnoses.map((d) => ({
    fullUrl: urn(d.id),
    resource: {
      resourceType: 'Condition',
      id: d.id,
      meta: { profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/Condition'] },
      clinicalStatus: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
      },
      code: {
        coding: d.icd10Code
          ? [{ system: 'http://id.who.int/icd/release/10/2019', code: d.icd10Code, display: d.name }]
          : undefined,
        text: d.name,
      },
      subject: { reference: urn(ctx.patient.id) },
      recordedDate: ctx.visit.date,
      note: d.notes ? [{ text: d.notes }] : undefined,
    },
  }));
}

/**
 * A MedicationRequest per prescribed drug.
 *
 * `dosageInstruction.text` carries the human-readable direction rather than
 * structured timing. Parsing "1-0-1 after food" into FHIR timing codes would be
 * guesswork, and a wrong structured dose is more dangerous than an unstructured
 * accurate one — the pharmacist reads the text either way.
 */
function medicationResources(ctx: ComposeContext): FhirEntry[] {
  return ctx.visit.prescriptions.map((p) => {
    const direction = [p.dosage, p.frequency, p.duration, p.instructions]
      .map((x) => (x ?? '').trim())
      .filter(Boolean)
      .join(', ');

    return {
      fullUrl: urn(p.id),
      resource: {
        resourceType: 'MedicationRequest',
        id: p.id,
        meta: { profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/MedicationRequest'] },
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: { text: p.medicine },
        subject: { reference: urn(ctx.patient.id) },
        authoredOn: ctx.visit.date,
        requester: { reference: urn(ctx.practitioner.id) },
        dosageInstruction: [{
          text: direction || 'As directed',
          route: p.route ? { text: p.route } : undefined,
        }],
      },
    };
  });
}

function section(title: string, code: string, display: string, refs: FhirEntry[]) {
  return {
    title,
    code: { coding: [{ system: 'http://snomed.info/sct', code, display }] },
    entry: refs.map((r) => ({ reference: r.fullUrl })),
  };
}

/** OPConsultRecord — the consultation itself. */
export function composeOpConsultation(ctx: ComposeContext): Record<string, unknown> {
  const patient = patientResource(ctx.patient);
  const author = practitionerResource(ctx.practitioner);
  const custodian = organizationResource(ctx.organization);

  const conditions = conditionResources(ctx);
  const medications = medicationResources(ctx);

  const sections: Record<string, unknown>[] = [];
  if (conditions.length) {
    sections.push(section('Chief complaints', '422843007', 'Chief complaint section', conditions));
  }
  if (medications.length) {
    sections.push(section('Medications', '721912009', 'Medication summary document', medications));
  }

  // A Composition with no sections is rejected. When a visit carried neither a
  // diagnosis nor a prescription, the doctor's note IS the clinical content,
  // so it becomes the section rather than the bundle being unsendable.
  if (!sections.length) {
    const note = (ctx.visit.doctorNotes ?? ctx.visit.chiefComplaint ?? '').trim();
    if (!note) {
      throw new Error(`Visit ${ctx.visit.id} has no clinical content to share`);
    }
    sections.push({
      title: 'Consultation note',
      code: { coding: [{ system: 'http://snomed.info/sct', code: '371530004', display: 'Clinical consultation report' }] },
      text: { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeXml(note)}</div>` },
    });
  }

  return buildDocumentBundle({
    hiType: 'OPConsultation',
    bundleId: ctx.ids.bundleId,
    compositionId: ctx.ids.compositionId,
    timestamp: ctx.visit.date,
    title: 'OP Consultation Record',
    patient,
    author,
    custodian,
    sections,
    supporting: [...conditions, ...medications],
  });
}

/** PrescriptionRecord — a separate HI type, and a separate care context. */
export function composePrescription(ctx: ComposeContext): Record<string, unknown> {
  if (!ctx.visit.prescriptions.length) {
    throw new Error(`Visit ${ctx.visit.id} has no prescription to share`);
  }

  const medications = medicationResources(ctx);

  return buildDocumentBundle({
    hiType: 'Prescription',
    bundleId: ctx.ids.bundleId,
    compositionId: ctx.ids.compositionId,
    timestamp: ctx.visit.date,
    title: 'Prescription',
    patient: patientResource(ctx.patient),
    author: practitionerResource(ctx.practitioner),
    custodian: organizationResource(ctx.organization),
    sections: [section('Prescription', '440545006', 'Prescription record', medications)],
    supporting: medications,
  });
}

/**
 * Narrative goes into XHTML, so unescaped clinical free text would break the
 * document — and a doctor's note containing "<" is entirely ordinary
 * ("BP <120"). Escaped, not stripped: the text must survive intact.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
