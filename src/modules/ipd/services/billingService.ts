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

export const billingService = {
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
      .select('*, lines:ipd_bill_lines(*)')
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
