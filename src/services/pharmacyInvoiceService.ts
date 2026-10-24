import { supabase } from '../lib/supabase';
import { billingService } from './billingService';
import { clinicSettingsService } from './clinicSettingsService';
import { getCurrentProfile } from './profileService';
import { createPharmacyInvoicePdf, pharmacyInvoiceContentKey, type InvoiceImage, type PharmacyInvoiceDocument } from '../utils/pharmacyInvoicePdf';

const imageCache = new Map<string, Promise<InvoiceImage>>();
async function brandingImage(url: string): Promise<InvoiceImage> {
  const pending = imageCache.get(url);
  if (pending) return pending;
  const task = (async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Could not load invoice branding. Check the logo/letterhead under Settings.');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image(); img.src = objectUrl; await img.decode();
      const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(img.naturalWidth * scale); canvas.height = Math.ceil(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image rendering is unavailable.');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return { data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
    } finally { URL.revokeObjectURL(objectUrl); }
  })();
  imageCache.set(url, task);
  try { return await task; } catch (error) { imageCache.delete(url); throw error; }
}

async function loadDocument(billId: string) {
  const [bill, clinic, profile] = await Promise.all([
    billingService.getBillById(billId, false), clinicSettingsService.getClinicSettings(), getCurrentProfile(),
  ]);
  if (!bill || bill.billType !== 'pharmacy' || !bill.patient) throw new Error('Pharmacy invoice or customer details could not be loaded.');
  if (!clinic || !profile?.clinicId || clinic.id !== profile.clinicId) throw new Error('Clinic settings could not be loaded.');
  const document: PharmacyInvoiceDocument = { bill, clinic, patient: bill.patient };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pharmacyInvoiceContentKey(document)));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const path = `pharmacy-invoices/${clinic.id}/${bill.id}/${hash}.pdf`;
  return { document, path };
}

export const pharmacyInvoiceService = {
  /** onReady opens the local PDF before storage upload finishes. */
  async generate(billId: string, options: { forceRegenerate?: boolean; onReady?: (url: string) => void } = {}) {
    if (!supabase) throw new Error('Database connection is unavailable.');
    const { document: data, path } = await loadDocument(billId);
    const bucket = supabase.storage.from('pdfs');
    const { data: { publicUrl } } = bucket.getPublicUrl(path);
    if (!options.forceRegenerate && data.bill.pdfUrl === publicUrl) {
      options.onReady?.(publicUrl);
      return { url: publicUrl, shareUrl: publicUrl, cached: true };
    }
    const { clinic, bill } = data;
    const images: PharmacyInvoiceDocument['images'] = {};
    const assets: Array<[keyof NonNullable<PharmacyInvoiceDocument['images']>, string | undefined]> =
      clinic.pdfLetterheadMode === 'full' && clinic.pdfLetterheadUrl
        ? [['letterhead', clinic.pdfLetterheadUrl]]
        : [['logo', clinic.logoUrl], ['header', clinic.pdfHeaderUrl], ['footer', clinic.pdfFooterUrl]];
    await Promise.all(assets.filter(([, url]) => url && !url.includes('example.com')).map(async ([key, url]) => { images[key] = await brandingImage(url!); }));
    if (typeof document !== 'undefined') await document.fonts.ready;
    const blob = createPharmacyInvoicePdf({ ...data, images }).output('blob');
    if (options.onReady) {
      const local = URL.createObjectURL(blob); options.onReady(local);
      // Allow the PDF viewer time to download/print the locally rendered file.
      setTimeout(() => URL.revokeObjectURL(local), 10 * 60 * 1000);
    }
    const { error: uploadError } = await bucket.upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw new Error(`PDF is ready, but saving failed: ${uploadError.message}. Use Generate PDF to retry.`);
    let update = supabase.from('bills').update({ pdf_url: publicUrl, print_pdf_url: publicUrl })
      .eq('id', bill.id).eq('clinic_id', clinic.id).eq('bill_type', 'pharmacy');
    if (bill.sourceUpdatedAt) update = update.eq('updated_at', bill.sourceUpdatedAt);
    const { data: saved, error: saveError } = await update.select('id').maybeSingle();
    if (saveError || !saved) throw new Error('PDF was generated, but the bill changed or its saved link could not be updated. Reopen the invoice and generate again.');
    return { url: publicUrl, shareUrl: publicUrl, cached: false };
  },

  async open(billId: string, forceRegenerate = false) {
    const tab = window.open('', '_blank');
    if (!tab) throw new Error('Allow pop-ups for this site to open the invoice PDF.');
    tab.opener = null;
    tab.document.body.textContent = 'Preparing pharmacy invoice...';
    let displayed = false;
    try {
      return await this.generate(billId, { forceRegenerate, onReady: url => { displayed = true; tab.location.href = url; } });
    } catch (error) {
      if (!displayed) tab.close();
      throw error;
    }
  },
};
