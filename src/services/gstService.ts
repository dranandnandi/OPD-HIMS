import { supabase } from '../lib/supabase';
import { getCurrentProfile } from './profileService';
import {
  GstOutwardSummaryRow,
  GstHsnSummaryRow,
  GstInwardRegisterRow,
  GstOutwardRegisterRow
} from '../types';

/**
 * GST filing reports. Every number comes from the gst_* SQL functions, which
 * only sum amounts stored on bill lines, inward items and debit notes — the
 * app never re-derives tax at report time, so what was printed is what is
 * filed.
 */

const toDateOnly = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

async function clinicId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');
  return profile.clinicId;
}

async function rpc<T>(fn: string, from: Date, to: Date): Promise<T[]> {
  if (!supabase) throw new Error('Supabase client not initialized');
  const { data, error } = await supabase.rpc(fn, {
    p_clinic_id: await clinicId(),
    p_from: toDateOnly(from),
    p_to: toDateOnly(to)
  });
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return (data || []) as T[];
}

const num = (v: unknown): number => Number(v) || 0;

export interface GstPeriodSummary {
  outward: {
    taxable: number; cgst: number; sgst: number; igst: number; total: number;
    creditNotes: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
  };
  inward: {
    taxable: number; cgst: number; sgst: number; igst: number; total: number;
    debitNotes: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
  };
  /** Output tax (net of credit notes) minus input tax credit (net of debit notes). */
  netPayable: { cgst: number; sgst: number; igst: number; total: number };
}

export const gstService = {
  async outwardSummary(from: Date, to: Date): Promise<GstOutwardSummaryRow[]> {
    const rows = await rpc<any>('gst_outward_summary', from, to);
    return rows.map(r => ({
      kind: r.kind,
      gstRate: num(r.gst_rate),
      invoiceCount: num(r.invoice_count),
      taxableAmount: num(r.taxable_amount),
      cgstAmount: num(r.cgst_amount),
      sgstAmount: num(r.sgst_amount),
      igstAmount: num(r.igst_amount),
      totalAmount: num(r.total_amount)
    }));
  },

  async hsnSummary(from: Date, to: Date): Promise<GstHsnSummaryRow[]> {
    const rows = await rpc<any>('gst_hsn_summary', from, to);
    return rows.map(r => ({
      hsnCode: r.hsn_code,
      gstRate: num(r.gst_rate),
      quantity: num(r.quantity),
      taxableAmount: num(r.taxable_amount),
      cgstAmount: num(r.cgst_amount),
      sgstAmount: num(r.sgst_amount),
      igstAmount: num(r.igst_amount),
      totalAmount: num(r.total_amount)
    }));
  },

  async inwardRegister(from: Date, to: Date): Promise<GstInwardRegisterRow[]> {
    const rows = await rpc<any>('gst_inward_register', from, to);
    return rows.map(r => ({
      kind: r.kind,
      documentId: r.document_id,
      documentNumber: r.document_number ?? undefined,
      documentDate: new Date(r.document_date),
      supplierName: r.supplier_name ?? undefined,
      supplierGstin: r.supplier_gstin ?? undefined,
      isInterstate: !!r.is_interstate,
      taxableAmount: num(r.taxable_amount),
      cgstAmount: num(r.cgst_amount),
      sgstAmount: num(r.sgst_amount),
      igstAmount: num(r.igst_amount),
      totalAmount: num(r.total_amount)
    }));
  },

  async outwardRegister(from: Date, to: Date): Promise<GstOutwardRegisterRow[]> {
    const rows = await rpc<any>('gst_outward_register', from, to);
    return rows.map(r => ({
      billId: r.bill_id,
      billNumber: r.bill_number,
      billDate: new Date(r.bill_date),
      patientName: r.patient_name ?? undefined,
      status: r.status,
      taxableAmount: num(r.taxable_amount),
      cgstAmount: num(r.cgst_amount),
      sgstAmount: num(r.sgst_amount),
      igstAmount: num(r.igst_amount),
      roundOff: num(r.round_off),
      totalAmount: num(r.total_amount),
      refundedAmount: num(r.refunded_amount)
    }));
  },

  /** The one-page view: output tax, input credit, net payable for the period. */
  async periodSummary(from: Date, to: Date): Promise<GstPeriodSummary> {
    const [outward, inward] = await Promise.all([
      this.outwardSummary(from, to),
      this.inwardRegister(from, to)
    ]);

    const zero = () => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });
    const add = (acc: ReturnType<typeof zero>, r: { taxableAmount: number; cgstAmount: number; sgstAmount: number; igstAmount: number; totalAmount: number }) => {
      acc.taxable += r.taxableAmount; acc.cgst += r.cgstAmount; acc.sgst += r.sgstAmount;
      acc.igst += r.igstAmount; acc.total += r.totalAmount;
      return acc;
    };

    const sales = outward.filter(r => r.kind === 'sale').reduce(add, zero());
    const credit = outward.filter(r => r.kind === 'credit_note').reduce(add, zero());
    const purchases = inward.filter(r => r.kind === 'purchase').reduce(add, zero());
    const debit = inward.filter(r => r.kind === 'debit_note').reduce(add, zero());

    // credit/debit note rows are already negative
    const outCgst = sales.cgst + credit.cgst;
    const outSgst = sales.sgst + credit.sgst;
    const outIgst = sales.igst + credit.igst;
    const inCgst = purchases.cgst + debit.cgst;
    const inSgst = purchases.sgst + debit.sgst;
    const inIgst = purchases.igst + debit.igst;

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const net = { cgst: r2(outCgst - inCgst), sgst: r2(outSgst - inSgst), igst: r2(outIgst - inIgst), total: 0 };
    net.total = r2(net.cgst + net.sgst + net.igst);

    const fix = (o: ReturnType<typeof zero>) => ({
      taxable: r2(o.taxable), cgst: r2(o.cgst), sgst: r2(o.sgst), igst: r2(o.igst), total: r2(o.total)
    });

    return {
      outward: { ...fix(sales), creditNotes: fix(credit) },
      inward: { ...fix(purchases), debitNotes: fix(debit) },
      netPayable: net
    };
  }
};
