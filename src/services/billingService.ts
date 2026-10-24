import { supabase } from '../lib/supabase';
import { Bill, BillItem, Patient, Visit, PaymentRecord } from '../types';
import { getCurrentProfile } from './profileService';
import type { DatabaseBill, DatabaseBillItem } from '../lib/supabase';

// Convert database bill to app bill type
const convertDatabaseBill = (
  dbBill: DatabaseBill,
  billItems: BillItem[] = [],
  paymentRecords: PaymentRecord[] = [],
  patient?: Patient,
  visit?: Visit
): Bill => ({
  id: dbBill.id,
  visitId: dbBill.visit_id || null,
  patientId: dbBill.patient_id,
  billNumber: dbBill.bill_number,
  totalAmount: dbBill.total_amount,
  paidAmount: dbBill.paid_amount,
  balanceAmount: dbBill.balance_amount,
  paymentStatus: dbBill.status,
  paymentMethod: dbBill.payment_method,
  billDate: new Date(dbBill.bill_date),
  dueDate: dbBill.due_date ? new Date(dbBill.due_date) : undefined,
  notes: dbBill.notes,
  totalRefundedAmount: dbBill.total_refunded_amount || 0,
  refundStatus: dbBill.refund_status || 'not_requested',
  lastRefundAt: dbBill.last_refund_at ? new Date(dbBill.last_refund_at) : undefined,
  refundNotes: dbBill.refund_notes || undefined,
  cancelledAt: dbBill.cancelled_at ? new Date(dbBill.cancelled_at) : undefined,
  cancelledBy: dbBill.cancelled_by || undefined,
  cancellationReason: dbBill.cancellation_reason || undefined,
  pdfUrl: dbBill.pdf_url || undefined, // Map stored PDF URL
  billType: (dbBill.bill_type as Bill['billType']) || 'opd',
  taxableAmount: Number(dbBill.taxable_amount || 0),
  discountAmount: Number(dbBill.discount_amount || 0),
  cgstAmount: Number(dbBill.cgst_amount || 0),
  sgstAmount: Number(dbBill.sgst_amount || 0),
  igstAmount: Number(dbBill.igst_amount || 0),
  roundOff: Number(dbBill.round_off || 0),
  createdAt: new Date(dbBill.created_at),
  updatedAt: new Date(dbBill.updated_at),
  sourceUpdatedAt: dbBill.updated_at,
  billItems,
  paymentRecords: paymentRecords.length > 0 ? paymentRecords : undefined,
  patient,
  visit
});

// Convert database bill item to app bill item type
const convertDatabaseBillItem = (dbBillItem: DatabaseBillItem): BillItem => ({
  id: dbBillItem.id,
  billId: dbBillItem.bill_id,
  itemType: dbBillItem.item_type,
  itemName: dbBillItem.item_name,
  quantity: Number(dbBillItem.quantity),
  packSize: dbBillItem.pack_size != null ? Number(dbBillItem.pack_size) : 1,
  billedQuantity: dbBillItem.billed_quantity != null
    ? Number(dbBillItem.billed_quantity)
    : Number(dbBillItem.quantity),
  billedUnit: dbBillItem.billed_unit ?? undefined,
  unitPrice: dbBillItem.unit_price,
  totalPrice: dbBillItem.total_price,
  discount: dbBillItem.discount,
  tax: dbBillItem.tax,
  refundedQuantity: dbBillItem.refunded_quantity,
  refundedAmount: dbBillItem.refunded_amount,
  lastRefundReason: dbBillItem.last_refund_reason,
  createdAt: new Date(dbBillItem.created_at),
  medicineId: dbBillItem.medicine_id ?? undefined,
  batchId: dbBillItem.batch_id ?? undefined,
  batchNumber: dbBillItem.batch_number ?? undefined,
  expiryDate: dbBillItem.expiry_date ? new Date(dbBillItem.expiry_date) : undefined,
  hsnCode: dbBillItem.hsn_code ?? undefined,
  gstRate: dbBillItem.gst_rate !== undefined && dbBillItem.gst_rate !== null ? Number(dbBillItem.gst_rate) : undefined,
  mrp: dbBillItem.mrp ?? undefined,
  taxableAmount: dbBillItem.taxable_amount !== undefined ? Number(dbBillItem.taxable_amount) : undefined,
  cgstAmount: dbBillItem.cgst_amount !== undefined ? Number(dbBillItem.cgst_amount) : undefined,
  sgstAmount: dbBillItem.sgst_amount !== undefined ? Number(dbBillItem.sgst_amount) : undefined,
  igstAmount: dbBillItem.igst_amount !== undefined ? Number(dbBillItem.igst_amount) : undefined
});

/** One line of a pharmacy tax invoice, already tax-computed by utils/gst. */
export interface PharmacyBillLineInput {
  medicineId: string;
  itemName: string;
  /** Stocked units sold; 0.5 when half a strip was broken open. */
  quantity: number;
  /** Quantity as charged, in billedUnit. Defaults to quantity. */
  billedQuantity?: number;
  /** Dispense units in one stocked unit at the time of the sale. */
  packSize?: number;
  /** Unit that billedQuantity and unitPrice are both in. */
  billedUnit?: string;
  /** Rate per billed unit: per tablet on a loose sale, per pack otherwise. */
  unitPrice: number;
  /** MRP of the whole pack, which is what has to be printed. */
  mrp?: number;
  batchId?: string;
  batchNumber?: string;
  expiryDate?: Date;
  hsnCode?: string;
  gstRate: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  /** taxable + tax for the line */
  totalPrice: number;
}

export interface PharmacyBillInput {
  patientId: string;
  visitId?: string | null;
  lines: PharmacyBillLineInput[];
  totals: {
    discount: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    roundOff: number;
    grandTotal: number;
  };
  /** Amount collected right now (0 for credit) */
  paidAmount: number;
  /** Must stay within the payment_records CHECK constraint — 'online' is not an allowed value there. */
  paymentMethod?: 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet';
  notes?: string;
}

export const billingService = {
  /** Pharmacy-only register. The RPC keeps patient search, totals and paging on the server under RLS. */
  async getPharmacyBills(filters: { page?: number; search?: string; status?: string; source?: string; from?: string; to?: string } = {}): Promise<{ bills: Bill[]; total: number; sales: number; outstanding: number }> {
    if (!supabase) throw new Error('Database connection is unavailable.');
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User is not assigned to a clinic.');
    const end = filters.to ? new Date(`${filters.to}T00:00:00`) : null;
    if (end) end.setDate(end.getDate() + 1);
    const { data, error } = await supabase.rpc('pharmacy_bill_register', {
      p_clinic_id: profile.clinicId, p_search: (filters.search || '').trim(),
      p_status: filters.status || 'all', p_source: filters.source || 'all',
      p_from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : null,
      p_to: end?.toISOString() || null, p_page: Math.max(0, filters.page || 0),
    });
    if (error) throw new Error(`Could not load pharmacy bills: ${error.message}`);
    return { total: Number(data.total), sales: Number(data.sales), outstanding: Number(data.outstanding),
      bills: (data.bills || []).map((row: DatabaseBill & { patients?: Patient & { patient_number?: string; created_at: string } }) =>
        convertDatabaseBill(row, [], [], row.patients?.id ? {
          ...row.patients, patientNumber: row.patients.patient_number, createdAt: new Date(row.patients.created_at),
        } : undefined)),
    };
  },

  // Generate a unique bill number
  generateBillNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const timestamp = now.getTime().toString().slice(-6); // Last 6 digits of timestamp

    return `BILL-${year}${month}${day}-${timestamp}`;
  },

  // Get all bills with optional payment records
  async getBills(includePaymentRecords: boolean = false): Promise<Bill[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data: bills, error: billsError } = await supabase
      .from('bills')
      .select(`
        *, 
        patients (*),
        visits (*)
      `)
      .eq('clinic_id', profile.clinicId)
      .order('bill_date', { ascending: false });

    if (billsError) {
      throw new Error('Failed to fetch bills');
    }

    // Get bill items for all bills
    const billIds = bills.map((bill: any) => bill.id);
    const { data: billItems, error: itemsError } = await supabase
      .from('bill_items')
      .select('*')
      .in('bill_id', billIds);

    if (itemsError) {
      throw new Error('Failed to fetch bill items');
    }

    // Group bill items by bill ID
    const itemsByBill = new Map<string, BillItem[]>();
    billItems?.forEach((item: any) => {
      const billItemsList = itemsByBill.get(item.bill_id) || [];
      billItemsList.push(convertDatabaseBillItem(item));
      itemsByBill.set(item.bill_id, billItemsList);
    });

    // Get payment records if requested
    let paymentsByBill = new Map<string, PaymentRecord[]>();
    if (includePaymentRecords) {
      const { data: paymentRecords, error: paymentsError } = await supabase
        .from('payment_records')
        .select(`
          *,
          profiles:received_by (*)
        `)
        .in('bill_id', billIds)
        .order('payment_date', { ascending: false });

      if (!paymentsError && paymentRecords) {
        paymentRecords.forEach((payment: any) => {
          const paymentList = paymentsByBill.get(payment.bill_id) || [];
          paymentList.push({
            id: payment.id,
            billId: payment.bill_id,
            paymentDate: new Date(payment.payment_date),
            paymentMethod: payment.payment_method,
            amount: payment.amount,
            cardReference: payment.card_reference,
            chequeNumber: payment.cheque_number,
            bankName: payment.bank_name,
            notes: payment.notes,
            receivedBy: payment.received_by,
            receivedByProfile: payment.profiles,
            createdAt: new Date(payment.created_at)
          });
          paymentsByBill.set(payment.bill_id, paymentList);
        });
      }
    }

    return bills.map((bill: any) => convertDatabaseBill(
      bill,
      itemsByBill.get(bill.id) || [],
      paymentsByBill.get(bill.id) || [],
      bill.patients ? {
        id: bill.patients.id,
        patientNumber: bill.patients.patient_number,
        patient_number: bill.patients.patient_number,
        name: bill.patients.name,
        phone: bill.patients.phone,
        age: bill.patients.age,
        gender: bill.patients.gender,
        address: bill.patients.address,
        emergency_contact: bill.patients.emergency_contact,
        blood_group: bill.patients.blood_group,
        allergies: bill.patients.allergies,
        createdAt: new Date(bill.patients.created_at),
        lastVisit: bill.patients.last_visit ? new Date(bill.patients.last_visit) : undefined
      } : undefined,
      bill.visits ? {
        id: bill.visits.id,
        patientId: bill.visits.patient_id,
        doctorId: bill.visits.doctor_id,
        appointmentId: bill.visits.appointment_id,
        date: new Date(bill.visits.date),
        chiefComplaint: bill.visits.chief_complaint || '',
        symptoms: [],
        vitals: bill.visits.vitals || {},
        diagnoses: [],
        prescriptions: [],
        testsOrdered: [],
        testResults: [],
        advice: bill.visits.advice || [],
        followUpDate: bill.visits.follow_up_date ? new Date(bill.visits.follow_up_date) : undefined,
        doctorNotes: bill.visits.doctor_notes || '',
        caseImageUrl: bill.visits.case_image_url,
        createdAt: new Date(bill.visits.created_at),
        updatedAt: new Date(bill.visits.updated_at)
      } : undefined
    ));
  },

  // Get a single bill with payment records
  async getBillById(billId: string, includePaymentRecords: boolean = true): Promise<Bill | null> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data: bill, error: billError } = await supabase
      .from('bills')
      .select(`
        *, 
        patients (*),
        visits (*)
      `)
      .eq('id', billId)
      .eq('clinic_id', profile.clinicId)
      .single();

    if (billError || !bill) {
      return null;
    }

    // Get bill items
    const { data: billItems, error: itemsError } = await supabase
      .from('bill_items')
      .select('*')
      .eq('bill_id', billId);

    if (itemsError) {
      throw new Error('Failed to fetch bill items');
    }

    // Get payment records if requested
    let paymentRecords: PaymentRecord[] = [];
    if (includePaymentRecords) {
      const { data: payments, error: paymentsError } = await supabase
        .from('payment_records')
        .select(`
          *,
          profiles:received_by (*)
        `)
        .eq('bill_id', billId)
        .order('payment_date', { ascending: false });

      if (!paymentsError && payments) {
        paymentRecords = payments.map((payment: any) => ({
          id: payment.id,
          billId: payment.bill_id,
          paymentDate: new Date(payment.payment_date),
          paymentMethod: payment.payment_method,
          amount: payment.amount,
          cardReference: payment.card_reference,
          chequeNumber: payment.cheque_number,
          bankName: payment.bank_name,
          notes: payment.notes,
          receivedBy: payment.received_by,
          receivedByProfile: payment.profiles,
          createdAt: new Date(payment.created_at)
        }));
      }
    }

    return convertDatabaseBill(
      bill,
      billItems?.map(convertDatabaseBillItem) || [],
      paymentRecords,
      bill.patients ? {
        id: bill.patients.id,
        patientNumber: bill.patients.patient_number,
        patient_number: bill.patients.patient_number,
        name: bill.patients.name,
        phone: bill.patients.phone,
        age: bill.patients.age,
        gender: bill.patients.gender,
        address: bill.patients.address,
        emergency_contact: bill.patients.emergency_contact,
        blood_group: bill.patients.blood_group,
        allergies: bill.patients.allergies,
        createdAt: new Date(bill.patients.created_at),
        lastVisit: bill.patients.last_visit ? new Date(bill.patients.last_visit) : undefined
      } : undefined,
      bill.visits ? {
        id: bill.visits.id,
        patientId: bill.visits.patient_id,
        doctorId: bill.visits.doctor_id,
        appointmentId: bill.visits.appointment_id,
        date: new Date(bill.visits.date),
        chiefComplaint: bill.visits.chief_complaint || '',
        symptoms: [],
        vitals: bill.visits.vitals || {},
        diagnoses: [],
        prescriptions: [],
        testsOrdered: [],
        testResults: [],
        advice: bill.visits.advice || [],
        followUpDate: bill.visits.follow_up_date ? new Date(bill.visits.follow_up_date) : undefined,
        doctorNotes: bill.visits.doctor_notes || '',
        caseImageUrl: bill.visits.case_image_url,
        createdAt: new Date(bill.visits.created_at),
        updatedAt: new Date(bill.visits.updated_at)
      } : undefined
    );
  },

  // Get bills for a specific patient
  async getPatientBills(patientId: string): Promise<Bill[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data: bills, error: billsError } = await supabase
      .from('bills')
      .select(`
        *, 
        patients (*),
        visits (*)
      `)
      .eq('patient_id', patientId)
      .eq('clinic_id', profile.clinicId)
      .order('bill_date', { ascending: false });

    if (billsError) {
      throw new Error('Failed to fetch patient bills');
    }

    // Get bill items for all bills
    const billIds = bills.map((bill: any) => bill.id);
    const { data: billItems, error: itemsError } = await supabase
      .from('bill_items')
      .select('*')
      .in('bill_id', billIds);

    if (itemsError) {
      throw new Error('Failed to fetch bill items');
    }

    // Group bill items by bill ID
    const itemsByBill = new Map<string, BillItem[]>();
    billItems?.forEach((item: any) => {
      const billItemsList = itemsByBill.get(item.bill_id) || [];
      billItemsList.push(convertDatabaseBillItem(item));
      itemsByBill.set(item.bill_id, billItemsList);
    });

    return bills.map((bill: any) => convertDatabaseBill(
      bill,
      itemsByBill.get(bill.id) || [],
      [],
      bill.patients ? {
        id: bill.patients.id,
        patientNumber: bill.patients.patient_number,
        patient_number: bill.patients.patient_number,
        name: bill.patients.name,
        phone: bill.patients.phone,
        age: bill.patients.age,
        gender: bill.patients.gender,
        address: bill.patients.address,
        emergency_contact: bill.patients.emergency_contact,
        blood_group: bill.patients.blood_group,
        allergies: bill.patients.allergies,
        createdAt: new Date(bill.patients.created_at),
        lastVisit: bill.patients.last_visit ? new Date(bill.patients.last_visit) : undefined
      } : undefined,
      bill.visits ? {
        id: bill.visits.id,
        patientId: bill.visits.patient_id,
        doctorId: bill.visits.doctor_id,
        appointmentId: bill.visits.appointment_id,
        date: new Date(bill.visits.date),
        chiefComplaint: bill.visits.chief_complaint || '',
        symptoms: [],
        vitals: bill.visits.vitals || {},
        diagnoses: [],
        prescriptions: [],
        testsOrdered: [],
        testResults: [],
        advice: bill.visits.advice || [],
        followUpDate: bill.visits.follow_up_date ? new Date(bill.visits.follow_up_date) : undefined,
        doctorNotes: bill.visits.doctor_notes || '',
        caseImageUrl: bill.visits.case_image_url,
        createdAt: new Date(bill.visits.created_at),
        updatedAt: new Date(bill.visits.updated_at)
      } : undefined
    ));
  },

  // Create a new bill
  async createBill(billData: {
    visitId?: string;
    patientId: string;
    totalAmount: number;
    billItems: Omit<BillItem, 'id' | 'billId' | 'createdAt'>[];
    notes?: string;
    dueDate?: Date;
  }): Promise<Bill> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    // Check for duplicate bills created in the last 30 seconds
    const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
    const { data: recentBills, error: checkError } = await supabase
      .from('bills')
      .select('id, bill_number, bill_date')
      .eq('patient_id', billData.patientId)
      .eq('clinic_id', profile.clinicId)
      .eq('total_amount', billData.totalAmount)
      .gte('bill_date', thirtySecondsAgo)
      .order('bill_date', { ascending: false })
      .limit(1);

    if (checkError) {
      console.warn('Failed to check for duplicate bills:', checkError);
    } else if (recentBills && recentBills.length > 0) {
      const recentBill = recentBills[0];
      console.warn('Preventing duplicate bill creation. Recent bill:', recentBill);
      throw new Error(`A bill for this patient with the same amount was created ${Math.round((Date.now() - new Date(recentBill.bill_date).getTime()) / 1000)} seconds ago. Please refresh the page.`);
    }

    // Generate bill number
    const billNumber = `BILL-${Date.now()}`;

    try {
      // Create bill
      const { data: bill, error: billError } = await supabase
        .from('bills')
        .insert({
          visit_id: billData.visitId || null,
          patient_id: billData.patientId,
          bill_number: billNumber,
          total_amount: billData.totalAmount,
          paid_amount: 0,
          status: 'pending',
          bill_date: new Date().toISOString(),
          due_date: billData.dueDate?.toISOString(),
          notes: billData.notes,
          clinic_id: profile.clinicId
        })
        .select()
        .single();

      if (billError) {
        throw new Error(`Failed to create bill: ${billError.message}`);
      }

      // Create bill items
      if (billData.billItems.length > 0) {
        const billItemsToInsert = billData.billItems.map(item => ({
          bill_id: bill.id,
          item_type: item.itemType,
          item_name: item.itemName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_price: item.totalPrice,
          discount: item.discount || 0,
          tax: item.tax || 0,
          clinic_id: profile.clinicId
        }));

        const { error: itemsError } = await supabase
          .from('bill_items')
          .insert(billItemsToInsert);

        if (itemsError) {
          // Rollback bill creation
          await supabase.from('bills').delete().eq('id', bill.id);
          throw new Error(`Failed to create bill items: ${itemsError.message}`);
        }
      }

      return this.getBillById(bill.id, false) as Promise<Bill>;
    } catch (error) {
      console.error('Error creating bill:', error);
      throw error;
    }
  },

  /**
   * Pharmacy tax invoice: its own number series (PH/FY/00001 via the DB
   * counter), GST totals on the header, HSN/batch/tax on every line. Returns
   * the bill with items. Payment, if any, is recorded as a payment_records row
   * so the daily collection and reconciliation screens see it like any other.
   */
  async createPharmacyBill(input: PharmacyBillInput): Promise<Bill> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }
    if (input.lines.length === 0) {
      throw new Error('A pharmacy invoice needs at least one line');
    }

    const { data: billNumber, error: numberError } = await supabase
      .rpc('next_pharmacy_bill_number', { p_clinic_id: profile.clinicId });
    if (numberError || !billNumber) {
      throw new Error(`Failed to allocate pharmacy invoice number: ${numberError?.message || 'unknown error'}`);
    }

    const paid = Math.min(Math.max(0, input.paidAmount || 0), input.totals.grandTotal);
    const status = paid >= input.totals.grandTotal ? 'paid' : paid > 0 ? 'partial' : 'pending';

    const { data: bill, error: billError } = await supabase
      .from('bills')
      .insert({
        visit_id: input.visitId || null,
        patient_id: input.patientId,
        bill_number: billNumber,
        bill_type: 'pharmacy',
        total_amount: input.totals.grandTotal,
        paid_amount: paid,
        balance_amount: Math.max(0, input.totals.grandTotal - paid),
        status,
        payment_method: paid > 0 ? input.paymentMethod || 'cash' : null,
        bill_date: new Date().toISOString(),
        notes: input.notes || null,
        taxable_amount: input.totals.taxable,
        discount_amount: input.totals.discount,
        cgst_amount: input.totals.cgst,
        sgst_amount: input.totals.sgst,
        igst_amount: input.totals.igst,
        round_off: input.totals.roundOff,
        clinic_id: profile.clinicId
      })
      .select()
      .single();

    if (billError || !bill) {
      throw new Error(`Failed to create pharmacy invoice: ${billError?.message || 'unknown error'}`);
    }

    const itemsToInsert = input.lines.map(line => ({
      bill_id: bill.id,
      clinic_id: profile.clinicId,
      item_type: 'medicine',
      item_name: line.itemName,
      quantity: line.quantity,
      pack_size: line.packSize && line.packSize > 0 ? line.packSize : 1,
      billed_quantity: line.billedQuantity ?? line.quantity,
      billed_unit: line.billedUnit || null,
      unit_price: line.unitPrice,
      amount: line.totalPrice,
      total_price: line.totalPrice,
      discount: line.discountAmount,
      tax: line.gstRate,
      medicine_id: line.medicineId,
      batch_id: line.batchId || null,
      batch_number: line.batchNumber || null,
      expiry_date: line.expiryDate ? line.expiryDate.toISOString().slice(0, 10) : null,
      hsn_code: line.hsnCode || null,
      gst_rate: line.gstRate,
      mrp: line.mrp ?? line.unitPrice,
      taxable_amount: line.taxableAmount,
      cgst_amount: line.cgstAmount,
      sgst_amount: line.sgstAmount,
      igst_amount: line.igstAmount
    }));

    const { error: itemsError } = await supabase.from('bill_items').insert(itemsToInsert);
    if (itemsError) {
      await supabase.from('bills').delete().eq('id', bill.id);
      throw new Error(`Failed to create invoice lines: ${itemsError.message}`);
    }

    if (paid > 0) {
      const { error: payError } = await supabase.from('payment_records').insert({
        bill_id: bill.id,
        amount: paid,
        payment_method: input.paymentMethod || 'cash',
        payment_date: new Date().toISOString(),
        received_by: profile.id,
        clinic_id: profile.clinicId,
        record_type: 'payment',
        notes: `Pharmacy invoice ${billNumber}`
      });
      if (payError) {
        // The bill itself is valid; surface the problem without rolling back stock.
        console.error('Pharmacy invoice saved but payment record failed:', payError);
      }
    }

    return this.getBillById(bill.id, false) as Promise<Bill>;
  },

  // Add item to existing bill
  async addBillItem(billId: string, item: Omit<BillItem, 'id' | 'billId' | 'createdAt'>): Promise<BillItem> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data: billItem, error } = await supabase
        .from('bill_items')
        .insert({
          bill_id: billId,
          item_type: item.itemType,
          item_name: item.itemName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_price: item.totalPrice,
          discount: item.discount || 0,
          tax: item.tax || 0,
          clinic_id: profile.clinicId
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to add bill item: ${error.message}`);
      }

      return convertDatabaseBillItem(billItem);
    } catch (error) {
      console.error('Error adding bill item:', error);
      throw error;
    }
  },

  // Update bill status (triggered automatically by payment records)
  async updateBillStatus(billId: string): Promise<void> {
    // This is now handled automatically by the database trigger
    // when payment records are added/updated/deleted
    console.log(`Bill ${billId} status will be updated automatically by database trigger`);
  },

  // Get bills pending payment
  async getPendingBills(): Promise<Bill[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data: bills, error } = await supabase
      .from('bills')
      .select(`
        *, 
        patients (*),
        visits (*)
      `)
      .eq('clinic_id', profile.clinicId)
      .in('status', ['pending', 'partial'])
      .order('bill_date', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch pending bills: ${error.message}`);
    }

    // Get bill items for all bills
    const billIds = bills.map((bill: any) => bill.id);
    const { data: billItems, error: itemsError } = await supabase
      .from('bill_items')
      .select('*')
      .in('bill_id', billIds);

    if (itemsError) {
      throw new Error('Failed to fetch bill items');
    }

    // Group bill items by bill ID
    const itemsByBill = new Map<string, BillItem[]>();
    billItems?.forEach((item: any) => {
      const billItemsList = itemsByBill.get(item.bill_id) || [];
      billItemsList.push(convertDatabaseBillItem(item));
      itemsByBill.set(item.bill_id, billItemsList);
    });

    return bills.map((bill: any) => convertDatabaseBill(
      bill,
      itemsByBill.get(bill.id) || [],
      [],
      bill.patients ? {
        id: bill.patients.id,
        patientNumber: bill.patients.patient_number,
        patient_number: bill.patients.patient_number,
        name: bill.patients.name,
        phone: bill.patients.phone,
        age: bill.patients.age,
        gender: bill.patients.gender,
        address: bill.patients.address,
        emergency_contact: bill.patients.emergency_contact,
        blood_group: bill.patients.blood_group,
        allergies: bill.patients.allergies,
        createdAt: new Date(bill.patients.created_at),
        lastVisit: bill.patients.last_visit ? new Date(bill.patients.last_visit) : undefined
      } : undefined
    ));
  },

  /**
   * Void a bill, keeping the row and the audit trail.
   *
   * This replaces a hard delete. `bills.delete()` cascaded payment_records,
   * bill_items and refund_requests away, erasing any record that money had been
   * collected and leaving a hole in the bill-number sequence — and it failed
   * outright on bills tied to a lab order, which references bills(id) with no
   * ON DELETE clause.
   *
   * The checks (admin only, no payments collected, no open refunds, reason
   * required) live in the cancel_bill SECURITY DEFINER function so they cannot
   * be bypassed by writing bills.status through the REST API.
   */
  async cancelBill(billId: string, reason: string): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const trimmed = reason?.trim();
    if (!trimmed) {
      throw new Error('A cancellation reason is required.');
    }

    const { error } = await supabase.rpc('cancel_bill', {
      p_bill_id: billId,
      p_reason: trimmed
    });

    if (error) {
      throw new Error(error.message || 'Failed to cancel bill');
    }
  },

  // Update bill details
  async updateBill(billId: string, updates: {
    notes?: string;
    dueDate?: Date;
    totalAmount?: number;
    paymentMethod?: 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet';
    billItems?: Omit<BillItem, 'id' | 'billId' | 'createdAt'>[];
  }): Promise<Bill> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const updateData: any = {};
      if (updates.notes !== undefined) updateData.notes = updates.notes;
      if (updates.dueDate !== undefined) updateData.due_date = updates.dueDate.toISOString();
      if (updates.totalAmount !== undefined) updateData.total_amount = updates.totalAmount;
      if (updates.paymentMethod !== undefined) updateData.payment_method = updates.paymentMethod;

      // Clear cached PDF URLs so the next open regenerates, exactly as
      // visitService does for visits. This was previously unnecessary only by
      // accident: the generator looked the bill cache up under a column name
      // that does not exist, so every bill PDF re-rendered regardless. With
      // that lookup fixed, an edited bill would otherwise serve its old PDF.
      updateData.pdf_url = null;
      updateData.print_pdf_url = null;

      const { error } = await supabase
        .from('bills')
        .update(updateData)
        .eq('id', billId)
        .eq('clinic_id', profile.clinicId);

      if (error) {
        throw new Error(`Failed to update bill: ${error.message}`);
      }

      // Update bill items if provided
      if (updates.billItems) {
        // Delete existing bill items
        const { error: deleteError } = await supabase
          .from('bill_items')
          .delete()
          .eq('bill_id', billId);

        if (deleteError) {
          throw new Error(`Failed to delete old bill items: ${deleteError.message}`);
        }

        // Insert new bill items
        if (updates.billItems.length > 0) {
          const billItemsToInsert = updates.billItems.map(item => ({
            bill_id: billId,
            item_type: item.itemType,
            item_name: item.itemName,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.totalPrice,
            discount: item.discount || 0,
            tax: item.tax || 0,
            clinic_id: profile.clinicId
          }));

          const { error: itemsError } = await supabase
            .from('bill_items')
            .insert(billItemsToInsert);

          if (itemsError) {
            throw new Error(`Failed to update bill items: ${itemsError.message}`);
          }
        }
      }

      const updatedBill = await this.getBillById(billId, true);
      if (!updatedBill) {
        throw new Error('Bill not found after update');
      }

      return updatedBill;
    } catch (error) {
      console.error('Error updating bill:', error);
      throw error;
    }
  }
};
