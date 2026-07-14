import { supabase } from '../utils/supabase';
import { chargeService } from './chargeService';
import { medicationService } from './medicationService';

export interface Store {
  id: string;
  clinic_id: string;
  code: string;
  name: string;
  ward_id: string | null;
  is_active: boolean;
}

export interface StoreStockRow {
  id: string;
  store_id: string;
  medicine_id: string;
  quantity: number;
  medicine?: { name: string; strength: string | null; current_stock: number } | null;
}

export interface StoreTransfer {
  id: string;
  from_store_id: string | null;
  to_store_id: string | null;
  medicine_id: string;
  quantity: number;
  remarks: string | null;
  created_at: string;
  medicine?: { name: string } | null;
  from_store?: { name: string } | null;
  to_store?: { name: string } | null;
}

export const storeService = {
  async listStores(clinicId: string): Promise<Store[]> {
    const { data, error } = await supabase
      .from('ipd_stores')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return data as Store[];
  },

  async createStore(params: { clinicId: string; code: string; name: string; wardId?: string }): Promise<Store> {
    const { data, error } = await supabase
      .from('ipd_stores')
      .insert({
        clinic_id: params.clinicId,
        code: params.code.trim().toUpperCase(),
        name: params.name.trim(),
        ward_id: params.wardId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as Store;
  },

  async listStock(storeId: string): Promise<StoreStockRow[]> {
    const { data, error } = await supabase
      .from('store_stock')
      .select('*, medicine:medicines_master(name, strength, current_stock)')
      .eq('store_id', storeId)
      .gt('quantity', 0)
      .order('quantity', { ascending: false });
    if (error) throw error;
    return data as unknown as StoreStockRow[];
  },

  async listTransfers(clinicId: string, limit = 30): Promise<StoreTransfer[]> {
    const { data, error } = await supabase
      .from('store_transfers')
      .select(
        `*, medicine:medicines_master(name),
         from_store:ipd_stores!store_transfers_from_store_id_fkey(name),
         to_store:ipd_stores!store_transfers_to_store_id_fkey(name)`
      )
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as unknown as StoreTransfer[];
  },

  /** Main pharmacy pool → sub-store */
  async transferFromMain(params: {
    clinicId: string; storeId: string; medicineId: string;
    quantity: number; userId?: string; remarks?: string;
  }): Promise<void> {
    const { error } = await supabase.rpc('transfer_from_main', {
      p_clinic_id: params.clinicId,
      p_store_id: params.storeId,
      p_medicine_id: params.medicineId,
      p_quantity: params.quantity,
      p_user_id: params.userId ?? null,
      p_remarks: params.remarks ?? null,
    });
    if (error) throw error;
  },

  /** Sub-store → sub-store */
  async transferBetweenStores(params: {
    clinicId: string; fromStoreId: string; toStoreId: string; medicineId: string;
    quantity: number; userId?: string; remarks?: string;
  }): Promise<void> {
    const { error } = await supabase.rpc('transfer_between_stores', {
      p_clinic_id: params.clinicId,
      p_from_store: params.fromStoreId,
      p_to_store: params.toStoreId,
      p_medicine_id: params.medicineId,
      p_quantity: params.quantity,
      p_user_id: params.userId ?? null,
      p_remarks: params.remarks ?? null,
    });
    if (error) throw error;
  },

  /** Match a parsed medicine name against the shared pharmacy master */
  async findMedicineByName(clinicId: string, name: string): Promise<{ id: string; name: string } | null> {
    const { data } = await supabase
      .from('medicines_master')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .ilike('name', `%${name.trim()}%`)
      .limit(1)
      .maybeSingle();
    return (data as { id: string; name: string } | null) ?? null;
  },

  /** Create a medicine that appeared on an invoice but isn't in the master yet.
      No selling price is set — configure it in the OPD pharmacy before charging. */
  async createMedicine(clinicId: string, name: string, strength?: string): Promise<string> {
    const { data, error } = await supabase
      .from('medicines_master')
      .insert({ clinic_id: clinicId, name: name.trim(), strength: strength ?? null, current_stock: 0, is_active: true })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  },

  /**
   * Direct supplier receipt into a sub-store (invoice upload path).
   * Credits store stock WITHOUT touching the main pharmacy pool, and logs
   * an inbound transfer row for the audit trail.
   */
  async receiveIntoStore(params: {
    clinicId: string;
    storeId: string;
    rows: Array<{ medicineId: string; quantity: number }>;
    remarks?: string;
    userId?: string;
  }): Promise<void> {
    for (const row of params.rows) {
      const { data: existing } = await supabase
        .from('store_stock')
        .select('id, quantity')
        .eq('store_id', params.storeId)
        .eq('medicine_id', row.medicineId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('store_stock')
          .update({ quantity: existing.quantity + row.quantity, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('store_stock').insert({
          clinic_id: params.clinicId,
          store_id: params.storeId,
          medicine_id: row.medicineId,
          quantity: row.quantity,
        });
        if (error) throw error;
      }

      const { error: trErr } = await supabase.from('store_transfers').insert({
        clinic_id: params.clinicId,
        from_store_id: null,
        to_store_id: params.storeId,
        medicine_id: row.medicineId,
        quantity: row.quantity,
        moved_by: params.userId ?? null,
        remarks: params.remarks ?? 'Supplier receipt (upload)',
      });
      if (trErr) throw trErr;
    }
  },

  /**
   * Consume from a store. When an admission is given, also:
   * writes pharmacy_dispensed_items (admission-linked) and posts the
   * patient charge at the clinic's selling price (package rules apply).
   */
  async consume(params: {
    clinicId: string;
    storeId: string;
    medicineId: string;
    medicineName: string;
    quantity: number;
    admissionId?: string;
    userId?: string;
    remarks?: string;
  }): Promise<void> {
    const { data: consumptionId, error } = await supabase.rpc('consume_from_store', {
      p_clinic_id: params.clinicId,
      p_store_id: params.storeId,
      p_medicine_id: params.medicineId,
      p_quantity: params.quantity,
      p_admission_id: params.admissionId ?? null,
      p_user_id: params.userId ?? null,
      p_remarks: params.remarks ?? null,
    });
    if (error) throw error;

    if (params.admissionId) {
      // selling price from clinic price list
      const { data: priceRow } = await supabase
        .from('clinic_medicine_prices')
        .select('selling_price')
        .eq('clinic_id', params.clinicId)
        .eq('medicine_id', params.medicineId)
        .maybeSingle();
      const sellingPrice = priceRow?.selling_price as number | undefined;

      await supabase.from('pharmacy_dispensed_items').insert({
        clinic_id: params.clinicId,
        medicine_id: params.medicineId,
        admission_id: params.admissionId,
        quantity: params.quantity,
        selling_price_at_dispense: sellingPrice ?? null,
        dispensed_by: params.userId ?? null,
      });

      if (sellingPrice && sellingPrice > 0) {
        const pharmServiceId = await medicationService.getPharmIssueServiceId(params.clinicId);
        const posting = await chargeService.postCharge({
          clinicId: params.clinicId,
          admissionId: params.admissionId,
          serviceId: pharmServiceId,
          quantity: params.quantity,
          unitRate: sellingPrice,
          source: 'pharmacy',
          sourceRef: consumptionId as string,
          description: params.medicineName,
          userId: params.userId,
        });
        await supabase
          .from('store_consumptions')
          .update({ charge_posting_id: posting.id })
          .eq('id', consumptionId as string);
      }
    }
  },
};
