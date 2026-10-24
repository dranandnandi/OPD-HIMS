import type { ClinicSetting, Patient, VisitImage } from '../types';
import { getAttachmentKind } from '../utils/visitAttachments';
import { composeReportPdf, type ReportImage } from '../utils/reportPdf';

const MAX_BYTES = 25 * 1024 * 1024;

export async function fetchReportFile(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not download the report or branding image. Please try again.');
  const blob = await response.blob();
  if (blob.size > MAX_BYTES) throw new Error('The file is too large. Maximum size is 25 MB.');
  return blob;
}

async function canvasImage(canvas: HTMLCanvasElement): Promise<ReportImage> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    value => value ? resolve(value) : reject(new Error('Could not render the report.')), 'image/png',
  ));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('Unable to read this image. Use a PNG or JPEG image.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function imageAsset(blob: Blob): Promise<ReportImage> {
  const img = await loadImage(blob);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image rendering is unavailable.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasImage(canvas);
}

async function* reportPages(source: VisitImage): AsyncGenerator<ReportImage> {
  const blob = await fetchReportFile(source.url);
  if (getAttachmentKind(source) !== 'pdf') {
    yield await imageAsset(blob);
    return;
  }
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  task.onPassword = () => { void task.destroy(); };
  try {
    const document = await task.promise;
    if (document.numPages > 50) throw new Error('Please split reports longer than 50 pages before adding letterhead.');
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.5, 2400 / Math.max(base.width, base.height)) });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('PDF rendering is unavailable.');
      // PDF.js renders rotated/scanned pages and visible form annotations too.
      await page.render({ canvasContext: ctx, viewport }).promise;
      yield await canvasImage(canvas);
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } catch (error) {
    throw new Error(`Unable to read the report PDF. If protected, upload an unlocked copy. ${error instanceof Error ? error.message : ''}`);
  } finally {
    await task.destroy();
  }
}

/** Canvas text supports the same Indian-language fonts as the app itself. */
async function reportHeader(clinic: ClinicSetting, patient: Patient, lab: string, logo?: Blob, headerUrl?: string): Promise<ReportImage> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Letterhead rendering is unavailable.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 12;
  if (headerUrl) {
    const banner = await loadImage(await fetchReportFile(headerUrl));
    const h = Math.min(210, banner.naturalHeight / banner.naturalWidth * 1600);
    const w = h * banner.naturalWidth / banner.naturalHeight;
    ctx.drawImage(banner, (1600 - w) / 2, y, w, h);
    y += h + 16;
  }
  let textX = 0;
  if (logo) {
    const image = await loadImage(logo);
    const scale = Math.min(130 / image.naturalWidth, 130 / image.naturalHeight);
    ctx.drawImage(image, 0, y, image.naturalWidth * scale, image.naturalHeight * scale);
    textX = 155;
  }
  const line = (text: string, size: number, bold = false, x = 0) => {
    ctx.font = `${bold ? '600' : '400'} ${size}px Arial, sans-serif`;
    ctx.fillStyle = bold ? '#123b50' : '#374151';
    let buffer = '';
    // Wrap by characters as well as spaces, so long names cannot leave the page.
    for (const character of text) {
      if (ctx.measureText(buffer + character).width > 1600 - x && buffer) {
        y += size * 1.35; ctx.fillText(buffer, x, y); buffer = '';
      }
      buffer += character;
    }
    if (buffer) { y += size * 1.35; ctx.fillText(buffer, x, y); }
  };
  const logoTop = y;
  line(clinic.clinicName, 44, true, textX);
  if (clinic.address) line(clinic.address, 25, false, textX);
  if (clinic.phone) line(`Phone: ${clinic.phone}`, 25, false, textX);
  y = Math.max(y + 20, logo ? logoTop + 150 : y + 20);
  ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1600, y); ctx.stroke();
  y += 8;
  line('LABORATORY REPORT', 30, true);
  line(`Patient: ${patient.name}${patient.patientNumber || patient.patient_number ? `   |   ID: ${patient.patientNumber || patient.patient_number}` : ''}`, 26);
  line(`Tests performed by: ${lab}`, 26, true);
  y += 20;
  if (y > canvas.height) throw new Error('The clinic or lab details are too long for the letterhead.');
  const cropped = document.createElement('canvas');
  cropped.width = canvas.width; cropped.height = Math.ceil(y);
  cropped.getContext('2d')!.drawImage(canvas, 0, 0);
  return canvasImage(cropped);
}

export async function createLetterheadReport(input: {
  attachment: VisitImage;
  patient: Patient;
  clinic: ClinicSetting;
  labName: string;
  customLogo?: File;
  useClinicLetterhead: boolean;
}): Promise<Blob> {
  const { attachment, patient, clinic } = input;
  const lab = input.labName.trim();
  if (!lab || lab.length > 160) throw new Error('Enter the performing lab name (up to 160 characters).');
  if (input.customLogo && (!['image/png', 'image/jpeg'].includes(input.customLogo.type) || input.customLogo.size > 5 * 1024 * 1024)) {
    throw new Error('Use a PNG or JPEG logo up to 5 MB.');
  }
  const source = attachment.reportSource ? { ...attachment, ...attachment.reportSource } : attachment;
  if (!['pdf', 'image'].includes(getAttachmentKind(source))) throw new Error('Select a PDF or image report.');
  const full = input.useClinicLetterhead && clinic.pdfLetterheadMode === 'full' && !!clinic.pdfLetterheadUrl;
  const logo = input.customLogo || (clinic.logoUrl ? await fetchReportFile(clinic.logoUrl) : undefined);
  const header = await reportHeader(clinic, patient, lab, logo,
    input.useClinicLetterhead && !full ? clinic.pdfHeaderUrl : undefined);
  const footer = input.useClinicLetterhead && !full && clinic.pdfFooterUrl
    ? await imageAsset(await fetchReportFile(clinic.pdfFooterUrl)) : undefined;
  const letterhead = full ? await imageAsset(await fetchReportFile(clinic.pdfLetterheadUrl!)) : undefined;
  const bytes = await composeReportPdf({
    pages: reportPages(source), header, footer, letterhead,
    topInset: full ? (clinic.pdfLetterheadSpacing?.top ?? 140) * 0.75 : 0,
    bottomInset: full ? (clinic.pdfLetterheadSpacing?.bottom ?? 100) * 0.75 : 0,
    title: `${patient.name} - ${lab} - Laboratory report`,
  });
  if (bytes.byteLength > MAX_BYTES) throw new Error('The generated PDF exceeds 25 MB. Split the report into smaller files.');
  return new Blob([bytes], { type: 'application/pdf' });
}
