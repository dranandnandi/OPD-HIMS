import { supabase } from '../lib/supabase';
import { ClinicSetting, PublicBookingPolicy } from '../types';
import { getCurrentProfile } from './profileService';
import type { DatabaseClinicSetting } from '../lib/supabase';

// A clinic_settings row can predate the app writing this column, and the
// working_hours JSONB is nullable, so every read has to be able to land on a
// usable week. Callers render Object.entries() over this directly.
export const DEFAULT_WORKING_HOURS: ClinicSetting['workingHours'] = {
  monday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
  tuesday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
  wednesday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
  thursday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
  friday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
  saturday: { isOpen: true, startTime: '09:00', endTime: '14:00' },
  sunday: { isOpen: false, startTime: '09:00', endTime: '18:00' }
};

const DAY_KEYS = Object.keys(DEFAULT_WORKING_HOURS);

// Accepts whatever the column holds (null, a stray array, a half-filled week)
// and returns a complete week with every day present and well-formed.
export const normalizeWorkingHours = (value: unknown): ClinicSetting['workingHours'] => {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const normalized: ClinicSetting['workingHours'] = {};

  for (const day of DAY_KEYS) {
    const raw = source[day];
    const fallback = DEFAULT_WORKING_HOURS[day];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      normalized[day] = { ...fallback };
      continue;
    }

    const entry = raw as Record<string, unknown>;
    normalized[day] = {
      isOpen: typeof entry.isOpen === 'boolean' ? entry.isOpen : fallback.isOpen,
      startTime: typeof entry.startTime === 'string' ? entry.startTime : fallback.startTime,
      endTime: typeof entry.endTime === 'string' ? entry.endTime : fallback.endTime,
      breakStart: typeof entry.breakStart === 'string' ? entry.breakStart : undefined,
      breakEnd: typeof entry.breakEnd === 'string' ? entry.breakEnd : undefined
    };
  }

  // Keep any extra day-shaped keys the clinic may have saved.
  for (const [day, raw] of Object.entries(source)) {
    if (normalized[day] || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.startTime !== 'string' || typeof entry.endTime !== 'string') continue;
    normalized[day] = {
      isOpen: entry.isOpen === true,
      startTime: entry.startTime,
      endTime: entry.endTime,
      breakStart: typeof entry.breakStart === 'string' ? entry.breakStart : undefined,
      breakEnd: typeof entry.breakEnd === 'string' ? entry.breakEnd : undefined
    };
  }

  return normalized;
};

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
  workingHours: normalizeWorkingHours(dbSetting.working_hours),
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
  whatsappSharedSessionUserId: dbSetting.whatsapp_shared_session_user_id,
  prescriptionFrequencies: dbSetting.prescription_frequencies,
  appointmentTypes: dbSetting.appointment_types,
  clinicTier: (dbSetting.clinic_tier as 'basic' | 'silver' | 'gold') ?? 'silver',
  ipdEnabled: dbSetting.ipd_enabled ?? false,
  waitingSequenceEnabled: dbSetting.waiting_sequence_enabled ?? false,
  saveVoiceRecordings: dbSetting.save_voice_recordings ?? false,
  labTestIntegrationEnabled: dbSetting.lab_test_integration_enabled ?? false,
  limsApiUrl: dbSetting.lims_api_url,
  limsApiKey: dbSetting.lims_api_key,
  pdfHeaderUrl: dbSetting.pdf_header_url,
  pdfFooterUrl: dbSetting.pdf_footer_url,
  pdfMargins: dbSetting.pdf_margins,
  pdfPrintMargins: dbSetting.pdf_print_margins,
  invoicePaperSize: dbSetting.invoice_paper_size as 'A4' | 'A5' | undefined,
  invoiceMargins: dbSetting.invoice_margins,
  pdfLetterheadMode: dbSetting.pdf_letterhead_mode === 'full' ? 'full' : 'bands',
  pdfLetterheadUrl: dbSetting.pdf_letterhead_url,
  pdfLetterheadSpacing: dbSetting.pdf_letterhead_spacing,
  pdfPrintBranding: dbSetting.pdf_print_branding ?? false,
  publicSlug: dbSetting.public_slug ?? null,
  publicBookingEnabled: dbSetting.public_booking_enabled ?? false,
  publicBookingPolicy: dbSetting.appointment_config ?? null,
  whatsappTemplates: dbSetting.whatsapp_templates,
  hfrFacilityId: dbSetting.hfr_facility_id ?? null,
  abdmHipId: dbSetting.abdm_hip_id ?? null,
  abdmHipName: dbSetting.abdm_hip_name ?? null,
  abdmCounterCode: dbSetting.abdm_counter_code ?? null,
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
  whatsapp_shared_session_user_id: setting.whatsappSharedSessionUserId,
  prescription_frequencies: setting.prescriptionFrequencies,
  appointment_types: setting.appointmentTypes,
  clinic_tier: setting.clinicTier,
  lab_test_integration_enabled: setting.labTestIntegrationEnabled,
  lims_api_url: setting.limsApiUrl,
  lims_api_key: setting.limsApiKey,
  whatsapp_templates: setting.whatsappTemplates,
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
    if (settings.appointmentTypes !== undefined) dbSettings.appointment_types = settings.appointmentTypes;
    if (settings.waitingSequenceEnabled !== undefined) dbSettings.waiting_sequence_enabled = settings.waitingSequenceEnabled;
    if (settings.saveVoiceRecordings !== undefined) dbSettings.save_voice_recordings = settings.saveVoiceRecordings;
    if (settings.labTestIntegrationEnabled !== undefined) dbSettings.lab_test_integration_enabled = settings.labTestIntegrationEnabled;
    if (settings.limsApiUrl !== undefined) dbSettings.lims_api_url = settings.limsApiUrl;
    if (settings.limsApiKey !== undefined) dbSettings.lims_api_key = settings.limsApiKey;
    if (settings.pdfHeaderUrl !== undefined) dbSettings.pdf_header_url = settings.pdfHeaderUrl;
    if (settings.pdfFooterUrl !== undefined) dbSettings.pdf_footer_url = settings.pdfFooterUrl;
    if (settings.pdfMargins !== undefined) dbSettings.pdf_margins = settings.pdfMargins;
    if (settings.invoicePaperSize !== undefined) dbSettings.invoice_paper_size = settings.invoicePaperSize;
    if (settings.invoiceMargins !== undefined) dbSettings.invoice_margins = settings.invoiceMargins;
    if (settings.pdfLetterheadMode !== undefined) dbSettings.pdf_letterhead_mode = settings.pdfLetterheadMode;
    if (settings.pdfLetterheadUrl !== undefined) dbSettings.pdf_letterhead_url = settings.pdfLetterheadUrl;
    if (settings.pdfLetterheadSpacing !== undefined) dbSettings.pdf_letterhead_spacing = settings.pdfLetterheadSpacing;
    if (settings.pdfPrintBranding !== undefined) dbSettings.pdf_print_branding = settings.pdfPrintBranding;
    if (settings.whatsappSharedSessionUserId !== undefined) dbSettings.whatsapp_shared_session_user_id = settings.whatsappSharedSessionUserId;
    // Without this the Clinic Settings template editor silently discarded every
    // edit, and the reminder scheduler read an empty whatsapp_templates column.
    if (settings.whatsappTemplates !== undefined) dbSettings.whatsapp_templates = settings.whatsappTemplates;

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
        workingHours: settings.workingHours || DEFAULT_WORKING_HOURS,
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
        workingHours: DEFAULT_WORKING_HOURS,
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
    return normalizeWorkingHours(settings.workingHours);
  },

  // Update working hours
  async updateWorkingHours(workingHours: ClinicSetting['workingHours']): Promise<ClinicSetting> {
    const settings = await this.getOrCreateClinicSettings();
    return await this.updateClinicSettings(settings.id, { workingHours });
  },

  // Public self-booking config.
  //
  // Written directly rather than through updateClinicSettings because the slug
  // carries a uniqueness constraint whose violation needs a specific message,
  // and because these columns must never ride along on an unrelated save.
  async updatePublicBooking(
    clinicId: string,
    config: {
      publicSlug?: string | null;
      publicBookingEnabled?: boolean;
      publicBookingPolicy?: PublicBookingPolicy;
    }
  ): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const updates: Record<string, unknown> = {};

    if (config.publicSlug !== undefined) {
      const slug = config.publicSlug?.trim().toLowerCase() || null;

      if (slug !== null && !/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
        throw new Error(
          'Link name must be 2-41 characters: lowercase letters, numbers and hyphens, starting with a letter or number.'
        );
      }

      updates.public_slug = slug;
    }

    if (config.publicBookingEnabled !== undefined) {
      updates.public_booking_enabled = config.publicBookingEnabled;
    }

    if (config.publicBookingPolicy !== undefined) {
      updates.appointment_config = config.publicBookingPolicy;
    }

    if (Object.keys(updates).length === 0) return;

    const { error } = await supabase
      .from('clinic_settings')
      .update(updates)
      .eq('id', clinicId);

    if (error) {
      // 23505 = idx_clinic_settings_public_slug. Slugs are global across every
      // clinic on the platform, so collisions are expected and normal.
      if (error.code === '23505') {
        throw new Error('That link name is already taken. Please choose another.');
      }
      throw new Error(`Failed to save public booking settings: ${error.message}`);
    }
  },

  // Platform-managed flag (like clinic_tier): deliberately not part of the
  // regular update path so a normal clinic-settings save can never flip it.
  async setIpdEnabled(clinicId: string, enabled: boolean): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }
    const { error } = await supabase
      .from('clinic_settings')
      .update({ ipd_enabled: enabled })
      .eq('id', clinicId);
    if (error) {
      throw new Error(`Failed to update IPD access: ${error.message}`);
    }
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

/**
 * Resolve the WhatsApp userId to use for API calls.
 * If shared session is enabled in clinic settings, returns the shared (admin) userId.
 * Otherwise returns the current user's own userId.
 */
export async function resolveWhatsAppUserId(currentUserId: string, clinicId: string): Promise<string> {
  try {
    if (!supabase) return currentUserId;
    const { data } = await supabase
      .from('clinic_settings')
      .select('whatsapp_shared_session_user_id')
      .eq('id', clinicId)
      .single();
    return data?.whatsapp_shared_session_user_id || currentUserId;
  } catch {
    return currentUserId;
  }
}
