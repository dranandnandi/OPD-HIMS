import { supabase } from '../lib/supabase';
import { ClinicSetting } from '../types';
import { getCurrentProfile } from './profileService';
import type { DatabaseClinicSetting } from '../lib/supabase';

// Convert database clinic setting to app clinic setting type
const convertDatabaseClinicSetting = (dbSetting: DatabaseClinicSetting): ClinicSetting => ({
  id: dbSetting.id,
  clinicName: dbSetting.clinic_name,
  address: dbSetting.address,
  phone: dbSetting.phone,
  email: dbSetting.email,
  website: dbSetting.website,
  logoUrl: dbSetting.logo_url,
  registrationNumber: dbSetting.registration_number,
  taxId: dbSetting.tax_id,
  consultationFee: dbSetting.consultation_fee,
  followUpFee: dbSetting.follow_up_fee,
  emergencyFee: dbSetting.emergency_fee,
  appointmentDuration: dbSetting.appointment_duration,
  workingHours: dbSetting.working_hours,
  currency: dbSetting.currency,
  timezone: dbSetting.timezone,
  createdAt: new Date(dbSetting.created_at),
  updatedAt: new Date(dbSetting.updated_at),
  blueticksApiKey: dbSetting.blueticks_api_key,
  enableManualWhatsappSend: dbSetting.enable_manual_whatsapp_send,
  enableBlueticksApiSend: dbSetting.enable_blueticks_api_send,
  enableAiReviewSuggestion: dbSetting.enable_ai_review_suggestion,
  enableSimpleThankYou: dbSetting.enable_simple_thank_you,
  enableAiThankYou: dbSetting.enable_ai_thank_you,
  enableGmbLinkOnly: dbSetting.enable_gmb_link_only,
  gmbLink: dbSetting.gmb_link,
  prescriptionFrequencies: dbSetting.prescription_frequencies
});

// Convert app clinic setting to database clinic setting type
const convertToDatabase = (setting: Omit<ClinicSetting, 'id' | 'createdAt' | 'updatedAt'>): Omit<DatabaseClinicSetting, 'id' | 'created_at' | 'updated_at'> => ({
  clinic_name: setting.clinicName,
  address: setting.address,
  phone: setting.phone,
  email: setting.email,
  website: setting.website,
  logo_url: setting.logoUrl,
  registration_number: setting.registrationNumber,
  tax_id: setting.taxId,
  consultation_fee: setting.consultationFee,
  follow_up_fee: setting.followUpFee,
  emergency_fee: setting.emergencyFee,
  appointment_duration: setting.appointmentDuration,
  working_hours: setting.workingHours,
  currency: setting.currency,
  timezone: setting.timezone,
  blueticks_api_key: setting.blueticksApiKey,
  enable_manual_whatsapp_send: setting.enableManualWhatsappSend,
  enable_blueticks_api_send: setting.enableBlueticksApiSend,
  enable_ai_review_suggestion: setting.enableAiReviewSuggestion,
  enable_simple_thank_you: setting.enableSimpleThankYou,
  enable_ai_thank_you: setting.enableAiThankYou,
  enable_gmb_link_only: setting.enableGmbLinkOnly,
  gmb_link: setting.gmbLink,
  prescription_frequencies: setting.prescriptionFrequencies
});

export const clinicSettingsService = {
  // Get clinic settings (there should typically be only one record)
  async getClinicSettings(): Promise<ClinicSetting | null> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('clinic_settings')
      .select('*')
      .eq('id', profile.clinicId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // No settings found
      }
      throw new Error('Failed to fetch clinic settings');
    }

    return convertDatabaseClinicSetting(data);
  },

  // Create initial clinic settings
  async createClinicSettings(settings: Omit<ClinicSetting, 'id' | 'createdAt' | 'updatedAt'>): Promise<ClinicSetting> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const dbSettings = convertToDatabase(settings);
    
    const { data, error } = await supabase
      .from('clinic_settings')

      .upsert([{
        ...dbSettings,
        id: profile.clinicId
      }], {
        onConflict: 'id'
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create/update clinic settings: ${error.message}`);
    }

    return convertDatabaseClinicSetting(data);
  },

  // Update clinic settings
  async updateClinicSettings(id: string, settings: Partial<Omit<ClinicSetting, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ClinicSetting> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    // Ensure we're only updating the current user's clinic
    if (id !== profile.clinicId) {
      throw new Error('Cannot update settings for a different clinic.');
    }

    const dbSettings: any = {};
    
    if (settings.clinicName) dbSettings.clinic_name = settings.clinicName;
    if (settings.address) dbSettings.address = settings.address;

    if (settings.phone) dbSettings.phone = settings.phone;
    if (settings.email !== undefined) dbSettings.email = settings.email;
    if (settings.website !== undefined) dbSettings.website = settings.website;
    if (settings.logoUrl !== undefined) dbSettings.logo_url = settings.logoUrl;
    if (settings.registrationNumber !== undefined) dbSettings.registration_number = settings.registrationNumber;
    if (settings.taxId !== undefined) dbSettings.tax_id = settings.taxId;
    if (settings.consultationFee !== undefined) dbSettings.consultation_fee = settings.consultationFee;
    if (settings.followUpFee !== undefined) dbSettings.follow_up_fee = settings.followUpFee;
    if (settings.emergencyFee !== undefined) dbSettings.emergency_fee = settings.emergencyFee;
    if (settings.appointmentDuration !== undefined) dbSettings.appointment_duration = settings.appointmentDuration;
    if (settings.workingHours) dbSettings.working_hours = settings.workingHours;
    if (settings.currency) dbSettings.currency = settings.currency;
    if (settings.timezone) dbSettings.timezone = settings.timezone;
    if (settings.blueticksApiKey !== undefined) dbSettings.blueticks_api_key = settings.blueticksApiKey;
    if (settings.enableManualWhatsappSend !== undefined) dbSettings.enable_manual_whatsapp_send = settings.enableManualWhatsappSend;
    if (settings.enableBlueticksApiSend !== undefined) dbSettings.enable_blueticks_api_send = settings.enableBlueticksApiSend;
    if (settings.enableAiReviewSuggestion !== undefined) dbSettings.enable_ai_review_suggestion = settings.enableAiReviewSuggestion;
    if (settings.enableSimpleThankYou !== undefined) dbSettings.enable_simple_thank_you = settings.enableSimpleThankYou;
    if (settings.enableAiThankYou !== undefined) dbSettings.enable_ai_thank_you = settings.enableAiThankYou;
    if (settings.enableGmbLinkOnly !== undefined) dbSettings.enable_gmb_link_only = settings.enableGmbLinkOnly;
    if (settings.gmbLink !== undefined) dbSettings.gmb_link = settings.gmbLink;
    if (settings.prescriptionFrequencies !== undefined) dbSettings.prescription_frequencies = settings.prescriptionFrequencies;

    const { data, error } = await supabase
      .from('clinic_settings')
      .update(dbSettings)
      .eq('id', id)
      .select();

    if (error) {
      throw new Error('Failed to update clinic settings');
    }

    // If no record was found for update, create it
    if (!data || data.length === 0) {
      // Create the clinic settings record with the provided updates
      const createSettings: Omit<ClinicSetting, 'id' | 'createdAt' | 'updatedAt'> = {
        clinicName: settings.clinicName || profile.clinic?.clinicName || 'My Clinic',
        address: settings.address || '',
        phone: settings.phone || '',
        email: settings.email || '',
        website: settings.website || '',
        logoUrl: settings.logoUrl || '',
        registrationNumber: settings.registrationNumber || '',
        taxId: settings.taxId || '',
        consultationFee: settings.consultationFee || 300,
        followUpFee: settings.followUpFee || 200,
        emergencyFee: settings.emergencyFee || 500,
        appointmentDuration: settings.appointmentDuration || 30,
        workingHours: settings.workingHours || {
          monday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
          tuesday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
          wednesday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
          thursday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
          friday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
          saturday: { isOpen: true, startTime: '09:00', endTime: '14:00' },
          sunday: { isOpen: false, startTime: '09:00', endTime: '18:00' }
        },
        currency: settings.currency || 'INR',
        timezone: settings.timezone || 'Asia/Kolkata',
        enableManualWhatsappSend: settings.enableManualWhatsappSend ?? true,
        enableBlueticksApiSend: settings.enableBlueticksApiSend ?? false,
        enableAiReviewSuggestion: settings.enableAiReviewSuggestion ?? true,
        enableSimpleThankYou: settings.enableSimpleThankYou ?? true,
        enableAiThankYou: settings.enableAiThankYou ?? true,
        enableGmbLinkOnly: settings.enableGmbLinkOnly ?? true,
        gmbLink: settings.gmbLink || ''
      };
      
      return await this.createClinicSettings(createSettings);
    }
    return convertDatabaseClinicSetting(data[0]);
  },

  // Get or create clinic settings (utility method)
  async getOrCreateClinicSettings(): Promise<ClinicSetting> {
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let settings = await this.getClinicSettings();
    
    if (!settings) {
      // Create default settings
      const defaultSettings: Omit<ClinicSetting, 'id' | 'createdAt' | 'updatedAt'> = {
        clinicName: profile.clinic?.clinicName || 'My Clinic',
        address: '',
        phone: '',
        email: '',
        website: '',
        logoUrl: '',
        registrationNumber: '',
        taxId: '',
        consultationFee: 300,
        followUpFee: 200,
        emergencyFee: 500,
        appointmentDuration: 30,
        workingHours: {
          monday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
          tuesday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
          wednesday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
          thursday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
          friday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
          saturday: { isOpen: true, startTime: '09:00', endTime: '14:00' },
          sunday: { isOpen: false, startTime: '09:00', endTime: '18:00' }
        },
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        enableManualWhatsappSend: true,
        enableBlueticksApiSend: false,
        enableAiReviewSuggestion: true,
        enableSimpleThankYou: true,
        enableAiThankYou: true,
        enableGmbLinkOnly: true,
        gmbLink: ''
      };
      
      settings = await this.createClinicSettings(defaultSettings);
    }
    
    return settings;
  },

  // Get consultation fees
  async getConsultationFees(): Promise<{ consultation: number; followUp: number; emergency: number }> {
    const settings = await this.getOrCreateClinicSettings();
    
    return {
      consultation: settings.consultationFee,
      followUp: settings.followUpFee,
      emergency: settings.emergencyFee
    };
  },

  // Update consultation fees
  async updateConsultationFees(fees: { consultation?: number; followUp?: number; emergency?: number }): Promise<ClinicSetting> {
    const settings = await this.getOrCreateClinicSettings();
    
    const updates: Partial<Omit<ClinicSetting, 'id' | 'createdAt' | 'updatedAt'>> = {};
    
    if (fees.consultation !== undefined) updates.consultationFee = fees.consultation;
    if (fees.followUp !== undefined) updates.followUpFee = fees.followUp;
    if (fees.emergency !== undefined) updates.emergencyFee = fees.emergency;
    
    return await this.updateClinicSettings(settings.id, updates);
  },

  // Get working hours
  async getWorkingHours(): Promise<ClinicSetting['workingHours']> {
    const settings = await this.getOrCreateClinicSettings();
    return settings.workingHours;
  },

  // Update working hours
  async updateWorkingHours(workingHours: ClinicSetting['workingHours']): Promise<ClinicSetting> {
    const settings = await this.getOrCreateClinicSettings();
    return await this.updateClinicSettings(settings.id, { workingHours });
  },

  // Check if clinic is open at a specific time
  isClinicOpen(day: string, time: string): Promise<boolean> {
    return this.getWorkingHours().then(workingHours => {
      const daySchedule = workingHours[day.toLowerCase()];
      
      if (!daySchedule || !daySchedule.isOpen) {
        return false;
      }
      
      const currentTime = new Date(`2000-01-01T${time}:00`);
      const startTime = new Date(`2000-01-01T${daySchedule.startTime}:00`);
      const endTime = new Date(`2000-01-01T${daySchedule.endTime}:00`);
      
      let isOpen = currentTime >= startTime && currentTime <= endTime;
      
      // Check if it's during break time
      if (isOpen && daySchedule.breakStart && daySchedule.breakEnd) {
        const breakStart = new Date(`2000-01-01T${daySchedule.breakStart}:00`);
        const breakEnd = new Date(`2000-01-01T${daySchedule.breakEnd}:00`);
        
        if (currentTime >= breakStart && currentTime <= breakEnd) {
          isOpen = false;
        }
      }
      
      return isOpen;
    });
  }
};