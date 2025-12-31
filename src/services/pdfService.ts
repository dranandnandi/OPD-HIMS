import { supabase } from '../lib/supabase';
import { Bill, Patient, Profile, ClinicSetting, Visit } from '../types';

export const pdfService = {
  async generatePdfFromData(
    type: 'bill' | 'visit',
    data: {
      bill?: Bill;
      visit?: Visit;
      patient: Patient;
      doctor?: Profile;
      clinicSettings: ClinicSetting;
    }
  ): Promise<string> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) throw new Error('Not authenticated');
      const token = session.access_token;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-pdf-from-html`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ type, data })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`PDF generation failed: ${errorData.error || errorData.details || response.statusText || 'Unknown error'}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      return result.url; // This is the URL to the generated PDF
    } catch (error) {
      console.error('Error generating PDF via Edge Function:', error);
      throw error;
    }
  },

  async generatePrintPdf(
    type: 'bill' | 'visit',
    data: {
      bill?: Bill;
      visit?: Visit;
      patient: Patient;
      doctor?: Profile;
      clinicSettings: ClinicSetting;
    }
  ): Promise<string> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) throw new Error('Not authenticated');
      const token = session.access_token;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-pdf-from-html`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          type,
          data,
          printVersion: true  // Flag to generate print version
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Print PDF generation failed: ${errorData.error || errorData.details || response.statusText || 'Unknown error'}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      return result.url; // This is the URL to the generated print PDF
    } catch (error) {
      console.error('Error generating print PDF via Edge Function:', error);
      throw error;
    }
  },

  async savePdfUrlToDatabase(type: 'bill' | 'visit', id: string, pdfUrl: string): Promise<void> {
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

  async savePrintPdfUrl(type: 'bill' | 'visit', id: string, printPdfUrl: string): Promise<void> {
    if (!supabase) return;

    try {
      const table = type === 'bill' ? 'bills' : 'visits';
      const column = type === 'bill' ? 'printPdfUrl' : 'print_pdf_url';

      const { error } = await supabase
        .from(table)
        .update({ [column]: printPdfUrl })
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