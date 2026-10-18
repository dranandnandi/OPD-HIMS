/**
 * GST arithmetic shared by pharmacy dispensing, purchase entry, debit notes
 * and the invoice templates. Everything is rounded to paise at the line level
 * so the stored numbers add up to what is printed.
 *
 * Indian retail pharmacy convention: the selling price is the MRP, which is
 * GST-inclusive, so tax is backed out of it. Purchase invoices from
 * distributors quote GST-exclusive rates, so tax is added on top.
 */

export interface GstLineInput {
  quantity: number;
  /** Rate per unit as entered (MRP / selling price, or purchase rate). */
  unitPrice: number;
  /** Line discount as a percentage of the gross value. */
  discountPercent?: number;
  /** Flat line discount in rupees, applied after the percentage discount. */
  discountAmount?: number;
  gstRate: number;
  /** True when unitPrice already includes GST (MRP-based retail sale). */
  priceIncludesGst: boolean;
  /** True for a supply across state lines: IGST instead of CGST + SGST. */
  interstate?: boolean;
}

export interface GstLineResult {
  /** quantity x unitPrice, before discount */
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** taxable + all tax */
  total: number;
}

export const GST_RATES = [0, 5, 12, 18, 28] as const;

/** Round to 2 decimals without the usual floating-point drift. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeGstLine(input: GstLineInput): GstLineResult {
  const qty = Math.max(0, Number(input.quantity) || 0);
  const unit = Math.max(0, Number(input.unitPrice) || 0);
  const rate = Math.max(0, Number(input.gstRate) || 0);
  const discPct = Math.min(100, Math.max(0, Number(input.discountPercent) || 0));
  const discAmt = Math.max(0, Number(input.discountAmount) || 0);

  const gross = round2(qty * unit);
  const discount = round2(Math.min(gross, gross * (discPct / 100) + discAmt));
  const net = round2(gross - discount);

  let taxable: number;
  let tax: number;
  if (input.priceIncludesGst) {
    taxable = round2(net / (1 + rate / 100));
    tax = round2(net - taxable);
  } else {
    taxable = net;
    tax = round2(net * (rate / 100));
  }

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (input.interstate) {
    igst = tax;
  } else {
    cgst = round2(tax / 2);
    sgst = round2(tax - cgst);
  }

  return { gross, discount, taxable, cgst, sgst, igst, total: round2(taxable + cgst + sgst + igst) };
}

export interface GstTotals {
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Sum of line totals before rounding */
  subtotal: number;
  /** Difference applied to reach a whole-rupee grand total */
  roundOff: number;
  grandTotal: number;
}

/** Sum lines and round the invoice to the nearest rupee (the usual Indian practice). */
export function sumGstLines(lines: GstLineResult[], roundToRupee = true): GstTotals {
  const acc = lines.reduce(
    (a, l) => ({
      gross: a.gross + l.gross,
      discount: a.discount + l.discount,
      taxable: a.taxable + l.taxable,
      cgst: a.cgst + l.cgst,
      sgst: a.sgst + l.sgst,
      igst: a.igst + l.igst,
      subtotal: a.subtotal + l.total
    }),
    { gross: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, subtotal: 0 }
  );
  const subtotal = round2(acc.subtotal);
  const grandTotal = roundToRupee ? Math.round(subtotal) : subtotal;
  return {
    gross: round2(acc.gross),
    discount: round2(acc.discount),
    taxable: round2(acc.taxable),
    cgst: round2(acc.cgst),
    sgst: round2(acc.sgst),
    igst: round2(acc.igst),
    subtotal,
    roundOff: round2(grandTotal - subtotal),
    grandTotal
  };
}

export interface RateBucket {
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/** Group lines by rate for the tax summary table on an invoice. */
export function groupByRate(lines: Array<GstLineResult & { gstRate: number }>): RateBucket[] {
  const map = new Map<number, RateBucket>();
  for (const l of lines) {
    const b = map.get(l.gstRate) || { gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    b.taxable = round2(b.taxable + l.taxable);
    b.cgst = round2(b.cgst + l.cgst);
    b.sgst = round2(b.sgst + l.sgst);
    b.igst = round2(b.igst + l.igst);
    b.total = round2(b.total + l.total);
    map.set(l.gstRate, b);
  }
  return [...map.values()].sort((a, b) => a.gstRate - b.gstRate);
}

/** Indian financial year label: Apr 2026 - Mar 2027 -> '26-27'. */
export function indianFyLabel(d: Date = new Date()): string {
  const y = d.getFullYear() % 100;
  const m = d.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  const pad = (n: number) => String((n + 100) % 100).padStart(2, '0');
  return `${pad(start)}-${pad(start + 1)}`;
}

/** First two digits of a GSTIN are the state code. */
export function stateCodeFromGstin(gstin?: string | null): string | undefined {
  const g = (gstin || '').trim();
  return /^\d{2}/.test(g) ? g.slice(0, 2) : undefined;
}

/** Basic GSTIN shape check: 15 chars, state code + PAN + entity + Z + check. */
export function isValidGstin(gstin?: string | null): boolean {
  if (!gstin) return false;
  return /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.trim().toUpperCase());
}

/** Whether a supply between the clinic and a party is inter-state. */
export function isInterstate(clinicStateCode?: string | null, partyStateCode?: string | null): boolean {
  if (!clinicStateCode || !partyStateCode) return false;
  return clinicStateCode.trim() !== partyStateCode.trim();
}

export const INDIAN_STATE_CODES: Array<{ code: string; name: string }> = [
  { code: '01', name: 'Jammu & Kashmir' }, { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' }, { code: '04', name: 'Chandigarh' }, { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' }, { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' }, { code: '10', name: 'Bihar' }, { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' }, { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' }, { code: '16', name: 'Tripura' }, { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' }, { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' }, { code: '22', name: 'Chhattisgarh' }, { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' }, { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' }, { code: '29', name: 'Karnataka' }, { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' }, { code: '32', name: 'Kerala' }, { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' }, { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' }, { code: '37', name: 'Andhra Pradesh' }, { code: '38', name: 'Ladakh' },
];

/** Build a CSV string from rows; values are quoted when needed. */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const inr = (n: number | null | undefined): string =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
