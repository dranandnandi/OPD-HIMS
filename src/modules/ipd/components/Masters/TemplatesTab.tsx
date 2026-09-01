import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, Plus, Save, ShieldCheck, Sparkles, X } from 'lucide-react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
  ClassicEditor, Essentials, Paragraph, Bold, Italic, Underline, Heading,
  List, Table, TableToolbar, Alignment, Link, FontSize, HorizontalLine,
  SourceEditing,
} from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';
import { useAuth } from '../../contexts/AuthContext';
import {
  documentService, docTypePermission, DOC_AUTHOR_LEVELS, DOC_TYPES, DocAuthorPermission,
  DocTypeAccessMap, DocumentTemplate, PLACEHOLDER_CATALOG,
} from '../../services/documentService';
import { aiAssistantService } from '../../services/aiAssistantService';

interface Props {
  clinicId: string;
}

export default function TemplatesTab({ clinicId }: Props) {
  const { profile } = useAuth();
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [docType, setDocType] = useState<string>('discharge_summary');
  const [html, setHtml] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiOpen, setAiOpen] = useState<'new' | 'revise' | null>(null);
  const [access, setAccess] = useState<DocTypeAccessMap>({});
  const [seeding, setSeeding] = useState(false);
  const editorRef = useRef<ClassicEditor | null>(null);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const reload = useCallback(() => {
    documentService
      .listTemplates(clinicId)
      .then(setTemplates)
      .catch((e) => toast.error(e.message));
  }, [clinicId]);

  const reloadAccess = useCallback(() => {
    documentService
      .listDocTypeAccess(clinicId)
      .then(setAccess)
      .catch(() => setAccess({}));
  }, [clinicId]);

  useEffect(reload, [reload]);
  useEffect(reloadAccess, [reloadAccess]);

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const n = await documentService.seedDefaultTemplates(clinicId);
      toast.success(
        n > 0
          ? `${n} default template(s) created or refreshed`
          : 'Default templates are already up to date'
      );
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  const changeAccess = async (docType: string, permission: DocAuthorPermission) => {
    // back to the built-in mapping when the choice matches it
    const isDefault = permission === docTypePermission(docType);
    setAccess((prev) => {
      const next = { ...prev };
      if (isDefault) delete next[docType];
      else next[docType] = permission;
      return next;
    });
    try {
      await documentService.setDocTypeAccess({
        clinicId,
        docType,
        permission: isDefault ? null : permission,
        userId: profile?.id,
      });
    } catch (e) {
      toast.error((e as Error).message);
      reloadAccess();
    }
  };

  const open = (t: DocumentTemplate) => {
    setSelectedId(t.id);
    setName(t.name);
    setDocType(t.doc_type);
    setHtml(t.html_template);
  };

  const openNew = () => {
    setSelectedId('new');
    setName('');
    setDocType('discharge_summary');
    setHtml('<h2 style="text-align:center">TITLE</h2><p>Body — insert placeholders from the panel on the right.</p>');
  };

  const insertPlaceholder = (key: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.model.change((writer) => {
      editor.model.insertContent(writer.createText(`{{${key}}}`));
    });
    editor.editing.view.focus();
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error('Template name is required');
      return;
    }
    setSaving(true);
    try {
      if (selectedId === 'new') {
        const created = await documentService.createTemplate({
          clinicId,
          docType,
          name: name.trim(),
          htmlTemplate: html,
          userId: profile?.id,
        });
        toast.success('Template created');
        reload();
        setSelectedId(created.id);
      } else if (selected) {
        await documentService.updateTemplate(
          selected.id,
          { name: name.trim(), htmlTemplate: html },
          selected.version
        );
        toast.success('Template saved');
        reload();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t: DocumentTemplate) => {
    try {
      await documentService.updateTemplate(t.id, { isActive: !t.is_active }, t.version);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const applyAiResult = (result: {
    name: string; doc_type: string; html_template: string; summary: string;
  }) => {
    if (aiOpen === 'revise') {
      // keep the open template's identity — only the content is revised
      setHtml(result.html_template);
    } else {
      setSelectedId('new');
      setName(result.name);
      setDocType(result.doc_type);
      setHtml(result.html_template);
    }
    setAiOpen(null);
    toast.success(`${result.summary} — review and Save.`, { duration: 6000 });
  };

  return (
    <div className="space-y-4">
      {/* who may write each document type + one-click default templates */}
      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-navy-600" /> Document types &amp; who may write them
          </p>
          <button
            onClick={seedDefaults}
            disabled={seeding}
            className="ml-auto text-sm border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 rounded-lg px-3 py-1.5"
            title="Create the built-in template for every document type this clinic is missing"
          >
            {seeding ? 'Seeding…' : 'Seed default templates'}
          </button>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {DOC_TYPES.map((d) => {
            const current = docTypePermission(d.key, access);
            const overridden = access[d.key] !== undefined;
            return (
              <div key={d.key} className="flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5">
                <span className="flex-1 min-w-0 text-sm text-slate-700 truncate" title={d.label}>
                  {d.label}
                  {overridden && <span className="ml-1 text-[10px] text-amber-600 uppercase">custom</span>}
                </span>
                <select
                  value={current}
                  onChange={(e) => changeAccess(d.key, e.target.value as DocAuthorPermission)}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-xs max-w-[190px]"
                  title="Who may create, edit and sign this document type"
                >
                  {DOC_AUTHOR_LEVELS.map((l) => (
                    <option key={l.key} value={l.key}>{l.label}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-400 mt-2 leading-snug">
          Everyone with the Documents permission can open, print and download every type — this
          sets who may <b>write and sign</b> each one. Doctors (Clinical Documents) can always
          write nursing documents. The same rule is enforced in the database, so changing it
          here changes it everywhere. Per-user grants live in Masters → Users.
        </p>
      </div>

    <div className="grid lg:grid-cols-[280px,1fr] gap-4 items-start">
      {aiOpen && (
        <AiTemplateModal
          mode={aiOpen}
          current={
            aiOpen === 'revise' && selectedId !== null
              ? { name, doc_type: docType, html }
              : undefined
          }
          onClose={() => setAiOpen(null)}
          onResult={applyAiResult}
        />
      )}

      {/* template list */}
      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <button
          onClick={openNew}
          className="w-full flex items-center justify-center gap-1.5 bg-navy-700 hover:bg-navy-800 text-white text-sm px-3 py-1.5 rounded-lg mb-2"
        >
          <Plus className="w-4 h-4" /> New template
        </button>
        <button
          onClick={() => setAiOpen('new')}
          className="w-full flex items-center justify-center gap-1.5 border border-violet-300 text-violet-700 hover:bg-violet-50 text-sm px-3 py-1.5 rounded-lg mb-3"
        >
          <Sparkles className="w-4 h-4" /> AI template
        </button>
        <div className="space-y-1">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => open(t)}
              className={`w-full text-left rounded-lg px-2.5 py-2 text-sm border ${
                selectedId === t.id
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-transparent hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <FileText className="w-3.5 h-3.5 text-navy-600 shrink-0" />
                <span className="truncate">{t.name}</span>
              </span>
              <span className="text-xs text-slate-400 capitalize">
                {t.doc_type.replace(/_/g, ' ')} · v{t.version}
                {!t.is_active && <span className="ml-1 text-rose-500">inactive</span>}
              </span>
            </button>
          ))}
          {templates.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4">
              No templates yet — the default discharge summary is created on first use,
              or start one here.
            </p>
          )}
        </div>
      </div>

      {/* editor */}
      {selectedId === null ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">
          Select a template to edit, or create a new one. Placeholders like{' '}
          <code className="bg-slate-100 px-1 rounded">{'{{patient.name}}'}</code> are filled
          from the chart when a document is created for an admission.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Template name *"
              className="flex-1 min-w-[180px] border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
            />
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              disabled={selectedId !== 'new'}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm capitalize disabled:bg-slate-50 disabled:text-slate-400"
              title={selectedId !== 'new' ? 'Document type is fixed after creation' : 'Document type'}
            >
              {DOC_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <button
              onClick={() => setAiOpen('revise')}
              className="flex items-center gap-1.5 text-sm border border-violet-300 text-violet-700 hover:bg-violet-50 rounded-lg px-3 py-1.5"
              title="Describe a change and let AI revise this template"
            >
              <Sparkles className="w-4 h-4" /> Revise with AI
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-1.5"
            >
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
            {selected && (
              <button
                onClick={() => toggleActive(selected)}
                className={`text-sm rounded-lg px-3 py-1.5 border ${
                  selected.is_active
                    ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                    : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                }`}
              >
                {selected.is_active ? 'Deactivate' : 'Activate'}
              </button>
            )}
          </div>

          <div className="grid xl:grid-cols-[1fr,230px] gap-3 items-start">
            <div className="ipd-document-editor bg-white rounded-xl border border-slate-200">
              <CKEditor
                editor={ClassicEditor}
                data={html}
                onReady={(editor) => { editorRef.current = editor; }}
                onChange={(_, editor) => setHtml(editor.getData())}
                config={{
                  licenseKey: 'GPL',
                  plugins: [
                    Essentials, Paragraph, Bold, Italic, Underline, Heading,
                    List, Table, TableToolbar, Alignment, Link, FontSize, HorizontalLine,
                    SourceEditing,
                  ],
                  toolbar: [
                    'heading', '|', 'bold', 'italic', 'underline', 'fontSize', '|',
                    'bulletedList', 'numberedList', 'alignment', '|',
                    'insertTable', 'horizontalLine', 'link', '|', 'sourceEditing', '|',
                    'undo', 'redo',
                  ],
                  table: { contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'] },
                }}
              />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
                Insert placeholder
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDER_CATALOG.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => insertPlaceholder(p.key)}
                    title={`{{${p.key}}}`}
                    className="text-xs bg-slate-100 hover:bg-blue-100 text-slate-600 rounded px-2 py-1"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-3 leading-snug">
                Placeholders are replaced with live chart data (patient, vitals, medications,
                investigations, notes) when the document is created for an admission.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AiTemplateModal({
  mode, current, onClose, onResult,
}: {
  mode: 'new' | 'revise';
  current?: { name: string; doc_type: string; html: string };
  onClose: () => void;
  onResult: (r: { name: string; doc_type: string; html_template: string; summary: string }) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!instruction.trim()) return;
    setBusy(true);
    try {
      const result = await aiAssistantService.generateTemplate({
        instruction: instruction.trim(),
        current,
      });
      onResult(result);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-violet-600" />
            {mode === 'revise'
              ? `Revise "${current?.name || 'template'}" with AI`
              : 'Generate a template with AI'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          autoFocus
          rows={4}
          placeholder={
            mode === 'revise'
              ? 'e.g. add an implant details section with make, size and batch number, and a physiotherapy advice section'
              : 'e.g. surgical consent form for orthopedic procedures with risks list, English with Hindi headings'
          }
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2"
        />
        <p className="text-[11px] text-slate-400 mb-3">
          The result loads into the editor for review — nothing is saved until you press Save.
          Patient/chart placeholders are inserted automatically where they fit.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={generate}
            disabled={busy || !instruction.trim()}
            className="flex items-center gap-1.5 text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-4 py-1.5"
          >
            <Sparkles className="w-4 h-4" />
            {busy ? 'Generating…' : mode === 'revise' ? 'Revise' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}
