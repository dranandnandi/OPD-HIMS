import { supabase } from '../lib/supabase';
import { getCurrentProfile } from './profileService';

/**
 * Pharmacy MIS. Thin wrappers over the pharmacy_* SQL report functions
 * (migration 20261016100000). Dates are sent as IST calendar dates.
 */

const toDateOnly = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const num = (v: unknown): number => Number(v) || 0;

async function clinicId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');
  return profile.clinicId;
}

async function call<T = any>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  if (!supabase) throw new Error('Supabase client not initialized');
  const { data, error } = await supabase.rpc(fn, { p_clinic_id: await clinicId(), ...args });
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return (data || []) as T[];
}

const period = (from: Date, to: Date) => ({ p_from: toDateOnly(from), p_to: toDateOnly(to) });

export interface SalesByMedicineRow {
  medicineId?: string; medicineName: string; category: string; hsnCode?: string;
  quantity: number; invoiceCount: number;
  taxableAmount: number; taxAmount: number; salesAmount: number; costAmount: number; marginAmount: number;
}
export interface DailySalesRow {
  day: Date; invoiceCount: number; billedAmount: number; taxableAmount: number; taxAmount: number;
  collectedAmount: number; byMethod: Record<string, number>;
}
export interface PurchasesBySupplierRow {
  supplierId?: string; supplierName: string; supplierGstin?: string;
  invoiceCount: number; debitNoteCount: number; taxableAmount: number; taxAmount: number; totalAmount: number;
}
export interface StockValuationRow {
  medicineId: string; medicineName: string; category: string; rackLocation?: string;
  batchQuantity: number; pooledQuantity: number; totalQuantity: number;
  costValue: number; mrpValue: number; earliestExpiry?: Date;
}
export interface DeadStockRow {
  medicineId: string; medicineName: string; category: string; rackLocation?: string;
  currentStock: number; costValue: number; lastSoldAt?: Date; daysIdle: number;
}
export interface ExpiredStockRow {
  batchId: string; medicineId: string; medicineName: string; rackLocation?: string;
  batchNumber: string; expiryDate: Date; quantity: number;
  purchaseRate?: number; mrp?: number; costValue: number; supplierName?: string;
}
export interface SalesByUserRow {
  userId?: string; userName: string; invoiceCount: number; lineCount: number; quantity: number;
  taxableAmount: number; taxAmount: number; salesAmount: number;
}

export const pharmacyMisService = {
  async salesByMedicine(from: Date, to: Date): Promise<SalesByMedicineRow[]> {
    const rows = await call('pharmacy_sales_by_medicine', period(from, to));
    return rows.map(r => ({
      medicineId: r.medicine_id ?? undefined, medicineName: r.medicine_name, category: r.category, hsnCode: r.hsn_code ?? undefined,
      quantity: num(r.quantity), invoiceCount: num(r.invoice_count),
      taxableAmount: num(r.taxable_amount), taxAmount: num(r.tax_amount), salesAmount: num(r.sales_amount),
      costAmount: num(r.cost_amount), marginAmount: num(r.margin_amount)
    }));
  },

  async dailySales(from: Date, to: Date): Promise<DailySalesRow[]> {
    const rows = await call('pharmacy_daily_sales', period(from, to));
    return rows.map(r => ({
      day: new Date(r.day), invoiceCount: num(r.invoice_count), billedAmount: num(r.billed_amount),
      taxableAmount: num(r.taxable_amount), taxAmount: num(r.tax_amount), collectedAmount: num(r.collected_amount),
      byMethod: Object.fromEntries(Object.entries(r.by_method || {}).map(([k, v]) => [k, num(v)]))
    }));
  },

  async purchasesBySupplier(from: Date, to: Date): Promise<PurchasesBySupplierRow[]> {
    const rows = await call('pharmacy_purchases_by_supplier', period(from, to));
    return rows.map(r => ({
      supplierId: r.supplier_id ?? undefined, supplierName: r.supplier_name, supplierGstin: r.supplier_gstin ?? undefined,
      invoiceCount: num(r.invoice_count), debitNoteCount: num(r.debit_note_count),
      taxableAmount: num(r.taxable_amount), taxAmount: num(r.tax_amount), totalAmount: num(r.total_amount)
    }));
  },

  async stockValuation(): Promise<StockValuationRow[]> {
    const rows = await call('pharmacy_stock_valuation', {});
    return rows.map(r => ({
      medicineId: r.medicine_id, medicineName: r.medicine_name, category: r.category, rackLocation: r.rack_location ?? undefined,
      batchQuantity: num(r.batch_quantity), pooledQuantity: num(r.pooled_quantity), totalQuantity: num(r.total_quantity),
      costValue: num(r.cost_value), mrpValue: num(r.mrp_value),
      earliestExpiry: r.earliest_expiry ? new Date(r.earliest_expiry) : undefined
    }));
  },

  async deadStock(days = 90): Promise<DeadStockRow[]> {
    const rows = await call('pharmacy_dead_stock', { p_days: days });
    return rows.map(r => ({
      medicineId: r.medicine_id, medicineName: r.medicine_name, category: r.category, rackLocation: r.rack_location ?? undefined,
      currentStock: num(r.current_stock), costValue: num(r.cost_value),
      lastSoldAt: r.last_sold_at ? new Date(r.last_sold_at) : undefined, daysIdle: num(r.days_idle)
    }));
  },

  async expiredStock(): Promise<ExpiredStockRow[]> {
    const rows = await call('pharmacy_expired_stock', {});
    return rows.map(r => ({
      batchId: r.batch_id, medicineId: r.medicine_id, medicineName: r.medicine_name, rackLocation: r.rack_location ?? undefined,
      batchNumber: r.batch_number, expiryDate: new Date(r.expiry_date), quantity: num(r.quantity),
      purchaseRate: r.purchase_rate != null ? num(r.purchase_rate) : undefined, mrp: r.mrp != null ? num(r.mrp) : undefined,
      costValue: num(r.cost_value), supplierName: r.supplier_name ?? undefined
    }));
  },

  /** Zero an expired/damaged batch and log the adjustment. Returns units written off. */
  async writeOffBatch(batchId: string, reason: string): Promise<number> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await supabase.rpc('write_off_batch', { p_batch_id: batchId, p_reason: reason });
    if (error) throw new Error(`Write-off failed: ${error.message}`);
    return num(data);
  },

  async salesByUser(from: Date, to: Date): Promise<SalesByUserRow[]> {
    const rows = await call('pharmacy_sales_by_user', period(from, to));
    return rows.map(r => ({
      userId: r.user_id ?? undefined, userName: r.user_name, invoiceCount: num(r.invoice_count), lineCount: num(r.line_count),
      quantity: num(r.quantity), taxableAmount: num(r.taxable_amount), taxAmount: num(r.tax_amount), salesAmount: num(r.sales_amount)
    }));
  }
};
