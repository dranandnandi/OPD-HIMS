import type { Admission } from '../types/ipd';

// ---------------------------------------------------------------------------
// Who a document is for.
//
// Most IPD documents are written against a live admission, which supplies the
// patient, the consultant and the bed whose class the charges resolve at. A
// pre-admission estimate has none of that — the patient, class and consultant
// are picked on a form. Both funnel into one shape so the dictation panel, the
// AI composer and the tariff snapshot never have to care which they got.
// ---------------------------------------------------------------------------

/**
 * Which rate card to price against. Taken from the occupied bed for an
 * admitted patient, and chosen by hand on a pre-admission estimate — where
 * there is no bed, only a class the family is being quoted for.
 */
export interface TariffTarget {
  bedTypeId: string | null;
  bedTypeCode: string | null;
  bedClassLabel: string;
  roomRentServiceId: string | null;
  nursingServiceId: string | null;
  tariffPlanId: string | null;
  payerName: string | null;
}

/**
 * Everything the composer needs about who the document is for. An admission
 * supplies it via subjectFromAdmission(); a pre-admission estimate builds it
 * from the patient, class and consultant picked on the form.
 */
export interface ComposeSubject {
  clinicId: string;
  patientName: string;
  age: number | string | null;
  gender: string | null;
  allergies: string[];
  admissionNumber: string | null;
  wardBed: string;
  admittedOn: string | null;
  dischargedOn: string | null;
  doctorName: string;
  diagnosis: string;
  reasonForAdmission: string;
  tariff: TariffTarget;
}

const fmtDate = (d: string | null | undefined): string | null =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

/** The subject of a document being written against a live admission */
export function subjectFromAdmission(admission: Admission): ComposeSubject {
  const bedType = admission.current_bed?.bed_type ?? null;
  const ward = admission.current_bed?.ward?.name;
  return {
    clinicId: admission.clinic_id,
    patientName: admission.patient?.name ?? '',
    age: admission.patient?.age ?? null,
    gender: admission.patient?.gender ?? null,
    allergies: admission.patient?.allergies ?? [],
    admissionNumber: admission.admission_number,
    wardBed: admission.current_bed
      ? `${ward ?? ''} / ${admission.current_bed.bed_number}`
      : 'not allotted',
    admittedOn: fmtDate(admission.admission_datetime),
    dischargedOn: fmtDate(admission.discharge_datetime),
    doctorName: admission.admitting_doctor?.name?.replace(/^dr\.?\s*/i, '') ?? '',
    diagnosis: admission.provisional_diagnosis ?? '',
    reasonForAdmission: admission.reason_for_admission ?? '',
    tariff: {
      bedTypeId: admission.current_bed?.bed_type_id ?? null,
      bedTypeCode: bedType?.code ?? null,
      bedClassLabel: [bedType?.name, ward ? `(${ward})` : null].filter(Boolean).join(' ') || 'not allotted',
      roomRentServiceId: bedType?.room_rent_service_id ?? null,
      nursingServiceId: bedType?.nursing_service_id ?? null,
      tariffPlanId: admission.tariff_plan_id ?? null,
      payerName: null,
    },
  };
}
