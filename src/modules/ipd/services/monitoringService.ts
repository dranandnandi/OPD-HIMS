import { supabase } from '../utils/supabase';
import type { MonitoringOrder, NursingTask } from '../types/ipd';

/**
 * Standing observation orders — the half of a ward order that is not a drug.
 *
 * "TPR, BP every 30 min", "watch for abdominal distension, passage of urine",
 * "chart urine output hourly": before this, none of it could be ordered. Vitals
 * could only be charted after the fact, so nothing said a reading was due and
 * nothing showed one had been skipped.
 *
 * A monitoring order is expanded into ipd_nursing_tasks occurrences exactly the
 * way a medication order is expanded into schedule slots, which means the
 * existing Tasks list, the done/skip buttons and the alert bar all work on it
 * with no special casing.
 */

/** How far ahead occurrences are materialised on each load. */
const HORIZON_HOURS = 12;
/** Safety valve — no single top-up may insert more than this many rows. */
const MAX_OCCURRENCES_PER_TOPUP = 200;

export interface MonitoringPreset {
  title: string;
  kind: MonitoringOrder['kind'];
  fields: string[];
  intervalMinutes: number;
  instructions?: string;
}

/** Ward-standard orders, one click each. Everything stays editable after. */
export const MONITORING_PRESETS: MonitoringPreset[] = [
  { title: 'TPR + BP', kind: 'vitals', fields: ['temperature', 'pulse', 'resp_rate', 'bp_systolic', 'bp_diastolic'], intervalMinutes: 30 },
  { title: 'TPR + BP', kind: 'vitals', fields: ['temperature', 'pulse', 'resp_rate', 'bp_systolic', 'bp_diastolic'], intervalMinutes: 60 },
  { title: 'Vitals + SpO₂', kind: 'vitals', fields: ['temperature', 'pulse', 'resp_rate', 'bp_systolic', 'bp_diastolic', 'spo2'], intervalMinutes: 240 },
  { title: 'Blood sugar (GRBS)', kind: 'vitals', fields: ['blood_sugar'], intervalMinutes: 360 },
  { title: 'Pain score', kind: 'vitals', fields: ['pain_score'], intervalMinutes: 240 },
  { title: 'Urine output / passage of urine', kind: 'intake_output', fields: [], intervalMinutes: 60 },
  { title: 'Watch for abdominal distension', kind: 'observation', fields: [], intervalMinutes: 120 },
  { title: 'Check IV site', kind: 'observation', fields: [], intervalMinutes: 240 },
];

export const INTERVAL_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 15, label: 'Every 15 min' },
  { minutes: 30, label: 'Every 30 min' },
  { minutes: 60, label: 'Hourly' },
  { minutes: 120, label: '2 hourly' },
  { minutes: 240, label: '4 hourly' },
  { minutes: 360, label: '6 hourly' },
  { minutes: 480, label: '8 hourly' },
  { minutes: 720, label: '12 hourly' },
  { minutes: 1440, label: 'Once daily' },
];

/** Vitals columns a monitoring order can ask for, labelled as on the chart. */
export const VITAL_FIELD_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'temperature', label: 'Temp' },
  { key: 'pulse', label: 'Pulse' },
  { key: 'resp_rate', label: 'Resp' },
  { key: 'bp_systolic', label: 'BP sys' },
  { key: 'bp_diastolic', label: 'BP dia' },
  { key: 'spo2', label: 'SpO₂' },
  { key: 'pain_score', label: 'Pain' },
  { key: 'blood_sugar', label: 'Sugar' },
  { key: 'weight_kg', label: 'Weight' },
];

export function intervalLabel(minutes: number): string {
  const known = INTERVAL_OPTIONS.find((o) => o.minutes === minutes);
  if (known) return known.label;
  if (minutes % 60 === 0) return `Every ${minutes / 60} h`;
  return `Every ${minutes} min`;
}

/** How the occurrence reads on the task list. */
function occurrenceLabel(order: Pick<MonitoringOrder, 'title' | 'kind' | 'fields'>): string {
  if (order.kind === 'vitals' && order.fields.length > 0) {
    const labels = order.fields
      .map((f) => VITAL_FIELD_OPTIONS.find((v) => v.key === f)?.label ?? f)
      .join(', ');
    return `${order.title} — chart ${labels}`;
  }
  return order.title;
}

const categoryFor = (kind: MonitoringOrder['kind']): NonNullable<NursingTask['category']> =>
  kind === 'vitals' ? 'monitoring'
    : kind === 'intake_output' ? 'intake_output'
      : kind === 'observation' ? 'observation'
        : 'general';

/** Due times for `order` in [from, until], aligned to the order's own start. */
function occurrenceTimes(order: MonitoringOrder, from: Date, until: Date): Date[] {
  const step = order.interval_minutes * 60 * 1000;
  if (step <= 0) return [];
  const start = new Date(order.start_at).getTime();
  const hardEnd = order.end_at ? new Date(order.end_at).getTime() : until.getTime();
  const last = Math.min(until.getTime(), hardEnd);

  // first occurrence at or after `from`, still on the order's own grid
  const elapsed = Math.max(0, from.getTime() - start);
  let t = start + Math.ceil(elapsed / step) * step;

  const out: Date[] = [];
  while (t <= last && out.length < MAX_OCCURRENCES_PER_TOPUP) {
    out.push(new Date(t));
    t += step;
  }
  return out;
}

async function insertOccurrences(order: MonitoringOrder, times: Date[]): Promise<number> {
  if (times.length === 0) return 0;
  const rows = times.map((t) => ({
    clinic_id: order.clinic_id,
    admission_id: order.admission_id,
    monitoring_order_id: order.id,
    task: occurrenceLabel(order),
    category: categoryFor(order.kind),
    due_at: t.toISOString(),
    recurrence: `${order.interval_minutes}m`,
    grace_minutes: order.grace_minutes,
    created_by: order.ordered_by,
  }));
  // uniq_nursing_task_occurrence makes the top-up idempotent — two nurses
  // opening the chart at once cannot double the task list
  const { error } = await supabase
    .from('ipd_nursing_tasks')
    .upsert(rows, { onConflict: 'monitoring_order_id,due_at', ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

export const monitoringService = {
  async listOrders(admissionId: string): Promise<MonitoringOrder[]> {
    const { data, error } = await supabase
      .from('ipd_monitoring_orders')
      .select('*')
      .eq('admission_id', admissionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as MonitoringOrder[];
  },

  /** Create a standing order and materialise its first block of occurrences. */
  async create(params: {
    clinicId: string;
    admissionId: string;
    title: string;
    kind: MonitoringOrder['kind'];
    fields?: string[];
    intervalMinutes: number;
    /** when charting starts (default: the next interval from now) */
    startAt?: Date;
    /** how long the order runs; omit for open-ended (until stopped) */
    durationHours?: number;
    instructions?: string;
    graceMinutes?: number;
    userId?: string;
  }): Promise<MonitoringOrder> {
    const title = params.title.trim();
    if (!title) throw new Error('Give the monitoring order a name');
    if (!Number.isFinite(params.intervalMinutes) || params.intervalMinutes < 5) {
      throw new Error('Interval must be at least 5 minutes');
    }
    // copied, not mutated — the caller's Date is theirs
    const startAt = new Date((params.startAt ?? new Date()).getTime());
    startAt.setSeconds(0, 0);
    const endAt = params.durationHours
      ? new Date(startAt.getTime() + params.durationHours * 60 * 60 * 1000)
      : null;

    const { data, error } = await supabase
      .from('ipd_monitoring_orders')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        title,
        kind: params.kind,
        fields: params.fields ?? [],
        interval_minutes: Math.round(params.intervalMinutes),
        start_at: startAt.toISOString(),
        end_at: endAt?.toISOString() ?? null,
        instructions: params.instructions?.trim() || null,
        grace_minutes: params.graceMinutes ?? 15,
        ordered_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;

    const order = data as MonitoringOrder;
    await insertOccurrences(
      order,
      occurrenceTimes(order, startAt, new Date(Date.now() + HORIZON_HOURS * 60 * 60 * 1000))
    );
    return order;
  },

  /** Stop an order and clear its future pending occurrences. */
  async stop(orderId: string, reason?: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('ipd_monitoring_orders')
      .update({ status: 'stopped', stopped_reason: reason ?? null, end_at: now, updated_at: now })
      .eq('id', orderId);
    if (error) throw error;

    await supabase
      .from('ipd_nursing_tasks')
      .delete()
      .eq('monitoring_order_id', orderId)
      .eq('status', 'pending')
      .gt('due_at', now);
  },

  /**
   * Materialise the next block of occurrences for every running order.
   *
   * Called whenever the chart is opened: a 30-minute order left running for a
   * week would otherwise need thousands of rows created up front, and a browser
   * that is never opened cannot generate them. Idempotent, so calling it on
   * every load is safe.
   */
  async topUp(orders: MonitoringOrder[]): Promise<number> {
    const now = new Date();
    const horizon = new Date(now.getTime() + HORIZON_HOURS * 60 * 60 * 1000);
    let created = 0;
    for (const order of orders) {
      if (order.status !== 'active') continue;
      if (order.end_at && new Date(order.end_at) <= now) continue;
      // start from the last hour so a chart reopened after a gap still shows
      // what was missed rather than silently skipping it
      const from = new Date(now.getTime() - 60 * 60 * 1000);
      created += await insertOccurrences(order, occurrenceTimes(order, from, horizon));
    }
    return created;
  },

  /**
   * Sign off the observation a nurse just charted.
   *
   * Recording vitals is the evidence the 30-minute TPR was done, so the nurse
   * should not then have to tick a task as well. The occurrence closest to now
   * (within its own grace window, past or upcoming) is marked done.
   */
  async completeDueOccurrence(params: {
    admissionId: string;
    categories: Array<NonNullable<NursingTask['category']>>;
    userId?: string;
    at?: Date;
  }): Promise<boolean> {
    const at = params.at ?? new Date();
    const { data, error } = await supabase
      .from('ipd_nursing_tasks')
      .select('id, due_at, grace_minutes')
      .eq('admission_id', params.admissionId)
      .eq('status', 'pending')
      .in('category', params.categories)
      .not('monitoring_order_id', 'is', null)
      .order('due_at', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as Array<{ id: string; due_at: string; grace_minutes: number | null }>;
    if (rows.length === 0) return false;

    // nearest occurrence to the charting time, but never one further out than
    // its own grace window — charting now must not tick tonight's reading off
    let best: { id: string; delta: number } | null = null;
    for (const r of rows) {
      const due = new Date(r.due_at).getTime();
      const delta = at.getTime() - due;
      const grace = (r.grace_minutes ?? 15) * 60 * 1000;
      if (delta < -grace) continue;              // still too far in the future
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { id: r.id, delta };
    }
    if (!best) return false;

    const { error: updErr } = await supabase
      .from('ipd_nursing_tasks')
      .update({ status: 'done', done_by: params.userId ?? null, done_at: at.toISOString() })
      .eq('id', best.id)
      .eq('status', 'pending');
    if (updErr) throw updErr;
    return true;
  },
};
