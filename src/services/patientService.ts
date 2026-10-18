import { supabase } from '../lib/supabase';
import { getCurrentProfile } from './profileService';
import { Patient } from '../types';
import { WhatsAppAutoSendService } from './whatsappAutoSendService';
import { phoneMatchKey } from '../utils/phoneUtils';

// Check if Supabase is available
const isSupabaseAvailable = (): boolean => {
  return supabase !== null && supabase !== undefined;
};

// Shared projection. `phone_norm` is deliberately absent: it is a generated
// column that exists for matching inside the database, and nothing in the UI
// should read or display it instead of the number reception actually typed.
const PATIENT_COLUMNS =
  'id, patient_number, name, phone, age, date_of_birth, gender, address, emergency_contact, blood_group, allergies, referred_by, created_at, last_visit';

/**
 * Escape a user-typed term for a PostgREST `.or()` filter.
 *
 * The term is interpolated into filter *syntax*, where a comma starts the next
 * condition and a parenthesis closes the group -- so searching "kumar, ramesh"
 * would otherwise build a malformed filter and return 400, and `%` would be
 * read as an ILIKE wildcard. Backslash first, or it escapes its own escapes.
 */
const escapeFilterTerm = (term: string): string =>
  term.replace(/[\\%_,().*:"']/g, (char) => `\\${char}`);

export const patientService = {
  /**
   * Every patient in this clinic reachable on the same phone number.
   *
   * Matched on `phone_norm` (last 10 digits), never on `phone` -- the raw
   * column holds the number exactly as it was typed, so "+91 98765 43210" and
   * "9876543210" are the same mobile but different strings. Comparing the raw
   * column is what let one person register twice.
   *
   * Returns the records rather than a boolean: a shared number is normal in
   * families, so the caller has to show reception WHO is on it and let them
   * decide between "this is the same patient" and "this is their relative".
   * Ordered oldest first, so the longest-standing record -- the one most
   * likely to hold the real history -- is offered first.
   */
  async findPatientsByPhone(phone: string): Promise<Patient[]> {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase client not available. Please check your configuration.');
    }

    const matchKey = phoneMatchKey(phone);
    if (!matchKey) return [];

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data, error } = await supabase!
        .from('patients')
        .select(PATIENT_COLUMNS)
        .eq('clinic_id', profile.clinicId)
        .eq('phone_norm', matchKey)
        .eq('is_hidden', false)
        .order('created_at', { ascending: true })
        .limit(25);

      if (error) {
        throw new Error(`Failed to look up phone number: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error looking up phone number:', error);
      }
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          throw new Error('Network error: Please check your internet connection and try again.');
        }
        throw error;
      }
      throw new Error('Failed to look up phone number');
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
        .eq('is_hidden', false)
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
        .select(PATIENT_COLUMNS)
        .eq('id', id)
        .eq('clinic_id', profile.clinicId)
        .eq('is_hidden', false)
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

      // Fire-and-forget: registration welcome + document-upload link.
      // Opt-in per clinic (auto-send rule); never blocks registration.
      if (data?.id) {
        WhatsAppAutoSendService.sendRegistrationWelcome({
          clinicId: profile.clinicId,
          patient: { id: data.id, name: data.name, phone: data.phone },
        }).catch(() => { /* non-blocking */ });
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

  // Soft hide patient so existing visits, appointments, bills, and other FK-linked records remain intact.
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
        .update({ is_hidden: true, hidden_at: new Date().toISOString() })
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

  // Search patients by readable patient number, name, or phone
  /**
   * Server-side patient lookup by patient number, name or phone number.
   *
   * Server-side on purpose. This used to be a `.filter()` over every patient
   * the client had already downloaded, which quietly stops working twice over:
   * PostgREST caps a collection read at 1000 rows by default, so in a clinic
   * past that count the older patients were simply absent from the array and
   * reception was told they did not exist; and `phone.includes(term)` compares
   * the raw typed string, so "9876543210" missed a patient stored as
   * "+91 98765 43210".
   *
   * Digits are matched against `phone_norm` instead, which is why a number
   * now finds its patient however either side was spaced or prefixed.
   */
  async searchPatients(query: string, limit = 25): Promise<Patient[]> {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase client not available. Please check your configuration.');
    }

    const term = query.trim();
    if (!term) return [];

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const safeTerm = escapeFilterTerm(term);
    const conditions = [
      `patient_number.ilike.%${safeTerm}%`,
      `name.ilike.%${safeTerm}%`,
    ];

    // Only a digit-bearing term can be a phone number, and it is matched on
    // the normalised key, so spacing and country code are irrelevant.
    //
    // A whole number is an equality test, which is the case that matters: it
    // is what reception types, and it is the only form the (clinic_id,
    // phone_norm) index can serve. Fewer digits fall back to a suffix match,
    // which scans -- but that is the deliberate "I only have the last four
    // digits" search, not the routine one.
    const digits = term.replace(/[^0-9]/g, '');
    if (digits.length >= 10) {
      conditions.push(`phone_norm.eq.${digits.slice(-10)}`);
    } else if (digits.length >= 4) {
      conditions.push(`phone_norm.like.%${digits}`);
    }

    try {
      const { data, error } = await supabase!
        .from('patients')
        .select(PATIENT_COLUMNS)
        .eq('clinic_id', profile.clinicId)
        .eq('is_hidden', false)
        .or(conditions.join(','))
        .order('created_at', { ascending: false })
        .limit(limit);

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
