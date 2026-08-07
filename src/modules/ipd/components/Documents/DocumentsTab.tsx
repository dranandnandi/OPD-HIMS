import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { FileText, Printer, PenLine, CheckCircle2, Plus, FileDown, Sparkles } from 'lucide-react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
  ClassicEditor, Essentials, Paragraph, Bold, Italic, Underline, Heading,
  List, Table, TableToolbar, Alignment, Link, FontSize, HorizontalLine,
} from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';
import { useAuth } from '../../contexts/AuthContext';
import { documentService, DocumentTemplate, IpdDocument } from '../../services/documentService';
import type { Admission } from '../../types/ipd';

interface Props {
  admission: Admission;
}

export default function DocumentsTab({ admission }: Props) {
  const { clinicId, profile } = useAuth();
  const [documents, setDocuments] = useState<IpdDocument[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('default');
  const [editing, setEditing] = useState<IpdDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const [aiCreating, setAiCreating] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    documentService
      .listDocuments(admission.id)
      .then(setDocuments)
      .catch((e) => toast.error(e.message));
  }, [admission.id]);

  useEffect(reload, [reload]);

  useEffect(() => {
    if (!clinicId) return;
    documentService
      .listTemplates(clinicId, true)
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [clinicId]);

  const createSummary = async (useAi = false) => {
    if (!clinicId) return;
    const setBusy = useAi ? setAiCreating : setCreating;
    setBusy(true);
    try {
      const doc = await documentService.createFromTemplate({
        clinicId,
        admission,
        docType: 'discharge_summary',
        templateId: templateId === 'default' ? undefined : templateId,
        useAi,
        userId: profile?.id,
      });
      toast.success(useAi ? 'AI draft created — please review before signing' : 'Draft document created');
      setDocuments((prev) => [doc, ...prev]);
      setEditing(doc);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openPdf = async (d: IpdDocument) => {
    if (!clinicId) return;
    if (d.pdf_url) {
      window.open(d.pdf_url, '_blank', 'noopener');
      return;
    }
    setPdfBusy(d.id);
    try {
      const url = await documentService.generateDocumentPdf({ doc: d, admission, clinicId });
      window.open(url, '_blank', 'noopener');
      toast.success('PDF generated — permanent copy saving in background');
      setTimeout(reload, 8000); // pick up the permanent pdf_url
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPdfBusy(null);
    }
  };

  if (editing) {
    return (
      <DocumentEditor
        doc={editing}
        admission={admission}
        onClose={() => {
          setEditing(null);
          reload();
        }}
      />
    );
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 flex flex-wrap items-center gap-2">
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm max-w-[280px]"
          title="Template"
        >
          <option value="default">Default Discharge Summary</option>
          {templates
            .filter((t) => !(t.doc_type === 'discharge_summary' && t.name === 'Default Discharge Summary'))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.doc_type.replace(/_/g, ' ')}
              </option>
            ))}
        </select>
        <button
          onClick={() => createSummary(false)}
          disabled={creating || aiCreating}
          className="flex items-center gap-1.5 bg-navy-700 hover:bg-navy-800 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
        >
          <Plus className="w-4 h-4" />
          {creating ? 'Creating…' : 'New document'}
        </button>
        <button
          onClick={() => createSummary(true)}
          disabled={creating || aiCreating}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
          title="AI writes the hospital course, advice & follow-up, and condition from the chart"
        >
          <Sparkles className="w-4 h-4" />
          {aiCreating ? 'Generating…' : 'AI draft'}
        </button>
        <span className="text-xs text-slate-400">
          Auto-fills patient, diagnosis, vitals, medications, investigations and round notes
          from the chart. <b>AI draft</b> also writes the hospital-course narrative, advice and
          condition — always review before signing. Manage templates in Masters → Document Templates.
        </span>
      </div>

      <div className="space-y-2">
        {documents.map((d) => (
          <div key={d.id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3 text-sm">
            <FileText className="w-5 h-5 text-navy-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800">
                {d.doc_type.replace(/_/g, ' ')}
                <span className="ml-2 text-xs text-slate-400">{d.document_number}</span>
              </p>
              <p className="text-xs text-slate-400">
                {format(new Date(d.created_at), 'dd MMM yyyy, HH:mm')}
                {d.pdf_url && <span className="ml-2 text-emerald-600">PDF saved ✓</span>}
              </p>
            </div>
            <span
              className={`text-xs uppercase px-2 py-0.5 rounded ${
                d.status === 'signed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {d.status}
            </span>
            <button
              onClick={() => setEditing(d)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              title={d.status === 'draft' ? 'Edit' : 'View'}
            >
              <PenLine className="w-4 h-4" />
            </button>
            <button
              onClick={() => openPdf(d)}
              disabled={pdfBusy === d.id}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              title="Server PDF (letterhead from clinic settings)"
            >
              <FileDown className="w-4 h-4" />
            </button>
            <button
              onClick={() =>
                documentService.printDocument({ doc: d, admission, clinicName: 'MediTrust Clinics' })
              }
              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              title="Quick browser print"
            >
              <Printer className="w-4 h-4" />
            </button>
          </div>
        ))}
        {documents.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-400">
            No documents yet — create the discharge summary when the patient is ready to go home.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DocumentEditor({
  doc, admission, onClose,
}: {
  doc: IpdDocument; admission: Admission; onClose: () => void;
}) {
  const { clinicId, profile } = useAuth();
  const [content, setContent] = useState(doc.content_html);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const readOnly = doc.status !== 'draft';

  const save = async () => {
    setSaving(true);
    try {
      await documentService.saveContent(doc.id, content);
      toast.success('Draft saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const sign = async () => {
    setSigning(true);
    try {
      await documentService.saveContent(doc.id, content);
      await documentService.finalize(doc.id, profile?.id);
      toast.success('Document signed');
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSigning(false);
    }
  };

  const serverPdf = async () => {
    if (!clinicId) return;
    setPdfBusy(true);
    try {
      const url = await documentService.generateDocumentPdf({
        doc: { ...doc, content_html: content },
        admission,
        clinicId,
        forceRegenerate: true,
      });
      window.open(url, '_blank', 'noopener');
      toast.success('PDF generated');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 flex flex-wrap items-center gap-2">
        <button onClick={onClose} className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5">
          ← Back
        </button>
        <span className="text-sm font-medium text-slate-700 flex-1">
          {doc.doc_type.replace(/_/g, ' ')} {doc.document_number} — {readOnly ? 'signed (read-only)' : 'draft'}
        </span>
        {!readOnly && (
          <>
            <button
              onClick={save}
              disabled={saving}
              className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-1.5"
            >
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            <button
              onClick={sign}
              disabled={signing}
              className="flex items-center gap-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg px-4 py-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              {signing ? 'Signing…' : 'Finalize & sign'}
            </button>
          </>
        )}
        <button
          onClick={serverPdf}
          disabled={pdfBusy}
          className="flex items-center gap-1.5 text-sm border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
        >
          <FileDown className="w-4 h-4" /> {pdfBusy ? 'Generating…' : 'PDF'}
        </button>
        <button
          onClick={() =>
            documentService.printDocument({
              doc: { ...doc, content_html: content },
              admission,
              clinicName: 'MediTrust Clinics',
            })
          }
          className="flex items-center gap-1.5 text-sm border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-50"
        >
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      <div className="max-w-3xl mx-auto ipd-document-editor">
        {readOnly ? (
          <div
            className="bg-white rounded-xl border border-slate-200 p-8 min-h-[60vh] text-sm leading-relaxed ck-content"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        ) : (
          <CKEditor
            editor={ClassicEditor}
            data={content}
            onChange={(_, editor) => setContent(editor.getData())}
            config={{
              licenseKey: 'GPL',
              plugins: [
                Essentials, Paragraph, Bold, Italic, Underline, Heading,
                List, Table, TableToolbar, Alignment, Link, FontSize, HorizontalLine,
              ],
              toolbar: [
                'heading', '|', 'bold', 'italic', 'underline', 'fontSize', '|',
                'bulletedList', 'numberedList', 'alignment', '|',
                'insertTable', 'horizontalLine', 'link', '|', 'undo', 'redo',
              ],
              table: { contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'] },
            }}
          />
        )}
      </div>
    </div>
  );
}
