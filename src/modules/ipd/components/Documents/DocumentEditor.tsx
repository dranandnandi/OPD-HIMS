import { useState } from 'react';
import toast from 'react-hot-toast';
import { Printer, CheckCircle2, FileDown } from 'lucide-react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
  ClassicEditor, Essentials, Paragraph, Bold, Italic, Underline, Heading,
  List, Table, TableToolbar, Alignment, Link, FontSize, HorizontalLine,
} from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';
import { useAuth } from '../../contexts/AuthContext';
import { documentService, docTypeLabel, documentErrorMessage, IpdDocument } from '../../services/documentService';
import type { ComposeSubject } from '../../services/documentSubject';
import DocumentVoiceDictation from './DocumentVoiceDictation';
import DocumentAiCompose from './DocumentAiCompose';
import type { Admission } from '../../types/ipd';
import { claimTab, openDocument } from '../../../../services/documentOpener';

interface Props {
  doc: IpdDocument;
  /** who the document is for — drives dictation context and estimate pricing */
  subject: ComposeSubject;
  /** the stay this document belongs to; null for a pre-admission estimate */
  admission: Admission | null;
  /**
   * Caller-side lock, independent of the document's own status: the viewer may
   * read and print but not write. Used for clinical documents opened by staff
   * without 'ipd_documents_clinical' — RLS refuses the write in any case, this
   * just stops them typing into a form that will not save.
   */
  viewOnly?: boolean;
  onClose: () => void;
}

/**
 * The one editor every IPD document is written in, wherever it was opened
 * from: the admission's Documents tab, or the pre-admission estimate desk on
 * the TPA page. Dictation and the AI composer both work off `subject`, so
 * neither needs an admission to exist.
 */
export default function DocumentEditor({ doc, subject, admission, viewOnly = false, onClose }: Props) {
  const { clinicId, profile } = useAuth();
  const [content, setContent] = useState(doc.content_html);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const signed = doc.status !== 'draft';
  const readOnly = signed || viewOnly;

  const save = async () => {
    setSaving(true);
    try {
      await documentService.saveContent(doc.id, content);
      toast.success('Draft saved');
    } catch (e) {
      toast.error(documentErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  /** Dictation / AI writes into the editor and persists the draft in one step */
  const applyGenerated = async (html: string) => {
    setContent(html);
    await documentService.saveContent(doc.id, html);
  };

  const sign = async () => {
    setSigning(true);
    try {
      await documentService.saveContent(doc.id, content);
      await documentService.finalize(doc.id, profile?.id);
      toast.success('Document signed');
      onClose();
    } catch (e) {
      toast.error(documentErrorMessage(e));
    } finally {
      setSigning(false);
    }
  };

  const serverPdf = async () => {
    if (!clinicId) return;
    const tab = claimTab();
    setPdfBusy(true);
    try {
      await openDocument(tab, {
        entityType: 'ipd_document',
        entityId: doc.id,
        variant: 'final',
        // Drafts may have changed since their last PDF. Signed documents are
        // immutable and should reuse their cached permanent copy.
        forceRegenerate: !signed,
        generate: () => documentService.generateDocumentPdf({
          doc: { ...doc, content_html: content },
          admission,
          clinicId,
          forceRegenerate: !signed,
        }),
        onError: (e) => toast.error((e as Error).message),
      });
    } catch {
      // openDocument closes the claimed tab and reports fallback errors.
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
          {docTypeLabel(doc.doc_type)} {doc.document_number} —{' '}
          {signed
            ? 'signed (read-only)'
            : viewOnly
              ? "draft — the treating doctor's to edit"
              : 'draft'}
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
              clinicId: clinicId!,
            })
          }
          className="flex items-center gap-1.5 text-sm border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-50"
        >
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-start gap-2 mb-3">
          <DocumentVoiceDictation
            docType={doc.doc_type}
            documentNumber={doc.document_number}
            subject={subject}
            contentHtml={content}
            onApply={applyGenerated}
          />
          <DocumentAiCompose
            docType={doc.doc_type}
            documentNumber={doc.document_number}
            subject={subject}
            contentHtml={content}
            onApply={applyGenerated}
          />
        </div>
      )}

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
