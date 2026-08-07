import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Copy, Check, Send, RefreshCw, ExternalLink, FolderUp } from 'lucide-react';
import { patientDocumentService, PatientUploadedDoc, DOC_TYPE_LABELS } from '../../services/patientDocumentService';

interface Props {
  patientId: string;
  patientName?: string;
  patientPhone?: string;
  /** Optional context label, e.g. for IPD admissions */
  contextLabel?: string;
}

/** Normalise an Indian mobile number to wa.me digits (adds 91 for bare 10-digit). */
const waDigits = (phone?: string): string => {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const PatientDocumentsPanel: React.FC<Props> = ({ patientId, patientName, patientPhone, contextLabel }) => {
  const [link, setLink] = useState('');
  const [docs, setDocs] = useState<PatientUploadedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [l, d] = await Promise.all([
        patientDocumentService.getUploadLink(patientId),
        patientDocumentService.listDocuments(patientId),
      ]);
      setLink(l);
      setDocs(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — long-press the link to copy manually.');
    }
  };

  const sendWhatsApp = () => {
    const digits = waDigits(patientPhone);
    const msg =
      `Dear ${patientName || 'Patient'}, please upload your documents (ID, insurance/TPA policy, ` +
      `reports) securely using this link:\n${link}`;
    const url = digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener');
  };

  const viewDoc = async (d: PatientUploadedDoc) => {
    try {
      const url = await patientDocumentService.getSignedUrl(d.storage_path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open document');
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FolderUp className="w-4 h-4 text-blue-600" />
        <span className="font-medium text-sm text-gray-800">Patient documents (TPA / insurance)</span>
        {contextLabel && <span className="text-xs text-gray-400">· {contextLabel}</span>}
        <button
          onClick={load}
          className="ml-auto p-1 text-gray-400 hover:text-gray-600"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-gray-500">
        Share this patient-specific link so they can upload ID, policy copy, OPD paper and external
        reports from their phone. No login needed.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={link}
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-600 bg-gray-50"
        />
        <button
          onClick={copyLink}
          disabled={!link}
          className="flex items-center gap-1 text-sm border border-gray-300 text-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
        >
          {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={sendWhatsApp}
          disabled={!link}
          className="flex items-center gap-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          <Send className="w-4 h-4" /> WhatsApp
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="space-y-1.5">
        {loading ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-xs text-gray-400">No documents uploaded yet.</p>
        ) : (
          docs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm border border-gray-100 rounded-lg px-3 py-2">
              <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate text-gray-700">{d.file_name}</span>
              <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full whitespace-nowrap">
                {DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type}
              </span>
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {new Date(d.uploaded_at).toLocaleDateString('en-IN')}
              </span>
              <button onClick={() => viewDoc(d)} className="p-1 text-blue-600 hover:text-blue-800" title="View">
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PatientDocumentsPanel;
