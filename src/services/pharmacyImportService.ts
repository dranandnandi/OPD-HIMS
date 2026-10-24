import { supabase } from '../lib/supabase';
import { supabaseUrl } from '../lib/supabaseClient';
import { getCurrentProfile } from './profileService';
import type { ImportDraft, InvoiceData } from '../types/pharmacyImport';

function database() {
  if (!supabase) throw new Error('Database is not configured.');
  return supabase;
}

export const pharmacyImportService = {
  async get(id: string): Promise<ImportDraft> {
    const { data, error } = await database().from('pharmacy_invoice_imports').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },
  async list(): Promise<ImportDraft[]> {
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('Select a clinic first.');
    const { data, error } = await database().from('pharmacy_invoice_imports').select('*').eq('clinic_id', profile.clinicId).eq('status', 'draft').order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async create(targetReceiptId: string | null = null): Promise<ImportDraft> {
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('Select a clinic first.');
    const { data, error } = await database().from('pharmacy_invoice_imports').insert({ clinic_id: profile.clinicId, target_receipt_id: targetReceiptId, payload: { pages: [] } }).select().single();
    if (error) throw error;
    return data;
  },
  async save(draft: ImportDraft, payload: ImportDraft['payload']): Promise<ImportDraft> {
    const { data, error } = await database().from('pharmacy_invoice_imports').update({ payload, revision: draft.revision + 1, updated_at: new Date().toISOString() }).eq('id', draft.id).eq('clinic_id', draft.clinic_id).eq('revision', draft.revision).eq('status', 'draft').select().maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Draft changed in another session or was already posted. Reload to continue.');
    return data;
  },
  async post(draft: ImportDraft, header: Record<string, unknown>, items: Record<string, unknown>[]): Promise<string> {
    const { data, error } = await database().rpc('post_pharmacy_invoice_import', { p_import_id: draft.id, p_revision: draft.revision, p_header: header, p_items: items });
    if (error) throw error;
    return data;
  },
  async extract(image: Blob, fileName: string, provider: string, quality: string, retry = false): Promise<{ extractedData: InvoiceData; model: string }> {
    const imageBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(image);
    });
    const { data: { session } } = await database().auth.getSession();
    if (!session) throw new Error('Sign in again to continue.');
    const response = await fetch(`${supabaseUrl}/functions/v1/parse-pharmacy-invoice`, {
      method: 'POST', signal: AbortSignal.timeout(150000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ imageBase64, mimeType: image.type, fileName, provider, quality, retry })
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || 'Page extraction failed');
    return result;
  }
};

// Render only the requested page: a 15-page PDF never allocates 15 canvases.
export async function openInvoiceFile(file: File) {
  const bytes = await file.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
  if (file.type !== 'application/pdf') return { hash, count: 1, render: async (_page: number) => file as Blob, close: async () => {} };
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  return {
    hash, count: pdf.numPages,
    async render(pageNumber: number): Promise<Blob> {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, 2400 / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
      try {
        const context = canvas.getContext('2d'); if (!context) throw new Error('Cannot render PDF');
        await page.render({ canvasContext: context, viewport }).promise;
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Cannot render page')), 'image/jpeg', 0.95));
      } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
    },
    async close() { await pdf.destroy(); }
  };
}
