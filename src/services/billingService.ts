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
  createdAt: new Date(dbBill.created_at),
  updatedAt: new Date(dbBill.updated_at),
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
  quantity: dbBillItem.quantity,
  unitPrice: dbBillItem.unit_price,
  totalPrice: dbBillItem.total_price,
  discount: dbBillItem.discount,
  tax: dbBillItem.tax,
  createdAt: new Date(dbBillItem.created_at)
});

export const billingService = {
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

  // Delete a bill (and all its items and payments)
  async deleteBill(billId: string): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      // Delete bill (cascade will handle bill_items and payment_records)
      const { error } = await supabase
        .from('bills')
        .delete()
        .eq('id', billId)
        .eq('clinic_id', profile.clinicId);

      if (error) {
        throw new Error(`Failed to delete bill: ${error.message}`);
      }
    } catch (error) {
      console.error('Error deleting bill:', error);
      throw error;
    }
  },

  // Update bill details
  async updateBill(billId: string, updates: {
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

    try {
      const updateData: any = {};
      if (updates.notes !== undefined) updateData.notes = updates.notes;
      if (updates.dueDate !== undefined) updateData.due_date = updates.dueDate.toISOString();

      const { error } = await supabase
        .from('bills')
        .update(updateData)
        .eq('id', billId)
        .eq('clinic_id', profile.clinicId);

      if (error) {
        throw new Error(`Failed to update bill: ${error.message}`);
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
