/**
 * Scheduled hourly. Finds reminders that have come due and inserts them into
 * whatsapp_message_queue. It does not send anything -- process-whatsapp-queue
 * drains the queue at the clinic's configured pace.
 *
 * Each run rescans the whole upcoming horizon and gives every row its own
 * scheduled_at, computed backwards from the appointment and pulled inside the
 * clinic's sending window. Every insert carries a dedupe_key backed by a unique
 * index, so rescanning the same appointment hourly is a no-op and overlapping
 * or replayed runs cannot double-book a patient.
 */

import type { Handler } from '@netlify/functions';
import {
  getServiceClient,
  istDateString,
  parseConfig,
  spreadBackwardsFromWindowClose,
  windowAdjustedSendTime,
  type AutoSendConfig
} from './_shared/autoSender';
import {
  formatIstDate,
  formatIstDateTime,
  renderTemplate,
  resolveTemplate
} from './_shared/messageTemplates';

const REMINDABLE_STATUSES = ['Scheduled', 'Confirmed'];

/**
 * How far past its ideal send time a reminder may still go out. Wide enough to
 * absorb a late or skipped hourly run, narrow enough that switching reminders
 * on does not back-fill every appointment already inside the lead window.
 */
const STALE_SEND_GRACE_MS = 2 * 60 * 60 * 1000;

interface PatientLite {
  id: string;
  name: string | null;
  phone: string | null;
}

const handler: Handler = async () => {
  const supabase = getServiceClient();
  const summary = { appointmentReminders: 0, followUpReminders: 0, clinics: 0, errors: [] as string[] };

  const { data: rules, error: rulesError } = await supabase
    .from('whatsapp_auto_send_rules')
    .select('clinic_id, event_type, enabled')
    .eq('enabled', true)
    .in('event_type', ['appointment_reminder', 'follow_up_reminder']);

  if (rulesError) {
    console.error('[queue-reminders] failed to load rules:', rulesError.message);
    return { statusCode: 500, body: JSON.stringify({ error: rulesError.message }) };
  }

  const enabledByClinic = new Map<string, Set<string>>();
  for (const rule of rules ?? []) {
    const set = enabledByClinic.get(rule.clinic_id) ?? new Set<string>();
    set.add(rule.event_type);
    enabledByClinic.set(rule.clinic_id, set);
  }

  if (enabledByClinic.size === 0) {
    return { statusCode: 200, body: JSON.stringify({ ...summary, note: 'no clinic has reminders enabled' }) };
  }

  const clinicIds = [...enabledByClinic.keys()];

  const { data: clinics, error: clinicError } = await supabase
    .from('clinic_settings')
    .select('id, clinic_name, phone, whatsapp_templates, whatsapp_auto_send_config')
    .in('id', clinicIds);

  if (clinicError) {
    console.error('[queue-reminders] failed to load clinics:', clinicError.message);
    return { statusCode: 500, body: JSON.stringify({ error: clinicError.message }) };
  }

  // Settings > Auto-Send writes its template edits here rather than to
  // clinic_settings.whatsapp_templates, so it is the second link in the chain.
  const { data: tableTemplates } = await supabase
    .from('whatsapp_message_templates')
    .select('clinic_id, event_type, message_content, is_default')
    .in('clinic_id', clinicIds)
    .in('event_type', ['appointment_reminder', 'follow_up_reminder'])
    .order('is_default', { ascending: false });

  const tableTemplateByClinic = new Map<string, string>();
  for (const row of tableTemplates ?? []) {
    const key = `${row.clinic_id}:${row.event_type}`;
    if (!tableTemplateByClinic.has(key)) tableTemplateByClinic.set(key, row.message_content);
  }

  for (const clinic of clinics ?? []) {
    summary.clinics += 1;
    const enabled = enabledByClinic.get(clinic.id) ?? new Set<string>();
    const config = parseConfig(clinic.whatsapp_auto_send_config);
    const clinicName = clinic.clinic_name || 'our clinic';
    const clinicPhone = clinic.phone || '';
    const templates = (clinic.whatsapp_templates ?? {}) as Record<string, string>;
    const tableTemplateFor = (eventType: string) =>
      tableTemplateByClinic.get(`${clinic.id}:${eventType}`) ?? null;

    if (enabled.has('appointment_reminder')) {
      try {
        summary.appointmentReminders += await queueAppointmentReminders({
          supabase,
          clinicId: clinic.id,
          clinicName,
          clinicPhone,
          templates,
          tableTemplate: tableTemplateFor('appointment_reminder'),
          config
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        summary.errors.push(`${clinic.id} appointments: ${message}`);
        console.error(`[queue-reminders] appointment pass failed for ${clinic.id}:`, message);
      }
    }

    if (enabled.has('follow_up_reminder')) {
      try {
        summary.followUpReminders += await queueFollowUpReminders({
          supabase,
          clinicId: clinic.id,
          clinicName,
          clinicPhone,
          templates,
          tableTemplate: tableTemplateFor('follow_up_reminder'),
          config
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        summary.errors.push(`${clinic.id} follow-ups: ${message}`);
        console.error(`[queue-reminders] follow-up pass failed for ${clinic.id}:`, message);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify(summary) };
};

interface PassArgs {
  supabase: ReturnType<typeof getServiceClient>;
  clinicId: string;
  clinicName: string;
  clinicPhone: string;
  templates: Record<string, string>;
  tableTemplate: string | null;
  config: AutoSendConfig;
}

async function queueAppointmentReminders(args: PassArgs): Promise<number> {
  const { supabase, clinicId, clinicName, clinicPhone, templates, tableTemplate, config } = args;

  // Scan every upcoming appointment far enough ahead that its send time is
  // still in the future, and let each row carry its own scheduled_at. The
  // dedupe_key makes re-scanning the same appointment every hour a no-op, so a
  // wide horizon costs nothing and removes the old "miss the slice, miss the
  // reminder" failure mode.
  const now = new Date();
  const leadMs = config.appointmentReminderHoursBefore * 60 * 60 * 1000;
  const horizonEnd = new Date(now.getTime() + leadMs + 24 * 60 * 60 * 1000);

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select('id, patient_id, appointment_date, status, patients!inner(id, name, phone, is_hidden), profiles(name)')
    .eq('clinic_id', clinicId)
    .in('status', REMINDABLE_STATUSES)
    .eq('patients.is_hidden', false)
    .gte('appointment_date', now.toISOString())
    .lt('appointment_date', horizonEnd.toISOString());

  if (error) throw new Error(error.message);
  if (!appointments?.length) return 0;

  const template = resolveTemplate('appointment_reminder', templates, tableTemplate);
  const rows: Record<string, unknown>[] = [];

  for (const appointment of appointments) {
    const patient = firstOf<PatientLite>(appointment.patients);
    if (!patient?.phone) continue;

    const idealSendAt = new Date(new Date(appointment.appointment_date).getTime() - leadMs);
    const sendAt = windowAdjustedSendTime(idealSendAt, config);

    // Already well past when this should have gone out -- typically an
    // appointment that was inside the lead window when reminders were first
    // switched on. Reminding someone an hour beforehand is worse than silence.
    if (sendAt.getTime() < now.getTime() - STALE_SEND_GRACE_MS) continue;

    const scheduledAt = new Date(Math.max(sendAt.getTime(), now.getTime()));
    const doctorName = firstOf<{ name: string | null }>(appointment.profiles)?.name || 'Doctor';

    rows.push({
      clinic_id: clinicId,
      patient_id: patient.id,
      phone_number: patient.phone,
      event_type: 'appointment_reminder',
      message_content: renderTemplate(template, {
        patientName: patient.name || 'Patient',
        clinicName,
        clinicPhone,
        doctorName,
        appointmentDate: formatIstDateTime(appointment.appointment_date)
      }),
      metadata: { appointmentId: appointment.id, source: 'auto_reminder' },
      status: 'pending',
      scheduled_at: scheduledAt.toISOString(),
      // Earlier appointment => lower number => sent first.
      priority: istMinutesOfDayFor(appointment.appointment_date),
      dedupe_key: `appt_reminder:${appointment.id}`,
      retry_count: 0
    });
  }

  spreadBackwardsFromWindowClose(rows as { scheduled_at: unknown; priority: unknown }[], config, now);
  return insertIgnoringDuplicates(supabase, rows);
}

async function queueFollowUpReminders(args: PassArgs): Promise<number> {
  const { supabase, clinicId, clinicName, clinicPhone, templates, tableTemplate, config } = args;

  // followUpLeadDays = 0 means "remind on the follow-up date itself".
  const target = new Date(Date.now() + config.followUpLeadDays * 24 * 60 * 60 * 1000);
  const targetDate = istDateString(target);
  const dayAfter = istDateString(new Date(target.getTime() + 24 * 60 * 60 * 1000));

  const { data: visits, error } = await supabase
    .from('visits')
    .select('id, patient_id, follow_up_date, patients!inner(id, name, phone, is_hidden), profiles(name)')
    .eq('clinic_id', clinicId)
    .eq('patients.is_hidden', false)
    .gte('follow_up_date', `${targetDate}T00:00:00+05:30`)
    .lt('follow_up_date', `${dayAfter}T00:00:00+05:30`);

  if (error) throw new Error(error.message);
  if (!visits?.length) return 0;

  const template = resolveTemplate('follow_up_reminder', templates, tableTemplate);
  const rows: Record<string, unknown>[] = [];

  for (const visit of visits) {
    const patient = firstOf<PatientLite>(visit.patients);
    if (!patient?.phone) continue;

    const doctorName = firstOf<{ name: string | null }>(visit.profiles)?.name || 'Doctor';

    rows.push({
      clinic_id: clinicId,
      patient_id: patient.id,
      phone_number: patient.phone,
      event_type: 'follow_up_reminder',
      message_content: renderTemplate(template, {
        patientName: patient.name || 'Patient',
        clinicName,
        clinicPhone,
        doctorName,
        followUpDate: formatIstDate(visit.follow_up_date)
      }),
      metadata: { visitId: visit.id, source: 'auto_reminder' },
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      // Behind same-day appointment reminders, which are more time-critical.
      priority: 2000,
      dedupe_key: `followup:${visit.id}`,
      retry_count: 0
    });
  }

  return insertIgnoringDuplicates(supabase, rows);
}

/**
 * PostgREST rejects the whole batch when any row trips the dedupe index, so a
 * conflicting batch is retried row by row and the duplicates are skipped.
 */
async function insertIgnoringDuplicates(
  supabase: ReturnType<typeof getServiceClient>,
  rows: Record<string, unknown>[]
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await supabase.from('whatsapp_message_queue').insert(rows);
  if (!error) return rows.length;
  if (error.code !== '23505') throw new Error(error.message);

  let inserted = 0;
  for (const row of rows) {
    const { error: rowError } = await supabase.from('whatsapp_message_queue').insert(row);
    if (!rowError) inserted += 1;
    else if (rowError.code !== '23505') throw new Error(rowError.message);
  }
  return inserted;
}

/** PostgREST returns embedded relations as an object or a single-element array. */
function firstOf<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value ?? undefined) as T | undefined;
}

function istMinutesOfDayFor(value: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata'
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

export { handler };
