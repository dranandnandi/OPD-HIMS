import { supabase } from '../utils/supabase';
import type { IpdReport } from '../types/ipd';

/** Pathology / radiology reports filed against an admission. Files go to the
    shared 'ocruploads' bucket (same bucket the OPD visit images use). */

const BUCKET = 'ocruploads';
const MAX_FILE_MB = 20;

export const reportService = {
  async list(admissionId: string): Promise<IpdReport[]> {
    const { data, error } = await supabase
      .from('ipd_reports')
      .select('*, order_item:ipd_order_items(id, service:services_master(name))')
      .eq('admission_id', admissionId)
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as unknown as IpdReport[];
  },

  async uploadFile(admissionId: string, file: File): Promise<{ url: string; name: string; mime: string }> {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      throw new Error(`File is larger than ${MAX_FILE_MB} MB`);
    }
    const safeName = file.name.replace(/[^\w.\-]/g, '_');
    const path = `ipd_reports/${admissionId}/${Date.now()}_${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file);
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, name: file.name, mime: file.type || 'application/octet-stream' };
  },

  async create(params: {
    clinicId: string;
    admissionId: string;
    orderItemId?: string | null;
    reportType: IpdReport['report_type'];
    title: string;
    reportDate?: string;
    performedAt?: string | null;
    fileUrl?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    findings?: string | null;
    impression?: string | null;
    isAbnormal?: boolean;
    userId?: string;
  }): Promise<IpdReport> {
    const { data, error } = await supabase
      .from('ipd_reports')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        order_item_id: params.orderItemId ?? null,
        report_type: params.reportType,
        title: params.title,
        report_date: params.reportDate ?? new Date().toISOString().slice(0, 10),
        performed_at: params.performedAt ?? null,
        file_url: params.fileUrl ?? null,
        file_name: params.fileName ?? null,
        mime_type: params.mimeType ?? null,
        findings: params.findings ?? null,
        impression: params.impression ?? null,
        is_abnormal: params.isAbnormal ?? false,
        uploaded_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;

    // filing a report against an order closes the loop on that order line
    if (params.orderItemId) {
      await supabase
        .from('ipd_order_items')
        .update({ status: 'resulted', updated_at: new Date().toISOString() })
        .eq('id', params.orderItemId);
    }
    return data as IpdReport;
  },

  async markReviewed(reportId: string, userId?: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_reports')
      .update({
        status: 'reviewed',
        reviewed_by: userId ?? null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', reportId);
    if (error) throw error;
  },

  async update(reportId: string, patch: Partial<IpdReport>): Promise<void> {
    const { error } = await supabase
      .from('ipd_reports')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', reportId);
    if (error) throw error;
  },

  async remove(reportId: string): Promise<void> {
    const { error } = await supabase.from('ipd_reports').delete().eq('id', reportId);
    if (error) throw error;
  },
};
