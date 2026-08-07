import { supabase } from '../utils/supabase';
import { chargeService } from './chargeService';
import type { IpdOrder, IpdOrderItem, ServiceMaster } from '../types/ipd';

/** Diagnostics + procedures a doctor orders on a round. Medications have their
    own flow (medicationService / eMAR); this is the ipd_orders spine. */

export type OrderCategory = 'pathology' | 'radiology' | 'procedure' | 'other';

/** services_master.service_type → the tab the order shows under */
export function categoryOfServiceType(type?: string | null): OrderCategory {
  switch (type) {
    case 'lab': return 'pathology';
    case 'imaging': return 'radiology';
    case 'procedure':
    case 'surgery': return 'procedure';
    default: return 'other';
  }
}

const SERVICE_TYPES_BY_CATEGORY: Record<OrderCategory, string[]> = {
  pathology: ['lab'],
  radiology: ['imaging'],
  procedure: ['procedure', 'surgery'],
  other: [],
};

export interface OrderSet {
  id: string;
  clinic_id: string;
  name: string;
  specialty: string | null;
  is_active: boolean;
  items?: Array<{
    id: string;
    service_id: string;
    default_qty: number;
    service?: ServiceMaster;
  }>;
}

export interface OrderLineInput {
  serviceId: string;
  quantity?: number;
  performingDoctorId?: string | null;
  scheduledFor?: string | null;
  /** post the charge to the running bill straight away (default true) */
  postCharge?: boolean;
}

export const orderService = {
  /** Orderable diagnostics/procedures from the charge catalog */
  async listOrderableServices(
    clinicId: string,
    category: OrderCategory | 'all',
    search?: string
  ): Promise<ServiceMaster[]> {
    const rows = await chargeService.listServices(clinicId, search);
    if (category === 'all') {
      return rows.filter((s) =>
        ['lab', 'imaging', 'procedure', 'surgery'].includes(s.service_type)
      ) as ServiceMaster[];
    }
    const types = SERVICE_TYPES_BY_CATEGORY[category];
    return rows.filter((s) => types.includes(s.service_type)) as ServiceMaster[];
  },

  /** Every order item on the chart, newest first, with its service + reports */
  async listItems(admissionId: string): Promise<IpdOrderItem[]> {
    const { data, error } = await supabase
      .from('ipd_order_items')
      .select(
        `*,
         service:services_master(id, name, service_code, service_type, base_price, external_system),
         parent_order:ipd_orders(id, order_datetime, priority, clinical_notes, status, ordered_by, treatment_plan_id),
         reports:ipd_reports(id, title, report_type, report_date, file_url, file_name, impression, is_abnormal, status)`
      )
      .eq('admission_id', admissionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as unknown as IpdOrderItem[];
  },

  async listOrders(admissionId: string): Promise<IpdOrder[]> {
    const { data, error } = await supabase
      .from('ipd_orders')
      .select('*')
      .eq('admission_id', admissionId)
      .order('order_datetime', { ascending: false });
    if (error) throw error;
    return data as IpdOrder[];
  },

  /**
   * Place an order (one header, N items). Each line optionally posts its charge
   * to the running bill immediately — the usual hospital practice for
   * investigations, so the bill never lags behind what was ordered.
   */
  async placeOrder(params: {
    clinicId: string;
    admissionId: string;
    orderedBy: string;
    lines: OrderLineInput[];
    priority?: 'routine' | 'urgent' | 'stat';
    clinicalNotes?: string;
    treatmentPlanId?: string | null;
    tariffPlanId?: string | null;
    bedTypeId?: string | null;
  }): Promise<IpdOrder> {
    if (params.lines.length === 0) throw new Error('Add at least one test / procedure');

    const { data: order, error } = await supabase
      .from('ipd_orders')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        ordered_by: params.orderedBy,
        priority: params.priority ?? 'routine',
        clinical_notes: params.clinicalNotes ?? null,
        treatment_plan_id: params.treatmentPlanId ?? null,
      })
      .select()
      .single();
    if (error) throw error;

    const { data: items, error: itemErr } = await supabase
      .from('ipd_order_items')
      .insert(
        params.lines.map((l) => ({
          clinic_id: params.clinicId,
          order_id: order.id,
          admission_id: params.admissionId,
          service_id: l.serviceId,
          quantity: l.quantity ?? 1,
          performing_doctor_id: l.performingDoctorId ?? null,
          scheduled_for: l.scheduledFor ?? null,
        }))
      )
      .select();
    if (itemErr) throw itemErr;

    // charges — best effort per line so one rate failure can't lose the order
    for (const item of items as IpdOrderItem[]) {
      const line = params.lines.find((l) => l.serviceId === item.service_id);
      if (line && line.postCharge === false) continue;
      try {
        const rate = await chargeService.resolveRate(
          item.service_id,
          params.tariffPlanId ?? null,
          params.bedTypeId ?? null
        );
        const posting = await chargeService.postCharge({
          clinicId: params.clinicId,
          admissionId: params.admissionId,
          serviceId: item.service_id,
          quantity: item.quantity,
          unitRate: rate,
          source: 'order',
          sourceRef: item.id,
          orderingDoctorId: params.orderedBy,
          performingDoctorId: item.performing_doctor_id ?? undefined,
          userId: params.orderedBy,
        });
        await supabase
          .from('ipd_order_items')
          .update({ charge_posting_id: posting.id })
          .eq('id', item.id);
      } catch (e) {
        console.error('[IPD] order charge posting failed', item.service_id, e);
      }
    }

    await this.logEvent(params.clinicId, (items as IpdOrderItem[]).map((i) => i.id), 'placed', params.orderedBy);
    return order as IpdOrder;
  },

  async setItemStatus(params: {
    clinicId: string;
    itemId: string;
    status: IpdOrderItem['status'];
    userId?: string;
    reason?: string;
  }): Promise<void> {
    const { error } = await supabase
      .from('ipd_order_items')
      .update({
        status: params.status,
        cancelled_reason: params.status === 'cancelled' ? params.reason ?? null : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.itemId);
    if (error) throw error;
    await this.logEvent(params.clinicId, [params.itemId], params.status, params.userId);
  },

  /** Cancelling an order also cancels its unbilled charge */
  async cancelItem(params: {
    clinicId: string;
    item: IpdOrderItem;
    reason: string;
    userId?: string;
  }): Promise<void> {
    await this.setItemStatus({
      clinicId: params.clinicId,
      itemId: params.item.id,
      status: 'cancelled',
      userId: params.userId,
      reason: params.reason,
    });
    if (params.item.charge_posting_id) {
      try {
        await chargeService.cancelPosting(params.item.charge_posting_id, params.reason);
      } catch (e) {
        console.error('[IPD] charge cancel failed for cancelled order', e);
      }
    }
  },

  // --- order sets (quick-pick bundles, e.g. "Post-op day 1") ------------------

  async listOrderSets(clinicId: string): Promise<OrderSet[]> {
    const { data, error } = await supabase
      .from('order_sets')
      .select('*, items:order_set_items(id, service_id, default_qty, service:services_master(id, name, service_code, service_type, base_price))')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return data as unknown as OrderSet[];
  },

  async createOrderSet(params: {
    clinicId: string;
    name: string;
    specialty?: string | null;
    lines: Array<{ serviceId: string; quantity: number }>;
    userId?: string;
  }): Promise<void> {
    if (params.lines.length === 0) throw new Error('Add lines before saving a set');
    const { data: set, error } = await supabase
      .from('order_sets')
      .insert({
        clinic_id: params.clinicId,
        name: params.name.trim(),
        specialty: params.specialty ?? null,
        created_by: params.userId ?? null,
      })
      .select('id')
      .single();
    if (error) {
      throw new Error(
        error.code === '23505' ? `An order set named "${params.name.trim()}" already exists` : error.message
      );
    }

    const { error: itemErr } = await supabase.from('order_set_items').insert(
      params.lines.map((l) => ({
        clinic_id: params.clinicId,
        order_set_id: set.id,
        service_id: l.serviceId,
        default_qty: l.quantity,
      }))
    );
    if (itemErr) throw itemErr;
  },

  async deleteOrderSet(setId: string): Promise<void> {
    const { error } = await supabase.from('order_sets').delete().eq('id', setId);
    if (error) throw error;
  },

  async logEvent(
    clinicId: string,
    itemIds: string[],
    event: string,
    actorId?: string,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    if (itemIds.length === 0) return;
    const { error } = await supabase.from('ipd_order_events').insert(
      itemIds.map((id) => ({
        clinic_id: clinicId,
        order_item_id: id,
        event,
        actor_id: actorId ?? null,
        details,
      }))
    );
    if (error) console.error('[IPD] order event log failed', error);
  },
};
