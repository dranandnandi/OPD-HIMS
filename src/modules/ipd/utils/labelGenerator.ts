// Ported and adapted from LIMS v2: src/utils/barcodeGenerator.ts
// Generates Code 128 barcodes + QR codes for admission wristbands and
// patient-file labels, printable via QZ Tray (label printer) or window.print().

import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

// ---------------------------------------------------------------------------
// Barcode / QR primitives
// ---------------------------------------------------------------------------

export function generateBarcodeDataUrl(
  data: string,
  options?: {
    width?: number;
    height?: number;
    displayValue?: boolean;
    fontSize?: number;
    margin?: number;
  }
): string {
  const { width = 2, height = 50, displayValue = true, fontSize = 12, margin = 6 } =
    options || {};
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, data, {
    format: 'CODE128',
    width,
    height,
    displayValue,
    fontSize,
    margin,
    background: '#ffffff',
    lineColor: '#000000',
  });
  return canvas.toDataURL('image/png');
}

export async function generateQrDataUrl(data: string, sizePx = 96): Promise<string> {
  return QRCode.toDataURL(data, { width: sizePx, margin: 1 });
}

export function isValidBarcodeData(data: string): boolean {
  if (!data || data.length === 0) return false;
  for (let i = 0; i < data.length; i++) {
    if (data.charCodeAt(i) > 127) return false;
  }
  return true;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Admission labels
// ---------------------------------------------------------------------------

export interface AdmissionLabelData {
  admissionNumber: string;
  patientName: string;
  age?: number | null;
  gender?: string | null;
  bloodGroup?: string | null;
  allergies?: string[] | null;
  wardBed?: string; // "ICU / B-04"
  admittedOn?: string; // display string
  doctorName?: string;
  /** Deep link encoded in the QR, e.g. `${origin}/ipd/admissions/${id}` */
  chartUrl?: string;
}

// Standard label stock: 50.8mm x 25.4mm (same as LIMS sample labels)
const LABEL_W = '50.8mm';
const LABEL_H = '25.4mm';

function labelCss(): string {
  return `
    * { box-sizing: border-box; }
    @page { size: ${LABEL_W} ${LABEL_H}; margin: 0; }
    html, body { margin: 0; padding: 0; color: #000; background: #fff;
      font-family: Arial, Helvetica, sans-serif; }
    .label {
      width: ${LABEL_W}; height: ${LABEL_H};
      padding: 1mm 1.75mm; overflow: hidden;
      page-break-after: always; break-after: page;
      display: flex; flex-direction: column;
    }
    .label:last-child { page-break-after: auto; break-after: auto; }
    .row { display: flex; justify-content: space-between; align-items: baseline; }
    .name { font-size: 10px; font-weight: bold; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    .meta { font-size: 9px; font-weight: bold; margin-left: 2mm; white-space: nowrap; }
    .allergy { font-size: 8px; font-weight: bold; color: #000;
      border: 1px solid #000; padding: 0 1mm; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    .barcode { text-align: center; margin: 0.5mm 0; }
    .barcode img { max-width: 100%; height: 9mm; object-fit: contain; }
    .foot { display: flex; justify-content: space-between; font-size: 8px; font-weight: bold; }
    .with-qr { display: flex; gap: 1mm; }
    .with-qr .body { flex: 1; min-width: 0; }
    .with-qr .qr img { width: 12mm; height: 12mm; }
    @media screen {
      body { padding: 12px; background: #f3f4f6; }
      .label { margin-bottom: 10px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
    }
    @media print {
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { width: ${LABEL_W} !important; margin: 0 !important; padding: 0 !important; }
      .label { page-break-inside: avoid !important; break-inside: avoid !important; }
    }
  `;
}

/**
 * Wristband / patient-file label markup.
 * Layout: name + age/sex, allergy strip, admission barcode, ward-bed + date,
 * optional QR (chart deep link) on the right.
 */
function admissionLabelMarkup(
  data: AdmissionLabelData,
  barcodeDataUrl: string,
  qrDataUrl?: string
): string {
  const meta = [data.gender?.[0]?.toUpperCase(), data.age ? `${data.age}Y` : '', data.bloodGroup]
    .filter(Boolean)
    .join(' ');
  const allergies = (data.allergies ?? []).filter(Boolean);

  const body = `
    <div class="body">
      <div class="row">
        <span class="name">${escapeHtml(data.patientName)}</span>
        ${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ''}
      </div>
      ${allergies.length ? `<div class="allergy">⚠ ${escapeHtml(allergies.join(', '))}</div>` : ''}
      <div class="barcode"><img src="${barcodeDataUrl}" alt="${escapeHtml(data.admissionNumber)}" /></div>
      <div class="foot">
        <span>${escapeHtml(data.wardBed ?? '')}</span>
        <span>${escapeHtml(data.admittedOn ?? '')}</span>
      </div>
    </div>`;

  return `
    <section class="label${qrDataUrl ? ' with-qr' : ''}">
      ${body}
      ${qrDataUrl ? `<div class="qr"><img src="${qrDataUrl}" alt="QR" /></div>` : ''}
    </section>`;
}

/**
 * Build a printable HTML document with N copies of the admission label
 * (wristband + file stickers usually print 2–4 copies at admission).
 */
export async function generateAdmissionLabelsHTML(
  data: AdmissionLabelData,
  options?: { copies?: number; includeQr?: boolean; title?: string }
): Promise<string> {
  const copies = options?.copies ?? 2;
  const barcodeDataUrl = generateBarcodeDataUrl(data.admissionNumber, {
    height: 34,
    fontSize: 10,
    margin: 2,
  });
  const qrDataUrl =
    options?.includeQr && data.chartUrl ? await generateQrDataUrl(data.chartUrl) : undefined;

  const labels = Array.from({ length: copies }, () =>
    admissionLabelMarkup(data, barcodeDataUrl, qrDataUrl)
  ).join('\n');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(options?.title ?? `Labels ${data.admissionNumber}`)}</title>
    <style>${labelCss()}</style>
  </head>
  <body>${labels}</body>
</html>`;
}

/** Open the labels in a hidden iframe and trigger the browser print dialog. */
export async function printAdmissionLabels(
  data: AdmissionLabelData,
  options?: { copies?: number; includeQr?: boolean }
): Promise<void> {
  const html = await generateAdmissionLabelsHTML(data, options);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '-10000px';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  iframe.contentWindow?.focus();
  // Give images (data URLs) a tick to layout before printing
  setTimeout(() => {
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 2000);
  }, 250);
}
