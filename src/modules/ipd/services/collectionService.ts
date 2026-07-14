import { supabase } from '../utils/supabase';

/** One money movement over the counter — deposit, bill payment, or refund */
export interface CollectionEntry {
  id: string;
  source: 'deposit' | 'bill_payment';
  isRefund: boolean;
  receiptNumber: string;
  /** signed: refunds are negative */
  amount: number;
  method: string;
  userId: string | null;
  userName: string;
  receivedAt: string;
  patientName: string;
  admissionNumber: string;
}

export const PAYMENT_METHODS = ['cash', 'card', 'upi', 'cheque', 'net_banking', 'wallet', 'neft'];

export const collectionService = {
  /**
   * All counter collections in [from, to): advance deposits + bill payments,
   * refunds signed negative. 'applied_to_bill' deposit entries are internal
   * transfers (no money changes hands) and are excluded.
   */
  async getCollections(clinicId: string, fromISO: string, toISO: string): Promise<CollectionEntry[]> {
    const [deposits, payments] = await Promise.all([
      supabase
        .from('ipd_deposits')
        .select(`
          id, receipt_number, amount, entry_type, payment_method, received_by, received_at,
          receiver:profiles(id, name),
          admission:ipd_admissions(admission_number, patient:patients(name))
        `)
        .eq('clinic_id', clinicId)
        .in('entry_type', ['deposit', 'refund'])
        .gte('received_at', fromISO)
        .lt('received_at', toISO)
        .order('received_at'),
      supabase
        .from('ipd_payments')
        .select(`
          id, receipt_number, amount, record_type, payment_method, received_by, received_at,
          receiver:profiles(id, name),
          bill:ipd_bills(bill_number, admission:ipd_admissions(admission_number, patient:patients(name)))
        `)
        .eq('clinic_id', clinicId)
        .gte('received_at', fromISO)
        .lt('received_at', toISO)
        .order('received_at'),
    ]);
    if (deposits.error) throw deposits.error;
    if (payments.error) throw payments.error;

    const entries: CollectionEntry[] = [];

    for (const d of deposits.data as any[]) {
      const isRefund = d.entry_type === 'refund';
      entries.push({
        id: d.id,
        source: 'deposit',
        isRefund,
        receiptNumber: d.receipt_number,
        amount: isRefund ? -Number(d.amount) : Number(d.amount),
        method: d.payment_method ?? 'cash',
        userId: d.receiver?.id ?? null,
        userName: d.receiver?.name ?? 'Unassigned',
        receivedAt: d.received_at,
        patientName: d.admission?.patient?.name ?? '—',
        admissionNumber: d.admission?.admission_number ?? '—',
      });
    }

    for (const p of payments.data as any[]) {
      const isRefund = p.record_type === 'refund';
      entries.push({
        id: p.id,
        source: 'bill_payment',
        isRefund,
        receiptNumber: p.receipt_number,
        amount: isRefund ? -Number(p.amount) : Number(p.amount),
        method: p.payment_method ?? 'cash',
        userId: p.receiver?.id ?? null,
        userName: p.receiver?.name ?? 'Unassigned',
        receivedAt: p.received_at,
        patientName: p.bill?.admission?.patient?.name ?? '—',
        admissionNumber: p.bill?.admission?.admission_number ?? '—',
      });
    }

    return entries.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  },
};
