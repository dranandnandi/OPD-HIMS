import { supabase } from '../lib/supabase';
import { getCurrentProfile } from './profileService';

/**
 * Refill reminders captured at the pharmacy counter. The Netlify scheduler
 * (queue-auto-reminders) turns pending rows into WhatsApp messages a few days
 * before due_date; this service only creates, lists and cancels them.
 */

export interface RefillReminderMedicine {
  medicineId: string;
  name: string;
  quantity: number;
}

export interface RefillReminder {
  id: string;
  patientId: string;
  billId?: string;
  visitId?: string;
  medicines: RefillReminderMedicine[];
  dueDate: Date;
  status: 'pending' | 'queued' | 'sent' | 'cancelled';
  note?: string;
  createdAt: Date;
  patientName?: string;
  patientPhone?: string;
}

const toDateOnly = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const convert = (r: any): RefillReminder => ({
  id: r.id,
  patientId: r.patient_id,
  billId: r.bill_id ?? undefined,
  visitId: r.visit_id ?? undefined,
  medicines: Array.isArray(r.medicines) ? r.medicines : [],
  dueDate: new Date(r.due_date),
  status: r.status,
  note: r.note ?? undefined,
  createdAt: new Date(r.created_at),
  patientName: r.patients?.name ?? undefined,
  patientPhone: r.patients?.phone ?? undefined
});

export const refillReminderService = {
  async create(input: {
    patientId: string;
    billId?: string | null;
    visitId?: string | null;
    medicines: RefillReminderMedicine[];
    dueDate: Date;
    note?: string;
  }): Promise<RefillReminder> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');

    const { data, error } = await supabase
      .from('pharmacy_refill_reminders')
      .insert({
        clinic_id: profile.clinicId,
        patient_id: input.patientId,
        bill_id: input.billId || null,
        visit_id: input.visitId || null,
        medicines: input.medicines,
        due_date: toDateOnly(input.dueDate),
        status: 'pending',
        note: input.note || null,
        created_by: profile.id
      })
      .select()
      .single();
    if (error || !data) throw new Error(error?.message || 'Failed to save refill reminder');
    return convert(data);
  },

  /** Upcoming reminders (pending or queued), soonest first. */
  async listUpcoming(limit = 200): Promise<RefillReminder[]> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');

    const { data, error } = await supabase
      .from('pharmacy_refill_reminders')
      .select('*, patients (name, phone)')
      .eq('clinic_id', profile.clinicId)
      .in('status', ['pending', 'queued'])
      .order('due_date', { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []).map(convert);
  },

  async cancel(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const { error } = await supabase
      .from('pharmacy_refill_reminders')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('status', 'pending');
    if (error) throw new Error(error.message);
  }
};

/**
 * "7 days", "2 weeks", "1 month", "15" -> days. Returns 0 when it cannot tell.
 * Prescription durations in this app are free text, so be forgiving.
 */
export function parseDurationDays(text?: string | null): number {
  if (!text) return 0;
  const t = text.toLowerCase().trim();
  const m = t.match(/(\d+(?:\.\d+)?)\s*(day|days|d|week|weeks|wk|wks|w|month|months|mo|mon|m)?\b/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2] || 'day';
  if (/^(week|weeks|wk|wks|w)$/.test(unit)) return Math.round(n * 7);
  if (/^(month|months|mo|mon|m)$/.test(unit)) return Math.round(n * 30);
  return Math.round(n);
}
