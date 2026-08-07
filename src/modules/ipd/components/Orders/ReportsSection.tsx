import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  Upload, FileText, ExternalLink, Eye, Trash2, Microscope, Scan, Loader2, CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { reportService } from '../../services/reportService';
import type { IpdOrderItem, IpdReport } from '../../types/ipd';

interface Props {
  admissionId: string;
  /** open order lines a report can be filed against */
  orderItems: IpdOrderItem[];
  readOnly: boolean;
  onChange?: () => void;
}

const TYPES: Array<{ key: IpdReport['report_type']; label: string; icon: typeof Microscope }> = [
  { key: 'pathology', label: 'Pathology', icon: Microscope },
  { key: 'radiology', label: 'Radiology', icon: Scan },
  { key: 'cardiology', label: 'Cardiology', icon: FileText },
  { key: 'other', label: 'Other', icon: FileText },
];

/** Pathology / radiology reports: upload the PDF or image, or type findings for
    results phoned in from the lab. Filing against an order marks it resulted. */
export default function ReportsSection({ admissionId, orderItems, readOnly, onChange }: Props) {
  const { clinicId, profile } = useAuth();
  const [reports, setReports] = useState<IpdReport[]>([]);
  const [filter, setFilter] = useState<IpdReport['report_type'] | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    reportType: 'pathology' as IpdReport['report_type'],
    title: '',
    reportDate: new Date().toISOString().slice(0, 10),
    performedAt: '',
    orderItemId: '',
    findings: '',
    impression: '',
    isAbnormal: false,
    fileUrl: '' as string | null,
    fileName: '' as string | null,
    mimeType: '' as string | null,
  });

  const reload = useCallback(() => {
    reportService.list(admissionId).then(setReports).catch((e) => toast.error(e.message));
  }, [admissionId]);

  useEffect(reload, [reload]);

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const up = await reportService.uploadFile(admissionId, file);
      setForm((f) => ({
        ...f,
        fileUrl: up.url,
        fileName: up.name,
        mimeType: up.mime,
        title: f.title || up.name.replace(/\.[^.]+$/, ''),
      }));
      toast.success('File uploaded');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (!clinicId) return;
    if (!form.title.trim()) { toast.error('Give the report a title'); return; }
    if (!form.fileUrl && !form.findings.trim() && !form.impression.trim()) {
      toast.error('Upload a file or type the findings');
      return;
    }
    setSaving(true);
    try {
      await reportService.create({
        clinicId,
        admissionId,
        orderItemId: form.orderItemId || null,
        reportType: form.reportType,
        title: form.title.trim(),
        reportDate: form.reportDate,
        performedAt: form.performedAt.trim() || null,
        fileUrl: form.fileUrl,
        fileName: form.fileName,
        mimeType: form.mimeType,
        findings: form.findings.trim() || null,
        impression: form.impression.trim() || null,
        isAbnormal: form.isAbnormal,
        userId: profile?.id,
      });
      toast.success('Report filed to the chart');
      setForm({
        reportType: form.reportType,
        title: '', reportDate: new Date().toISOString().slice(0, 10), performedAt: '',
        orderItemId: '', findings: '', impression: '', isAbnormal: false,
        fileUrl: '', fileName: '', mimeType: '',
      });
      setShowForm(false);
      reload();
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const shown = filter === 'all' ? reports : reports.filter((r) => r.report_type === filter);
  const pendingItems = orderItems.filter((i) => !['cancelled', 'done'].includes(i.status));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-sm ${filter === 'all' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
          >
            All ({reports.length})
          </button>
          {TYPES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm ${filter === key ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label} ({reports.filter((r) => r.report_type === key).length})
            </button>
          ))}
        </div>
        {!readOnly && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="ml-auto flex items-center gap-1.5 bg-navy-700 hover:bg-navy-800 text-white text-sm px-3 py-1.5 rounded-lg"
          >
            <Upload className="w-4 h-4" /> Upload report
          </button>
        )}
      </div>

      {showForm && !readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={form.reportType}
              onChange={(e) => setForm({ ...form, reportType: e.target.value as IpdReport['report_type'] })}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            >
              {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Report title (e.g. CBC, Chest X-ray PA)"
              className="flex-1 min-w-48 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
            />
            <input
              type="date"
              value={form.reportDate}
              onChange={(e) => setForm({ ...form, reportDate: e.target.value })}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            />
            <input
              value={form.performedAt}
              onChange={(e) => setForm({ ...form, performedAt: e.target.value })}
              placeholder="Lab / imaging centre"
              className="w-44 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={form.orderItemId}
              onChange={(e) => setForm({ ...form, orderItemId: e.target.value })}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm max-w-72"
              title="Against which order?"
            >
              <option value="">Not linked to an order (outside report)</option>
              {pendingItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.service?.name ?? 'Ordered item'} — {i.status}
                </option>
              ))}
            </select>

            <input ref={fileRef} type="file" onChange={pickFile}
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.dcm" className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 border border-slate-300 text-slate-600 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Attach PDF / image'}
            </button>
            {form.fileName && (
              <span className="text-xs text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> {form.fileName}
              </span>
            )}
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.isAbnormal}
                onChange={(e) => setForm({ ...form, isAbnormal: e.target.checked })}
              />
              Abnormal / critical
            </label>
          </div>

          <textarea
            value={form.findings}
            onChange={(e) => setForm({ ...form, findings: e.target.value })}
            rows={2}
            placeholder="Findings / values (optional when a file is attached)…"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={form.impression}
            onChange={(e) => setForm({ ...form, impression: e.target.value })}
            placeholder="Impression / conclusion"
            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          />

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
            >
              {saving ? 'Filing…' : 'File report'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {shown.map((r) => (
          <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                r.report_type === 'radiology' ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'
              }`}>
                {r.report_type}
              </span>
              <span className="font-medium text-slate-800">{r.title}</span>
              {r.is_abnormal && (
                <span className="text-[10px] uppercase font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                  abnormal
                </span>
              )}
              <span className="text-xs text-slate-400">
                {format(new Date(r.report_date), 'dd MMM yyyy')}
                {r.performed_at ? ` · ${r.performed_at}` : ''}
                {r.order_item?.service?.name ? ` · for ${r.order_item.service.name}` : ''}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                {r.file_url && (
                  <a
                    href={r.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                    title="Open report file"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                {r.status === 'filed' && !readOnly && (
                  <button
                    onClick={async () => {
                      try {
                        await reportService.markReviewed(r.id, profile?.id);
                        reload();
                      } catch (e) { toast.error((e as Error).message); }
                    }}
                    className="flex items-center gap-1 text-xs border border-emerald-300 text-emerald-700 rounded-lg px-2 py-1 hover:bg-emerald-50"
                    title="Mark as seen by the doctor"
                  >
                    <Eye className="w-3.5 h-3.5" /> Mark reviewed
                  </button>
                )}
                {r.status === 'reviewed' && (
                  <span className="text-xs text-emerald-700">reviewed ✓</span>
                )}
                {!readOnly && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Remove "${r.title}" from the chart?`)) return;
                      try {
                        await reportService.remove(r.id);
                        reload();
                      } catch (e) { toast.error((e as Error).message); }
                    }}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </span>
            </div>
            {r.findings && <p className="text-slate-600 mt-1.5 whitespace-pre-wrap">{r.findings}</p>}
            {r.impression && (
              <p className="text-slate-700 mt-1"><span className="text-slate-400">Impression:</span> {r.impression}</p>
            )}
          </div>
        ))}
        {shown.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-400">
            No {filter === 'all' ? '' : filter} reports filed yet — upload the PDF or type the values as they come in.
          </div>
        )}
      </div>
    </div>
  );
}
