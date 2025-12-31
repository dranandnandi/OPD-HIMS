import { supabase } from '../lib/supabase';
import { Profile, Role } from '../types';
import type { DatabaseProfile, DatabaseRole } from '../lib/supabase';
import { getCurrentProfile, saveProfileToLocalStorage, getProfileFromLocalStorage, convertDatabaseProfile } from './profileService';

export const convertDatabaseRole = (dbRole: DatabaseRole): Role => ({
  id: dbRole.id,
  name: dbRole.name,
  description: dbRole.description || '',
  permissions: dbRole.permissions || [],
  createdAt: dbRole.created_at || new Date().toISOString(),
});

export const authService = {
  isSupabaseAvailable(): boolean {
    return !!supabase;
  },

  async signIn(email: string, password: string) {
    if (!supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data;
  },

  async signOut() {
    if (!supabase) throw new Error('Supabase client not initialized');
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
    localStorage.removeItem('bolt_user_profile');
  },

  async getSession() {
    if (!supabase) throw new Error('Supabase client not initialized');
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw new Error(error.message);
      return { session: data?.session, error: null };
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  },

  getCurrentProfile,

  async createProfile(
    userId: string,
    profileData: Omit<Profile, 'id' | 'createdAt' | 'updatedAt' | 'role' | 'clinic' | 'roleName' | 'permissions'>
  ): Promise<Profile> {
    if (!supabase) throw new Error('Supabase client not initialized');

    // Fetch role details to populate denormalized columns
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('name, permissions')
      .eq('id', profileData.roleId)
      .single();

    if (roleError) throw new Error('Failed to fetch role data');

    const dbProfile = {
      id: userId,
      user_id: userId,
      role_id: profileData.roleId,
      clinic_id: profileData.clinicId,
      name: profileData.name,
      email: profileData.email,
      phone: profileData.phone,
      specialization: profileData.specialization,
      qualification: profileData.qualification,
      registration_no: profileData.registrationNo,
      role_name: roleData.name,
      permissions: roleData.permissions,
      is_open_for_consultation: profileData.isOpenForConsultation || false,
      doctor_availability: profileData.doctorAvailability,
      is_active: profileData.isActive,
    };

    const { data, error } = await supabase
      .from('profiles')
      .insert([dbProfile])
      .select(`*, clinic_settings:clinic_id (*)`);

    if (error || !data?.[0]) throw new Error('Failed to create profile');
    const profile = convertDatabaseProfile(data[0], undefined, data[0].clinic_settings);
    saveProfileToLocalStorage(profile);
    return profile;
  },

  async updateProfile(
    id: string,
    profileData: Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt' | 'role' | 'clinic' | 'roleName' | 'permissions'>>
  ): Promise<Profile> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const dbProfile: any = {};
    if (profileData.userId) dbProfile.user_id = profileData.userId;
    if (profileData.roleId) {
      dbProfile.role_id = profileData.roleId;
      
      // Fetch role details to update denormalized columns
      const { data: roleData, error: roleError } = await supabase
        .from('roles')
        .select('name, permissions')
        .eq('id', profileData.roleId)
        .single();

      if (roleError) throw new Error('Failed to fetch role data');
      
      dbProfile.role_name = roleData.name;
      dbProfile.permissions = roleData.permissions;
    }
    if (profileData.clinicId !== undefined) dbProfile.clinic_id = profileData.clinicId;
    if (profileData.name) dbProfile.name = profileData.name;
    if (profileData.email) dbProfile.email = profileData.email;
    if (profileData.phone !== undefined) dbProfile.phone = profileData.phone;
    if (profileData.specialization !== undefined) dbProfile.specialization = profileData.specialization;
    if (profileData.qualification !== undefined) dbProfile.qualification = profileData.qualification;
    if (profileData.registrationNo !== undefined) dbProfile.registration_no = profileData.registrationNo;
    if (profileData.consultationFee !== undefined) dbProfile.consultation_fee = profileData.consultationFee;
    if (profileData.followUpFee !== undefined) dbProfile.follow_up_fee = profileData.followUpFee;
    if (profileData.emergencyFee !== undefined) dbProfile.emergency_fee = profileData.emergencyFee;
    if (profileData.isActive !== undefined) dbProfile.is_active = profileData.isActive;
    if (profileData.isOpenForConsultation !== undefined) dbProfile.is_open_for_consultation = profileData.isOpenForConsultation;
    if (profileData.doctorAvailability !== undefined) dbProfile.doctor_availability = profileData.doctorAvailability;

    const { data, error } = await supabase
      .from('profiles')
      .update(dbProfile)
      .eq('id', id)
      .select(`*, clinic_settings:clinic_id (*)`);

    if (error || !data?.[0]) throw new Error('Failed to update profile');
    const profile = convertDatabaseProfile(data[0], undefined, data[0].clinic_settings);
    saveProfileToLocalStorage(profile);
    return profile;
  },

  async getRoles(): Promise<Role[]> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await supabase.from('roles').select('*').order('name');
    if (error) throw new Error('Failed to fetch roles');
    return data.map(convertDatabaseRole);
  },

  async getRole(id: string): Promise<Role | null> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await supabase.from('roles').select('*').eq('id', id).single();
    if (error?.code === 'PGRST116') return null;
    if (error) throw new Error('Failed to fetch role');
    return convertDatabaseRole(data);
  },

  async getUsers(): Promise<Profile[]> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('profiles')
      .select(`*, clinic_id, clinic_settings:clinic_id (*)`)
      .eq('clinic_id', profile.clinicId)
      .order('created_at', { ascending: false });

    if (error) throw new Error('Failed to fetch users');
    return data.map(p => convertDatabaseProfile(p, undefined, p.clinic_settings));
  },

  async getDoctors(): Promise<Profile[]> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('profiles')
      .select(`*, clinic_id, clinic_settings:clinic_id (*)`)
      .eq('clinic_id', profile.clinicId)
      .eq('is_open_for_consultation', true)
      .order('name');

    if (error) throw new Error('Failed to fetch doctors');
    return data.map(p => convertDatabaseProfile(p, undefined, p.clinic_settings));
  },

  async getAllDoctors(): Promise<Profile[]> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('profiles')
      .select(`*, clinic_id, clinic_settings:clinic_id (*)`)
      .eq('clinic_id', profile.clinicId)
      .eq('is_active', true)
      .not('specialization', 'is', null) // Only users with specialization (doctors)
      .order('name');

    if (error) throw new Error('Failed to fetch all doctors');
    return data.map(p => convertDatabaseProfile(p, undefined, p.clinic_settings));
  },

  async createUser(userData: {
    email: string;
    password: string;
    name: string;
    roleId: string;
    clinicId?: string;
    phone?: string;
    specialization?: string;
    qualification?: string;
    registrationNo?: string;
    consultationFee?: number;
    followUpFee?: number;
    emergencyFee?: number;
    isOpenForConsultation?: boolean;
  }): Promise<Profile> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: userData.email,
      password: userData.password,
      options: { emailRedirectTo: undefined },
    });

    if (authError) throw new Error(authError.message);
    if (!authData.user) throw new Error('Failed to create user account');
    if (!authData.session) throw new Error('User already exists or needs confirmation');

    return this.createProfile(authData.user.id, {
      roleId: userData.roleId,
      clinicId: userData.clinicId,
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      specialization: userData.specialization,
      qualification: userData.qualification,
      registrationNo: userData.registrationNo,
      consultationFee: userData.consultationFee,
      followUpFee: userData.followUpFee,
      emergencyFee: userData.emergencyFee,
      isOpenForConsultation: userData.isOpenForConsultation || false,
      isActive: true,
    });
  },

  async deleteUser(userId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const { error } = await supabase.from('profiles').update({ is_active: false }).eq('id', userId);
    if (error) throw new Error('Failed to deactivate user');
  },

  async hasPermission(permission: string): Promise<boolean> {
    const profile = await getCurrentProfile();
    if (!profile?.permissions) return false;
    return profile.permissions.includes(permission) || profile.permissions.includes('all');
  },

  onAuthStateChange(callback: (event: string, session: any) => void) {
    if (!supabase) throw new Error('Supabase client not initialized');
    return supabase.auth.onAuthStateChange(callback);
  },
};