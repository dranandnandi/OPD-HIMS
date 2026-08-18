/**
 * Server-side template rendering for automatic WhatsApp reminders.
 *
 * Mirrors the resolution order used by the in-app WhatsAppAutoSendService:
 *   clinic_settings.whatsapp_templates[key]  ->  DEFAULT_TEMPLATES[eventType]
 *
 * Kept self-contained (no imports from src/) so the Netlify bundler does not
 * have to pull the React app's module graph into a scheduled function.
 */

export type AutoEventType = 'appointment_reminder' | 'follow_up_reminder';

/** clinic_settings.whatsapp_templates uses its own key names for some events. */
const TEMPLATE_KEY_MAP: Record<AutoEventType, string> = {
  appointment_reminder: 'appointment_reminder',
  follow_up_reminder: 'follow_up_reminder'
};

export const DEFAULT_TEMPLATES: Record<AutoEventType, string> = {
  appointment_reminder:
    'Dear {{patientName}},\n\n⏰ Appointment Reminder\n\nYou have an appointment on {{appointmentDate}} with Dr. {{doctorName}} at {{clinicName}}.\n\nPlease arrive 10 minutes early. Reply to this message if you need to reschedule.',
  follow_up_reminder:
    'Dear {{patientName}},\n\n🩺 Follow-up Reminder\n\nDr. {{doctorName}} advised a follow-up visit on {{followUpDate}}. Please call {{clinicPhone}} to book a convenient slot.\n\n- {{clinicName}}'
};

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return Object.entries(variables).reduce(
    (message, [key, value]) => message.replace(new RegExp(`{{${key}}}`, 'g'), value ?? ''),
    template
  );
}

/**
 * Same precedence the in-app WhatsAppAutoSendService.getTemplate() uses:
 * clinic_settings.whatsapp_templates wins, then the whatsapp_message_templates
 * row (which is what the Settings > Auto-Send template editor writes), then the
 * built-in default. Both stores are live in production, so both are honoured.
 */
export function resolveTemplate(
  eventType: AutoEventType,
  clinicTemplates: Record<string, string> | null | undefined,
  tableTemplate?: string | null
): string {
  const key = TEMPLATE_KEY_MAP[eventType];
  const configured = clinicTemplates?.[key];
  if (configured && configured.trim()) return configured;
  if (tableTemplate && tableTemplate.trim()) return tableTemplate;
  return DEFAULT_TEMPLATES[eventType];
}

/** Appointment/follow-up dates are stored as UTC but always read as IST by the clinic. */
export function formatIstDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata'
  }).format(new Date(value));
}

export function formatIstDate(value: string | Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  }).format(new Date(value));
}
