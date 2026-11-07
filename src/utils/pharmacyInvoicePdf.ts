import { jsPDF } from 'jspdf';
import type { Bill, BillItem, ClinicSetting, Patient } from '../types';

export interface InvoiceImage { data: string; width: number; height: number }
export interface PharmacyInvoiceDocument {
  bill: Bill; patient: Patient; clinic: ClinicSetting;
  images?: { logo?: InvoiceImage; header?: InvoiceImage; footer?: InvoiceImage; letterhead?: InvoiceImage };
}
export const PHARMACY_PDF_VERSION = 'local-pharmacy-v2-percentages';
const money = (value?: number) => Number(value || 0).toFixed(2);
const percent = (value: number) => `${Number(value)}%`;
function discountPercentage(item: BillItem): string | null {
  const saved = item.saleDiscountPercent;
  if (saved != null && Number.isFinite(saved) && saved >= 0 && saved <= 100) return percent(saved);
  const gross = Math.round(Number(item.billedQuantity ?? item.quantity) * Number(item.unitPrice) * 100) / 100;
  if (!Number(item.discount)) return '0%';
  if (!(gross > 0)) return null;
  return `~${percent(Number((Number(item.discount) / gross * 100).toFixed(1)))}`;
}
const date = (value?: Date | string) => value && !Number.isNaN(new Date(value).getTime())
  ? new Date(value).toLocaleDateString('en-IN') : '-';

/** Content identity excludes URL/cache timestamps; edits invalidate the saved PDF. */
export function pharmacyInvoiceContentKey({ bill, patient, clinic }: PharmacyInvoiceDocument): string {
  return JSON.stringify({ version: PHARMACY_PDF_VERSION,
    bill: { id: bill.id, number: bill.billNumber, date: bill.billDate, status: bill.paymentStatus,
      total: bill.totalAmount, paid: bill.paidAmount, balance: bill.balanceAmount,
      refunded: bill.totalRefundedAmount, discount: bill.discountAmount, roundOff: bill.roundOff,
      taxable: bill.taxableAmount, cgst: bill.cgstAmount, sgst: bill.sgstAmount, igst: bill.igstAmount,
      method: bill.paymentMethod, notes: bill.notes, items: bill.billItems },
    patient: { name: patient.name, number: patient.patientNumber || patient.patient_number,
      phone: patient.phone, address: patient.address },
    clinic: { name: clinic.clinicName, address: clinic.address, phone: clinic.phone,
      email: clinic.email, gstin: clinic.gstin, license: clinic.drugLicenseNumber,
      scheme: clinic.pharmacyGstScheme, logo: clinic.logoUrl, header: clinic.pdfHeaderUrl,
      footer: clinic.pdfFooterUrl, letterhead: clinic.pdfLetterheadUrl, mode: clinic.pdfLetterheadMode,
      spacing: clinic.pdfLetterheadSpacing, paper: clinic.invoicePaperSize, margins: clinic.invoiceMargins },
  });
}

/** Local vector PDF. Only non-Latin text uses a canvas, preserving browser font shaping. */
export function createPharmacyInvoicePdf(input: PharmacyInvoiceDocument): jsPDF {
  const { bill, patient, clinic, images = {} } = input;
  if (bill.billType !== 'pharmacy') throw new Error('Only pharmacy invoices use this template.');
  const a5 = clinic.invoicePaperSize === 'A5';
  const pdf = new jsPDF({ unit: 'mm', format: a5 ? 'a5' : 'a4', compress: true });
  pdf.setProperties({ title: `Pharmacy invoice ${bill.billNumber}`, author: clinic.clinicName });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const spacing = clinic.pdfLetterheadSpacing;
  const defaultMargin = a5 ? 9 : 12;
  const margin = images.letterhead ? Math.max(defaultMargin, Number(spacing?.left || 0) * 0.264583) : defaultMargin;
  const right = images.letterhead ? Math.max(defaultMargin, Number(spacing?.right || 0) * 0.264583) : defaultMargin;
  const width = W - margin - right;
  if (width < 80) throw new Error('Letterhead side spacing leaves too little space for the invoice.');
  const font = a5 ? 7 : 8.5, lineHeight = a5 ? 3.2 : 4;
  const composition = clinic.pharmacyGstScheme === 'composition';
  const title = composition ? 'BILL OF SUPPLY' : 'PHARMACY TAX INVOICE';
  const top = images.letterhead ? Math.max(margin, Number(spacing?.top || 130) * 0.264583) : margin;
  const bottom = images.letterhead ? Math.max(14, Number(spacing?.bottom || 130) * 0.264583) : images.footer ? 26 : 14;
  const limit = H - bottom;
  let y = top;

  function text(value: string, x: number, at: number, size = font, bold = false) {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(30, 41, 59);
    if (/[^\x20-\x7e]/.test(value) && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Text rendering is unavailable.');
      const px = size * 4;
      ctx.font = `${bold ? 'bold ' : ''}${px}px Arial, sans-serif`;
      canvas.width = Math.ceil(ctx.measureText(value).width + 8); canvas.height = Math.ceil(px * 1.6);
      ctx.font = `${bold ? 'bold ' : ''}${px}px Arial, sans-serif`;
      ctx.fillStyle = '#1e293b'; ctx.textBaseline = 'alphabetic'; ctx.fillText(value, 2, px * 1.15);
      const scale = 0.352778 / 4;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, at - px * 1.15 * scale,
        canvas.width * scale, canvas.height * scale);
    } else {
      pdf.text(value, x, at);
    }
  }
  function wrap(value: unknown, maxWidth: number, size = font): string[] {
    const content = String(value ?? '').replace(/\r/g, '');
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(size);
    // Width for shaped Indian-language strings must come from the browser font.
    if (/[^\x20-\x7e\n]/.test(content) && typeof document !== 'undefined') {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${size * 4}px Arial, sans-serif`;
      const result: string[] = [];
      for (const paragraph of content.split('\n')) {
        let line = '';
        for (const ch of Array.from(paragraph)) {
          if (line && ctx.measureText(line + ch).width * 0.352778 / 4 > maxWidth) { result.push(line); line = ''; }
          line += ch;
        }
        result.push(line);
      }
      return result;
    }
    return pdf.splitTextToSize(content || ' ', maxWidth) as string[];
  }
  function image(asset: InvoiceImage, x: number, at: number, maxW: number, maxH: number) {
    const scale = Math.min(maxW / asset.width, maxH / asset.height);
    pdf.addImage(asset.data, 'PNG', x, at, asset.width * scale, asset.height * scale);
  }
  function page() {
    if (images.letterhead) pdf.addImage(images.letterhead.data, 'PNG', 0, 0, W, H);
    y = top;
    if (images.header && !images.letterhead) { image(images.header, margin, y, width, a5 ? 20 : 26); y += a5 ? 23 : 29; }
    if (images.logo && !images.header && !images.letterhead) image(images.logo, margin, y, 16, 16);
    const offset = images.logo && !images.header && !images.letterhead ? 20 : 0;
    for (const line of wrap(clinic.clinicName, width - offset, a5 ? 12 : 16)) { text(line, margin + offset, y + 5, a5 ? 12 : 16, true); y += 6; }
    for (const line of wrap([clinic.address, `Phone: ${clinic.phone || '-'}`].filter(Boolean).join(' | '), width - offset)) {
      text(line, margin + offset, y + 4); y += lineHeight;
    }
    y += 4;
    for (const line of wrap(`GSTIN: ${clinic.gstin || 'Not registered'} | Drug licence: ${clinic.drugLicenseNumber || '-'}`, width)) {
      text(line, margin, y + 3, font - 0.5); y += lineHeight;
    }
    y += 3; pdf.setDrawColor(37, 99, 235); pdf.line(margin, y, W - right, y); y += 6;
    text(title, margin, y, font + 2, true); y += 5;
    for (const line of wrap(`${bill.billNumber} | ${date(bill.billDate)} | ${bill.paymentStatus.toUpperCase()}`, width)) {
      text(line, margin, y, font, true); y += lineHeight;
    }
    for (const line of wrap(`Customer: ${patient.name} | ${patient.phone || '-'}${patient.patientNumber || patient.patient_number ? ` | ID: ${patient.patientNumber || patient.patient_number}` : ''}`, width)) {
      text(line, margin, y); y += lineHeight;
    }
    y += 4;
    if (y > limit - 35) throw new Error('Letterhead leaves too little space for the invoice. Reduce its top/bottom spacing.');
  }
  function nextPage() { pdf.addPage(); page(); }
  function ensure(height: number) { if (y + height > limit) nextPage(); }
  const weights = [5, 30, 14, 10, 11, 10, 10, 12];
  const widths = weights.map(n => width * n / weights.reduce((a, b) => a + b));
  const labels = ['#', 'Medicine / HSN', 'Batch / Exp.', 'Qty / Unit', 'Pack MRP', 'Rate', composition ? 'Taxable' : 'GST % / Tax', 'Total'];
  function tableHead() {
    pdf.setFillColor(239, 246, 255); pdf.rect(margin, y, width, 10, 'F');
    let x = margin;
    labels.forEach((label, i) => { wrap(label, widths[i] - 3, font - 1).forEach((l, j) => text(l, x + 1.5, y + 4 + j * 3, font - 1, true)); x += widths[i]; });
    y += 10;
  }
  page(); tableHead();
  bill.billItems.forEach((item, index) => {
    const qty = item.billedQuantity ?? item.quantity;
    const tax = Number(item.cgstAmount || 0) + Number(item.sgstAmount || 0) + Number(item.igstAmount || 0);
    const discountRate = discountPercentage(item);
    const discountText = Number(item.discount) || Number(item.saleDiscountPercent)
      ? `\nSale discount${discountRate ? ` ${discountRate}` : ''}: ${money(item.discount)}` : '';
    const cells = [String(index + 1),
      `${item.itemName}\nHSN: ${item.hsnCode || '-'}${discountText}\nTaxable: ${money(item.taxableAmount)}`,
      `${item.batchNumber || '-'}\n${item.expiryDate ? new Date(item.expiryDate).toLocaleDateString('en-IN', { month: '2-digit', year: '2-digit' }) : '-'}`,
      `${Number(qty)}\n${item.billedUnit || 'Pack'}`,
      `${money(item.mrp ?? item.unitPrice)}\n${Number(item.packSize || 1)} units`,
      money(item.unitPrice), composition ? money(item.taxableAmount) : `${Number(item.gstRate || 0)}%\n${money(tax)}`, money(item.totalPrice)];
    const lines = cells.map((cell, i) => wrap(cell, widths[i] - 3, font - 0.5));
    let remaining = Math.max(...lines.map(l => l.length)), offset = 0;
    const rowHeight = remaining * lineHeight + 4;
    if (y + rowHeight > limit && rowHeight < limit - top - 80) { nextPage(); tableHead(); }
    while (remaining > 0) {
      if (limit - y < lineHeight + 4) { nextPage(); tableHead(); }
      const count = Math.min(remaining, Math.max(1, Math.floor((limit - y - 4) / lineHeight)));
      const height = count * lineHeight + 4;
      let x = margin;
      lines.forEach((cell, i) => {
        pdf.setDrawColor(210, 218, 230); pdf.rect(x, y, widths[i], height);
        cell.slice(offset, offset + count).forEach((l, j) => text(l, x + 1.5, y + 4 + j * lineHeight, font - 0.5));
        x += widths[i];
      });
      y += height; remaining -= count; offset += count;
    }
  });
  y += 7;
  const discountRates = [...new Set(bill.billItems.map(discountPercentage))];
  const discountLabel = discountRates.length === 1 && discountRates[0] && discountRates[0] !== '0%'
    ? `Sale discount ${discountRates[0]} (already applied)` : 'Sale discount (see items; already applied)';
  function taxLabel(kind: 'CGST' | 'SGST' | 'IGST') {
    const applicable = bill.billItems.filter(i => kind === 'IGST' ? Number(i.igstAmount) > 0 : !(Number(i.igstAmount) > 0));
    const values = [...new Set(applicable.map(i => Number(i.gstRate || 0) / (kind === 'IGST' ? 1 : 2)))];
    return `${kind}${values.length === 1 ? ` ${percent(values[0])}` : values.length > 1 ? ' (see rate breakdown)' : ''}`;
  }
  const totals = [
    ...(Number(bill.discountAmount) ? [[discountLabel, bill.discountAmount]] : []),
    ['Taxable value', bill.taxableAmount],
    ...(!composition ? [[taxLabel('CGST'), bill.cgstAmount], [taxLabel('SGST'), bill.sgstAmount],
      ...(Number(bill.igstAmount) ? [[taxLabel('IGST'), bill.igstAmount]] : [])] : []),
    ...(Number(bill.roundOff) ? [['Round off', bill.roundOff]] : []),
    ['Invoice total', bill.totalAmount], ['Paid', bill.paidAmount], ['Balance', bill.balanceAmount],
    ...(Number(bill.totalRefundedAmount) ? [['Refunded', bill.totalRefundedAmount]] : []),
  ];
  ensure(totals.length * 6 + 14); text('AMOUNTS IN INR', margin, y, font, true); y += 6;
  for (const [label, value] of totals) {
    const labelLines = wrap(label, width - 29, font + (label === 'Invoice total' ? 1 : 0));
    ensure(Math.max(7, labelLines.length * lineHeight + 2));
    const strong = label === 'Invoice total';
    labelLines.forEach((line, i) => text(line, margin, y + i * lineHeight, font + (strong ? 1 : 0), strong));
    text(money(Number(value)), W - right - 24, y, font + (strong ? 1 : 0), strong); y += Math.max(6, labelLines.length * lineHeight + 2);
  }
  const rates = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  bill.billItems.forEach(i => {
    const rate = Number(i.gstRate || 0), row = rates.get(rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += Number(i.taxableAmount || 0); row.cgst += Number(i.cgstAmount || 0);
    row.sgst += Number(i.sgstAmount || 0); row.igst += Number(i.igstAmount || 0); rates.set(rate, row);
  });
  if (!composition) {
    y += 3;
    for (const [rate, r] of [...rates].sort((a, b) => a[0] - b[0])) {
      const splitTax = r.cgst || r.sgst || !r.igst ? ` | CGST ${percent(rate / 2)}: ${money(r.cgst)} | SGST ${percent(rate / 2)}: ${money(r.sgst)}` : '';
      for (const l of wrap(`GST ${percent(rate)} | Taxable ${money(r.taxable)}${splitTax}${r.igst ? ` | IGST ${percent(rate)}: ${money(r.igst)}` : ''}`, width)) {
        ensure(lineHeight + 2); text(l, margin, y, font - 0.5); y += lineHeight;
      }
    }
  }
  const notes = [composition ? 'Composition scheme - tax is not collected separately.' : 'Prices shown include applicable GST.',
    discountRates.some(rate => rate?.startsWith('~')) ? '~ Discount percentage estimated from the saved rounded amount.' : '',
    bill.paymentMethod ? `Payment: ${bill.paymentMethod.replace(/_/g, ' ')}` : '', bill.notes || ''].filter(Boolean).join('\n');
  y += 5;
  for (const l of wrap(notes, width, font - 0.5)) { ensure(lineHeight + 2); text(l, margin, y, font - 0.5); y += lineHeight; }
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    if (images.footer && !images.letterhead) image(images.footer, margin, H - 24, width, 15);
    text(`${bill.billNumber} | Page ${p} of ${pages}`, margin, H - 6, 7);
  }
  return pdf;
}
