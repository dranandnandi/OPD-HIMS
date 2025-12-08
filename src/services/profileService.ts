import { supabase } from '../lib/supabaseClient';
import { Profile, Role } from '../types';
import type { DatabaseProfile, DatabaseRole } from '../lib/supabaseClient';
import { supabase as supabaseClient } from '../lib/supabase';


// Local Storage Keys
const LOCAL_STORAGE_PROFILE_KEY = 'bolt_user_profile';

export const saveProfileToLocalStorage = (profile: Profile) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_PROFILE_KEY, JSON.stringify(profile));
    if (import.meta.env.DEV) {
      console.log('✅ [LocalStorage] Profile saved.');
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('❌ [LocalStorage] Save failed:', e);
    }
  }
};

export const getProfileFromLocalStorage = (): Profile | null => {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_PROFILE_KEY);
    if (stored) {
      const profile = JSON.parse(stored);
      // Rehydrate dates
      if (profile.createdAt) profile.createdAt = new Date(profile.createdAt);
      if (profile.updatedAt) profile.updatedAt = new Date(profile.updatedAt);
      if (profile.clinic?.createdAt) profile.clinic.createdAt = new Date(profile.clinic.createdAt);
      if (profile.clinic?.updatedAt) profile.clinic.updatedAt = new Date(profile.clinic.updatedAt);
      if (import.meta.env.DEV) {
        console.log('📦 [LocalStorage] Loaded cached profile.');
      }
      return profile;
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('❌ [LocalStorage] Load failed:', e);
    }
  }
  return null;
};

const convertDatabaseRole = (dbRole: DatabaseRole): Role => ({
  id: dbRole.id,
  name: dbRole.name,
  description: dbRole.description,
  permissions: dbRole.permissions,
  createdAt: new Date(dbRole.created_at),
});

export const convertDatabaseProfile = (
  dbProfile: DatabaseProfile,
  role?: DatabaseRole,
  clinic?: any
): Profile => ({
  id: dbProfile.id,
  userId: dbProfile.user_id,
  roleId: dbProfile.role_id,
  clinicId: dbProfile.clinic_id,
  name: dbProfile.name,
  email: dbProfile.email,
  phone: dbProfile.phone,
  specialization: dbProfile.specialization,
  qualification: dbProfile.qualification,
  registrationNo: dbProfile.registration_no,
  roleName: dbProfile.role_name,
  permissions: dbProfile.permissions,
  consultationFee: dbProfile.consultation_fee,
  followUpFee: dbProfile.follow_up_fee,
  emergencyFee: dbProfile.emergency_fee,
  isActive: dbProfile.is_active,
  isOpenForConsultation: dbProfile.is_open_for_consultation,
  doctorAvailability: dbProfile.doctor_availability,
  createdAt: new Date(dbProfile.created_at),
  updatedAt: new Date(dbProfile.updated_at),
  role: role ? convertDatabaseRole(role) : undefined,
  clinic: clinic
    ? {
        id: clinic.id,
        clinicName: clinic.clinic_name,
        address: clinic.address,
        phone: clinic.phone,
        email: clinic.email,
        website: clinic.website,
        logoUrl: clinic.logo_url,
        registrationNumber: clinic.registration_number,
        taxId: clinic.tax_id,
        consultationFee: clinic.consultation_fee,
        followUpFee: clinic.follow_up_fee,
        emergencyFee: clinic.emergency_fee,
        appointmentDuration: clinic.appointment_duration,
        workingHours: clinic.working_hours,
        currency: clinic.currency,
        timezone: clinic.timezone,
        createdAt: clinic.created_at ? new Date(clinic.created_at) : undefined,
        updatedAt: clinic.updated_at ? new Date(clinic.updated_at) : undefined,
      }
    : undefined,
});

export async function getCurrentProfile(providedUserId?: string, providedAccessToken?: string): Promise<Profile | null> {
  if (import.meta.env.DEV) {
    console.log('🔍 [getCurrentProfile] Starting Edge Function approach...');
  }

  try {
    let token = providedAccessToken;
    let userId = providedUserId;

    // Only fetch session if token or userId not provided
    if (!token || !userId) {
      if (!supabaseClient) {
        if (import.meta.env.DEV) {
          console.error('❌ [Supabase] Client not initialized.');
        }
        return getProfileFromLocalStorage();
      }

      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError || !session) {
        if (import.meta.env.DEV) {
          console.warn('⚠️ [Auth] No session. Using fallback.');
        }
        return getProfileFromLocalStorage();
      }

      token = token || session.access_token;
      userId = userId || session.user.id;
    }
    
    if (import.meta.env.DEV) {
      console.log('👤 [User] Using userId:', userId);
      console.log('🔐 [Auth] Token available:', !!token);
    }

    // Call the Edge Function
    if (import.meta.env.DEV) {
      console.log('📡 [Edge Function] Calling fetch-user-profile...');
    }
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-user-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId })
    });

    if (import.meta.env.DEV) {
      console.log('📡 [Edge Function] Response status:', response.status);
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      if (import.meta.env.DEV) {
        console.error('❌ [Edge Function] HTTP error:', response.status, errorText);
      }
      throw new Error(`Edge Function call failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    if (import.meta.env.DEV) {
      console.log('📦 [Edge Function] Result:', result);
    }

    if (!result.success) {
      if (import.meta.env.DEV) {
        console.warn('⚠️ [Edge Function] Profile not found:', result.error);
      }
      return getProfileFromLocalStorage();
    }

    // Convert the profile data to the expected format with proper date objects
    const profile: Profile = {
      ...result.profile,
      createdAt: new Date(result.profile.createdAt),
      updatedAt: new Date(result.profile.updatedAt),
      clinic: result.profile.clinic ? {
        ...result.profile.clinic,
        createdAt: result.profile.clinic.createdAt ? new Date(result.profile.clinic.createdAt) : undefined,
        updatedAt: result.profile.clinic.updatedAt ? new Date(result.profile.clinic.updatedAt) : undefined,
      } : undefined
    }

    // Save to local storage for caching
    saveProfileToLocalStorage(profile);
    if (import.meta.env.DEV) {
      console.log('✅ [Edge Function] Profile loaded successfully:', profile.name);
    }
    return profile;

  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('❌ [getCurrentProfile] Edge Function error:', err);
    }
    const fallback = getProfileFromLocalStorage();
    if (fallback) {
      if (import.meta.env.DEV) {
        console.log('📦 [Fallback] Using cached profile:', fallback.name);
      }
      return fallback;
    }
    throw err;
  }
}
