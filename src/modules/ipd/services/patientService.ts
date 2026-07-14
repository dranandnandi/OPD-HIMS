import { supabase } from '../utils/supabase';
import type { Patient, Profile } from '../types/ipd';

export const patientService = {
  /** Search shared OPD patients by name or phone */
  async search(clinicId: string, term: string): Promise<Patient[]> {
    if (!term || term.trim().length < 2) return [];
    const { data, error } = await supabase
      .from('patients')
      .select('id, clinic_id, name, phone, age, gender, address, blood_group, allergies, abha_number')
      .eq('clinic_id', clinicId)
      .eq('is_hidden', false)
      .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
      .order('last_visit', { ascending: false, nullsFirst: false })
      .limit(15);
    if (error) throw error;
    return data as Patient[];
  },

  /** Doctors from shared profiles: doctor-role users PLUS anyone the OPD app
      marks "open for consultation" (same list the OPD appointment book uses) */
  async listDoctors(clinicId: string): Promise<Profile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, clinic_id, name, email, role_name, specialization, permissions, is_active')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .or('role_name.ilike.%doctor%,is_open_for_consultation.eq.true')
      .order('name');
    if (error) throw error;
    return data as Profile[];
  },

  /** OPD visit history for the IPD chart timeline (read-only) */
  async listVisits(patientId: string, limit = 20) {
    const { data, error } = await supabase
      .from('visits')
      .select('id, date, visit_date, chief_complaint, diagnosis, doctor_notes, doctor_id, doctor:profiles!visits_doctor_id_fkey(name)')
      .eq('patient_id', patientId)
      .order('visit_date', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as unknown as Array<{
      id: string;
      date: string | null;
      visit_date: string | null;
      chief_complaint: string | null;
      diagnosis: string[] | null;
      doctor_notes: string | null;
      doctor_id: string | null;
      doctor: { name: string | null } | null;
    }>;
  },
};
