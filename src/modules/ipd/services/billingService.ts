import { supabase } from '../utils/supabase';
import type { Deposit, IpdBill, IpdPayment } from '../types/ipd';

export interface BillingOverviewRow {
  admissionId: string;
  admissionNumber: string;
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  bedLabel: string;
  admissionDate: string;
  packageName: string | null;
  packageAgreed: number | null;
  unbilledCharges: number;   // pending, not package-covered
  packageCovered: number;    // pending, covered by package
  depositsHeld: number;
  billBalance: number;       // outstanding across issued bills
}

export interface BillAudit {
  ordersNotCharged: Array<{ id: string; serviceName: string; orderedAt: string }>;
  consumablesNotCharged: Array<{ id: string; name: string; quantity: number; at: string }>;
  doctorWorkMissingDoctor: Array<{ id: string; serviceName: string; amount: number }>;
  pendingCount: number;
  pendingAmount: number;
  roomRentPostings: number;
}

export const billingService = {
  /**
   * Pre-final-bill audit for one admission — reconciles the chart against the
   * running bill to catch revenue leakage before discharge:
   *  - order items placed but never charged (rate failure / postCharge skipped)
   *  - ward consumption not charged (no selling price configured)
   *  - doctor-work charges with no performing doctor tagged
   *  - count/amount of still-pending (unbilled) charges
   *  - room-rent postings vs length of stay (caller compares to LOS)
   */
  async getBillAudit(admissionId: string): Promise<BillAudit> {
    type SvcJoin = { name?: string; service_type?: string; requires_doctor?: boolean } | null;

    const [ordersRes, consumRes, postingsRes, roomRes] = await Promise.all([
      supabase
        .from('ipd_order_items')
        .select('id, created_at, service:services_master(name)')
        .eq('admission_id', admissionId)
        .neq('status', 'cancelled')
        .is('charge_posting_id', null),
      supabase
        .from('store_consumptions')
        .select('id, quantity, created_at, medicine:medicines_master(name)')
        .eq('admission_id', admissionId)
        .is('charge_posting_id', null),
      supabase
        .from('charge_postings')
        .select('id, net_amount, performing_doctor_id, service:services_master(name, service_type, requires_doctor)')
        .eq('admission_id', admissionId)
        .eq('status', 'pending'),
      supabase
        .from('charge_postings')
        .select('id', { count: 'exact', head: true })
        .eq('admission_id', admissionId)
        .eq('source', 'room_rent_job')
        .neq('status', 'cancelled'),
    ]);
    if (ordersRes.error) throw ordersRes.error;
    if (consumRes.error) throw consumRes.error;
    if (postingsRes.error) throw postingsRes.error;

    const orderRows = (ordersRes.data ?? []) as unknown as Array<{ id: string; created_at: string; service: SvcJoin }>;
    const consumRows = (consumRes.data ?? []) as unknown as Array<{ id: string; quantity: number; created_at: string; medicine: { name?: string } | null }>;
    const postings = (postingsRes.data ?? []) as unknown as Array<{ id: string; net_amount: number; performing_doctor_id: string | null; service: SvcJoin }>;

    const isDoctorWork = (svc: SvcJoin) =>
      !!svc && (Boolean(svc.requires_doctor) || ['consultation', 'surgery', 'procedure'].includes(svc.service_type ?? ''));

    return {
      ordersNotCharged: orderRows.map((o) => ({
        id: o.id, serviceName: o.service?.name ?? 'Service', orderedAt: o.created_at,
      })),
      consumablesNotCharged: consumRows.map((c) => ({
        id: c.id, name: c.medicine?.name ?? 'Item', quantity: c.quantity, at: c.created_at,
      })),
      doctorWorkMissingDoctor: postings
        .filter((p) => isDoctorWork(p.service) && !p.performing_doctor_id)
        .map((p) => ({ id: p.id, serviceName: p.service?.name ?? 'Service', amount: Number(p.net_amount) })),
      pendingCount: postings.length,
      pendingAmount: postings.reduce((s, p) => s + Number(p.net_amount), 0),
      roomRentPostings: roomRes.count ?? 0,
    };
  },

  /** Cashier overview: every admitted patient with live billing position */
  async getBillingOverview(clinicId: string): Promise<BillingOverviewRow[]> {
    const { data: admissions, error } = await supabase
      .from('ipd_admissions')
      .select(
        `id, admission_number, admission_datetime,
         patient:patients(id, name, phone),
         admitting_doctor:profiles!ipd_admissions_admitting_doctor_id_fkey(name),
         current_bed:ipd_beds(bed_number, ward:ipd_wards(name))`
      )
      .eq('clinic_id', clinicId)
      .eq('status', 'admitted')
      .order('admission_datetime');
    if (error) throw error;
    if (!admissions || admissions.length === 0) return [];

    const ids = admissions.map((a: any) => a.id);

    const { data: packages } = await supabase
      .from('admission_packages')
      .select('admission_id, agreed_price, status, package:packages(name)')
      .in('admission_id', ids)
      .in('status', ['active', 'closed']);

    const [{ data: postings }, { data: deposits }, { data: bills }] = await Promise.all([
      supabase
        .from('charge_postings')
        .select('admission_id, net_amount, covered_by_package')
        .in('admission_id', ids)
        .eq('status', 'pending'),
      supabase
        .from('ipd_deposits')
        .select('admission_id, amount, entry_type')
        .in('admission_id', ids),
      supabase
        .from('ipd_bills')
        .select('admission_id, balance_amount, status')
        .in('admission_id', ids)
        .neq('status', 'cancelled'),
    ]);

    return admissions.map((a: any) => {
      const myPostings = (postings ?? []).filter((p) => p.admission_id === a.id);
      const myDeposits = (deposits ?? []).filter((d) => d.admission_id === a.id);
      const myBills = (bills ?? []).filter((b) => b.admission_id === a.id);
      const myPkg = (packages ?? []).find((p: any) => p.admission_id === a.id) as any;
      return {
        admissionId: a.id,
        admissionNumber: a.admission_number,
        patientId: a.patient?.id ?? null,
        patientName: a.patient?.name ?? '—',
        patientPhone: a.patient?.phone ?? null,
        doctorName: a.admitting_doctor?.name ?? '—',
        packageName: myPkg?.package?.name ?? null,
        packageAgreed: myPkg ? Number(myPkg.agreed_price) : null,
        bedLabel: a.current_bed
          ? `${a.current_bed.ward?.name ?? ''} / ${a.current_bed.bed_number}`
          : '—',
        admissionDate: a.admission_datetime,
        unbilledCharges: myPostings.filter((p) => !p.covered_by_package)
          .reduce((s, p) => s + Number(p.net_amount), 0),
        packageCovered: myPostings.filter((p) => p.covered_by_package)
          .reduce((s, p) => s + Number(p.net_amount), 0),
        depositsHeld: myDeposits.reduce(
          (s, d) => s + (d.entry_type === 'deposit' ? Number(d.amount) : -Number(d.amount)), 0),
        billBalance: myBills.reduce((s, b) => s + Math.max(Number(b.balance_amount), 0), 0),
      };
    });
  },

  async listDeposits(admissionId: string): Promise<Deposit[]> {
    const { data, error } = await supabase
      .from('ipd_deposits')
      .select('*')
      .eq('admission_id', admissionId)
      .order('received_at');
    if (error) throw error;
    return data as Deposit[];
  },

  async collectDeposit(params: {
    clinicId: string;
    admissionId: string;
    amount: number;
    paymentMethod: string;
    reference?: string;
    userId?: string;
  }): Promise<Deposit> {
    const { data: receiptNumber, error: numErr } = await supabase.rpc('next_document_number', {
      p_clinic_id: params.clinicId,
      p_doc_type: 'deposit',
    });
    if (numErr) throw numErr;

    const { data, error } = await supabase
      .from('ipd_deposits')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        receipt_number: receiptNumber as string,
        amount: params.amount,
        entry_type: 'deposit',
        payment_method: params.paymentMethod,
        reference: params.reference ?? null,
        received_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as Deposit;
  },

  /** Refund unused deposit back to the patient (settle-out at discharge) */
  async refundDeposit(params: {
    clinicId: string;
    admissionId: string;
    amount: number;
    paymentMethod: string;
    userId?: string;
  }): Promise<Deposit> {
    const { data: receiptNumber, error: numErr } = await supabase.rpc('next_document_number', {
      p_clinic_id: params.clinicId,
      p_doc_type: 'deposit',
    });
    if (numErr) throw numErr;

    const { data, error } = await supabase
      .from('ipd_deposits')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        receipt_number: receiptNumber as string,
        amount: params.amount,
        entry_type: 'refund',
        payment_method: params.paymentMethod,
        received_by: params.userId ?? null,
        notes: 'Deposit refund to patient',
      })
      .select()
      .single();
    if (error) throw error;
    return data as Deposit;
  },

  /** Sweep pending postings into an interim/final bill via the DB function */
  async generateBill(
    admissionId: string,
    billType: 'interim' | 'final' | 'supplementary',
    userId?: string
  ): Promise<string> {
    const { data, error } = await supabase.rpc('generate_ipd_bill', {
      p_admission_id: admissionId,
      p_bill_type: billType,
      p_created_by: userId ?? null,
    });
    if (error) throw error;
    return data as string;
  },

  /** Relabel an interim bill as the FINAL bill (one final per admission — DB-enforced) */
  async markAsFinal(billId: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_bills')
      .update({ bill_type: 'final', updated_at: new Date().toISOString() })
      .eq('id', billId)
      .eq('bill_type', 'interim')
      .neq('status', 'cancelled');
    if (error) {
      if (error.message?.includes('uq_final_bill_per_admission')) {
        throw new Error('A final bill already exists for this admission.');
      }
      throw error;
    }
  },

  async listBills(admissionId: string): Promise<IpdBill[]> {
    const { data, error } = await supabase
      .from('ipd_bills')
      .select('*, lines:ipd_bill_lines(*), payments:ipd_payments(*)')
      .eq('admission_id', admissionId)
      .order('bill_datetime');
    if (error) throw error;
    return data as unknown as IpdBill[];
  },

  async recordPayment(params: {
    clinicId: string;
    billId: string;
    amount: number;
    payerKind: IpdPayment['payer_kind'];
    paymentMethod: string;
    reference?: string;
    userId?: string;
  }): Promise<IpdPayment> {
    const { data: receiptNumber, error: numErr } = await supabase.rpc('next_document_number', {
      p_clinic_id: params.clinicId,
      p_doc_type: 'ipd_receipt',
    });
    if (numErr) throw numErr;

    const { data, error } = await supabase
      .from('ipd_payments')
      .insert({
        clinic_id: params.clinicId,
        bill_id: params.billId,
        receipt_number: receiptNumber as string,
        amount: params.amount,
        payer_kind: params.payerKind,
        payment_method: params.paymentMethod,
        reference: params.reference ?? null,
        received_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as IpdPayment;
  },
};
