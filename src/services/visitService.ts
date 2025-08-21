import { supabase } from '../lib/supabase';
import { Visit, Symptom, Diagnosis, Prescription, TestOrdered, TestResult, Patient, Profile } from '../types';
import { getCurrentProfile } from './profileService';
import type { DatabaseVisit, DatabaseSymptom, DatabaseDiagnosis, DatabasePrescription, DatabaseTestOrdered, DatabaseTestResult } from '../lib/supabase';

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
  date: new Date(dbVisit.date),
  chiefComplaint: dbVisit.chief_complaint || '',
  symptoms,
  vitals: dbVisit.vitals || {},
  diagnoses,
  prescriptions,
  testsOrdered,
  testResults,
  advice: dbVisit.advice || [],
  followUpDate: dbVisit.follow_up_date ? new Date(dbVisit.follow_up_date) : undefined,
  doctorNotes: dbVisit.doctor_notes || '',
  caseImageUrl: dbVisit.case_image_url,
  createdAt: new Date(dbVisit.created_at),
  updatedAt: new Date(dbVisit.updated_at),
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
  createdAt: new Date(dbPrescription.created_at)
});

// Convert database test ordered to app test ordered type
const convertDatabaseTestOrdered = (dbTestOrdered: DatabaseTestOrdered): TestOrdered => ({
  id: dbTestOrdered.id,
  visitId: dbTestOrdered.visit_id,
  testName: dbTestOrdered.test_name,
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

    // Get visits
    const { data: visits, error: visitsError } = await supabase
      .from('visits')
      .select(`
        *, clinic_id,
        patients (*),
        profiles (*)
      `)
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
        name: visit.patients.name,
        phone: visit.patients.phone,
        age: visit.patients.age,
        gender: visit.patients.gender,
        address: visit.patients.address,
        emergencyContact: visit.patients.emergency_contact,
        bloodGroup: visit.patients.blood_group,
        allergies: visit.patients.allergies,
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
        patients (*),
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
        name: visit.patients.name,
        phone: visit.patients.phone,
        age: visit.patients.age,
        gender: visit.patients.gender,
        address: visit.patients.address,
        emergencyContact: visit.patients.emergency_contact,
        bloodGroup: visit.patients.blood_group,
        allergies: visit.patients.allergies,
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

  // Add a new visit with all related data
  async addVisit(visit: Omit<Visit, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'>): Promise<Visit> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data: clinicProfile } = await supabase
    try {
      // Insert the main visit record
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .insert([{ clinic_id: profile.clinicId,
          patient_id: visit.patientId,
          doctor_id: visit.doctorId,
          appointment_id: visit.appointmentId,
          date: visit.date.toISOString(),
          chief_complaint: visit.chiefComplaint,
          vitals: visit.vitals,
          advice: visit.advice,
          follow_up_date: visit.followUpDate?.toISOString(),
          doctor_notes: visit.doctorNotes,
          case_image_url: visit.caseImageUrl
        }])
        .select()
        .single();

      if (visitError) {
        throw new Error('Failed to create visit');
      }

      const visitId = visitData.id;

      // Insert related data
      const insertPromises = [];

      // Insert symptoms
      if (visit.symptoms.length > 0) {
        const symptomsToInsert = visit.symptoms.map(symptom => ({
          visit_id: visitId,
          name: symptom.name,
          severity: symptom.severity,
          duration: symptom.duration,
          notes: symptom.notes
        }));
        insertPromises.push(supabase.from('symptoms').insert(symptomsToInsert));
      }

      // Insert diagnoses
      if (visit.diagnoses.length > 0) {
        const diagnosesToInsert = visit.diagnoses.map(diagnosis => ({
          visit_id: visitId,
          name: diagnosis.name,
          icd10_code: diagnosis.icd10Code,
          is_primary: diagnosis.isPrimary,
          notes: diagnosis.notes
        }));
        insertPromises.push(supabase.from('diagnoses').insert(diagnosesToInsert));
      }

      // Insert prescriptions
      if (visit.prescriptions.length > 0) {
        const prescriptionsToInsert = visit.prescriptions.map(prescription => ({
          visit_id: visitId,
          medicine: prescription.medicine,
          dosage: prescription.dosage,
          frequency: prescription.frequency,
          duration: prescription.duration,
          instructions: prescription.instructions,
          quantity: prescription.quantity,
          refills: prescription.refills
        }));
        insertPromises.push(supabase.from('prescriptions').insert(prescriptionsToInsert));
      }

      // Insert tests ordered
      if (visit.testsOrdered.length > 0) {
        const testsToInsert = visit.testsOrdered.map(test => ({
          visit_id: visitId,
          test_name: test.testName,
          test_type: test.testType,
          instructions: test.instructions,
          urgency: test.urgency,
          status: test.status,
          ordered_date: test.orderedDate.toISOString(),
          expected_date: test.expectedDate?.toISOString()
        }));
        insertPromises.push(supabase.from('tests_ordered').insert(testsToInsert));
      }

      // Insert test results
      if (visit.testResults.length > 0) {
        const resultsToInsert = visit.testResults.map(result => ({
          test_ordered_id: result.testOrderedId,
          visit_id: visitId,
          result: result.result,
          normal_range: result.normalRange,
          is_abnormal: result.isAbnormal,
          result_date: result.resultDate.toISOString(),
          report_url: result.reportUrl,
          notes: result.notes
        }));
        insertPromises.push(supabase.from('test_results').insert(resultsToInsert));
      }

      // Wait for all inserts to complete
      await Promise.all(insertPromises);

      // Fetch the complete visit with all related data
      const visits = await this.getPatientVisits(visit.patientId);
      const createdVisit = visits.find(v => v.id === visitId);

      if (!createdVisit) {
        throw new Error('Failed to retrieve created visit');
      }

      return createdVisit;

    } catch (error) {
      console.error('Error creating visit:', error);
      throw new Error('Failed to create visit with related data');
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
        patients (*),
        profiles (*)
      `)
      .eq('id', id)
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

    const symptoms = symptomsData.data?.map(convertDatabaseSymptom) || [];
    const diagnoses = diagnosesData.data?.map(convertDatabaseDiagnosis) || [];
    const prescriptions = prescriptionsData.data?.map(convertDatabasePrescription) || [];
    const testsOrdered = testsOrderedData.data?.map(convertDatabaseTestOrdered) || [];
    const testResults = testResultsData.data?.map(convertDatabaseTestResult) || [];

    return convertDatabaseVisit(
      visit,
      symptoms,
      diagnoses,
      prescriptions,
      testsOrdered,
      testResults,
      visit.patients ? {
        id: visit.patients.id,
        name: visit.patients.name,
        phone: visit.patients.phone,
        age: visit.patients.age,
        gender: visit.patients.gender,
        address: visit.patients.address,
        emergencyContact: visit.patients.emergency_contact,
        bloodGroup: visit.patients.blood_group,
        allergies: visit.patients.allergies,
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

  // Update a visit
  async updateVisit(id: string, visit: Partial<Omit<Visit, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'>>): Promise<Visit> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const dbVisit: any = {};
    
    if (visit.patientId) dbVisit.patient_id = visit.patientId;
    if (visit.doctorId) dbVisit.doctor_id = visit.doctorId;
    dbVisit.clinic_id = profile.clinicId;

    if (visit.appointmentId !== undefined) dbVisit.appointment_id = visit.appointmentId;
    if (visit.date) dbVisit.date = visit.date.toISOString();
    if (visit.chiefComplaint !== undefined) dbVisit.chief_complaint = visit.chiefComplaint;
    if (visit.vitals) dbVisit.vitals = visit.vitals;
    if (visit.advice) dbVisit.advice = visit.advice;
    if (visit.followUpDate !== undefined) dbVisit.follow_up_date = visit.followUpDate?.toISOString();
    if (visit.doctorNotes !== undefined) dbVisit.doctor_notes = visit.doctorNotes;
    if (visit.caseImageUrl !== undefined) dbVisit.case_image_url = visit.caseImageUrl;

    const { error } = await supabase
      .from('visits')
      .eq('clinic_id', profile.clinicId)
      .update(dbVisit)
      .eq('id', id);

    if (error) {
      throw new Error('Failed to update visit');
    }

    // Return the updated visit
    const updatedVisit = await this.getVisit(id);
    if (!updatedVisit) {
      throw new Error('Failed to retrieve updated visit');
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
        name: visit.patients.name,
        phone: visit.patients.phone,
        age: visit.patients.age,
        gender: visit.patients.gender,
        address: visit.patients.address,
        emergencyContact: visit.patients.emergency_contact,
        bloodGroup: visit.patients.blood_group,
        allergies: visit.patients.allergies,
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
  }
};