import { Patient } from '../types';

/**
 * The clinic-facing patient number, from whichever casing the row carries.
 *
 * Rows arrive both ways: `patient_number` straight from the database and
 * `patientNumber` once a service has camel-cased it. Callers should not have
 * to know which one they were handed.
 */
export const getPatientNumber = (patient?: Patient | null): string =>
  patient?.patientNumber || patient?.patient_number || '';
