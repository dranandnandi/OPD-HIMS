import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { FileText, Printer, PenLine, Eye, Plus, FileDown, Sparkles } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  documentService, docTypeLabel, hasNarrativePlaceholders, canAuthorDocType,
  documentErrorMessage, DOC_TYPES, DocumentTemplate, DocTypeAccessMap, IpdDocument,
} from '../../services/documentService';
import DocumentEditor from './DocumentEditor';
import { documentAiService } from '../../services/documentAiService';
import type { Admission } from '../../types/ipd';
import { claimTab, openDocument } from '../../../../services/documentOpener';

interface Props {
  admission: Admission;
}

export default function DocumentsTab({ admission }: Props) {
  const { clinicId, profile, hasPermission } = useAuth();
  // Each document type has a required permission — the clinic's own map, from
  // Masters -> Document Templates, falling back to the built-in one. Everyone
  // with 'ipd_documents' still reads and prints every type. RLS resolves the
  // same map, so this is not the only lock.
  const [access, setAccess] = useState<DocTypeAccessMap>({});
  const canAuthor = (t: string) => canAuthorDocType(t, hasPermission, access);
  const [documents, setDocuments] = useState<IpdDocument[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [docType, setDocType] = useState<string>('admission_sheet');
  const [templateId, setTemplateId] = useState<string>('default');
  const [editing, setEditing] = useState<IpdDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const [aiCreating, setAiCreating] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  // stable identity — the AI panel refetches the rate card when this changes
  const subject = useMemo(() => documentAiService.subjectFromAdmission(admission), [admission]);

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
    documentService
      .listDocTypeAccess(clinicId)
      .then(setAccess)
      .catch(() => setAccess({}));
  }, [clinicId]);

  // Types this user may raise — the ones they cannot write drop out
  const creatableDocTypes = DOC_TYPES.filter((d) => canAuthor(d.key));
  const creatableKeys = creatableDocTypes.map((d) => d.key).join(',');
  // Keep the picker on something this user may actually create
  useEffect(() => {
    const keys = creatableKeys ? creatableKeys.split(',') : [];
    if (keys.length > 0 && !keys.includes(docType)) {
      setDocType(keys[0]);
      setTemplateId('default');
    }
  }, [creatableKeys, docType]);
  // Templates the clinic has authored for the chosen document type
  const docTypeTemplates = templates.filter((t) => t.doc_type === docType);
  const selectedTemplate = docTypeTemplates.find((t) => t.id === templateId) ?? null;
  // The AI writer only has something to do when the template has narrative slots
  const aiSupported = templateId === 'default'
    ? docType === 'discharge_summary'
    : hasNarrativePlaceholders(selectedTemplate?.html_template ?? '');

  const createSummary = async (useAi = false) => {
    if (!clinicId) return;
    const setBusy = useAi ? setAiCreating : setCreating;
    setBusy(true);
    try {
      const doc = await documentService.createFromTemplate({
        clinicId,
        admission,
        docType,
        templateId: templateId === 'default' ? undefined : templateId,
        useAi,
        userId: profile?.id,
      });
      toast.success(useAi ? 'AI draft created — please review before signing' : 'Draft document created');
      setDocuments((prev) => [doc, ...prev]);
      setEditing(doc);
    } catch (e) {
      toast.error(documentErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openPdf = async (d: IpdDocument) => {
    if (!clinicId) return;
    const tab = claimTab();
    setPdfBusy(d.id);
    try {
      await openDocument(tab, {
        entityType: 'ipd_document',
        entityId: d.id,
        variant: 'final',
        generate: () => documentService.generateDocumentPdf({ doc: d, admission, clinicId }),
        onComplete: () => reload(),
        onError: (e) => toast.error((e as Error).message),
      });
    } catch {
      // openDocument closes the claimed tab and reports fallback errors.
    } finally {
      setPdfBusy(null);
    }
  };

  if (editing) {
    return (
      <DocumentEditor
        doc={editing}
        subject={subject}
        admission={admission}
        viewOnly={!canAuthor(editing.doc_type)}
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
          value={docType}
          onChange={(e) => { setDocType(e.target.value); setTemplateId('default'); }}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          title="Document type"
        >
          {creatableDocTypes.map((d) => (
            <option key={d.key} value={d.key}>{d.label}</option>
          ))}
        </select>
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm max-w-[280px]"
          title="Template"
        >
          <option value="default">Default {docTypeLabel(docType)}</option>
          {docTypeTemplates
            .filter((t) => t.name !== `Default ${docTypeLabel(docType)}`)
            .map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
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
          disabled={creating || aiCreating || !aiSupported}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
          title={
            aiSupported
              ? 'AI writes the hospital course, advice & follow-up, and condition from the chart'
              : `This template has no AI narrative sections — create the ${docTypeLabel(docType).toLowerCase()} and dictate into it instead`
          }
        >
          <Sparkles className="w-4 h-4" />
          {aiCreating ? 'Generating…' : 'AI draft'}
        </button>
        <span className="text-xs text-slate-400">
          Auto-fills patient, diagnosis, vitals, medications, investigations and round notes
          from the chart. <b>AI draft</b> also writes the hospital-course narrative, advice and
          condition. Open any draft and use <b>Dictate</b> to speak content into its sections, or
          <b>Write with AI</b> to type a one-line brief (“typhoid fever, 5 days”) and have the
          whole document drafted — on an estimate that includes a costed breakup priced from this
          clinic’s rate card at the admitted bed class. Always review before signing. Manage
          templates in Masters → Document Templates.
        </span>
        {creatableDocTypes.length < DOC_TYPES.length && (
          <p className="w-full text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            {DOC_TYPES.filter((d) => !canAuthor(d.key)).map((d) => d.label).join(', ')} —
            written and signed by the staff your clinic assigns to them. You can open, print
            and download them here, but not change them. Masters → Document Templates sets
            who may write each type.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {documents.map((d) => (
          <div key={d.id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3 text-sm">
            <FileText className="w-5 h-5 text-navy-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800">
                {docTypeLabel(d.doc_type)}
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
              title={
                d.status === 'draft' && canAuthor(d.doc_type) ? 'Edit' : 'View'
              }
            >
              {d.status === 'draft' && canAuthor(d.doc_type)
                ? <PenLine className="w-4 h-4" />
                : <Eye className="w-4 h-4" />}
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
                documentService.printDocument({ doc: d, admission, clinicId: clinicId! })
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
