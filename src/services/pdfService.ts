import { supabase } from '../lib/supabase';
import { Bill, Patient, Profile, ClinicSetting, Visit } from '../types';
import { supabaseUrl } from '../lib/supabaseClient';

type PdfRecordType = 'bill' | 'visit';

interface PdfPayload {
  bill?: Bill;
  visit?: Visit;
  patient: Patient;
  doctor?: Profile;
  clinicSettings: ClinicSetting;
}

interface PdfOptions {
  forceRegenerate?: boolean;
}

export interface GeneratedPdf {
  /**
   * The real Supabase Storage URL. Use this for download and for auto-print —
   * a print bridge cannot consume the link resolver's HTML wait page.
   */
  url: string;
  /**
   * The stable `/r/<token>.pdf` link, when the clinic has stable links enabled.
   * Use this for anything sent outward (WhatsApp, email): it survives
   * regeneration, and it stays alive even when `url` is a PDF.co fallback that
   * expires within the hour.
   */
  shareUrl?: string;
  token?: string;
  /** True when `url` is a PDF.co temp URL because Storage persistence failed. */
  temporary?: boolean;
  cached?: boolean;
}

/**
 * Single entry point to the generator edge function.
 *
 * The three public wrappers below differ only in which flags they set, so they
 * share this body rather than repeating the auth/fetch/error handling.
 */
async function invokeGenerator(
  type: PdfRecordType,
  data: PdfPayload,
  flags: { printVersion?: boolean; compactVersion?: boolean },
  options: PdfOptions | undefined,
  label: string,
): Promise<GeneratedPdf> {
  if (!supabase) {
    throw new Error('Supabase client not initialized');
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) throw new Error('Not authenticated');

  const response = await fetch(`${supabaseUrl}/functions/v1/generate-pdf-from-html`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      type,
      data,
      ...flags,
      forceRegenerate: Boolean(options?.forceRegenerate),
    }),
  });

  if (!response.ok) {
    let detail = response.statusText || 'Unknown error';
    try {
      const errorData = await response.json();
      detail = errorData.error || errorData.details || detail;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new Error(`${label} failed: ${detail}`);
  }

  const result = await response.json();
  if (result.error) throw new Error(result.error);

  return {
    url: result.url,
    shareUrl: result.shareUrl ?? undefined,
    token: result.token ?? undefined,
    temporary: Boolean(result.temporary),
    cached: Boolean(result.cached),
  };
}

export const pdfService = {
  /**
   * Full generator result, including the stable share link.
   * Prefer this at any call site that sends the document to a patient.
   */
  generateWithLink(
    type: PdfRecordType,
    data: PdfPayload,
    variant: 'display' | 'print' | 'compact' = 'display',
    options?: PdfOptions,
  ): Promise<GeneratedPdf> {
    const flags =
      variant === 'print' ? { printVersion: true }
      : variant === 'compact' ? { compactVersion: true }
      : {};
    return invokeGenerator(type, data, flags, options, `${variant} PDF generation`);
  },

  async generatePdfFromData(type: PdfRecordType, data: PdfPayload, options?: PdfOptions): Promise<string> {
    try {
      const result = await invokeGenerator(type, data, {}, options, 'PDF generation');
      return result.url;
    } catch (error) {
      console.error('Error generating PDF via Edge Function:', error);
      throw error;
    }
  },

  async generateCompactPrintPdf(type: PdfRecordType, data: PdfPayload, options?: PdfOptions): Promise<string> {
    try {
      const result = await invokeGenerator(type, data, { compactVersion: true }, options, 'Compact print PDF generation');
      return result.url;
    } catch (error) {
      console.error('Error generating compact print PDF via Edge Function:', error);
      throw error;
    }
  },

  async generatePrintPdf(type: PdfRecordType, data: PdfPayload, options?: PdfOptions): Promise<string> {
    try {
      const result = await invokeGenerator(type, data, { printVersion: true }, options, 'Print PDF generation');
      return result.url;
    } catch (error) {
      console.error('Error generating print PDF via Edge Function:', error);
      throw error;
    }
  },

  async savePdfUrlToDatabase(type: PdfRecordType, id: string, pdfUrl: string): Promise<void> {
    if (!supabase) return;

    try {
      const table = type === 'bill' ? 'bills' : 'visits';
      const { error } = await supabase
        .from(table)
        .update({ pdf_url: pdfUrl })
        .eq('id', id);

      if (error) {
        console.error(`Error saving PDF URL to ${table}:`, error);
      } else {
        console.log(`Saved PDF URL to ${table} for id ${id}`);
      }
    } catch (error) {
      console.error('Error in savePdfUrlToDatabase:', error);
    }
  },

  async saveCompactPrintPdfUrl(id: string, url: string): Promise<void> {
    if (!supabase) return;

    try {
      const { error } = await supabase
        .from('visits')
        .update({ compact_print_pdf_url: url })
        .eq('id', id);

      if (error) {
        console.error('Error saving compact print PDF URL:', error);
      } else {
        console.log(`Saved compact print PDF URL for visit ${id}`);
      }
    } catch (error) {
      console.error('Error in saveCompactPrintPdfUrl:', error);
    }
  },

  async savePrintPdfUrl(type: PdfRecordType, id: string, printPdfUrl: string): Promise<void> {
    if (!supabase) return;

    try {
      const table = type === 'bill' ? 'bills' : 'visits';
      // Both tables use print_pdf_url. This used to send "printPdfUrl" for
      // bills, which is not a column — the update failed and was only logged,
      // so bill print URLs were never cached.
      const { error } = await supabase
        .from(table)
        .update({ print_pdf_url: printPdfUrl })
        .eq('id', id);

      if (error) {
        console.error(`Error saving print PDF URL to ${table}:`, error);
      } else {
        console.log(`Saved print PDF URL to ${table} for id ${id}`);
      }
    } catch (error) {
      console.error('Error in savePrintPdfUrl:', error);
    }
  }
};
