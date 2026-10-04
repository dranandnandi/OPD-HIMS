import { supabase } from '../lib/supabase';
import { getCurrentProfile } from './profileService';

/**
 * Income break-up across OPD and IPD.
 *
 * THE REVENUE-SOURCE RULE
 * -----------------------
 * Income is read from BILL LINES and nowhere else:
 *   OPD -> bill_items (via bills)
 *   IPD -> ipd_bill_lines (via ipd_bills)
 *
 * pharmacy_dispensed_items is a STOCK record, never a revenue source. Both IPD
 * dispensing paths (eMAR administration and ward-store consumption) write a
 * dispensed row AND post a PHARM charge that becomes a bill line, so adding the
 * two together would count every IPD drug twice.
 *
 * Pharmacy is therefore a HEAD inside each module, not a module of its own.
 *
 * KNOWN GAP
 * ---------
 * OPD dispensing has no key back to the bill: the bill modal copies name,
 * quantity and price off the dispense, so medicine dispensed but never billed
 * is invisible here. OPD pharmacy income is accurate to what was billed, not to
 * what left the shelf.
 *
 * IPD ROWS THAT ARE NOT INCOME
 * ----------------------------
 * Interim bills are reprintable running statements (is_provisional) and the
 * consolidated final supersedes earlier bills (superseded_by_bill_id). Both are
 * excluded, and counted separately so the exclusion is visible rather than
 * silent.
 */

export interface IncomeHead {
  code: string;
  label: string;
}

/** The IPD charge-group tree, which OPD line types are mapped onto. */
export const INCOME_HEADS: IncomeHead[] = [
  { code: 'BED', label: 'Bed & Nursing' },
  { code: 'CONS', label: 'Consultations' },
  { code: 'INV', label: 'Investigations' },
  { code: 'PROC', label: 'Procedures' },
  { code: 'PHARM', label: 'Pharmacy & Consumables' },
  { code: 'SUPPORT', label: 'Support Services' },
  { code: 'PKG', label: 'Package (bundled)' },
  { code: 'MISC', label: 'Miscellaneous' },
];

const HEAD_LABEL: { [code: string]: string } = INCOME_HEADS.reduce(
  (acc, head) => ({ ...acc, [head.code]: head.label }),
  {}
);

/**
 * OPD bill lines carry five flat types against IPD's two-level tree, so the
 * consolidated break-up is only ever as fine as the OPD side allows: an OPD
 * investigation cannot be split into pathology and radiology the way an IPD one
 * can.
 */
const OPD_TYPE_TO_HEAD: { [itemType: string]: string } = {
  consultation: 'CONS',
  test: 'INV',
  procedure: 'PROC',
  medicine: 'PHARM',
  other: 'MISC',
};

export interface HeadRow {
  code: string;
  label: string;
  opdGross: number;
  opdDiscount: number;
  opdNet: number;
  ipdGross: number;
  ipdDiscount: number;
  ipdNet: number;
  net: number;
}

export interface DoctorRow {
  doctorId: string | null;
  doctorName: string;
  opd: number;
  ipd: number;
  total: number;
}

export interface MethodRow {
  method: string;
  amount: number;
}

export interface IncomeBreakup {
  from: Date;
  to: Date;

  /** Income earned in the period - the accrual figure. */
  billed: {
    opdGross: number;
    opdDiscount: number;
    opdNet: number;
    ipdGross: number;
    ipdDiscount: number;
    ipdNet: number;
    gross: number;
    discount: number;
    net: number;
  };

  /** Refunds raised against bills - a reduction of income, not a receipt. */
  refunds: { opd: number; ipd: number; total: number };

  /**
   * Cash that moved in the period. Deposits are advances, not income, so they
   * are kept apart from bill receipts rather than folded into one total.
   */
  received: {
    opdBillPayments: number;
    ipdBillPayments: number;
    ipdDeposits: number;
    refundsPaidOut: number;
    net: number;
    byMethod: MethodRow[];
  };

  /** Open balances as at now - a position, not a flow for the period. */
  outstanding: { opd: number; ipd: number; total: number };

  heads: HeadRow[];
  doctors: DoctorRow[];

  /** IPD only: OPD has no payer concept, so every OPD rupee is self-pay. */
  payerSplit: { payerExpected: number; patientPayable: number };

  /** IPD bills deliberately left out of the figures above. */
  excluded: { provisional: number; superseded: number; cancelled: number };

  billCount: { opd: number; ipd: number };
}

/** [start of `from`, start of the day after `to`) in clinic-local time. */
const rangeBounds = (from: Date, to: Date): { fromISO: string; toISO: string } => {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  return { fromISO: start.toISOString(), toISO: end.toISOString() };
};

const num = (value: unknown): number => Number(value) || 0;

/** Embedded to-one relations come back as an object, or an array when
 *  PostgREST cannot prove the relationship is to-one. Accept either. */
const one = (embedded: any): any => (Array.isArray(embedded) ? embedded[0] : embedded);

/** 'INV/INV-PATH' -> 'INV'. Package lines carry no group. */
const topHead = (path: string | null, lineType: string | null): string => {
  if (lineType === 'package') return 'PKG';
  const top = String(path || '').split('/')[0];
  return top && HEAD_LABEL[top] ? top : 'MISC';
};

interface HeadAccumulator {
  opdGross: number;
  opdDiscount: number;
  opdNet: number;
  ipdGross: number;
  ipdDiscount: number;
  ipdNet: number;
}

const emptyHead = (): HeadAccumulator => ({
  opdGross: 0,
  opdDiscount: 0,
  opdNet: 0,
  ipdGross: 0,
  ipdDiscount: 0,
  ipdNet: 0,
});

export const incomeService = {
  async getIncomeBreakup(from: Date, to: Date): Promise<IncomeBreakup> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const clinicId = profile.clinicId;
    const { fromISO, toISO } = rangeBounds(from, to);
    const db = supabase as any;

    const ipdBillFilter = (query: any) =>
      query
        .eq('clinic_id', clinicId)
        .eq('is_provisional', false)
        .is('superseded_by_bill_id', null)
        .neq('status', 'cancelled');

    const [
      opdResult,
      ipdResult,
      opdReceiptResult,
      ipdPaymentResult,
      ipdDepositResult,
      opdOutstandingResult,
      ipdOutstandingResult,
      provisionalResult,
      supersededResult,
      cancelledResult,
    ] = await Promise.all([
      db
        .from('bills')
        .select(`
          id, bill_date, total_amount, total_refunded_amount,
          visits ( doctor_id ),
          bill_items ( item_type, quantity, unit_price, total_price )
        `)
        .eq('clinic_id', clinicId)
        .gte('bill_date', fromISO)
        .lt('bill_date', toISO),

      ipdBillFilter(
        db.from('ipd_bills').select(`
          id, bill_datetime, net_total, gross_total, discount_total,
          payer_expected, patient_payable,
          ipd_bill_lines ( net, gross, discount, charge_group_path, line_type, performing_doctor_id )
        `)
      )
        .gte('bill_datetime', fromISO)
        .lt('bill_datetime', toISO),

      db
        .from('payment_records')
        .select('amount, payment_method, record_type')
        .eq('clinic_id', clinicId)
        .gte('payment_date', fromISO)
        .lt('payment_date', toISO),

      db
        .from('ipd_payments')
        .select('amount, payment_method, record_type')
        .eq('clinic_id', clinicId)
        .gte('received_at', fromISO)
        .lt('received_at', toISO),

      db
        .from('ipd_deposits')
        .select('amount, payment_method, entry_type')
        .eq('clinic_id', clinicId)
        .in('entry_type', ['deposit', 'refund'])
        .gte('received_at', fromISO)
        .lt('received_at', toISO),

      db
        .from('bills')
        .select('balance_amount')
        .eq('clinic_id', clinicId)
        .gt('balance_amount', 0),

      ipdBillFilter(db.from('ipd_bills').select('balance_amount')).gt('balance_amount', 0),

      db
        .from('ipd_bills')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('is_provisional', true)
        .gte('bill_datetime', fromISO)
        .lt('bill_datetime', toISO),

      db
        .from('ipd_bills')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .not('superseded_by_bill_id', 'is', null)
        .gte('bill_datetime', fromISO)
        .lt('bill_datetime', toISO),

      db
        .from('ipd_bills')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('status', 'cancelled')
        .gte('bill_datetime', fromISO)
        .lt('bill_datetime', toISO),
    ]);

    for (const result of [opdResult, ipdResult, opdReceiptResult, ipdPaymentResult, ipdDepositResult]) {
      if (result.error) throw new Error(`Income break-up query failed: ${result.error.message}`);
    }

    const heads = new Map<string, HeadAccumulator>();
    const headOf = (code: string): HeadAccumulator => {
      const existing = heads.get(code);
      if (existing) return existing;
      const created = emptyHead();
      heads.set(code, created);
      return created;
    };

    const doctors = new Map<string, { opd: number; ipd: number }>();
    const doctorOf = (id: string): { opd: number; ipd: number } => {
      const existing = doctors.get(id);
      if (existing) return existing;
      const created = { opd: 0, ipd: 0 };
      doctors.set(id, created);
      return created;
    };

    // ---- OPD billed ---------------------------------------------------------
    // bill_items.discount is a PERCENT and total_price is already net of it, so
    // the discount amount is recovered as gross - net rather than read directly.
    let opdGross = 0;
    let opdDiscount = 0;
    let opdNet = 0;
    let opdRefunds = 0;

    const opdBills = (opdResult.data as any[]) || [];
    for (const bill of opdBills) {
      opdRefunds += num(bill.total_refunded_amount);
      const doctorId = one(bill.visits)?.doctor_id || null;

      for (const item of bill.bill_items || []) {
        const net = num(item.total_price);
        const gross = num(item.quantity) * num(item.unit_price);
        const discount = Math.max(0, gross - net);
        const code = OPD_TYPE_TO_HEAD[String(item.item_type || 'other')] || 'MISC';

        const head = headOf(code);
        head.opdGross += gross;
        head.opdDiscount += discount;
        head.opdNet += net;

        opdGross += gross;
        opdDiscount += discount;
        opdNet += net;

        if (doctorId) doctorOf(doctorId).opd += net;
      }
    }

    // ---- IPD billed ---------------------------------------------------------
    let ipdGross = 0;
    let ipdDiscount = 0;
    let ipdNet = 0;
    let payerExpected = 0;
    let patientPayable = 0;

    const ipdBills = (ipdResult.data as any[]) || [];
    for (const bill of ipdBills) {
      payerExpected += num(bill.payer_expected);
      patientPayable += num(bill.patient_payable);

      for (const line of bill.ipd_bill_lines || []) {
        const net = num(line.net);
        const gross = num(line.gross);
        const discount = num(line.discount);
        const code = topHead(line.charge_group_path, line.line_type);

        const head = headOf(code);
        head.ipdGross += gross;
        head.ipdDiscount += discount;
        head.ipdNet += net;

        ipdGross += gross;
        ipdDiscount += discount;
        ipdNet += net;

        if (line.performing_doctor_id) doctorOf(line.performing_doctor_id).ipd += net;
      }
    }

    // ---- doctor names -------------------------------------------------------
    const doctorIds = Array.from(doctors.keys());
    const doctorNames = new Map<string, string>();
    if (doctorIds.length > 0) {
      const { data: profiles } = await db
        .from('profiles')
        .select('id, name')
        .in('id', doctorIds);
      for (const row of (profiles as any[]) || []) {
        doctorNames.set(row.id, row.name);
      }
    }

    // ---- receipts -----------------------------------------------------------
    const byMethod = new Map<string, number>();
    const addMethod = (method: string, amount: number) => {
      const key = String(method || 'unknown');
      byMethod.set(key, (byMethod.get(key) || 0) + amount);
    };

    let opdBillPayments = 0;
    let ipdBillPayments = 0;
    let ipdDeposits = 0;
    let refundsPaidOut = 0;

    for (const row of (opdReceiptResult.data as any[]) || []) {
      const isRefund = row.record_type === 'refund';
      const amount = isRefund ? -num(row.amount) : num(row.amount);
      if (isRefund) refundsPaidOut += amount;
      else opdBillPayments += amount;
      addMethod(row.payment_method, amount);
    }

    for (const row of (ipdPaymentResult.data as any[]) || []) {
      const isRefund = row.record_type === 'refund';
      const amount = isRefund ? -num(row.amount) : num(row.amount);
      if (isRefund) refundsPaidOut += amount;
      else ipdBillPayments += amount;
      addMethod(row.payment_method, amount);
    }

    for (const row of (ipdDepositResult.data as any[]) || []) {
      const isRefund = row.entry_type === 'refund';
      const amount = isRefund ? -num(row.amount) : num(row.amount);
      if (isRefund) refundsPaidOut += amount;
      else ipdDeposits += amount;
      addMethod(row.payment_method, amount);
    }

    const opdOutstanding = ((opdOutstandingResult.data as any[]) || [])
      .reduce((sum, bill) => sum + num(bill.balance_amount), 0);
    const ipdOutstanding = ((ipdOutstandingResult.data as any[]) || [])
      .reduce((sum, bill) => sum + num(bill.balance_amount), 0);

    const headRows: HeadRow[] = INCOME_HEADS
      .map((head) => {
        const totals = heads.get(head.code) || emptyHead();
        return {
          code: head.code,
          label: head.label,
          ...totals,
          net: totals.opdNet + totals.ipdNet,
        };
      })
      .filter((row) => row.opdGross !== 0 || row.ipdGross !== 0);

    const doctorRows: DoctorRow[] = Array.from(doctors.entries())
      .map(([doctorId, totals]) => ({
        doctorId,
        doctorName: doctorNames.get(doctorId) || 'Unattributed',
        opd: totals.opd,
        ipd: totals.ipd,
        total: totals.opd + totals.ipd,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      from,
      to,
      billed: {
        opdGross,
        opdDiscount,
        opdNet,
        ipdGross,
        ipdDiscount,
        ipdNet,
        gross: opdGross + ipdGross,
        discount: opdDiscount + ipdDiscount,
        net: opdNet + ipdNet,
      },
      refunds: { opd: opdRefunds, ipd: 0, total: opdRefunds },
      received: {
        opdBillPayments,
        ipdBillPayments,
        ipdDeposits,
        refundsPaidOut,
        net: opdBillPayments + ipdBillPayments + ipdDeposits + refundsPaidOut,
        byMethod: Array.from(byMethod.entries())
          .map(([method, amount]) => ({ method, amount }))
          .sort((a, b) => b.amount - a.amount),
      },
      outstanding: {
        opd: opdOutstanding,
        ipd: ipdOutstanding,
        total: opdOutstanding + ipdOutstanding,
      },
      heads: headRows,
      doctors: doctorRows,
      payerSplit: { payerExpected, patientPayable },
      excluded: {
        provisional: provisionalResult.count || 0,
        superseded: supersededResult.count || 0,
        cancelled: cancelledResult.count || 0,
      },
      billCount: { opd: opdBills.length, ipd: ipdBills.length },
    };
  },
};
