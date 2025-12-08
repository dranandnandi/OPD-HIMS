import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { authService } from './authService';
import { clinicSettingsService } from './clinicSettingsService'; // Assuming this service is clinic-aware
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

export const doctorAvailabilityService = {
  // Get doctor's availability (fallback to clinic settings if not set)
  async getDoctorAvailability(doctorId: string): Promise<DoctorAvailability> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await authService.getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      // Get doctor's specific availability
      const { data: profile, error } = await supabase
        .from('profiles')
        .eq('clinic_id', profile.clinicId)

        .select('doctor_availability, clinic_id')
        .eq('id', doctorId)
        .single();

      if (error) {
        throw new Error('Failed to fetch doctor profile');
      }

      // If doctor has specific availability, use it
      if (profile.doctor_availability) {
        return profile.doctor_availability;
      }

      // Otherwise, fall back to clinic working hours
      const clinicWorkingHours = await clinicSettingsService.getWorkingHours();
      return clinicWorkingHours;

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

      
      // Get existing appointments for the doctor in the date range
      const existingAppointments = await appointmentService.getAppointmentsByDateRange(startDate, endDate);
      const doctorAppointments = existingAppointments.filter(apt => apt.doctorId === doctorId);

      const slots: TimeSlot[] = [];
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dayName = format(currentDate, 'EEEE').toLowerCase();
        const dayAvailability = availability[dayName];

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