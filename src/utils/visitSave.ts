import type { Visit } from '../types';

export type VisitSaveData = Partial<Omit<Visit, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'>>;
export interface VisitSaveOptions {
  requestId?: string;
  expectedUpdatedAt?: string;
  newVisitId?: string;
}

// Use the same database names and conversions for manual creation and editing.
// undefined means unchanged; null means explicitly clear the field.
export function buildVisitSavePayload(visit: VisitSaveData) {
  const main: Record<string, unknown> = {};
  const details: Record<string, unknown[]> = {};
  const set = (column: string, value: unknown) => {
    if (value !== undefined) main[column] = value;
  };
  set('patient_id', visit.patientId);
  set('doctor_id', visit.doctorId);
  set('appointment_id', visit.appointmentId);
  set('visit_type', visit.visitType);
  set('date', visit.date?.toISOString());
  set('chief_complaint', visit.chiefComplaint);
  set('vitals', visit.vitals);
  set('advice', visit.advice);
  set('advice_language', visit.adviceLanguage);
  set('advice_regional', visit.adviceRegional);
  set('follow_up_date', visit.followUpDate === null ? null : visit.followUpDate?.toISOString());
  set('physical_examination', visit.physicalExamination);
  set('doctor_notes', visit.doctorNotes);
  set('case_image_url', visit.caseImageUrl);
  set('visit_images', visit.visitImages);
  if (visit.symptoms) details.symptoms = visit.symptoms.map(s => ({
    name: s.name, severity: s.severity, duration: s.duration, notes: s.notes,
  }));
  if (visit.diagnoses) details.diagnoses = visit.diagnoses.map(d => ({
    name: d.name, icd10_code: d.icd10Code, is_primary: d.isPrimary, notes: d.notes,
  }));
  if (visit.prescriptions) details.prescriptions = visit.prescriptions.map(p => ({
    medicine: p.medicine, dosage: p.dosage || null, frequency: p.frequency || null,
    duration: p.duration || null, instructions: p.instructions || null,
    quantity: p.quantity != null && String(p.quantity) !== '' ? Number(p.quantity) : null,
    refills: p.refills != null && String(p.refills) !== '' ? Number(p.refills) : 0,
    route: p.route?.trim() || null,
  }));
  if (visit.testsOrdered) details.tests_ordered = visit.testsOrdered.map((test, index) => {
    if (!test.testName?.trim()) throw new Error(`Enter a name for test ${index + 1}, or remove the empty row.`);
    return {
      id: test.id || undefined,
      test_id: test.testId || null,
      testName: test.testName.trim(),
      test_type: test.testType,
      instructions: test.instructions || null,
      urgency: test.urgency,
      status: test.status,
      ordered_date: new Date(test.orderedDate).toISOString(),
      expected_date: test.expectedDate ? new Date(test.expectedDate).toISOString() : null,
    };
  });
  return { main, details };
}

// A failed related SELECT must never become an empty editable array: saving
// that array would erase data the user never got to see.
export function assertVisitDetailsLoaded(results: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const failed = results.find(result => result.error);
  if (failed?.error) throw new Error(`Could not load complete visit details: ${failed.error.message}. Please retry.`);
}
