import { supabase } from '../lib/supabase';
import { getCurrentProfile } from './profileService';
import { Appointment, Patient, Profile } from '../types';
import type { DatabaseAppointment } from '../lib/supabase';

// Convert database appointment to app appointment type
const convertDatabaseAppointment = (dbAppointment: DatabaseAppointment, patient?: Patient, doctor?: Profile): Appointment => ({
  id: dbAppointment.id,
  patientId: dbAppointment.patient_id,
  doctorId: dbAppointment.doctor_id,
  appointmentDate: new Date(dbAppointment.appointment_date),
  duration: dbAppointment.duration,
  status: dbAppointment.status,
  appointmentType: dbAppointment.appointment_type,
  notes: dbAppointment.notes,
  createdAt: new Date(dbAppointment.created_at),
  updatedAt: new Date(dbAppointment.updated_at),
  patient,
  doctor
});

// Convert app appointment to database appointment type
const convertToDatabase = (appointment: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'>): Omit<DatabaseAppointment, 'id' | 'created_at' | 'updated_at'> => ({
  patient_id: appointment.patientId,
  doctor_id: appointment.doctorId,
  appointment_date: appointment.appointmentDate.toISOString(),
  duration: appointment.duration,
  status: appointment.status,
  appointment_type: appointment.appointmentType,
  notes: appointment.notes
});

export const appointmentService = {
  // Get all appointments
  async getAppointments(): Promise<Appointment[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        clinic_id,
        patients (*),
        profiles (*)
      `)
      .eq('clinic_id', profile.clinicId)
      .order('appointment_date', { ascending: true });

    if (error) {
      throw new Error('Failed to fetch appointments');
    }

    return data.map(appointment => convertDatabaseAppointment(
      appointment,
      appointment.patients ? {
        id: appointment.patients.id,
        name: appointment.patients.name,
        phone: appointment.patients.phone,
        age: appointment.patients.age,
        gender: appointment.patients.gender,
        address: appointment.patients.address,
        emergencyContact: appointment.patients.emergency_contact,
        bloodGroup: appointment.patients.blood_group,
        allergies: appointment.patients.allergies,
        createdAt: new Date(appointment.patients.created_at),
        lastVisit: appointment.patients.last_visit ? new Date(appointment.patients.last_visit) : undefined
      } : undefined,
      appointment.profiles ? {
        id: appointment.profiles.id,
        userId: appointment.profiles.user_id,
        roleId: appointment.profiles.role_id,
        name: appointment.profiles.name,
        email: appointment.profiles.email,
        phone: appointment.profiles.phone,
        specialization: appointment.profiles.specialization,
        qualification: appointment.profiles.qualification,
        registrationNo: appointment.profiles.registration_no,
        isActive: appointment.profiles.is_active,
        createdAt: new Date(appointment.profiles.created_at),
        updatedAt: new Date(appointment.profiles.updated_at)
      } : undefined
    ));
  },

  // Get appointments by date range
  async getAppointmentsByDateRange(startDate: Date, endDate: Date): Promise<Appointment[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        patients (id, name, phone),
        profiles (id, name, specialization)
      `)
      .eq('clinic_id', profile.clinicId)
      .gte('appointment_date', startDate.toISOString())
      .lte('appointment_date', endDate.toISOString())
      .order('appointment_date', { ascending: true });
      

    if (error) {
      throw new Error('Failed to fetch appointments');
    }

    return data.map(appointment => convertDatabaseAppointment(
      appointment,
      appointment.patients ? {
        id: appointment.patients.id,
        name: appointment.patients.name,
        phone: appointment.patients.phone,
        age: appointment.patients.age,
        gender: appointment.patients.gender,
        address: appointment.patients.address,
        emergencyContact: appointment.patients.emergency_contact,
        bloodGroup: appointment.patients.blood_group,
        allergies: appointment.patients.allergies,
        createdAt: new Date(appointment.patients.created_at),
        lastVisit: appointment.patients.last_visit ? new Date(appointment.patients.last_visit) : undefined
      } : undefined,
      appointment.profiles ? {
        id: appointment.profiles.id,
        userId: appointment.profiles.user_id,
        roleId: appointment.profiles.role_id,
        name: appointment.profiles.name,
        email: appointment.profiles.email,
        phone: appointment.profiles.phone,
        specialization: appointment.profiles.specialization,
        qualification: appointment.profiles.qualification,
        registrationNo: appointment.profiles.registration_no,
        isActive: appointment.profiles.is_active,
        createdAt: new Date(appointment.profiles.created_at),
        updatedAt: new Date(appointment.profiles.updated_at)
      } : undefined
    ));
  },

  // Get appointments for a specific patient
  async getPatientAppointments(patientId: string): Promise<Appointment[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        patients (id, name, phone),
        profiles (id, name, specialization)
      `)
      .eq('clinic_id', profile.clinicId)
      .eq('patient_id', patientId)
      .order('appointment_date', { ascending: false });

    if (error) {
      throw new Error('Failed to fetch patient appointments');
    }

    return data.map(appointment => convertDatabaseAppointment(
      appointment,
      appointment.patients ? {
        id: appointment.patients.id,
        name: appointment.patients.name,
        phone: appointment.patients.phone,
        age: appointment.patients.age,
        gender: appointment.patients.gender,
        address: appointment.patients.address,
        emergencyContact: appointment.patients.emergency_contact,
        bloodGroup: appointment.patients.blood_group,
        allergies: appointment.patients.allergies,
        createdAt: new Date(appointment.patients.created_at),
        lastVisit: appointment.patients.last_visit ? new Date(appointment.patients.last_visit) : undefined
      } : undefined,
      appointment.profiles ? {
        id: appointment.profiles.id,
        userId: appointment.profiles.user_id,
        roleId: appointment.profiles.role_id,
        name: appointment.profiles.name,
        email: appointment.profiles.email,
        phone: appointment.profiles.phone,
        specialization: appointment.profiles.specialization,
        qualification: appointment.profiles.qualification,
        registrationNo: appointment.profiles.registration_no,
        isActive: appointment.profiles.is_active,
        createdAt: new Date(appointment.profiles.created_at),
        updatedAt: new Date(appointment.profiles.updated_at)
      } : undefined
    ));
  },

  // Get appointments for a specific doctor
  async getDoctorAppointments(doctorId: string): Promise<Appointment[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        patients (id, name, phone),
        profiles (id, name, specialization)
      `)
      .eq('clinic_id', profile.clinicId)
      .eq('doctor_id', doctorId)
      .order('appointment_date', { ascending: true });

    if (error) {
      throw new Error('Failed to fetch doctor appointments');
    }

    return data.map(appointment => convertDatabaseAppointment(
      appointment,
      appointment.patients ? {
        id: appointment.patients.id,
        name: appointment.patients.name,
        phone: appointment.patients.phone,
        age: appointment.patients.age,
        gender: appointment.patients.gender,
        address: appointment.patients.address,
        emergencyContact: appointment.patients.emergency_contact,
        bloodGroup: appointment.patients.blood_group,
        allergies: appointment.patients.allergies,
        createdAt: new Date(appointment.patients.created_at),
        lastVisit: appointment.patients.last_visit ? new Date(appointment.patients.last_visit) : undefined
      } : undefined,
      appointment.profiles ? {
        id: appointment.profiles.id,
        userId: appointment.profiles.user_id,
        roleId: appointment.profiles.role_id,
        name: appointment.profiles.name,
        email: appointment.profiles.email,
        phone: appointment.profiles.phone,
        specialization: appointment.profiles.specialization,
        qualification: appointment.profiles.qualification,
        registrationNo: appointment.profiles.registration_no,
        isActive: appointment.profiles.is_active,
        createdAt: new Date(appointment.profiles.created_at),
        updatedAt: new Date(appointment.profiles.updated_at)
      } : undefined
    ));
  },

  // Add a new appointment
  async addAppointment(appointment: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'>): Promise<Appointment> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const dbAppointment = convertToDatabase(appointment);
    
    const { data, error } = await supabase
      .from('appointments')
      .insert([{ ...dbAppointment, clinic_id: profile.clinicId }])
      .select(`
        *,
        patients (id, name, phone),
        profiles (id, name, specialization)
      `)
      .single();

    if (error) {
      throw new Error('Failed to create appointment');
    }

    return convertDatabaseAppointment(
      data,
      data.patients ? {
        id: data.patients.id,
        name: data.patients.name,
        phone: data.patients.phone,
        age: data.patients.age,
        gender: data.patients.gender,
        address: data.patients.address,
        emergencyContact: data.patients.emergency_contact,
        bloodGroup: data.patients.blood_group,
        allergies: data.patients.allergies,
        createdAt: new Date(data.patients.created_at),
        lastVisit: data.patients.last_visit ? new Date(data.patients.last_visit) : undefined
      } : undefined,
      data.profiles ? {
        id: data.profiles.id,
        userId: data.profiles.user_id,
        roleId: data.profiles.role_id,
        name: data.profiles.name,
        email: data.profiles.email,
        phone: data.profiles.phone,
        specialization: data.profiles.specialization,
        qualification: data.profiles.qualification,
        registrationNo: data.profiles.registration_no,
        isActive: data.profiles.is_active,
        createdAt: new Date(data.profiles.created_at),
        updatedAt: new Date(data.profiles.updated_at)
      } : undefined
    );
  },

  // Update an appointment
  async updateAppointment(id: string, appointment: Partial<Omit<Appointment, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'>>): Promise<Appointment> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const dbAppointment: any = {};
    
    if (appointment.patientId) dbAppointment.patient_id = appointment.patientId;
    if (appointment.doctorId) dbAppointment.doctor_id = appointment.doctorId;
    dbAppointment.clinic_id = profile.clinicId; // Ensure clinic_id is set for update

    if (appointment.appointmentDate) dbAppointment.appointment_date = appointment.appointmentDate.toISOString();
    if (appointment.duration) dbAppointment.duration = appointment.duration;
    if (appointment.status) dbAppointment.status = appointment.status;
    if (appointment.appointmentType) dbAppointment.appointment_type = appointment.appointmentType;
    if (appointment.notes !== undefined) dbAppointment.notes = appointment.notes;

    const { data, error } = await supabase
      .from('appointments')
      .update(dbAppointment)
      .eq('clinic_id', profile.clinicId)
      .eq('id', id)
      .select(`
        *,
        patients (*),
        profiles (*)
      `)
      .single();

    if (error) {
      throw new Error('Failed to update appointment');
    }

    return convertDatabaseAppointment(
      data,
      data.patients ? {
        id: data.patients.id,
        name: data.patients.name,
        phone: data.patients.phone,
        age: data.patients.age,
        gender: data.patients.gender,
        address: data.patients.address,
        emergencyContact: data.patients.emergency_contact,
        bloodGroup: data.patients.blood_group,
        allergies: data.patients.allergies,
        createdAt: new Date(data.patients.created_at),
        lastVisit: data.patients.last_visit ? new Date(data.patients.last_visit) : undefined
      } : undefined,
      data.profiles ? {
        id: data.profiles.id,
        userId: data.profiles.user_id,
        roleId: data.profiles.role_id,
        name: data.profiles.name,
        email: data.profiles.email,
        phone: data.profiles.phone,
        specialization: data.profiles.specialization,
        qualification: data.profiles.qualification,
        registrationNo: data.profiles.registration_no,
        isActive: data.profiles.is_active,
        createdAt: new Date(data.profiles.created_at),
        updatedAt: new Date(data.profiles.updated_at)
      } : undefined
    );
  },

  // Delete an appointment
  async deleteAppointment(id: string): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', id)
      .eq('clinic_id', profile.clinicId);


    if (error) {
      throw new Error('Failed to delete appointment');
    }
  },

  // Get appointment by ID
  async getAppointment(id: string): Promise<Appointment | null> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        patients (id, name, phone),
        profiles (id, name, specialization)
      `)
      .eq('clinic_id', profile.clinicId)
      .eq('id', id)
      .single();


    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error('Failed to fetch appointment');
    }

    return convertDatabaseAppointment(
      data,
      data.patients ? {
        id: data.patients.id,
        name: data.patients.name,
        phone: data.patients.phone,
        age: data.patients.age,
        gender: data.patients.gender,
        address: data.patients.address,
        emergencyContact: data.patients.emergency_contact,
        bloodGroup: data.patients.blood_group,
        allergies: data.patients.allergies,
        createdAt: new Date(data.patients.created_at),
        lastVisit: data.patients.last_visit ? new Date(data.patients.last_visit) : undefined
      } : undefined,
      data.profiles ? {
        id: data.profiles.id,
        userId: data.profiles.user_id,
        roleId: data.profiles.role_id,
        name: data.profiles.name,
        email: data.profiles.email,
        phone: data.profiles.phone,
        specialization: data.profiles.specialization,
        qualification: data.profiles.qualification,
        registrationNo: data.profiles.registration_no,
        isActive: data.profiles.is_active,
        createdAt: new Date(data.profiles.created_at),
        updatedAt: new Date(data.profiles.updated_at)
      } : undefined
    );
  }
};