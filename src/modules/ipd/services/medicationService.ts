import { supabase } from '../utils/supabase';
import { chargeService } from './chargeService';
import type { MedicationOrder, MedicationScheduleSlot } from '../types/ipd';

/** Generic pharmacy-issue service that carries drug charges into the bill
    (bill line shows the medicine name via the posting description) */
async function getOrCreatePharmIssueService(clinicId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('services_master')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('service_code', 'PHARM-ISSUE')
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: group } = await supabase
    .from('charge_groups')
    .select('id')
    .eq('clinic_id', clinicId)
    .in('code', ['PHARM-DRUG', 'PHARM'])
    .order('depth', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!group) throw new Error('PHARM charge group missing — run Seed defaults first.');

  const { data, error } = await supabase
    .from('services_master')
    .insert({
      clinic_id: clinicId,
      service_code: 'PHARM-ISSUE',
      name: 'Pharmacy Issue',
      charge_group_id: group.id,
      service_type: 'pharmacy',
      base_price: 0,
      unit: 'unit',
      is_sharable: false,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export interface MedicineOption {
  id: string;
  name: string;
  strength: string | null;
  dosage_form: string | null;
  current_stock: number;
  selling_price: number | null;
}

// Suggested dose times per frequency code. These are only a STARTING POINT the
// prescriber edits — a ward order reads "Inj. Monosef 1 g IV 12 hourly at 8 PM
// and 8 AM", so the clock times belong to the order, not to the frequency code.
// What the user settles on is stored in ipd_medication_orders.dose_times and is
// what the schedule is expanded from.
const FREQUENCY_TIMES: Record<string, string[]> = {
  od: ['09:00'],
  bd: ['09:00', '21:00'],
  tid: ['09:00', '14:00', '21:00'],
  qid: ['06:00', '12:00', '18:00', '22:00'],
  q4h: ['06:00', '10:00', '14:00', '18:00', '22:00', '02:00'],
  q6h: ['00:00', '06:00', '12:00', '18:00'],
  q8h: ['06:00', '14:00', '22:00'],
  q12h: ['09:00', '21:00'],
  hs: ['21:00'],
  custom: ['09:00'],
  stat: [], // one immediate slot
  sos: [],  // PRN — no schedule; given ad hoc
};

export const FREQUENCY_OPTIONS = [
  { code: 'od', label: 'OD — once daily' },
  { code: 'bd', label: 'BD — twice daily' },
  { code: 'tid', label: 'TID — three times daily' },
  { code: 'qid', label: 'QID — four times daily' },
  { code: 'q4h', label: 'Q4H — every 4 hours' },
  { code: 'q6h', label: 'Q6H — every 6 hours' },
  { code: 'q8h', label: 'Q8H — every 8 hours' },
  { code: 'q12h', label: 'Q12H — every 12 hours' },
  { code: 'hs', label: 'HS — at bedtime' },
  { code: 'custom', label: 'Custom — my own times' },
  { code: 'stat', label: 'STAT — immediately, once' },
  { code: 'sos', label: 'SOS — as needed (PRN)' },
];

/** Frequencies that run on a clock: their times are editable per order. */
export function isScheduledFrequency(code: string): boolean {
  return code !== 'stat' && code !== 'sos';
}

/** Suggested clock times to seed the editor with when a frequency is picked. */
export function defaultTimesFor(code: string): string[] {
  return [...(FREQUENCY_TIMES[code] ?? FREQUENCY_TIMES.od)];
}

/** 'HH:MM' — anything else is rejected before it can poison the schedule. */
export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t.trim());
}

/** De-duplicated, validated, chronologically sorted clock times. */
export function normaliseTimes(times: string[]): string[] {
  return [...new Set(times.map((t) => t.trim()).filter(isValidTime))].sort();
}

/** '20:00' → '8:00 PM' — how the ward reads a drug chart. */
export function formatDoseTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** The times an existing order actually runs on (falls back to the defaults
    for orders written before dose times were user-editable). */
export function orderDoseTimes(order: MedicationOrder): string[] {
  const stored = order.dose_times;
  if (stored && stored.length > 0) return normaliseTimes(stored);
  return defaultTimesFor(order.frequency_code);
}

export const ROUTE_OPTIONS = ['oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'per_rectal', 'sublingual'];

/** Label a formulary medicine the way it should read on the order/eMAR line */
export function medicineLabel(m: MedicineOption): string {
  return `${m.name}${m.strength ? ` ${m.strength}` : ''}`;
}

/**
 * Dose values offered once a medicine is picked — its own strength first, then
 * the usual units for that dosage form. The first entry is what auto-fills.
 */
export function doseSuggestions(m: MedicineOption | null): string[] {
  if (!m) return [];
  const form = (m.dosage_form ?? '').toLowerCase();
  const strength = m.strength?.trim();
  const out: string[] = [];
  if (strength) out.push(strength);
  if (/tab|cap/.test(form)) out.push('1 tab', '2 tab', '1/2 tab');
  else if (/syr|susp|solution|liquid|drop|elixir/.test(form)) out.push('5 ml', '10 ml', '2.5 ml');
  else if (/inj|vial|amp|infusion/.test(form)) out.push('1 vial', '1 amp');
  else if (/inhal|respul|nebul|rotacap|puff/.test(form)) out.push('2 puffs', '1 respule');
  else if (/oint|cream|gel|lotion/.test(form)) out.push('Local application');
  else if (/drop/.test(form)) out.push('2 drops');
  return [...new Set(out.filter(Boolean))];
}

/** Route implied by the dosage form, so it does not have to be set by hand */
export function defaultRouteFor(m: MedicineOption | null): string | null {
  const form = (m?.dosage_form ?? '').toLowerCase();
  if (!form) return null;
  if (/inj|vial|amp|infusion/.test(form)) return 'iv';
  if (/inhal|respul|nebul|rotacap|puff/.test(form)) return 'inhalation';
  if (/oint|cream|gel|lotion|patch/.test(form)) return 'topical';
  if (/suppos|enema/.test(form)) return 'per_rectal';
  if (/subling/.test(form)) return 'sublingual';
  if (/tab|cap|syr|susp|solution|liquid|powder|sachet/.test(form)) return 'oral';
  return null;
}

/**
 * Expand the order into dose slots on the given clock times.
 *
 * `from` is where expansion starts (first dose no earlier than this) and
 * `until` is the hard stop — so an order can be re-timed mid-course and only
 * its future slots regenerated.
 */
function expandSchedule(params: {
  frequencyCode: string;
  times: string[];
  from: Date;
  until: Date | null;
  days: number;
}): Date[] {
  const { frequencyCode, times, from, until, days } = params;
  if (frequencyCode === 'stat') return [from];
  if (frequencyCode === 'sos') return [];
  if (times.length === 0) return [];

  const slots: Date[] = [];
  // walk one extra day so a course that starts late in the evening still gets
  // its full run of doses
  for (let d = 0; d <= days; d++) {
    for (const t of times) {
      const [h, m] = t.split(':').map(Number);
      const slot = new Date(from);
      slot.setDate(slot.getDate() + d);
      slot.setHours(h, m, 0, 0);
      if (slot < from) continue;
      if (until && slot > until) continue;
      slots.push(slot);
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime());
}

export const medicationService = {
  /** Shared with storeService: service that carries drug charges into bills */
  getPharmIssueServiceId(clinicId: string): Promise<string> {
    return getOrCreatePharmIssueService(clinicId);
  },

  /**
   * Search the shared OPD pharmacy master, with clinic selling price + stock.
   * An empty term browses the formulary (used by the picker dropdown when the
   * field is focused but nothing has been typed yet).
   */
  async searchMedicines(clinicId: string, term: string): Promise<MedicineOption[]> {
    const search = term.trim();
    let query = supabase
      .from('medicines_master')
      .select('id, name, strength, dosage_form, current_stock, clinic_medicine_prices(selling_price)')
      .eq('clinic_id', clinicId)
      .eq('is_active', true);
    if (search) query = query.ilike('name', `%${search}%`);
    const { data, error } = await query
      .order('name')
      .limit(search ? 15 : 50);
    if (error) throw error;
    return (data as any[]).map((m) => ({
      id: m.id,
      name: m.name,
      strength: m.strength,
      dosage_form: m.dosage_form,
      current_stock: m.current_stock ?? 0,
      selling_price: m.clinic_medicine_prices?.[0]?.selling_price ?? null,
    }));
  },

  async listOrders(admissionId: string): Promise<MedicationOrder[]> {
    const { data, error } = await supabase
      .from('ipd_medication_orders')
      .select('*')
      .eq('admission_id', admissionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as MedicationOrder[];
  },

  /**
   * Create the order and expand its dose schedule.
   *
   * `doseTimes` are the clock times the prescriber actually wants ("8 PM and
   * 8 AM"); leaving it out falls back to the suggested times for the frequency
   * code, which is what dictation and treatment-plan-driven orders do.
   * `startAt` sets when the course begins — an order written at 11 AM can still
   * have its first dose at 8 PM.
   */
  async createOrder(params: {
    clinicId: string;
    admissionId: string;
    medicineId?: string;
    medicineName: string;
    dose?: string;
    route?: string;
    frequencyCode: string;
    days: number;
    instructions?: string;
    /** user-chosen HH:MM slots; defaults to the frequency's suggested times */
    doseTimes?: string[];
    /** when the course begins (default: now) */
    startAt?: Date;
    /** minutes a dose may run late before it is flagged as missed */
    graceMinutes?: number;
    /** set when the order came out of a treatment-plan entry / dictation */
    treatmentPlanId?: string | null;
    userId?: string;
  }): Promise<MedicationOrder> {
    const startAt = params.startAt ?? new Date();
    const times = normaliseTimes(
      params.doseTimes?.length ? params.doseTimes : defaultTimesFor(params.frequencyCode)
    );
    if (isScheduledFrequency(params.frequencyCode) && times.length === 0) {
      throw new Error('Set at least one dose time for this order');
    }
    const endAt =
      params.frequencyCode === 'stat'
        ? null
        : new Date(startAt.getTime() + params.days * 24 * 60 * 60 * 1000);

    const { data: order, error } = await supabase
      .from('ipd_medication_orders')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        medicine_id: params.medicineId ?? null,
        medicine_name: params.medicineName,
        dose: params.dose ?? null,
        route: params.route ?? null,
        frequency_code: params.frequencyCode,
        dose_times: isScheduledFrequency(params.frequencyCode) ? times : null,
        grace_minutes: params.graceMinutes ?? 30,
        start_at: startAt.toISOString(),
        end_at: endAt?.toISOString() ?? null,
        instructions: params.instructions ?? null,
        treatment_plan_id: params.treatmentPlanId ?? null,
        ordered_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;

    const slots = expandSchedule({
      frequencyCode: params.frequencyCode,
      times,
      from: startAt,
      until: endAt,
      days: params.days,
    });
    if (slots.length > 0) {
      const { error: schedErr } = await supabase.from('ipd_medication_schedule').insert(
        slots.map((s) => ({
          clinic_id: params.clinicId,
          medication_order_id: order.id,
          admission_id: params.admissionId,
          scheduled_at: s.toISOString(),
        }))
      );
      if (schedErr) throw schedErr;
    }
    return order as MedicationOrder;
  },

  /**
   * Re-time a running order. Doses already signed for are untouched; only
   * future 'due' slots are dropped and rebuilt on the new times, so shifting
   * "8 AM / 8 PM" to "6 AM / 6 PM" mid-course does not rewrite history.
   */
  async retimeOrder(params: {
    clinicId: string;
    order: MedicationOrder;
    doseTimes: string[];
    /** extend/shorten the course; omit to keep the existing end date */
    days?: number;
    userId?: string;
  }): Promise<void> {
    const { order } = params;
    if (!isScheduledFrequency(order.frequency_code)) {
      throw new Error('STAT and SOS orders have no fixed schedule to re-time');
    }
    const times = normaliseTimes(params.doseTimes);
    if (times.length === 0) throw new Error('Set at least one dose time');

    const now = new Date();
    const endAt = params.days != null
      ? new Date(now.getTime() + params.days * 24 * 60 * 60 * 1000)
      : order.end_at ? new Date(order.end_at) : null;

    const { error: updErr } = await supabase
      .from('ipd_medication_orders')
      .update({
        dose_times: times,
        end_at: endAt?.toISOString() ?? null,
        updated_at: now.toISOString(),
      })
      .eq('id', order.id);
    if (updErr) throw updErr;

    // future untouched slots only — a dose already given/held/refused stays
    const { error: delErr } = await supabase
      .from('ipd_medication_schedule')
      .delete()
      .eq('medication_order_id', order.id)
      .eq('status', 'due')
      .gt('scheduled_at', now.toISOString());
    if (delErr) throw delErr;

    const days = params.days
      ?? (endAt ? Math.ceil((endAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : 3);
    const slots = expandSchedule({
      frequencyCode: order.frequency_code,
      times,
      from: now,
      until: endAt,
      days: Math.max(days, 1),
    });
    if (slots.length > 0) {
      const { error: schedErr } = await supabase
        .from('ipd_medication_schedule')
        .upsert(
          slots.map((s) => ({
            clinic_id: params.clinicId,
            medication_order_id: order.id,
            admission_id: order.admission_id,
            scheduled_at: s.toISOString(),
          })),
          { onConflict: 'medication_order_id,scheduled_at', ignoreDuplicates: true }
        );
      if (schedErr) throw schedErr;
    }
  },

  /** Stop an order and remove its future due slots */
  async stopOrder(orderId: string, reason?: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_medication_orders')
      .update({
        status: 'stopped',
        stopped_reason: reason ?? null,
        end_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);
    if (error) throw error;

    await supabase
      .from('ipd_medication_schedule')
      .delete()
      .eq('medication_order_id', orderId)
      .eq('status', 'due')
      .gt('scheduled_at', new Date().toISOString());
  },

  /** PRN (SOS) orders get an on-demand slot at administration time */
  async createPrnSlot(params: {
    clinicId: string;
    orderId: string;
    admissionId: string;
  }): Promise<string> {
    const { data, error } = await supabase
      .from('ipd_medication_schedule')
      .insert({
        clinic_id: params.clinicId,
        medication_order_id: params.orderId,
        admission_id: params.admissionId,
        scheduled_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  },

  async listSchedule(admissionId: string): Promise<MedicationScheduleSlot[]> {
    const { data, error } = await supabase
      .from('ipd_medication_schedule')
      .select('*, medication_order:ipd_medication_orders(*)')
      .eq('admission_id', admissionId)
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    return data as unknown as MedicationScheduleSlot[];
  },

  /**
   * Record an administration (eMAR event).
   * On 'given' with a formulary medicine, stock is deducted from either the
   * MAIN pharmacy pool (default — with stock_movement_log entry) or a chosen
   * SUB-STORE (ward store — via consume_from_store), then the dispense is
   * recorded and the drug charge posted to the admission.
   */
  async administer(params: {
    clinicId: string;
    scheduleId: string;
    admissionId: string;
    order: MedicationOrder;
    status: 'given' | 'held' | 'refused';
    reason?: string;
    userId?: string;
    /** deduct from this sub-store instead of the main pharmacy pool */
    sourceStoreId?: string;
  }): Promise<void> {
    let stockMovementId: string | null = null;

    if (params.status === 'given' && params.order.medicine_id) {
      const { data: med, error: medErr } = await supabase
        .from('medicines_master')
        .select('id, current_stock, clinic_medicine_prices(selling_price)')
        .eq('id', params.order.medicine_id)
        .single();
      if (medErr) throw medErr;

      if (params.sourceStoreId) {
        // ward store path — RPC checks store stock and records consumption
        const { error: consumeErr } = await supabase.rpc('consume_from_store', {
          p_clinic_id: params.clinicId,
          p_store_id: params.sourceStoreId,
          p_medicine_id: params.order.medicine_id,
          p_quantity: 1,
          p_admission_id: params.admissionId,
          p_user_id: params.userId ?? null,
          p_remarks: `eMAR: ${params.order.medicine_name}`,
        });
        if (consumeErr) throw consumeErr;
      } else {
        // main pharmacy pool path
        const stock = (med as any).current_stock ?? 0;
        if (stock <= 0) {
          throw new Error('No main pharmacy stock — pick a ward store or record inward first.');
        }
        const newLevel = stock - 1;

        const { error: updErr } = await supabase
          .from('medicines_master')
          .update({ current_stock: newLevel })
          .eq('id', params.order.medicine_id);
        if (updErr) throw updErr;

        const { data: movement, error: movErr } = await supabase
          .from('stock_movement_log')
          .insert({
            clinic_id: params.clinicId,
            medicine_id: params.order.medicine_id,
            movement_type: 'outward',
            quantity_change: -1,
            new_stock_level: newLevel,
            reference_type: 'ipd_medication_administration',
            reference_id: params.scheduleId,
            moved_by: params.userId ?? null,
            movement_date: new Date().toISOString(),
            remarks: `IPD eMAR: ${params.order.medicine_name} (${params.order.dose ?? ''} ${params.order.route ?? ''})`,
          })
          .select('id')
          .single();
        if (movErr) throw movErr;
        stockMovementId = movement.id;
      }

      const sellingPrice = (med as any).clinic_medicine_prices?.[0]?.selling_price ?? null;
      await supabase.from('pharmacy_dispensed_items').insert({
        clinic_id: params.clinicId,
        medicine_id: params.order.medicine_id,
        admission_id: params.admissionId,
        quantity: 1,
        selling_price_at_dispense: sellingPrice,
        dispensed_by: params.userId ?? null,
      });

      // Post the drug charge so it lands in the bill (PHARM group; package
      // rules decide coverage). Skipped when no selling price is configured.
      if (sellingPrice != null && Number(sellingPrice) > 0) {
        const pharmServiceId = await getOrCreatePharmIssueService(params.clinicId);
        await chargeService.postCharge({
          clinicId: params.clinicId,
          admissionId: params.admissionId,
          serviceId: pharmServiceId,
          quantity: 1,
          unitRate: Number(sellingPrice),
          source: 'emar',
          sourceRef: params.scheduleId,
          description: `${params.order.medicine_name}${params.order.dose ? ` ${params.order.dose}` : ''}`,
          userId: params.userId,
        });
      }
    }

    const { error } = await supabase.from('ipd_medication_administrations').insert({
      clinic_id: params.clinicId,
      schedule_id: params.scheduleId,
      admission_id: params.admissionId,
      administered_by: params.userId ?? null,
      status: params.status,
      reason: params.reason ?? null,
      stock_movement_id: stockMovementId,
    });
    if (error) throw error;
    // schedule slot status is synced by the trg_emar_sync_schedule DB trigger
  },
};
