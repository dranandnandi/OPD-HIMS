import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, MessageCircle, X } from 'lucide-react';
import type { ClinicSetting, Patient, VisitImage } from '../../types';
import { useAuth } from '../Auth/useAuth';
import { clinicSettingsService } from '../../services/clinicSettingsService';
import { visitReportService } from '../../services/visitReportService';
import { whatsappApi } from '../../services/whatsappApi';

interface Props {
  attachment: VisitImage;
  visitId: string;
  patient: Patient;
  initialMode: 'brand' | 'send';
  onSaved: (attachments: VisitImage[]) => void;
  onClose: () => void;
}

const ReportActionsModal: React.FC<Props> = ({ attachment, visitId, patient, initialMode, onSaved, onClose }) => {
  const { user } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [current, setCurrent] = useState(attachment);
  const [clinic, setClinic] = useState<ClinicSetting | null>(null);
  const [labName, setLabName] = useState(attachment.performingLab || '');
  const [logo, setLogo] = useState<File>();
  const [useLetterhead, setUseLetterhead] = useState(true);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);
  const [sent, setSent] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    let active = true;
    clinicSettingsService.getClinicSettings().then(value => {
      if (active) {
        setClinic(value);
        if (!value) setError('Configure the clinic name and branding in Clinic Settings before creating a letterhead report.');
      }
    }).catch(() => { if (active) setError('Could not load clinic branding. Reopen the report to try again.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const invalidate = () => { setPdf(null); setPreviewUrl(''); setError(''); setNotice(''); };
  const run = async (label: string, task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(label); setError(''); setNotice('');
    try { await task(); }
    catch (err) { setError(err instanceof Error ? err.message : 'The report action failed. Please try again.'); }
    finally { running.current = false; setBusy(''); }
  };
  const generate = () => run('Creating preview…', async () => {
    if (!clinic) throw new Error('Clinic branding is not available yet.');
    const { createLetterheadReport } = await import('../../services/reportPdfService');
    const generated = await createLetterheadReport({ attachment: current, patient, clinic, labName, customLogo: logo, useClinicLetterhead: useLetterhead });
    setPdf(generated); setPreviewUrl(URL.createObjectURL(generated));
  });
  const save = () => run('Saving PDF…', async () => {
    if (!pdf) throw new Error('Create and review the preview first.');
    const attachments = await visitReportService.saveLetterheadReport({ visitId, patientId: patient.id, attachment: current, pdf, labName });
    const replacement = attachments.find(item => item.id === current.id)!;
    setCurrent(replacement); setSaved(true); setSent(false);
    onSaved(attachments);
    setNotice('PDF saved. This report now replaces the attachment shown in the visit.');
  });
  const send = () => run('Sending report…', async () => {
    if (!patient.phone?.trim()) throw new Error('Add a phone number to the patient record first.');
    if (!user?.clinicId) throw new Error('Clinic connection is unavailable.');
    const response = await whatsappApi.sendFileUrl({
      phone: patient.phone,
      fileUrl: current.url,
      fileName: current.label || 'report.pdf',
      caption: `Dear ${patient.name},\nPlease find your report attached.${current.performingLab ? `\nTests performed by: ${current.performingLab}` : ''}\nRegards,\n${clinic?.clinicName || user.clinic?.clinicName || 'Clinic'}`,
    }, { clinicId: user.clinicId, userId: user.userId || user.id, email: user.email });
    if (response.success === false) throw new Error(typeof response.message === 'string' ? response.message : 'WhatsApp could not send the report.');
    setSent(true); setNotice('Report submitted to WhatsApp for delivery.');
  });
  const download = () => run('Downloading…', async () => {
    const { fetchReportFile } = await import('../../services/reportPdfService');
    const file = saved || !pdf ? await fetchReportFile(current.url) : pdf;
    const url = URL.createObjectURL(file);
    const link = document.createElement('a'); link.href = url;
    link.download = `report-${patient.patientNumber || patient.patient_number || patient.id}.pdf`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  });

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4" onClick={event => event.stopPropagation()}>
      <div role="dialog" aria-modal="true" aria-labelledby="report-action-title" className="bg-white rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h3 id="report-action-title" className="text-lg font-semibold">{mode === 'brand' ? 'Create letterhead PDF' : 'Send report to patient'}</h3>
            <p className="text-sm text-gray-600">{patient.name} · {current.label || 'Report'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close report" className="p-2 disabled:opacity-50"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <p role="alert" className="p-3 rounded bg-red-50 text-red-700 text-sm">{error}</p>}
          {notice && <p role="status" className="p-3 rounded bg-green-50 text-green-800 text-sm">{notice}</p>}
          {mode === 'brand' && <>
            <fieldset disabled={!!busy || saved} className="space-y-3 disabled:opacity-70">
              <div>
                <label htmlFor="report-lab" className="block text-sm font-medium mb-1">Name of lab that performed the tests *</label>
                <input id="report-lab" value={labName} maxLength={160} onChange={event => { setLabName(event.target.value); invalidate(); }} className="w-full border rounded-lg p-2" placeholder="Enter performing lab name" />
              </div>
              <div>
                <label htmlFor="report-logo" className="block text-sm font-medium mb-1">Clinic logo (optional)</label>
                <input id="report-logo" type="file" accept="image/png,image/jpeg" onChange={event => { setLogo(event.target.files?.[0]); invalidate(); }} className="block text-sm" />
                <p className="text-xs text-gray-500 mt-1">PNG or JPEG, up to 5 MB. Uses your saved clinic logo when no file is selected.</p>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useLetterhead} onChange={event => { setUseLetterhead(event.target.checked); invalidate(); }} />Use saved clinic letterhead</label>
              <p className="text-xs text-gray-600">All report pages are kept intact beneath the clinic header. The original report remains available for reference.</p>
            </fieldset>
            {!saved && <div className="flex flex-wrap gap-2">
              <button type="button" onClick={generate} disabled={!!busy || !clinic || !labName.trim()} className="px-4 py-2 bg-teal-600 text-white rounded-lg disabled:opacity-50">Preview PDF</button>
              <button type="button" onClick={save} disabled={!!busy || !pdf} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">Save & replace report</button>
            </div>}
            {previewUrl && <iframe src={previewUrl} title="Letterhead report preview" className="w-full h-[55vh] border rounded-lg" />}
            {(pdf || saved) && <div className="flex flex-wrap gap-3">
              <button type="button" disabled={!!busy} onClick={download} className="inline-flex items-center gap-1 text-sm text-blue-700"><Download className="w-4 h-4" />Download PDF</button>
              {saved && <button type="button" onClick={() => { setMode('send'); setNotice(''); }} disabled={!!busy} className="inline-flex items-center gap-1 text-sm text-green-700"><MessageCircle className="w-4 h-4" />Send saved report to patient</button>}
            </div>}
          </>}
          {mode === 'send' && <>
            <div className="p-4 bg-gray-50 rounded-lg text-sm space-y-1">
              <p><strong>Patient:</strong> {patient.name}</p>
              <p><strong>WhatsApp number:</strong> {patient.phone || 'No phone number saved'}</p>
              <p><strong>Report:</strong> {current.label || 'Clinical report'}</p>
              {current.performingLab && <p><strong>Tests performed by:</strong> {current.performingLab}</p>}
              <a href={current.url} target="_blank" rel="noopener noreferrer" className="inline-block text-blue-700 underline">Review report</a>
            </div>
            {!patient.phone && <p className="text-sm text-amber-700">Add the patient's phone number in their record before sending.</p>}
            <button type="button" onClick={send} disabled={!!busy || !patient.phone || sent} className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg disabled:opacity-50"><MessageCircle className="w-4 h-4" />{sent ? 'Submitted to WhatsApp' : 'Send via WhatsApp'}</button>
          </>}
          {busy && <p role="status" className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="w-4 h-4 animate-spin" />{busy}</p>}
        </div>
      </div>
    </div>
  );
};

export default ReportActionsModal;
