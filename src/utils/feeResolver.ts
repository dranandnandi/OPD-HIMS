import { AppointmentType, Profile, ClinicSetting } from '../types';

/**
 * Resolves the consultation fee based on appointment type
 * Priority: Doctor-specific fee > Clinic-level fee > Default
 */
export function resolveFeeForAppointment(
  appointmentType: string,
  appointmentTypes: AppointmentType[],
  doctor?: Profile | null,
  clinicSettings?: ClinicSetting | null
): number {
  // Find the appointment type configuration
  const aptTypeConfig = appointmentTypes.find(
    t => t.label === appointmentType || t.id === appointmentType
  );

  if (!aptTypeConfig) {
    // Fallback to default consultation fee if type not found
    return doctor?.consultationFee || clinicSettings?.consultationFee || 300;
  }

  // Resolve fee based on feeType
  switch (aptTypeConfig.feeType) {
    case 'consultation':
      return doctor?.consultationFee || clinicSettings?.consultationFee || 300;
    
    case 'followup':
      return doctor?.followUpFee || clinicSettings?.followUpFee || 200;
    
    case 'emergency':
      return doctor?.emergencyFee || clinicSettings?.emergencyFee || 500;
    
    case 'custom':
      return aptTypeConfig.customFee || 0;
    
    default:
      return doctor?.consultationFee || clinicSettings?.consultationFee || 300;
  }
}

/**
 * Get fee display text for an appointment type
 */
export function getFeeDisplayForAppointmentType(
  appointmentType: AppointmentType,
  doctor?: Profile | null,
  clinicSettings?: ClinicSetting | null
): string {
  const fee = resolveFeeForAppointment(
    appointmentType.label,
    [appointmentType],
    doctor,
    clinicSettings
  );
  
  const source = appointmentType.feeType === 'custom' 
    ? 'Custom' 
    : doctor?.[`${appointmentType.feeType}Fee` as keyof Profile]
      ? 'Doctor'
      : 'Clinic';
  
  return `₹${fee} (${source})`;
}
