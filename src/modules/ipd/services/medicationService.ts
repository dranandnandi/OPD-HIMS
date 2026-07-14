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

// Dose times per frequency code (hospital defaults; editable later per clinic)
const FREQUENCY_TIMES: Record<string, string[]> = {
  od: ['09:00'],
  bd: ['09:00', '21:00'],
  tid: ['09:00', '14:00', '21:00'],
  qid: ['06:00', '12:00', '18:00', '22:00'],
  q6h: ['00:00', '06:00', '12:00', '18:00'],
  q8h: ['06:00', '14:00', '22:00'],
  q12h: ['09:00', '21:00'],
  hs: ['21:00'],
  stat: [], // one immediate slot
  sos: [],  // PRN — no schedule; given ad hoc
};

export const FREQUENCY_OPTIONS = [
  { code: 'od', label: 'OD — once daily' },
  { code: 'bd', label: 'BD — twice daily' },
  { code: 'tid', label: 'TID — three times daily' },
  { code: 'qid', label: 'QID — four times daily' },
  { code: 'q6h', label: 'Q6H — every 6 hours' },
  { code: 'q8h', label: 'Q8H — every 8 hours' },
  { code: 'q12h', label: 'Q12H — every 12 hours' },
  { code: 'hs', label: 'HS — at bedtime' },
  { code: 'stat', label: 'STAT — immediately, once' },
  { code: 'sos', label: 'SOS — as needed (PRN)' },
];

export const ROUTE_OPTIONS = ['oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'per_rectal', 'sublingual'];

function expandSchedule(frequencyCode: string, startAt: Date, days: number): Date[] {
  if (frequencyCode === 'stat') return [new Date()];
  if (frequencyCode === 'sos') return [];
  const times = FREQUENCY_TIMES[frequencyCode] ?? FREQUENCY_TIMES.od;
  const slots: Date[] = [];
  for (let d = 0; d < days; d++) {
    for (const t of times) {
      const [h, m] = t.split(':').map(Number);
      const slot = new Date(startAt);
      slot.setDate(slot.getDate() + d);
      slot.setHours(h, m, 0, 0);
      if (slot >= startAt) slots.push(slot);
    }
  }
  return slots;
}

export const medicationService = {
  /** Shared with storeService: service that carries drug charges into bills */
  getPharmIssueServiceId(clinicId: string): Promise<string> {
    return getOrCreatePharmIssueService(clinicId);
  },

  /** Search the shared OPD pharmacy master, with clinic selling price + stock */
  async searchMedicines(clinicId: string, term: string): Promise<MedicineOption[]> {
    if (term.trim().length < 2) return [];
    const { data, error } = await supabase
      .from('medicines_master')
      .select('id, name, strength, dosage_form, current_stock, clinic_medicine_prices(selling_price)')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .ilike('name', `%${term}%`)
      .order('name')
      .limit(15);
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

  /** Create the order and expand its dose schedule */
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
    userId?: string;
  }): Promise<MedicationOrder> {
    const startAt = new Date();
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
        start_at: startAt.toISOString(),
        end_at: endAt?.toISOString() ?? null,
        instructions: params.instructions ?? null,
        ordered_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;

    const slots = expandSchedule(params.frequencyCode, startAt, params.days);
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
