import { supabase } from '../utils/supabase';
import type { Deposit, IpdBill, IpdPayment } from '../types/ipd';
import { chargeService } from './chargeService';

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

export interface NoteAuditFinding {
  id?: string;
  source_table: 'ipd_treatment_plans' | 'ipd_nursing_notes';
  source_id: string;
  source_date: string;
  source_excerpt: string;
  service_id: string;
  service_name: string;
  documented_quantity: number;
  charged_quantity: number;
  status?: string;
}

export interface NoteAuditRun {
  id: string; run_type: 'manual' | 'discharge'; status: string;
  findings_count: number; created_at: string; completed_at: string | null;
  findings?: NoteAuditFinding[];
}

export const billingService = {
  /** User-driven (max twice/day, DB enforced) or mandatory discharge note audit. */
  async runNoteAudit(params: {
    clinicId: string; admissionId: string; runType: 'manual' | 'discharge'; userId?: string;
  }): Promise<NoteAuditRun> {
    const { data: runId, error: beginError } = await supabase.rpc('begin_ipd_billing_audit', {
      p_admission_id: params.admissionId, p_run_type: params.runType, p_created_by: params.userId ?? null,
    });
    if (beginError) throw beginError;
    try {
      const [{ data: plans, error: planErr }, { data: notes, error: noteErr }, { data: postings, error: postingErr }] = await Promise.all([
        supabase.from('ipd_treatment_plans')
          .select('id,plan_date,subjective,objective,assessment,plan,advice,voice_transcript')
          .eq('admission_id', params.admissionId).eq('status', 'active'),
        supabase.from('ipd_nursing_notes').select('id,note,created_at,note_type')
          .eq('admission_id', params.admissionId),
        supabase.from('charge_postings').select('service_id,service_date,quantity,status')
          .eq('admission_id', params.admissionId).neq('status', 'cancelled'),
      ]);
      if (planErr) throw planErr; if (noteErr) throw noteErr; if (postingErr) throw postingErr;

      const sources = [
        ...(plans ?? []).map((p: any) => ({
          source_table: 'ipd_treatment_plans' as const, source_id: p.id, source_date: p.plan_date,
          // The transcript and structured fields describe the same round. Prefer the
          // transcript to avoid counting one dictated activity twice.
          text: p.voice_transcript || [p.subjective,p.objective,p.assessment,p.plan,p.advice].filter(Boolean).join('\n'),
          note_type: 'doctor_daily_note',
        })),
        ...(notes ?? []).map((n: any) => ({
          source_table: 'ipd_nursing_notes' as const, source_id: n.id,
          source_date: String(n.created_at).slice(0,10), text: n.note,
          note_type: n.note_type,
        })),
      ].filter((s) => s.text?.trim());

      const findings: NoteAuditFinding[] = [];
      for (const source of sources) {
        const captured = await chargeService.auditClinicalNote(params.clinicId, source.text, source.note_type);
        for (const match of captured.matches) {
          const charged = (postings ?? [])
            .filter((p: any) => p.service_id === match.service.id && p.service_date === source.source_date)
            .reduce((sum: number, p: any) => sum + Number(p.quantity), 0);
          if (charged < match.quantity) findings.push({
            source_table: source.source_table, source_id: source.source_id, source_date: source.source_date,
            source_excerpt: (match.phrase || source.text).slice(0, 300), service_id: match.service.id,
            service_name: match.service.name, documented_quantity: match.quantity, charged_quantity: charged,
          });
        }
      }
      const { error: completeError } = await supabase.rpc('complete_ipd_billing_audit', {
        p_run_id: runId, p_findings: findings,
      });
      if (completeError) throw completeError;
      const { data: saved, error: savedError } = await supabase.from('ipd_billing_audit_runs')
        .select('*, findings:ipd_billing_audit_findings(*)').eq('id', runId).single();
      if (savedError) throw savedError;
      return saved as unknown as NoteAuditRun;
    } catch (e) {
      await supabase.rpc('fail_ipd_billing_audit', { p_run_id: runId, p_error: (e as Error).message });
      throw e;
    }
  },

  async listNoteAudits(admissionId: string): Promise<NoteAuditRun[]> {
    const { data, error } = await supabase.from('ipd_billing_audit_runs')
      .select('*, findings:ipd_billing_audit_findings(*)').eq('admission_id', admissionId)
      .order('created_at', { ascending: false }).limit(10);
    if (error) throw error;
    return data as unknown as NoteAuditRun[];
  },

  async resolveNoteFinding(findingId: string, status: string, reason: string | null, userId?: string): Promise<void> {
    const { error } = await supabase.rpc('resolve_ipd_billing_audit_finding', {
      p_finding_id: findingId, p_status: status, p_reason: reason, p_user_id: userId ?? null,
    });
    if (error) throw error;
  },
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
        .select('service_date, service:services_master!inner(service_type)')
        .eq('admission_id', admissionId)
        .eq('source', 'room_rent_job')
        .eq('service.service_type', 'bed')
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
      roomRentPostings: new Set((roomRes.data ?? []).map((r: any) => r.service_date)).size,
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
      // provisional statements and superseded bills carry no money
      supabase
        .from('ipd_bills')
        .select('admission_id, balance_amount, status')
        .in('admission_id', ids)
        .eq('is_provisional', false)
        .not('status', 'in', '(cancelled,superseded)'),
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

  /**
   * Build a bill via the DB function.
   *  - 'interim'       provisional running statement. Prints everything
   *                    charged so far and consumes nothing — charges stay
   *                    unbilled, packages unclaimed, no money owed against it.
   *  - 'final'         the one consolidated bill for the whole episode. Sweeps
   *                    every non-cancelled charge and every package, and
   *                    supersedes earlier bills, carrying their receipts and
   *                    applied deposits onto itself.
   *  - 'supplementary' pending-only, for charges that land after the final.
   */
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
    if (error) {
      if (error.message?.includes('uq_final_bill_per_admission')) {
        throw new Error('A final bill already exists for this admission.');
      }
      throw error;
    }
    return data as string;
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
