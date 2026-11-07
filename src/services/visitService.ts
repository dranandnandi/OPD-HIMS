import { supabase } from '../lib/supabase';
import { Visit, Symptom, Diagnosis, Prescription, TestOrdered, TestResult, Patient, Profile } from '../types';
import { getCurrentProfile } from './profileService';
import { limsService } from './limsService';
import { buildVisitSavePayload, assertVisitDetailsLoaded, type VisitSaveOptions } from '../utils/visitSave';
import type { DatabaseVisit, DatabaseSymptom, DatabaseDiagnosis, DatabasePrescription, DatabaseTestOrdered, DatabaseTestResult } from '../lib/supabase';

// PostgREST caps each response. Fetch every page for visit totals and exports.
async function collectPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error('Failed to fetch complete visit data');
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function collectRelated<T>(ids: string[], fetchPage: (ids: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const data: T[] = [];
  // Bound URL length as well as the number of rows returned.
  for (let index = 0; index < ids.length; index += 100) {
    data.push(...await collectPages((from, to) => fetchPage(ids.slice(index, index + 100), from, to)));
  }
  return { data, error: null };
}

const deduplicatePrescriptions = <T extends {
  medicine: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  quantity?: number | null;
  refills?: number | null;
  route?: string | null;
}>(prescriptions: T[]): T[] => {
  const seen = new Set<string>();

  return prescriptions.filter((prescription) => {
    const key = JSON.stringify([
      prescription.medicine.trim().toLowerCase(),
      prescription.dosage?.trim().toLowerCase() || '',
      prescription.frequency?.trim().toLowerCase() || '',
      prescription.duration?.trim().toLowerCase() || '',
      prescription.instructions?.trim().toLowerCase() || '',
      prescription.quantity ?? null,
      prescription.refills ?? 0,
      prescription.route?.trim().toLowerCase() || ''
    ]);

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Convert database visit to app visit type
const convertDatabaseVisit = (
  dbVisit: DatabaseVisit,
  symptoms: Symptom[] = [],
  diagnoses: Diagnosis[] = [],
  prescriptions: Prescription[] = [],
  testsOrdered: TestOrdered[] = [],
  testResults: TestResult[] = [],
  patient?: Patient,
  doctor?: Profile
): Visit => ({
  id: dbVisit.id,
  patientId: dbVisit.patient_id,
  doctorId: dbVisit.doctor_id,
  appointmentId: dbVisit.appointment_id,
  visitType: dbVisit.visit_type ?? null,
  date: new Date(dbVisit.date),
  chiefComplaint: dbVisit.chief_complaint || '',
  symptoms,
  vitals: dbVisit.vitals || {},
  diagnoses,
  prescriptions: deduplicatePrescriptions(prescriptions),
  testsOrdered,
  testResults,
  advice: dbVisit.advice || [],
  adviceLanguage: (dbVisit as any).advice_language || 'english',
  adviceRegional: (dbVisit as any).advice_regional || '',
  followUpDate: dbVisit.follow_up_date ? new Date(dbVisit.follow_up_date) : undefined,
  physicalExamination: dbVisit.physical_examination || undefined,
  doctorNotes: dbVisit.doctor_notes || '',
  caseImageUrl: dbVisit.case_image_url,
  visitImages: (dbVisit as any).visit_images || undefined,
  pdf_url: dbVisit.pdf_url || undefined,
  pdf_generated_at: dbVisit.pdf_generated_at ? new Date(dbVisit.pdf_generated_at) : undefined,
  print_pdf_url: dbVisit.print_pdf_url || undefined,
  print_pdf_generated_at: dbVisit.print_pdf_generated_at ? new Date(dbVisit.print_pdf_generated_at) : undefined,
  compact_print_pdf_url: dbVisit.compact_print_pdf_url || undefined,
  createdAt: new Date(dbVisit.created_at),
  updatedAt: new Date(dbVisit.updated_at),
  saveVersion: dbVisit.updated_at,
  patient,
  doctor
});

// Convert database symptom to app symptom type
const convertDatabaseSymptom = (dbSymptom: DatabaseSymptom): Symptom => ({
  id: dbSymptom.id,
  visitId: dbSymptom.visit_id,
  name: dbSymptom.name,
  severity: dbSymptom.severity,
  duration: dbSymptom.duration,
  notes: dbSymptom.notes,
  createdAt: new Date(dbSymptom.created_at)
});

// Convert database diagnosis to app diagnosis type
const convertDatabaseDiagnosis = (dbDiagnosis: DatabaseDiagnosis): Diagnosis => ({
  id: dbDiagnosis.id,
  visitId: dbDiagnosis.visit_id,
  name: dbDiagnosis.name,
  icd10Code: dbDiagnosis.icd10_code,
  isPrimary: dbDiagnosis.is_primary,
  notes: dbDiagnosis.notes,
  createdAt: new Date(dbDiagnosis.created_at)
});

// Convert database prescription to app prescription type
const convertDatabasePrescription = (dbPrescription: DatabasePrescription): Prescription => ({
  id: dbPrescription.id,
  visitId: dbPrescription.visit_id,
  medicine: dbPrescription.medicine,
  dosage: dbPrescription.dosage,
  frequency: dbPrescription.frequency,
  duration: dbPrescription.duration,
  instructions: dbPrescription.instructions,
  quantity: dbPrescription.quantity,
  refills: dbPrescription.refills,
  route: dbPrescription.route ?? undefined,
  createdAt: new Date(dbPrescription.created_at)
});

// Convert database test ordered to app test ordered type
const convertDatabaseTestOrdered = (dbTestOrdered: DatabaseTestOrdered): TestOrdered => ({
  id: dbTestOrdered.id,
  visitId: dbTestOrdered.visit_id,
  testName: dbTestOrdered.testName,
  testId: dbTestOrdered.test_id || undefined,
  testType: dbTestOrdered.test_type,
  instructions: dbTestOrdered.instructions,
  urgency: dbTestOrdered.urgency,
  status: dbTestOrdered.status,
  orderedDate: new Date(dbTestOrdered.ordered_date),
  expectedDate: dbTestOrdered.expected_date ? new Date(dbTestOrdered.expected_date) : undefined,
  createdAt: new Date(dbTestOrdered.created_at)
});

// Convert database test result to app test result type
const convertDatabaseTestResult = (dbTestResult: DatabaseTestResult, testOrdered?: TestOrdered): TestResult => ({
  id: dbTestResult.id,
  testOrderedId: dbTestResult.test_ordered_id,
  visitId: dbTestResult.visit_id,
  result: dbTestResult.result,
  normalRange: dbTestResult.normal_range,
  isAbnormal: dbTestResult.is_abnormal,
  resultDate: new Date(dbTestResult.result_date),
  reportUrl: dbTestResult.report_url,
  notes: dbTestResult.notes,
  createdAt: new Date(dbTestResult.created_at),
  testOrdered
});

export const visitService = {
  // Get all visits with related data
  async getAllVisits(): Promise<Visit[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    // Get every visit, with stable ordering across pages.
    const client = supabase;
    const visits = await collectPages((from, to) => client
      .from('visits')
      .select(`
        *, clinic_id,
        patients!inner (*),
        profiles (*)
      `)
      .eq('clinic_id', profile.clinicId)
      .eq('patients.is_hidden', false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to));

    // Get related data for all visits
    const visitIds = visits.map(visit => visit.id);

    const [symptomsData, diagnosesData, prescriptionsData, testsOrderedData, testResultsData] = await Promise.all([
      collectRelated(visitIds, (ids, from, to) => client.from('symptoms').select('*').in('visit_id', ids).order('id').range(from, to)),
      collectRelated(visitIds, (ids, from, to) => client.from('diagnoses').select('*').in('visit_id', ids).order('id').range(from, to)),
      collectRelated(visitIds, (ids, from, to) => client.from('prescriptions').select('*').in('visit_id', ids).order('id').range(from, to)),
      collectRelated(visitIds, (ids, from, to) => client.from('tests_ordered').select('*').in('visit_id', ids).order('id').range(from, to)),
      collectRelated(visitIds, (ids, from, to) => client.from('test_results').select('*').in('visit_id', ids).order('id').range(from, to))
    ]);

    assertVisitDetailsLoaded([symptomsData, diagnosesData, prescriptionsData, testsOrderedData, testResultsData]);

    // Group related data by visit ID
    const symptomsByVisit = new Map<string, Symptom[]>();
    const diagnosesByVisit = new Map<string, Diagnosis[]>();
    const prescriptionsByVisit = new Map<string, Prescription[]>();
    const testsOrderedByVisit = new Map<string, TestOrdered[]>();
    const testResultsByVisit = new Map<string, TestResult[]>();

    symptomsData.data?.forEach(symptom => {
      const visitSymptoms = symptomsByVisit.get(symptom.visit_id) || [];
      visitSymptoms.push(convertDatabaseSymptom(symptom));
      symptomsByVisit.set(symptom.visit_id, visitSymptoms);
    });

    diagnosesData.data?.forEach(diagnosis => {
      const visitDiagnoses = diagnosesByVisit.get(diagnosis.visit_id) || [];
      visitDiagnoses.push(convertDatabaseDiagnosis(diagnosis));
      diagnosesByVisit.set(diagnosis.visit_id, visitDiagnoses);
    });

    prescriptionsData.data?.forEach(prescription => {
      const visitPrescriptions = prescriptionsByVisit.get(prescription.visit_id) || [];
      visitPrescriptions.push(convertDatabasePrescription(prescription));
      prescriptionsByVisit.set(prescription.visit_id, visitPrescriptions);
    });

    testsOrderedData.data?.forEach(testOrdered => {
      const visitTestsOrdered = testsOrderedByVisit.get(testOrdered.visit_id) || [];
      visitTestsOrdered.push(convertDatabaseTestOrdered(testOrdered));
      testsOrderedByVisit.set(testOrdered.visit_id, visitTestsOrdered);
    });

    testResultsData.data?.forEach(testResult => {
      const visitTestResults = testResultsByVisit.get(testResult.visit_id) || [];
      visitTestResults.push(convertDatabaseTestResult(testResult));
      testResultsByVisit.set(testResult.visit_id, visitTestResults);
    });

    // Convert visits with related data
    return visits.map(visit => convertDatabaseVisit(
      visit,
      symptomsByVisit.get(visit.id) || [],
      diagnosesByVisit.get(visit.id) || [],
      prescriptionsByVisit.get(visit.id) || [],
      testsOrderedByVisit.get(visit.id) || [],
      testResultsByVisit.get(visit.id) || [],
      visit.patients ? {
        id: visit.patients.id,
        patientNumber: visit.patients.patient_number,
        patient_number: visit.patients.patient_number,
        name: visit.patients.name,
        phone: visit.patients.phone,
        age: visit.patients.age,
        gender: visit.patients.gender,
        address: visit.patients.address,
        emergencyContact: visit.patients.emergency_contact,
        bloodGroup: visit.patients.blood_group,
        allergies: visit.patients.allergies,
        // Carried through so a visit can tell whether ABDM sharing applies at
        // all, without a round trip per visit opened.
        abha_number: visit.patients.abha_number,
        abha_address: visit.patients.abha_address,
        abha_consent_given: visit.patients.abha_consent_given,
        createdAt: new Date(visit.patients.created_at),
        lastVisit: visit.patients.last_visit ? new Date(visit.patients.last_visit) : undefined
      } : undefined,
      visit.profiles ? {
        id: visit.profiles.id,
        userId: visit.profiles.user_id,
        roleId: visit.profiles.role_id,
        name: visit.profiles.name,
        email: visit.profiles.email,
        phone: visit.profiles.phone,
        specialization: visit.profiles.specialization,
        qualification: visit.profiles.qualification,
        registrationNo: visit.profiles.registration_no,
        isActive: visit.profiles.is_active,
        createdAt: new Date(visit.profiles.created_at),
        updatedAt: new Date(visit.profiles.updated_at)
      } : undefined
    ));
  },

  // Get all visits for a patient with related data
  async getPatientVisits(patientId: string): Promise<Visit[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    // Get visits
    const { data: visits, error: visitsError } = await supabase
      .from('visits')
      .select(`
        *, clinic_id,
        patients!inner (*),
        profiles (*)
      `)
      .eq('patient_id', patientId)
      .eq('clinic_id', profile.clinicId)
      .order('created_at', { ascending: false });

    if (visitsError) {
      throw new Error('Failed to fetch visits');
    }

    // Get related data for all visits
    const visitIds = visits.map(visit => visit.id);

    const [symptomsData, diagnosesData, prescriptionsData, testsOrderedData, testResultsData] = await Promise.all([
      supabase.from('symptoms').select('*').in('visit_id', visitIds),
      supabase.from('diagnoses').select('*').in('visit_id', visitIds),
      supabase.from('prescriptions').select('*').in('visit_id', visitIds),
      supabase.from('tests_ordered').select('*').in('visit_id', visitIds),
      supabase.from('test_results').select('*').in('visit_id', visitIds)
    ]);

    assertVisitDetailsLoaded([symptomsData, diagnosesData, prescriptionsData, testsOrderedData, testResultsData]);

    // Group related data by visit ID
    const symptomsByVisit = new Map<string, Symptom[]>();
    const diagnosesByVisit = new Map<string, Diagnosis[]>();
    const prescriptionsByVisit = new Map<string, Prescription[]>();
    const testsOrderedByVisit = new Map<string, TestOrdered[]>();
    const testResultsByVisit = new Map<string, TestResult[]>();

    symptomsData.data?.forEach(symptom => {
      const visitSymptoms = symptomsByVisit.get(symptom.visit_id) || [];
      visitSymptoms.push(convertDatabaseSymptom(symptom));
      symptomsByVisit.set(symptom.visit_id, visitSymptoms);
    });

    diagnosesData.data?.forEach(diagnosis => {
      const visitDiagnoses = diagnosesByVisit.get(diagnosis.visit_id) || [];
      visitDiagnoses.push(convertDatabaseDiagnosis(diagnosis));
      diagnosesByVisit.set(diagnosis.visit_id, visitDiagnoses);
    });

    prescriptionsData.data?.forEach(prescription => {
      const visitPrescriptions = prescriptionsByVisit.get(prescription.visit_id) || [];
      visitPrescriptions.push(convertDatabasePrescription(prescription));
      prescriptionsByVisit.set(prescription.visit_id, visitPrescriptions);
    });

    testsOrderedData.data?.forEach(testOrdered => {
      const visitTestsOrdered = testsOrderedByVisit.get(testOrdered.visit_id) || [];
      visitTestsOrdered.push(convertDatabaseTestOrdered(testOrdered));
      testsOrderedByVisit.set(testOrdered.visit_id, visitTestsOrdered);
    });

    testResultsData.data?.forEach(testResult => {
      const visitTestResults = testResultsByVisit.get(testResult.visit_id) || [];
      visitTestResults.push(convertDatabaseTestResult(testResult));
      testResultsByVisit.set(testResult.visit_id, visitTestResults);
    });

    // Convert visits with related data
    return visits.map(visit => convertDatabaseVisit(
      visit,
      symptomsByVisit.get(visit.id) || [],
      diagnosesByVisit.get(visit.id) || [],
      prescriptionsByVisit.get(visit.id) || [],
      testsOrderedByVisit.get(visit.id) || [],
      testResultsByVisit.get(visit.id) || [],
      visit.patients ? {
        id: visit.patients.id,
        patientNumber: visit.patients.patient_number,
        patient_number: visit.patients.patient_number,
        name: visit.patients.name,
        phone: visit.patients.phone,
        age: visit.patients.age,
        gender: visit.patients.gender,
        address: visit.patients.address,
        emergencyContact: visit.patients.emergency_contact,
        bloodGroup: visit.patients.blood_group,
        allergies: visit.patients.allergies,
        // Carried through so a visit can tell whether ABDM sharing applies at
        // all, without a round trip per visit opened.
        abha_number: visit.patients.abha_number,
        abha_address: visit.patients.abha_address,
        abha_consent_given: visit.patients.abha_consent_given,
        createdAt: new Date(visit.patients.created_at),
        lastVisit: visit.patients.last_visit ? new Date(visit.patients.last_visit) : undefined
      } : undefined,
      visit.profiles ? {
        id: visit.profiles.id,
        userId: visit.profiles.user_id,
        roleId: visit.profiles.role_id,
        name: visit.profiles.name,
        email: visit.profiles.email,
        phone: visit.profiles.phone,
        specialization: visit.profiles.specialization,
        qualification: visit.profiles.qualification,
        registrationNo: visit.profiles.registration_no,
        isActive: visit.profiles.is_active,
        createdAt: new Date(visit.profiles.created_at),
        updatedAt: new Date(visit.profiles.updated_at)
      } : undefined
    ));
  },

  // The RPC owns the transaction. Never fall back to separate writes: a
  // missing deployment or failed child insert must leave the form open.
  async addVisit(visit: Omit<Visit, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'>, options: VisitSaveOptions = {}): Promise<Visit> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const payload = buildVisitSavePayload({ ...visit, prescriptions: deduplicatePrescriptions(visit.prescriptions) });
    payload.main.id = options.newVisitId || options.requestId || crypto.randomUUID();
    const details: Record<string, unknown> = payload.details;
    if (visit.testResults.length) details.test_results = visit.testResults.map(result => ({
      id: result.id || undefined, test_ordered_id: result.testOrderedId,
      result: result.result, normal_range: result.normalRange, is_abnormal: result.isAbnormal,
      result_date: result.resultDate.toISOString(), report_url: result.reportUrl,
    }));
    const { data: visitId, error } = await supabase.rpc('save_visit_with_details', {
      p_visit_id: null, p_visit: payload.main, p_details: details,
      p_request_id: options.requestId || crypto.randomUUID(), p_expected_updated_at: null,
    });
    if (error) throw new Error(`Visit was not saved: ${error.message}`);
    if (!visitId) throw new Error('The server did not confirm the visit save. Retry using this form.');
    const createdVisit = await this.getVisit(visitId);
    if (!createdVisit) throw new Error('Could not reload the saved visit. Retry using this form.');
    if (createdVisit.testsOrdered.length && createdVisit.patient) {
      this.sendTestsToLimsIfEnabled(visitId, createdVisit.patient, createdVisit.testsOrdered, createdVisit.doctor?.name);
    }
    return createdVisit;
  },

  // Helper: Send tests to LIMS if integration is enabled (fire-and-forget)
  async sendTestsToLimsIfEnabled(
    visitId: string,
    patient: Patient,
    tests: TestOrdered[],
    referringDoctor?: string
  ): Promise<void> {
    try {
      const isEnabled = await limsService.isLimsEnabled();
      if (!isEnabled) return;

      const labTests = tests.filter(t => t.testType === 'lab' && t.status === 'ordered');
      if (labTests.length === 0) return;

      const result = await limsService.sendOrderToLims(visitId, patient, labTests, referringDoctor);
      console.log('LIMS order sent successfully:', result.limsSampleId);
    } catch (error) {
      console.error('Failed to send tests to LIMS (non-blocking):', error);
    }
  },

  // Get a single visit by ID
  async getVisit(id: string): Promise<Visit | null> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data: visit, error: visitError } = await supabase
      .from('visits')
      .select(`
        *,
        clinic_id,
        patients!inner (*),
        profiles (*)
      `)
      .eq('id', id)
      .eq('clinic_id', profile.clinicId)
      .single();


    if (visitError) {
      if (visitError.code === 'PGRST116') {
        return null;
      }
      throw new Error('Failed to fetch visit');
    }

    // Get related data
    const [symptomsData, diagnosesData, prescriptionsData, testsOrderedData, testResultsData] = await Promise.all([
      supabase.from('symptoms').select('*').eq('visit_id', id),
      supabase.from('diagnoses').select('*').eq('visit_id', id),
      supabase.from('prescriptions').select('*').eq('visit_id', id),
      supabase.from('tests_ordered').select('*').eq('visit_id', id),
      supabase.from('test_results').select('*').eq('visit_id', id)
    ]);

    assertVisitDetailsLoaded([symptomsData, diagnosesData, prescriptionsData, testsOrderedData, testResultsData]);

    const symptoms = symptomsData.data?.map(convertDatabaseSymptom) || [];
    const diagnoses = diagnosesData.data?.map(convertDatabaseDiagnosis) || [];
    const prescriptions = prescriptionsData.data?.map(convertDatabasePrescription) || [];
    const testsOrdered = testsOrderedData.data?.map(convertDatabaseTestOrdered) || [];
    const testResults = testResultsData.data?.map(result => convertDatabaseTestResult(result)) || [];

    return convertDatabaseVisit(
      visit,
      symptoms,
      diagnoses,
      prescriptions,
      testsOrdered,
      testResults,
      visit.patients ? {
        id: visit.patients.id,
        patientNumber: visit.patients.patient_number,
        patient_number: visit.patients.patient_number,
        name: visit.patients.name,
        phone: visit.patients.phone,
        age: visit.patients.age,
        gender: visit.patients.gender,
        address: visit.patients.address,
        emergencyContact: visit.patients.emergency_contact,
        bloodGroup: visit.patients.blood_group,
        allergies: visit.patients.allergies,
        // Carried through so a visit can tell whether ABDM sharing applies at
        // all, without a round trip per visit opened.
        abha_number: visit.patients.abha_number,
        abha_address: visit.patients.abha_address,
        abha_consent_given: visit.patients.abha_consent_given,
        createdAt: new Date(visit.patients.created_at),
        lastVisit: visit.patients.last_visit ? new Date(visit.patients.last_visit) : undefined
      } : undefined,
      visit.profiles ? {
        id: visit.profiles.id,
        userId: visit.profiles.user_id,
        roleId: visit.profiles.role_id,
        name: visit.profiles.name,
        email: visit.profiles.email,
        phone: visit.profiles.phone,
        specialization: visit.profiles.specialization,
        qualification: visit.profiles.qualification,
        registrationNo: visit.profiles.registration_no,
        isActive: visit.profiles.is_active,
        createdAt: new Date(visit.profiles.created_at),
        updatedAt: new Date(visit.profiles.updated_at)
      } : undefined
    );
  },

  // Partial updates (e.g. billing's doctor change) omit untouched arrays.
  async updateVisit(id: string, visit: Partial<Omit<Visit, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'>>, options: VisitSaveOptions = {}): Promise<Visit> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const payload = buildVisitSavePayload({ ...visit,
      prescriptions: visit.prescriptions ? deduplicatePrescriptions(visit.prescriptions) : undefined,
    });
    const { data: savedId, error } = await supabase.rpc('save_visit_with_details', {
      p_visit_id: id, p_visit: payload.main, p_details: payload.details,
      p_request_id: options.requestId || crypto.randomUUID(),
      p_expected_updated_at: options.expectedUpdatedAt || null,
    });
    if (error) throw new Error(`Visit was not updated: ${error.message}`);
    if (savedId !== id) throw new Error('The server did not confirm the visit update. Retry using this form.');
    const updatedVisit = await this.getVisit(id);
    if (!updatedVisit) throw new Error('Could not reload the saved visit. Retry using this form.');
    if (visit.testsOrdered?.length && updatedVisit.patient) {
      this.sendTestsToLimsIfEnabled(id, updatedVisit.patient, updatedVisit.testsOrdered, updatedVisit.doctor?.name);
    }
    return updatedVisit;
  },

  // Get visits with follow-up dates for follow-up management
  async getVisitsWithFollowUps(): Promise<Visit[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    // Get visits with follow-up dates
    const { data: visits, error: visitsError } = await supabase
      .from('visits')
      .select(`
        *, clinic_id,
        patients (*),
        profiles (*)
      `)
      .not('follow_up_date', 'is', null)
      .eq('clinic_id', profile.clinicId)
      .eq('patients.is_hidden', false)
      .order('created_at', { ascending: false });

    if (visitsError) {
      throw new Error('Failed to fetch follow-up visits');
    }

    // Get related data for all visits
    const visitIds = visits.map(visit => visit.id);

    const [symptomsData, diagnosesData, prescriptionsData, testsOrderedData, testResultsData] = await Promise.all([
      supabase.from('symptoms').select('*').in('visit_id', visitIds),
      supabase.from('diagnoses').select('*').in('visit_id', visitIds),
      supabase.from('prescriptions').select('*').in('visit_id', visitIds),
      supabase.from('tests_ordered').select('*').in('visit_id', visitIds),
      supabase.from('test_results').select('*').in('visit_id', visitIds)
    ]);

    assertVisitDetailsLoaded([symptomsData, diagnosesData, prescriptionsData, testsOrderedData, testResultsData]);

    // Group related data by visit ID
    const symptomsByVisit = new Map<string, Symptom[]>();
    const diagnosesByVisit = new Map<string, Diagnosis[]>();
    const prescriptionsByVisit = new Map<string, Prescription[]>();
    const testsOrderedByVisit = new Map<string, TestOrdered[]>();
    const testResultsByVisit = new Map<string, TestResult[]>();

    symptomsData.data?.forEach(symptom => {
      const visitSymptoms = symptomsByVisit.get(symptom.visit_id) || [];
      visitSymptoms.push(convertDatabaseSymptom(symptom));
      symptomsByVisit.set(symptom.visit_id, visitSymptoms);
    });

    diagnosesData.data?.forEach(diagnosis => {
      const visitDiagnoses = diagnosesByVisit.get(diagnosis.visit_id) || [];
      visitDiagnoses.push(convertDatabaseDiagnosis(diagnosis));
      diagnosesByVisit.set(diagnosis.visit_id, visitDiagnoses);
    });

    prescriptionsData.data?.forEach(prescription => {
      const visitPrescriptions = prescriptionsByVisit.get(prescription.visit_id) || [];
      visitPrescriptions.push(convertDatabasePrescription(prescription));
      prescriptionsByVisit.set(prescription.visit_id, visitPrescriptions);
    });

    testsOrderedData.data?.forEach(testOrdered => {
      const visitTestsOrdered = testsOrderedByVisit.get(testOrdered.visit_id) || [];
      visitTestsOrdered.push(convertDatabaseTestOrdered(testOrdered));
      testsOrderedByVisit.set(testOrdered.visit_id, visitTestsOrdered);
    });

    testResultsData.data?.forEach(testResult => {
      const visitTestResults = testResultsByVisit.get(testResult.visit_id) || [];
      visitTestResults.push(convertDatabaseTestResult(testResult));
      testResultsByVisit.set(testResult.visit_id, visitTestResults);
    });

    // Convert visits with related data
    return visits.map(visit => convertDatabaseVisit(
      visit,
      symptomsByVisit.get(visit.id) || [],
      diagnosesByVisit.get(visit.id) || [],
      prescriptionsByVisit.get(visit.id) || [],
      testsOrderedByVisit.get(visit.id) || [],
      testResultsByVisit.get(visit.id) || [],
      visit.patients ? {
        id: visit.patients.id,
        patientNumber: visit.patients.patient_number,
        patient_number: visit.patients.patient_number,
        name: visit.patients.name,
        phone: visit.patients.phone,
        age: visit.patients.age,
        gender: visit.patients.gender,
        address: visit.patients.address,
        emergencyContact: visit.patients.emergency_contact,
        bloodGroup: visit.patients.blood_group,
        allergies: visit.patients.allergies,
        // Carried through so a visit can tell whether ABDM sharing applies at
        // all, without a round trip per visit opened.
        abha_number: visit.patients.abha_number,
        abha_address: visit.patients.abha_address,
        abha_consent_given: visit.patients.abha_consent_given,
        createdAt: new Date(visit.patients.created_at),
        lastVisit: visit.patients.last_visit ? new Date(visit.patients.last_visit) : undefined
      } : undefined,
      visit.profiles ? {
        id: visit.profiles.id,
        userId: visit.profiles.user_id,
        roleId: visit.profiles.role_id,
        name: visit.profiles.name,
        email: visit.profiles.email,
        phone: visit.profiles.phone,
        specialization: visit.profiles.specialization,
        qualification: visit.profiles.qualification,
        registrationNo: visit.profiles.registration_no,
        isActive: visit.profiles.is_active,
        createdAt: new Date(visit.profiles.created_at),
        updatedAt: new Date(visit.profiles.updated_at)
      } : undefined
    ));
  },

  // Delete a visit and all related data
  async deleteVisit(id: string): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      // Delete all related records first (cascade delete pattern)
      const deleteOperations = [
        supabase.from('symptoms').delete().eq('visit_id', id),
        supabase.from('diagnoses').delete().eq('visit_id', id),
        supabase.from('prescriptions').delete().eq('visit_id', id),
        supabase.from('tests_ordered').delete().eq('visit_id', id),
        supabase.from('test_results').delete().eq('visit_id', id)
      ];

      // Execute all delete operations in parallel
      const results = await Promise.all(deleteOperations);

      // Check for errors in related data deletion
      for (const result of results) {
        if (result.error) {
          console.error('Error deleting related data:', result.error);
        }
      }

      // Finally delete the visit itself
      const { error: visitError } = await supabase
        .from('visits')
        .delete()
        .eq('id', id)
        .eq('clinic_id', profile.clinicId);

      if (visitError) {
        throw new Error('Failed to delete visit');
      }
    } catch (error) {
      console.error('Error deleting visit:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to delete visit');
    }
  }
};
