import { Appointment } from '../types';

/**
 * Get Tailwind CSS classes for appointment status badge
 * @param status - Appointment status
 * @returns CSS class string for background, text, and border colors
 */
export const getAppointmentStatusColor = (status: Appointment['status']): string => {
    const colorMap: Record<Appointment['status'], string> = {
        'Scheduled': 'bg-blue-100 text-blue-800 border-blue-200',
        'Confirmed': 'bg-green-100 text-green-800 border-green-200',
        'Arrived': 'bg-purple-100 text-purple-800 border-purple-200',
        'In_Progress': 'bg-orange-100 text-orange-800 border-orange-200',
        'Completed': 'bg-gray-100 text-gray-800 border-gray-200',
        'Cancelled': 'bg-red-100 text-red-800 border-red-200',
        'No_Show': 'bg-red-200 text-red-900 border-red-300'
    };
    return colorMap[status] || 'bg-gray-100 text-gray-800 border-gray-200';
};

/**
 * Get display-friendly appointment status label with emoji
 * @param status - Appointment status
 * @returns Formatted status string with emoji
 */
export const getAppointmentStatusBadge = (status: Appointment['status']): string => {
    const badges: Record<Appointment['status'], string> = {
        'Scheduled': '📅 Scheduled',
        'Confirmed': '✅ Confirmed',
        'Arrived': '🚪 Arrived',
        'In_Progress': '⏳ In Progress',
        'Completed': '✓ Completed',
        'Cancelled': '❌ Cancelled',
        'No_Show': '⚠️ No Show'
    };
    return badges[status] || status;
};

/**
 * Get appointment status display name without emoji
 * @param status - Appointment status
 * @returns Formatted status string
 */
export const getAppointmentStatusLabel = (status: Appointment['status']): string => {
    const labels: Record<Appointment['status'], string> = {
        'Scheduled': 'Scheduled',
        'Confirmed': 'Confirmed',
        'Arrived': 'Arrived',
        'In_Progress': 'In Progress',
        'Completed': 'Completed',
        'Cancelled': 'Cancelled',
        'No_Show': 'No Show'
    };
    return labels[status] || status;
};

/**
 * Get priority order for appointment statuses (lower = higher priority)
 * @param status - Appointment status
 * @returns Priority number (0 = highest priority)
 */
export const getAppointmentStatusPriority = (status: Appointment['status']): number => {
    const priorityMap: Record<Appointment['status'], number> = {
        'Arrived': 0,        // Highest priority - patient is waiting
        'Confirmed': 1,      // Patient confirmed they're coming
        'Scheduled': 2,      // Default scheduled
        'In_Progress': 3,    // Currently being seen
        'Completed': 4,      // Done
        'Cancelled': 5,      // Cancelled
        'No_Show': 6         // No show
    };
    return priorityMap[status] ?? 999;
};

/**
 * Check if appointment status is active (patient should be seen)
 * @param status - Appointment status
 * @returns True if appointment is active
 */
export const isAppointmentActive = (status: Appointment['status']): boolean => {
    return ['Scheduled', 'Confirmed', 'Arrived', 'In_Progress'].includes(status);
};

/**
 * Get next logical status transition for appointment
 * @param currentStatus - Current appointment status
 * @returns Suggested next status or null if no logical transition
 */
export const getNextAppointmentStatus = (
    currentStatus: Appointment['status']
): Appointment['status'] | null => {
    const transitions: Partial<Record<Appointment['status'], Appointment['status']>> = {
        'Scheduled': 'Confirmed',
        'Confirmed': 'Arrived',
        'Arrived': 'In_Progress',
        'In_Progress': 'Completed'
    };
    return transitions[currentStatus] || null;
};
