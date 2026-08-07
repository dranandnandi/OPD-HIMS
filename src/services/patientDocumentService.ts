import { supabase } from '../lib/supabase';

export interface PatientUploadedDoc {
  id: string;
  clinic_id: string;
  patient_id: string;
  admission_id: string | null;
  doc_type: 'id_card' | 'insurance_policy' | 'opd_paper' | 'external_report' | 'other';
  file_name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  source: string;
  uploaded_at: string;
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  id_card: 'ID card',
  insurance_policy: 'Insurance / TPA policy',
  opd_paper: 'OPD paper',
  external_report: 'External report',
  other: 'Other',
};

const BUCKET = 'patient-documents';

export const patientDocumentService = {
  /** Build the patient-specific public upload link (stable, no expiry). */
  async getUploadLink(patientId: string): Promise<string> {
    if (!supabase) throw new Error('Supabase client not available.');
    const { data, error } = await supabase
      .from('patients')
      .select('upload_link_id')
      .eq('id', patientId)
      .single();
    if (error) throw new Error(error.message);
    return `${window.location.origin}/patient-upload?c=${data.upload_link_id}`;
  },

  /** Documents the patient (or staff) uploaded, newest first. */
  async listDocuments(patientId: string): Promise<PatientUploadedDoc[]> {
    if (!supabase) throw new Error('Supabase client not available.');
    const { data, error } = await supabase
      .from('patient_uploaded_documents')
      .select('*')
      .eq('patient_id', patientId)
      .order('uploaded_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PatientUploadedDoc[];
  },

  /** Short-lived signed URL to view a file from the private bucket. */
  async getSignedUrl(storagePath: string): Promise<string> {
    if (!supabase) throw new Error('Supabase client not available.');
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
};
