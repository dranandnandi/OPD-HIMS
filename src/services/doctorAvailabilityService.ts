import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { authService } from './authService';
import { clinicSettingsService, normalizeWorkingHours } from './clinicSettingsService'; // Assuming this service is clinic-aware
import { appointmentService } from './appointmentService';
import { addMinutes, format, isSameDay, isAfter, isBefore, parseISO } from 'date-fns';

export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
  doctorId: string;
}

export interface DoctorAvailability {
  [key: string]: {
    isOpen: boolean;
    startTime: string;
    endTime: string;
    breakStart?: string;
    breakEnd?: string;
  };
}

export type DayAvailability = DoctorAvailability[string];

/** A date-specific replacement of the weekly pattern (doctor_availability_overrides row). */
export interface AvailabilityOverride {
  id: string;
  doctorId: string;
  /** Clinic-local "YYYY-MM-DD". */
  date: string;
  isOpen: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  note: string | null;
}

interface OverrideRow {
  id: string;
  doctor_id: string;
  override_date: string;
  is_open: boolean;
  start_time: string | null;
  end_time: string | null;
  break_start: string | null;
  break_end: string | null;
  note: string | null;
}

const mapOverrideRow = (row: OverrideRow): AvailabilityOverride => ({
  id: row.id,
  doctorId: row.doctor_id,
  date: row.override_date,
  isOpen: row.is_open === true,
  startTime: row.start_time,
  endTime: row.end_time,
  breakStart: row.break_start,
  breakEnd: row.break_end,
  note: row.note,
});

const overrideToDay = (override: AvailabilityOverride): DayAvailability => ({
  isOpen: override.isOpen,
  startTime: override.startTime ?? '',
  endTime: override.endTime ?? '',
  breakStart: override.breakStart ?? undefined,
  breakEnd: override.breakEnd ?? undefined,
});

export const doctorAvailabilityService = {
  // Get doctor's availability (fallback to clinic settings if not set)
  async getDoctorAvailability(doctorId: string): Promise<DoctorAvailability> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const currentProfile = await authService.getCurrentProfile();
    if (!currentProfile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      // Get doctor's specific availability
      const { data: doctorProfile, error } = await supabase
        .from('profiles')
        .select('doctor_availability, clinic_id')
        .eq('clinic_id', currentProfile.clinicId)
        .eq('id', doctorId)
        .single();

      if (error) {
        throw new Error('Failed to fetch doctor profile');
      }

      // If doctor has specific availability, use it. It is a nullable JSONB
      // column that predates this shape, so it gets normalized rather than
      // trusted - callers render Object.entries() over the result.
      if (doctorProfile.doctor_availability) {
        return normalizeWorkingHours(doctorProfile.doctor_availability);
      }

      // Otherwise, fall back to clinic working hours
      const clinicWorkingHours = await clinicSettingsService.getWorkingHours();
      return normalizeWorkingHours(clinicWorkingHours);

    } catch (error) {
      console.error('Error getting doctor availability:', error);
      throw error;
    }
  },

  // Update doctor's availability
  async updateDoctorAvailability(doctorId: string, availabilityData: DoctorAvailability): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await authService.getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ doctor_availability: availabilityData })
        .eq('clinic_id', profile.clinicId)

        .eq('id', doctorId);

      if (error) {
        throw new Error('Failed to update doctor availability');
      }
    } catch (error) {
      console.error('Error updating doctor availability:', error);
      throw error;
    }
  },

  // --- date-specific overrides ---------------------------------------------

  /**
   * Upcoming overrides for a doctor. Past rows are purged first (clinic-wide)
   * so the table never bulks up: once the date has gone by, the weekly pattern
   * is the only truth anyway.
   */
  async listOverrides(doctorId: string): Promise<AvailabilityOverride[]> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const profile = await authService.getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');

    const today = format(new Date(), 'yyyy-MM-dd');

    // Best-effort cleanup; a failure here must not block the listing.
    try {
      await supabase
        .from('doctor_availability_overrides')
        .delete()
        .eq('clinic_id', profile.clinicId)
        .lt('override_date', today);
    } catch {
      // ignore
    }

    const { data, error } = await supabase
      .from('doctor_availability_overrides')
      .select('id, doctor_id, override_date, is_open, start_time, end_time, break_start, break_end, note')
      .eq('clinic_id', profile.clinicId)
      .eq('doctor_id', doctorId)
      .gte('override_date', today)
      .order('override_date', { ascending: true });

    if (error) throw new Error('Failed to load date overrides');
    return (data ?? []).map(mapOverrideRow);
  },

  /** Create or replace the override for one doctor on one date. */
  async saveOverride(
    doctorId: string,
    override: {
      date: string;
      isOpen: boolean;
      startTime?: string;
      endTime?: string;
      breakStart?: string;
      breakEnd?: string;
      note?: string;
    },
  ): Promise<void> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const profile = await authService.getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');

    const { error } = await supabase
      .from('doctor_availability_overrides')
      .upsert(
        {
          clinic_id: profile.clinicId,
          doctor_id: doctorId,
          override_date: override.date,
          is_open: override.isOpen,
          start_time: override.isOpen ? override.startTime || null : null,
          end_time: override.isOpen ? override.endTime || null : null,
          break_start: override.isOpen ? override.breakStart || null : null,
          break_end: override.isOpen ? override.breakEnd || null : null,
          note: override.note?.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'doctor_id,override_date' },
      );

    if (error) {
      console.error('Error saving availability override:', error);
      throw new Error('Failed to save date override');
    }
  },

  /** Remove an override; the date reverts to the weekly schedule. */
  async deleteOverride(overrideId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const { error } = await supabase
      .from('doctor_availability_overrides')
      .delete()
      .eq('id', overrideId);

    if (error) throw new Error('Failed to delete date override');
  },

  /**
   * The availability that actually applies to a doctor on one date: the
   * override if one exists, the weekly pattern otherwise. `day: null` means
   * closed all day.
   */
  async getEffectiveDayAvailability(
    doctorId: string,
    dateKey: string,
  ): Promise<{ day: DayAvailability | null; overridden: boolean }> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const profile = await authService.getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');

    const { data: overrideRow } = await supabase
      .from('doctor_availability_overrides')
      .select('id, doctor_id, override_date, is_open, start_time, end_time, break_start, break_end, note')
      .eq('clinic_id', profile.clinicId)
      .eq('doctor_id', doctorId)
      .eq('override_date', dateKey)
      .maybeSingle();

    if (overrideRow) {
      const override = mapOverrideRow(overrideRow as OverrideRow);
      return {
        day: override.isOpen ? overrideToDay(override) : null,
        overridden: true,
      };
    }

    const weekly = await this.getDoctorAvailability(doctorId);
    const dayName = format(parseISO(dateKey), 'EEEE').toLowerCase();
    const day = weekly[dayName];

    return { day: day && day.isOpen ? day : null, overridden: false };
  },

  // Generate available time slots for a doctor within a date range
  async generateAvailableSlots(
    doctorId: string, 
    startDate: Date, 
    endDate: Date,
    appointmentDuration: number = 30
  ): Promise<TimeSlot[]> {
    try {
      // Get doctor's availability
      const profile = await authService.getCurrentProfile();
      if (!profile?.clinicId) {
        throw new Error('User not assigned to a clinic.');
      }

      const availability = await this.getDoctorAvailability(doctorId); // This already filters by clinic_id

      // Date overrides in the range, keyed by "YYYY-MM-DD". An override wins
      // over the weekly pattern on exactly its date.
      const overridesByDate = new Map<string, AvailabilityOverride>();
      if (supabase) {
        const { data: overrideRows } = await supabase
          .from('doctor_availability_overrides')
          .select('id, doctor_id, override_date, is_open, start_time, end_time, break_start, break_end, note')
          .eq('clinic_id', profile.clinicId)
          .eq('doctor_id', doctorId)
          .gte('override_date', format(startDate, 'yyyy-MM-dd'))
          .lte('override_date', format(endDate, 'yyyy-MM-dd'));

        for (const row of (overrideRows ?? []) as OverrideRow[]) {
          overridesByDate.set(row.override_date, mapOverrideRow(row));
        }
      }

      // Get existing appointments for the doctor in the date range
      const existingAppointments = await appointmentService.getAppointmentsByDateRange(startDate, endDate);
      const doctorAppointments = existingAppointments.filter(apt => apt.doctorId === doctorId);

      const slots: TimeSlot[] = [];
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dayName = format(currentDate, 'EEEE').toLowerCase();
        const override = overridesByDate.get(format(currentDate, 'yyyy-MM-dd'));
        const dayAvailability = override ? overrideToDay(override) : availability[dayName];

        if (dayAvailability && dayAvailability.isOpen) {
          // Generate slots for this day
          const daySlots = this.generateDaySlots(
            currentDate,
            dayAvailability,
            appointmentDuration,
            doctorAppointments,
            doctorId
          );
          slots.push(...daySlots);
        }

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return slots;

    } catch (error) {
      console.error('Error generating available slots:', error);
      throw error;
    }
  },

  // Generate slots for a specific day
  generateDaySlots(
    date: Date,
    dayAvailability: DoctorAvailability[string],
    appointmentDuration: number,
    existingAppointments: any[],
    doctorId: string
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    
    // Parse start and end times
    const [startHour, startMinute] = dayAvailability.startTime.split(':').map(Number);
    const [endHour, endMinute] = dayAvailability.endTime.split(':').map(Number);
    
    const dayStart = new Date(date);
    dayStart.setHours(startHour, startMinute, 0, 0);
    
    const dayEnd = new Date(date);
    dayEnd.setHours(endHour, endMinute, 0, 0);

    // Parse break times if they exist
    let breakStart: Date | null = null;
    let breakEnd: Date | null = null;
    
    if (dayAvailability.breakStart && dayAvailability.breakEnd) {
      const [breakStartHour, breakStartMinute] = dayAvailability.breakStart.split(':').map(Number);
      const [breakEndHour, breakEndMinute] = dayAvailability.breakEnd.split(':').map(Number);
      
      breakStart = new Date(date);
      breakStart.setHours(breakStartHour, breakStartMinute, 0, 0);
      
      breakEnd = new Date(date);
      breakEnd.setHours(breakEndHour, breakEndMinute, 0, 0);
    }

    // Generate slots
    let currentSlotStart = new Date(dayStart);
    
    while (currentSlotStart < dayEnd) {
      const currentSlotEnd = addMinutes(currentSlotStart, appointmentDuration);
      
      // Check if slot end time exceeds day end
      if (currentSlotEnd > dayEnd) {
        break;
      }

      // Check if slot overlaps with break time
      const isInBreak = breakStart && breakEnd && (
        (currentSlotStart >= breakStart && currentSlotStart < breakEnd) ||
        (currentSlotEnd > breakStart && currentSlotEnd <= breakEnd) ||
        (currentSlotStart <= breakStart && currentSlotEnd >= breakEnd)
      );

      // Check if slot conflicts with existing appointments
      const hasConflict = existingAppointments.some(appointment => {
        if (!isSameDay(appointment.appointmentDate, date)) {
          return false;
        }
        
        const aptStart = new Date(appointment.appointmentDate);
        const aptEnd = addMinutes(aptStart, appointment.duration);
        
        return (
          (currentSlotStart >= aptStart && currentSlotStart < aptEnd) ||
          (currentSlotEnd > aptStart && currentSlotEnd <= aptEnd) ||
          (currentSlotStart <= aptStart && currentSlotEnd >= aptEnd)
        );
      });

      // Only add slot if it's not in break time and has no conflicts
      const isAvailable = !isInBreak && !hasConflict;
      
      slots.push({
        start: new Date(currentSlotStart),
        end: new Date(currentSlotEnd),
        available: isAvailable,
        doctorId
      });

      // Move to next slot
      currentSlotStart = addMinutes(currentSlotStart, appointmentDuration);
    }

    return slots;
  },

  // Check if a doctor is available at a specific time
  async isDoctorAvailable(doctorId: string, appointmentDate: Date, duration: number): Promise<boolean> {
    try {
      const endDate = addMinutes(appointmentDate, duration);
      const slots = await this.generateAvailableSlots(doctorId, appointmentDate, endDate);
      
      // Check if there's an available slot that covers the entire appointment duration
      return slots.some(slot => 
        slot.available && 
        slot.start <= appointmentDate && 
        slot.end >= endDate
      );
    } catch (error) {
      console.error('Error checking doctor availability:', error);
      return false;
    }
  },

  // Get all doctors who are open for consultation
  async getConsultationDoctors(): Promise<Profile[]> {
    const profile = await authService.getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }
    // authService.getDoctors() already filters by clinic_id
    return await authService.getDoctors(); 
  }
};