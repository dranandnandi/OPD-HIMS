import { supabase } from '../lib/supabase';
import {
  Supplier,
  PharmacyInwardReceipt,
  PharmacyInwardItem,
  PharmacyDispensedItem,
  StockMovementLog,
  MedicineMaster,
  MedicineWithPrice,
  StockAlert,
  MedicineBatch,
  PharmacyDebitNote,
  PharmacyDebitNoteItem,
  Bill
} from '../types';
import { getCurrentProfile } from './profileService';
import { supabaseUrl } from '../lib/supabaseClient';
import type {
  DatabaseSupplier,
  DatabasePharmacyInwardReceipt,
  DatabasePharmacyInwardItem,
  DatabasePharmacyDispensedItem,
  DatabaseStockMovementLog,
  DatabaseMedicineBatch,
  DatabasePharmacyDebitNote,
  DatabasePharmacyDebitNoteItem
} from '../lib/supabase';
import { billingService, PharmacyBillInput } from './billingService';

const num = (v: unknown): number => Number(v) || 0;
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));

// Convert database supplier to app supplier type
const convertDatabaseSupplier = (dbSupplier: DatabaseSupplier): Supplier => ({
  id: dbSupplier.id,
  name: dbSupplier.name,
  contactPerson: dbSupplier.contact_person,
  phone: dbSupplier.phone,
  email: dbSupplier.email,
  address: dbSupplier.address,
  gstin: dbSupplier.gstin ?? undefined,
  stateCode: dbSupplier.state_code ?? undefined,
  drugLicenseNumber: dbSupplier.drug_license_number ?? undefined,
  isActive: dbSupplier.is_active,
  createdAt: new Date(dbSupplier.created_at),
  updatedAt: new Date(dbSupplier.updated_at)
});

// Convert database inward receipt to app inward receipt type
const convertDatabaseInwardReceipt = (
  dbReceipt: DatabasePharmacyInwardReceipt,
  supplier?: Supplier,
  inwardItems?: PharmacyInwardItem[]
): PharmacyInwardReceipt => ({
  id: dbReceipt.id,
  supplierId: dbReceipt.supplier_id,
  invoiceNumber: dbReceipt.invoice_number,
  receiptDate: new Date(dbReceipt.receipt_date),
  supplierInvoiceDate: dbReceipt.supplier_invoice_date ? new Date(dbReceipt.supplier_invoice_date) : undefined,
  totalAmount: num(dbReceipt.total_amount),
  uploadedBy: dbReceipt.uploaded_by,
  invoiceFileUrl: dbReceipt.invoice_file_url,
  status: dbReceipt.status,
  remarks: dbReceipt.remarks,
  isInterstate: dbReceipt.is_interstate ?? false,
  taxableAmount: num(dbReceipt.taxable_amount),
  discountAmount: num(dbReceipt.discount_amount),
  cgstAmount: num(dbReceipt.cgst_amount),
  sgstAmount: num(dbReceipt.sgst_amount),
  igstAmount: num(dbReceipt.igst_amount),
  roundOff: num(dbReceipt.round_off),
  grandTotal: num(dbReceipt.grand_total) || num(dbReceipt.total_amount),
  createdAt: new Date(dbReceipt.created_at),
  updatedAt: new Date(dbReceipt.updated_at),
  supplier,
  inwardItems
});

// Convert database inward item to app inward item type
const convertDatabaseInwardItem = (dbItem: DatabasePharmacyInwardItem, medicine?: MedicineMaster): PharmacyInwardItem => ({
  id: dbItem.id,
  receiptId: dbItem.receipt_id,
  medicineId: dbItem.medicine_id,
  quantity: dbItem.quantity,
  unitCostPrice: num(dbItem.unit_cost_price),
  totalCostPrice: num(dbItem.total_cost_price),
  batchNumber: dbItem.batch_number,
  expiryDate: dbItem.expiry_date ? new Date(dbItem.expiry_date) : undefined,
  batchId: dbItem.batch_id ?? undefined,
  hsnCode: dbItem.hsn_code ?? undefined,
  gstRate: optNum(dbItem.gst_rate),
  mrp: optNum(dbItem.mrp),
  discountPercent: optNum(dbItem.discount_percent),
  discountAmount: optNum(dbItem.discount_amount),
  freeQuantity: optNum(dbItem.free_quantity),
  taxableAmount: optNum(dbItem.taxable_amount),
  cgstAmount: optNum(dbItem.cgst_amount),
  sgstAmount: optNum(dbItem.sgst_amount),
  igstAmount: optNum(dbItem.igst_amount),
  lineTotal: optNum(dbItem.line_total),
  createdAt: new Date(dbItem.created_at),
  medicine
});

// Convert database dispensed item to app dispensed item type
const convertDatabaseDispensedItem = (dbItem: DatabasePharmacyDispensedItem, medicine?: MedicineMaster): PharmacyDispensedItem => ({
  id: dbItem.id,
  visitId: dbItem.visit_id,
  prescriptionId: dbItem.prescription_id,
  medicineId: dbItem.medicine_id,
  quantity: dbItem.quantity,
  dispensedBy: dbItem.dispensed_by,
  dispenseDate: new Date(dbItem.dispense_date),
  sellingPriceAtDispense: optNum(dbItem.selling_price_at_dispense),
  totalSellingPrice: optNum(dbItem.total_selling_price),
  batchNumber: dbItem.batch_number,
  batchId: dbItem.batch_id ?? undefined,
  billId: dbItem.bill_id ?? undefined,
  hsnCode: dbItem.hsn_code ?? undefined,
  gstRate: optNum(dbItem.gst_rate),
  mrp: optNum(dbItem.mrp),
  discountAmount: optNum(dbItem.discount_amount),
  taxableAmount: optNum(dbItem.taxable_amount),
  cgstAmount: optNum(dbItem.cgst_amount),
  sgstAmount: optNum(dbItem.sgst_amount),
  igstAmount: optNum(dbItem.igst_amount),
  refundedQuantity: dbItem.refunded_quantity,
  refundRequestId: dbItem.refund_request_id ?? undefined,
  createdAt: new Date(dbItem.created_at),
  medicine
});

const convertDatabaseBatch = (b: DatabaseMedicineBatch, medicine?: MedicineMaster): MedicineBatch => ({
  id: b.id,
  clinicId: b.clinic_id,
  medicineId: b.medicine_id,
  batchNumber: b.batch_number,
  expiryDate: b.expiry_date ? new Date(b.expiry_date) : undefined,
  mrp: optNum(b.mrp),
  purchaseRate: optNum(b.purchase_rate),
  quantity: b.quantity,
  supplierId: b.supplier_id ?? undefined,
  createdAt: new Date(b.created_at),
  updatedAt: new Date(b.updated_at),
  medicine
});

const convertDatabaseDebitNoteItem = (i: DatabasePharmacyDebitNoteItem, medicine?: MedicineMaster): PharmacyDebitNoteItem => ({
  id: i.id,
  debitNoteId: i.debit_note_id,
  medicineId: i.medicine_id,
  batchId: i.batch_id ?? undefined,
  batchNumber: i.batch_number ?? undefined,
  quantity: i.quantity,
  unitRate: num(i.unit_rate),
  hsnCode: i.hsn_code ?? undefined,
  gstRate: num(i.gst_rate),
  taxableAmount: num(i.taxable_amount),
  cgstAmount: num(i.cgst_amount),
  sgstAmount: num(i.sgst_amount),
  igstAmount: num(i.igst_amount),
  lineTotal: num(i.line_total),
  medicine
});

const convertDatabaseDebitNote = (d: DatabasePharmacyDebitNote, supplier?: Supplier, items?: PharmacyDebitNoteItem[]): PharmacyDebitNote => ({
  id: d.id,
  clinicId: d.clinic_id,
  supplierId: d.supplier_id,
  debitNoteNumber: d.debit_note_number,
  noteDate: new Date(d.note_date),
  againstReceiptId: d.against_receipt_id ?? undefined,
  reason: d.reason ?? undefined,
  isInterstate: d.is_interstate,
  taxableAmount: num(d.taxable_amount),
  cgstAmount: num(d.cgst_amount),
  sgstAmount: num(d.sgst_amount),
  igstAmount: num(d.igst_amount),
  roundOff: num(d.round_off),
  grandTotal: num(d.grand_total),
  createdBy: d.created_by ?? undefined,
  createdAt: new Date(d.created_at),
  supplier,
  items
});

// Convert database stock movement log to app stock movement log type
const convertDatabaseStockMovementLog = (dbLog: DatabaseStockMovementLog, medicine?: MedicineMaster): StockMovementLog => ({
  id: dbLog.id,
  medicineId: dbLog.medicine_id,
  movementType: dbLog.movement_type,
  quantityChange: dbLog.quantity_change,
  newStockLevel: dbLog.new_stock_level,
  referenceId: dbLog.reference_id,
  referenceType: dbLog.reference_type,
  movedBy: dbLog.moved_by,
  movementDate: new Date(dbLog.movement_date),
  remarks: dbLog.remarks,
  createdAt: new Date(dbLog.created_at),
  medicine
});

// Convert database stock alert to app stock alert type
const convertDatabaseStockAlert = (dbAlert: any, medicine?: MedicineMaster): StockAlert => ({
  id: dbAlert.id,
  medicineId: dbAlert.medicine_id,
  alertType: dbAlert.alert_type,
  message: dbAlert.message,
  createdAt: new Date(dbAlert.created_at),
  isResolved: dbAlert.is_resolved,
  resolvedAt: dbAlert.resolved_at ? new Date(dbAlert.resolved_at) : undefined,
  resolvedBy: dbAlert.resolved_by,
  medicine
});

// Shared medicine row -> MedicineWithPrice (the four list queries below all
// select medicines_master with the clinic price joined in).
const convertMedicineRowWithPrice = (medicine: any): MedicineWithPrice => {
  const priceData = medicine.clinic_medicine_prices?.[0];
  return {
    id: medicine.id,
    name: medicine.name,
    genericName: medicine.generic_name,
    brandName: medicine.brand_name,
    category: medicine.category,
    dosageForm: medicine.dosage_form,
    strength: medicine.strength,
    manufacturer: medicine.manufacturer,
    description: medicine.description,
    sideEffects: medicine.side_effects,
    contraindications: medicine.contraindications,
    currentStock: medicine.current_stock,
    reorderLevel: medicine.reorder_level,
    batchNumber: medicine.batch_number,
    expiryDate: medicine.expiry_date ? new Date(medicine.expiry_date) : undefined,
    rackLocation: medicine.rack_location ?? undefined,
    barcode: medicine.barcode ?? undefined,
    isChronic: medicine.is_chronic ?? false,
    hsnCode: medicine.hsn_code ?? undefined,
    gstRate: medicine.gst_rate ?? 12,
    isActive: medicine.is_active,
    createdAt: new Date(medicine.created_at),
    updatedAt: new Date(medicine.updated_at),
    sellingPrice: priceData?.selling_price,
    costPrice: priceData?.cost_price
  };
};

export type InwardReceiptInput = Omit<PharmacyInwardReceipt, 'id' | 'createdAt' | 'updatedAt' | 'supplier' | 'inwardItems'>;
export type InwardItemInput = Omit<PharmacyInwardItem, 'id' | 'receiptId' | 'createdAt' | 'medicine' | 'totalCostPrice'>;
export type DispenseItemInput = Omit<PharmacyDispensedItem, 'id' | 'createdAt' | 'medicine' | 'dispensedByProfile' | 'totalSellingPrice'>;

export interface DebitNoteItemInput {
  medicineId: string;
  batchId?: string;
  batchNumber?: string;
  quantity: number;
  unitRate: number;
  hsnCode?: string;
  gstRate: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineTotal: number;
}

export interface DebitNoteInput {
  supplierId: string;
  againstReceiptId?: string;
  reason?: string;
  isInterstate: boolean;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  roundOff: number;
  grandTotal: number;
  items: DebitNoteItemInput[];
}

export const pharmacyService = {
  // Supplier Management
  async getSuppliers(): Promise<Supplier[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('clinic_id', profile.clinicId)
      .eq('is_active', true)
      .order('name');

    if (error) {
      throw new Error('Failed to fetch suppliers');
    }

    return data.map(convertDatabaseSupplier);
  },

  async addSupplier(supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Promise<Supplier> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('suppliers')
      .insert([{
        name: supplier.name,
        clinic_id: profile.clinicId,
        contact_person: supplier.contactPerson,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        gstin: supplier.gstin?.trim().toUpperCase() || null,
        state_code: supplier.stateCode || null,
        drug_license_number: supplier.drugLicenseNumber?.trim() || null,
        is_active: supplier.isActive
      }])
      .select()
      .single();

    if (error) {
      throw new Error(error.message || 'Failed to add supplier');
    }

    return convertDatabaseSupplier(data);
  },

  async updateSupplier(id: string, supplier: Partial<Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Supplier> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const updateData: any = {};
    if (supplier.name !== undefined) updateData.name = supplier.name;
    if (supplier.contactPerson !== undefined) updateData.contact_person = supplier.contactPerson;
    if (supplier.phone !== undefined) updateData.phone = supplier.phone;
    if (supplier.email !== undefined) updateData.email = supplier.email;
    if (supplier.address !== undefined) updateData.address = supplier.address;
    if (supplier.gstin !== undefined) updateData.gstin = supplier.gstin?.trim().toUpperCase() || null;
    if (supplier.stateCode !== undefined) updateData.state_code = supplier.stateCode || null;
    if (supplier.drugLicenseNumber !== undefined) updateData.drug_license_number = supplier.drugLicenseNumber?.trim() || null;
    if (supplier.isActive !== undefined) updateData.is_active = supplier.isActive;

    const { data, error } = await supabase
      .from('suppliers')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(error.message || 'Failed to update supplier');
    }

    return convertDatabaseSupplier(data);
  },

  async deleteSupplier(id: string): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const { error } = await supabase
      .from('suppliers')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error('Failed to delete supplier');
    }
  },

  // Inward Receipt Management
  async getInwardReceipts(range?: { from: Date; to: Date }): Promise<PharmacyInwardReceipt[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let query = supabase
      .from('pharmacy_inward_receipts')
      .select(`
        *,
        clinic_id,
        suppliers (*),
        pharmacy_inward_items (*, medicines_master (*))
      `)
      .eq('clinic_id', profile.clinicId)
      .order('receipt_date', { ascending: false });

    if (range) {
      query = query
        .gte('receipt_date', range.from.toISOString())
        .lte('receipt_date', range.to.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching inward receipts:', error);
      throw new Error('Failed to fetch inward receipts');
    }

    return data.map(receipt => convertDatabaseInwardReceipt(
      receipt,
      receipt.suppliers ? convertDatabaseSupplier(receipt.suppliers) : undefined,
      receipt.pharmacy_inward_items?.map(item => convertDatabaseInwardItem(item, item.medicines_master)) || []
    ));
  },

  /**
   * Save a purchase. Items carry their GST split (computed in the UI with
   * utils/gst); the header carries the invoice totals. Stock and batches are
   * maintained by DB triggers on pharmacy_inward_items.
   */
  async createInwardReceipt(
    receipt: InwardReceiptInput,
    items: InwardItemInput[]
  ): Promise<PharmacyInwardReceipt> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    // Ensure clinic_id is a valid UUID or null, not an empty string
    const clinicId = profile.clinicId && profile.clinicId.trim() !== '' ? profile.clinicId : null;
    if (!clinicId) {
      throw new Error('Invalid clinic ID. Please contact support.');
    }

    try {
      // Insert receipt
      const { data: receiptData, error: receiptError } = await supabase
        .from('pharmacy_inward_receipts')
        .insert([{
          clinic_id: clinicId,
          supplier_id: receipt.supplierId,
          invoice_number: receipt.invoiceNumber,
          receipt_date: receipt.receiptDate.toISOString(),
          supplier_invoice_date: receipt.supplierInvoiceDate
            ? receipt.supplierInvoiceDate.toISOString().slice(0, 10)
            : receipt.receiptDate.toISOString().slice(0, 10),
          total_amount: receipt.grandTotal ?? receipt.totalAmount,
          uploaded_by: receipt.uploadedBy,
          invoice_file_url: receipt.invoiceFileUrl,
          status: receipt.status,
          remarks: receipt.remarks,
          is_interstate: receipt.isInterstate ?? false,
          taxable_amount: receipt.taxableAmount ?? 0,
          discount_amount: receipt.discountAmount ?? 0,
          cgst_amount: receipt.cgstAmount ?? 0,
          sgst_amount: receipt.sgstAmount ?? 0,
          igst_amount: receipt.igstAmount ?? 0,
          round_off: receipt.roundOff ?? 0,
          grand_total: receipt.grandTotal ?? receipt.totalAmount
        }])
        .select()
        .single();

      if (receiptError) {
        throw new Error(receiptError.message || 'Failed to create inward receipt');
      }

      // Insert items
      if (items.length > 0) {
        const itemsToInsert = items.map(item => ({
          receipt_id: receiptData.id,
          clinic_id: clinicId,
          medicine_id: item.medicineId && item.medicineId.trim() !== '' ? item.medicineId : null,
          quantity: item.quantity,
          unit_cost_price: item.unitCostPrice,
          batch_number: item.batchNumber?.trim() || null,
          expiry_date: item.expiryDate ? item.expiryDate.toISOString().slice(0, 10) : null,
          hsn_code: item.hsnCode || null,
          gst_rate: item.gstRate ?? 0,
          mrp: item.mrp ?? null,
          discount_percent: item.discountPercent ?? 0,
          discount_amount: item.discountAmount ?? 0,
          free_quantity: item.freeQuantity ?? 0,
          taxable_amount: item.taxableAmount ?? item.quantity * item.unitCostPrice,
          cgst_amount: item.cgstAmount ?? 0,
          sgst_amount: item.sgstAmount ?? 0,
          igst_amount: item.igstAmount ?? 0,
          line_total: item.lineTotal ?? item.quantity * item.unitCostPrice
        }));

        const { error: itemsError } = await supabase
          .from('pharmacy_inward_items')
          .insert(itemsToInsert);

        if (itemsError) {
          await supabase.from('pharmacy_inward_receipts').delete().eq('id', receiptData.id);
          throw new Error(itemsError.message || 'Failed to create inward items');
        }
      }

      // Fetch the complete receipt with items
      const { data: completeReceipt, error: fetchError } = await supabase
        .from('pharmacy_inward_receipts')
        .select(`
          clinic_id,
          *,
          suppliers (*),
          pharmacy_inward_items (*, medicines_master (*))
        `)
        .eq('id', receiptData.id)
        .single();

      if (fetchError) {
        throw new Error('Failed to fetch created receipt');
      }

      return convertDatabaseInwardReceipt(
        completeReceipt,
        completeReceipt.suppliers ? convertDatabaseSupplier(completeReceipt.suppliers) : undefined,
        completeReceipt.pharmacy_inward_items?.map(item => convertDatabaseInwardItem(item, item.medicines_master)) || []
      );

    } catch (error) {
      console.error('Error creating inward receipt:', error);
      throw error;
    }
  },

  // Batches
  /** Batches with stock for a medicine (or all), earliest expiry first — FEFO. */
  async getBatches(medicineId?: string, includeEmpty = false): Promise<MedicineBatch[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let query = supabase
      .from('medicine_batches')
      .select('*, medicines_master (*)')
      .eq('clinic_id', profile.clinicId)
      .order('expiry_date', { ascending: true, nullsFirst: false });

    if (medicineId) query = query.eq('medicine_id', medicineId);
    if (!includeEmpty) query = query.gt('quantity', 0);

    const { data, error } = await query;
    if (error) {
      throw new Error('Failed to fetch batches');
    }
    return (data || []).map(b => convertDatabaseBatch(b, b.medicines_master));
  },

  // Medicine Dispensing
  async dispenseMedicines(items: DispenseItemInput[]): Promise<PharmacyDispensedItem[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const itemsToInsert = items.map(item => ({
        visit_id: item.visitId || null,
        prescription_id: item.prescriptionId || null,
        clinic_id: profile.clinicId,
        medicine_id: item.medicineId,
        quantity: item.quantity,
        dispensed_by: item.dispensedBy,
        dispense_date: item.dispenseDate.toISOString(),
        selling_price_at_dispense: item.sellingPriceAtDispense,
        batch_number: item.batchNumber || null,
        batch_id: item.batchId || null,
        bill_id: item.billId || null,
        hsn_code: item.hsnCode || null,
        gst_rate: item.gstRate ?? 0,
        mrp: item.mrp ?? item.sellingPriceAtDispense ?? null,
        discount_amount: item.discountAmount ?? 0,
        taxable_amount: item.taxableAmount ?? 0,
        cgst_amount: item.cgstAmount ?? 0,
        sgst_amount: item.sgstAmount ?? 0,
        igst_amount: item.igstAmount ?? 0
      }));

      const { data, error } = await supabase
        .from('pharmacy_dispensed_items')
        .insert(itemsToInsert)
        .select(`
          *,
          medicines_master (*),
          profiles (*)
        `);

      if (error) {
        throw new Error(error.message || 'Failed to dispense medicines');
      }

      return data.map(item => convertDatabaseDispensedItem(item, item.medicines_master));

    } catch (error) {
      console.error('Error dispensing medicines:', error);
      throw error;
    }
  },

  /**
   * Dispense and raise the pharmacy tax invoice in one go. The invoice is
   * created first so each dispensed row can point at it; if dispensing then
   * fails (stock race), the invoice is cancelled so the series shows a void
   * number rather than a phantom sale.
   */
  async dispenseAndInvoice(
    items: DispenseItemInput[],
    bill: PharmacyBillInput
  ): Promise<{ dispensed: PharmacyDispensedItem[]; bill: Bill }> {
    const createdBill = await billingService.createPharmacyBill(bill);
    try {
      const dispensed = await this.dispenseMedicines(items.map(i => ({ ...i, billId: createdBill.id })));
      return { dispensed, bill: createdBill };
    } catch (err) {
      try {
        await billingService.cancelBill(createdBill.id, 'Dispense failed after invoice was raised');
      } catch (cancelErr) {
        console.error('Could not cancel invoice after failed dispense:', cancelErr);
      }
      throw err;
    }
  },

  // Stock Management
  async getStockMovementLog(medicineId?: string): Promise<StockMovementLog[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let query = supabase
      .from('stock_movement_log')
      .select(`
        *,
        clinic_id,
        medicines_master (*),
        profiles (*)
      `)
      .order('movement_date', { ascending: false });

    if (medicineId) {
      query = query.eq('medicine_id', medicineId);
      query = query.eq('clinic_id', profile.clinicId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch stock movement log');
    }

    return data.map(log => convertDatabaseStockMovementLog(log, log.medicines_master));
  },

  async getLowStockMedicines(clinicId?: string): Promise<MedicineWithPrice[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('medicines_master')
      .select(`
        *,
        clinic_medicine_prices!left (
          selling_price,
          cost_price
        )
      `)
      .eq('is_active', true)
      .eq('clinic_id', profile.clinicId)
      .gt('reorder_level', 0)
      .order('current_stock');

    if (error) {
      throw new Error('Failed to fetch low stock medicines');
    }

    // Filter medicines where current_stock <= reorder_level in JavaScript
    return data
      .filter(medicine => medicine.current_stock <= medicine.reorder_level)
      .map(convertMedicineRowWithPrice);
  },

  async getExpiringMedicines(daysAhead: number = 30, clinicId?: string): Promise<MedicineWithPrice[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const { data, error } = await supabase
      .from('medicines_master')
      .select(`
        *,
        clinic_medicine_prices!left (
          selling_price,
          cost_price
        )
      `)
      .eq('is_active', true)
      .eq('clinic_id', profile.clinicId)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', futureDate.toISOString())
      .gt('current_stock', 0)
      .order('expiry_date');

    if (error) {
      throw new Error('Failed to fetch expiring medicines');
    }

    return data.map(convertMedicineRowWithPrice);
  },

  // Dashboard Analytics
  async getPharmacyDashboardData(clinicId?: string): Promise<{
    totalMedicines: number;
    lowStockCount: number;
    expiringCount: number;
    totalStockValue: number;
    recentMovements: StockMovementLog[];
  }> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const [
        allMedicines,
        lowStockMedicines,
        expiringMedicines,
        { data: recentMovements }
      ] = await Promise.all([
        this.getAllMedicinesWithPrices(clinicId),
        this.getLowStockMedicines(clinicId),
        this.getExpiringMedicines(30, clinicId),
        supabase
          .from('stock_movement_log')
          .select(`
            *,
            medicines_master (*),
            clinic_id,
            profiles (*)
          `)
          .order('movement_date', { ascending: false })
          .limit(10)
      ]);

      const totalStockValue = allMedicines.reduce((sum, medicine) => {
        return sum + (medicine.currentStock * (medicine.costPrice || 0));
      }, 0) || 0;

      return {
        totalMedicines: allMedicines.length,
        lowStockCount: lowStockMedicines.length,
        expiringCount: expiringMedicines.length,
        totalStockValue,
        recentMovements: recentMovements?.map(log => convertDatabaseStockMovementLog(log, log.medicines_master)) || []
      };

    } catch (error) {
      console.error('Error fetching pharmacy dashboard data:', error);
      throw new Error('Failed to fetch pharmacy dashboard data');
    }
  },

  async getAllMedicinesWithPrices(clinicId?: string): Promise<MedicineWithPrice[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('medicines_master')
      .select(`
        *,
        clinic_medicine_prices!left (
          selling_price,
          cost_price
        )
      `)
      .eq('is_active', true)
      .eq('clinic_id', profile.clinicId);

    if (error) {
      throw new Error('Failed to fetch medicines with prices');
    }

    return data.map(convertMedicineRowWithPrice);
  },

  // Stock Alerts Management
  async getStockAlerts(includeResolved: boolean = false): Promise<StockAlert[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let query = supabase
      .from('stock_alerts')
      .select(`
        *,
        clinic_id,
        medicines_master!stock_alerts_medicine_id_fkey (*)
      `)
      .order('created_at', { ascending: false });

    if (!includeResolved) {
      query = query.eq('is_resolved', false);
    }
    query = query.eq('clinic_id', profile.clinicId);

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch stock alerts');
    }

    return data.map(alert => convertDatabaseStockAlert(alert, alert.medicines_master));
  },

  async resolveStockAlert(alertId: string, resolvedBy: string): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { error } = await supabase
      .from('stock_alerts')
      .update({
        is_resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy
      })
      .eq('clinic_id', profile.clinicId)
      .eq('id', alertId);

    if (error) {
      throw new Error('Failed to resolve stock alert');
    }
  },

  async triggerStockAlertsCheck(): Promise<{ success: boolean; message: string }> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) throw new Error('Not authenticated');
      const token = session.access_token;

      const response = await fetch(`${supabaseUrl}/functions/v1/predict-stock-alerts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error(`Stock alerts check failed: ${response.statusText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error triggering stock alerts check:', error);
      throw error;
    }
  },

  // Debit notes (return to supplier)
  async getDebitNotes(range?: { from: Date; to: Date }): Promise<PharmacyDebitNote[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let query = supabase
      .from('pharmacy_debit_notes')
      .select('*, suppliers (*), pharmacy_debit_note_items (*, medicines_master (*))')
      .eq('clinic_id', profile.clinicId)
      .order('note_date', { ascending: false });

    if (range) {
      query = query
        .gte('note_date', range.from.toISOString().slice(0, 10))
        .lte('note_date', range.to.toISOString().slice(0, 10));
    }

    const { data, error } = await query;
    if (error) {
      throw new Error('Failed to fetch debit notes');
    }
    return (data || []).map(d => convertDatabaseDebitNote(
      d,
      d.suppliers ? convertDatabaseSupplier(d.suppliers) : undefined,
      (d.pharmacy_debit_note_items || []).map((i: any) => convertDatabaseDebitNoteItem(i, i.medicines_master))
    ));
  },

  /**
   * Return goods to a supplier. Allocates a DN/FY/00001 number, stores the
   * GST reversal, and the item trigger moves stock + batch + movement log.
   */
  async createDebitNote(input: DebitNoteInput): Promise<PharmacyDebitNote> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }
    if (input.items.length === 0) {
      throw new Error('Add at least one item to return');
    }

    const { data: noteNumber, error: numberError } = await supabase
      .rpc('next_debit_note_number', { p_clinic_id: profile.clinicId });
    if (numberError || !noteNumber) {
      throw new Error(`Failed to allocate debit note number: ${numberError?.message || 'unknown error'}`);
    }

    const { data: note, error: noteError } = await supabase
      .from('pharmacy_debit_notes')
      .insert({
        clinic_id: profile.clinicId,
        supplier_id: input.supplierId,
        debit_note_number: noteNumber,
        against_receipt_id: input.againstReceiptId || null,
        reason: input.reason || null,
        is_interstate: input.isInterstate,
        taxable_amount: input.taxableAmount,
        cgst_amount: input.cgstAmount,
        sgst_amount: input.sgstAmount,
        igst_amount: input.igstAmount,
        round_off: input.roundOff,
        grand_total: input.grandTotal,
        created_by: profile.id
      })
      .select()
      .single();

    if (noteError || !note) {
      throw new Error(noteError?.message || 'Failed to create debit note');
    }

    const { error: itemsError } = await supabase
      .from('pharmacy_debit_note_items')
      .insert(input.items.map(i => ({
        clinic_id: profile.clinicId,
        debit_note_id: note.id,
        medicine_id: i.medicineId,
        batch_id: i.batchId || null,
        batch_number: i.batchNumber || null,
        quantity: i.quantity,
        unit_rate: i.unitRate,
        hsn_code: i.hsnCode || null,
        gst_rate: i.gstRate,
        taxable_amount: i.taxableAmount,
        cgst_amount: i.cgstAmount,
        sgst_amount: i.sgstAmount,
        igst_amount: i.igstAmount,
        line_total: i.lineTotal
      })));

    if (itemsError) {
      // Items insert is all-or-nothing in one statement; triggers rolled back with it.
      await supabase.from('pharmacy_debit_notes').delete().eq('id', note.id);
      throw new Error(itemsError.message || 'Failed to save debit note items');
    }

    const { data: full, error: fetchError } = await supabase
      .from('pharmacy_debit_notes')
      .select('*, suppliers (*), pharmacy_debit_note_items (*, medicines_master (*))')
      .eq('id', note.id)
      .single();
    if (fetchError || !full) {
      throw new Error('Debit note saved but could not be re-read');
    }
    return convertDatabaseDebitNote(
      full,
      full.suppliers ? convertDatabaseSupplier(full.suppliers) : undefined,
      (full.pharmacy_debit_note_items || []).map((i: any) => convertDatabaseDebitNoteItem(i, i.medicines_master))
    );
  },

  // Stock Adjustments
  async adjustStock(
    medicineId: string,
    quantityChange: number,
    reason: string,
    adjustedBy: string
  ): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      // Fetch current medicine stock
      const { data: medicine, error: medicineError } = await supabase
        .from('medicines_master')
        .select('id, name, current_stock')
        .eq('id', medicineId)
        .eq('clinic_id', profile.clinicId)
        .single();

      if (medicineError || !medicine) {
        throw new Error('Medicine not found or error fetching medicine data');
      }

      const newStockLevel = medicine.current_stock + quantityChange;

      if (newStockLevel < 0) {
        throw new Error(`Invalid adjustment. Would result in negative stock. Current: ${medicine.current_stock}, Change: ${quantityChange}`);
      }

      // Update medicine stock
      const { error: updateError } = await supabase
        .from('medicines_master')
        .update({ current_stock: newStockLevel })
        .eq('clinic_id', profile.clinicId)
        .eq('id', medicineId);

      if (updateError) {
        throw new Error(`Failed to update medicine stock: ${updateError.message}`);
      }

      // Create stock movement log entry
      const movementRemarks = `Stock adjustment: ${reason}`;

      const { error: logError } = await supabase
        .from('stock_movement_log')
        .insert([{
          clinic_id: profile.clinicId,
          medicine_id: medicineId,
          movement_type: 'adjustment',
          quantity_change: quantityChange,
          new_stock_level: newStockLevel,
          reference_type: 'manual_adjustment',
          moved_by: adjustedBy,
          movement_date: new Date().toISOString(),
          remarks: movementRemarks
        }]);

      if (logError) {
        throw new Error(`Failed to log stock movement: ${logError.message}`);
      }

    } catch (error) {
      console.error('Error adjusting stock:', error);
      throw error;
    }
  }
};
