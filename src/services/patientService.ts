import { supabase } from '../lib/supabase';
import { getCurrentProfile } from './profileService';
import { Patient } from '../types';

// Check if Supabase is available
const isSupabaseAvailable = (): boolean => {
  return supabase !== null && supabase !== undefined;
};

export const patientService = {
  // Check if patient exists by phone number
  async checkIfPatientExistsByPhone(phone: string): Promise<boolean> {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase client not available. Please check your configuration.');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data, error } = await supabase!
        .from('patients')
        .select('id')
        .eq('phone', phone)
        .eq('clinic_id', profile.clinicId)
        .limit(1);

      if (error) {
        throw new Error(`Failed to check phone number: ${error.message}`);
      }

      return data && data.length > 0;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error checking phone number:', error);
      }
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          throw new Error('Network error: Please check your internet connection and try again.');
        }
        throw error;
      }
      throw new Error('Failed to check phone number');
    }
  },

  // Get all patients
  async getPatients(): Promise<Patient[]> {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase client not available. Please check your configuration.');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data, error } = await supabase!
        .from('patients')
        .select('*')
        .eq('clinic_id', profile.clinicId)
        .order('created_at', { ascending: false });

      if (error) {
        if (import.meta.env.DEV) {
          console.error('Error fetching patients:', error);
        }
        throw new Error(`Failed to fetch patients: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error fetching patients:', error);
      }
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          throw new Error('Network error: Please check your internet connection and try again.');
        }
        throw error;
      }
      throw new Error('Failed to fetch patients');
    }
  },

  // Get patient by ID
  async getPatientById(id: string): Promise<Patient | null> {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase client not available. Please check your configuration.');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data, error } = await supabase!
        .from('patients')
        .select('id, name, phone, age, gender, address, emergency_contact, blood_group, allergies, referred_by, created_at, last_visit')
        .eq('id', id)
        .eq('clinic_id', profile.clinicId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Patient not found
        }
        throw new Error(`Failed to fetch patient: ${error.message}`);
      }

      return data;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error fetching patient:', error);
      }
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          throw new Error('Network error: Please check your internet connection and try again.');
        }
        throw error;
      }
      throw new Error('Failed to fetch patient');
    }
  },

  // Add new patient
  async addPatient(patient: Omit<Patient, 'id' | 'createdAt' | 'lastVisit'>): Promise<Patient> {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase client not available. Please check your configuration.');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data, error } = await supabase!
        .from('patients')
        .insert([{
          ...patient,
          clinic_id: profile.clinicId
        }])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to add patient: ${error.message}`);
      }

      return data;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error adding patient:', error);
      }
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          throw new Error('Network error: Please check your internet connection and try again.');
        }
        throw error;
      }
      throw new Error('Failed to add patient');
    }
  },

  // Update patient
  async updatePatient(id: string, updates: Partial<Patient>): Promise<Patient> {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase client not available. Please check your configuration.');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data, error } = await supabase!
        .from('patients')
        .update(updates)
        .eq('id', id)
        .eq('clinic_id', profile.clinicId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update patient: ${error.message}`);
      }

      return data;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error updating patient:', error);
      }
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          throw new Error('Network error: Please check your internet connection and try again.');
        }
        throw error;
      }
      throw new Error('Failed to update patient');
    }
  },

  // Delete patient
  async deletePatient(id: string): Promise<void> {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase client not available. Please check your configuration.');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { error } = await supabase!
        .from('patients')
        .delete()
        .eq('id', id)
        .eq('clinic_id', profile.clinicId);

      if (error) {
        throw new Error(`Failed to delete patient: ${error.message}`);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error deleting patient:', error);
      }
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          throw new Error('Network error: Please check your internet connection and try again.');
        }
        throw error;
      }
      throw new Error('Failed to delete patient');
    }
  },

  // Search patients by name or phone
  async searchPatients(query: string): Promise<Patient[]> {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase client not available. Please check your configuration.');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data, error } = await supabase!
        .from('patients')
        .select('id, name, phone, age, gender, address, emergency_contact, blood_group, allergies, referred_by, created_at, last_visit')
        .eq('clinic_id', profile.clinicId)
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to search patients: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error searching patients:', error);
      }
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          throw new Error('Network error: Please check your internet connection and try again.');
        }
        throw error;
      }
      throw new Error('Failed to search patients');
    }
  }
};