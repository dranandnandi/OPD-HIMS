import { supabase } from '../lib/supabase';
import { getCurrentProfile } from './profileService';
import type { VisitImage } from '../types';

export function replaceReportAttachment(existing: VisitImage[], expected: VisitImage, replacement: VisitImage): VisitImage[] {
  const current = existing.find(item => item.id === expected.id);
  if (!current || current.url !== expected.url) {
    throw new Error('This report has changed or was removed. Reopen the visit before saving.');
  }
  return existing.map(item => item.id === expected.id ? replacement : item);
}

export const visitReportService = {
  async saveLetterheadReport(input: {
    visitId: string; patientId: string; attachment: VisitImage; pdf: Blob; labName: string;
  }): Promise<VisitImage[]> {
    if (!supabase) throw new Error('Database connection is unavailable.');
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User is not assigned to a clinic.');
    if (!input.labName.trim()) throw new Error('The performing lab name is required.');
    if (input.pdf.type !== 'application/pdf' || !input.pdf.size || input.pdf.size > 25 * 1024 * 1024) {
      throw new Error('Select a generated PDF up to 25 MB.');
    }
    const { data: visit, error: readError } = await supabase.from('visits')
      .select('visit_images').eq('id', input.visitId).eq('patient_id', input.patientId)
      .eq('clinic_id', profile.clinicId).single();
    if (readError || !visit) throw new Error('Unable to load the visit for this patient.');
    const existing = (visit.visit_images || []) as VisitImage[];
    // Check before uploading; repeat at write time with a JSON compare-and-swap.
    replaceReportAttachment(existing, input.attachment, input.attachment);
    const path = `visit_images/${profile.clinicId}/${input.visitId}/${crypto.randomUUID()}_report.pdf`;
    const bucket = supabase.storage.from('ocruploads');
    const { error: uploadError } = await bucket.upload(path, input.pdf, { contentType: 'application/pdf', upsert: false });
    if (uploadError) throw new Error(`Could not save report PDF: ${uploadError.message}`);
    const { data: { publicUrl } } = bucket.getPublicUrl(path);
    const original = input.attachment.reportSource || {
      url: input.attachment.url, mimeType: input.attachment.mimeType,
      imageType: input.attachment.imageType, label: input.attachment.label, fileSize: input.attachment.fileSize,
    };
    const replacement: VisitImage = {
      ...input.attachment, url: publicUrl, imageType: 'lab_report', mimeType: 'application/pdf',
      label: `${input.labName.trim()} - Report.pdf`, fileSize: input.pdf.size,
      reportSource: original, performingLab: input.labName.trim(), reportGeneratedAt: new Date().toISOString(),
    };
    const updated = replaceReportAttachment(existing, input.attachment, replacement);
    const { data: saved, error: saveError } = await supabase.from('visits')
      .update({ visit_images: updated, updated_at: new Date().toISOString() })
      .eq('id', input.visitId).eq('patient_id', input.patientId).eq('clinic_id', profile.clinicId)
      .filter('visit_images', 'eq', JSON.stringify(visit.visit_images))
      .select('id').maybeSingle();
    if (saveError || !saved) {
      // Remove only this newly generated orphan, never the original report.
      await bucket.remove([path]);
      throw new Error(saveError ? `Could not update report: ${saveError.message}` : 'Attachments changed while saving. Reopen the visit and try again.');
    }
    return updated;
  },
};
