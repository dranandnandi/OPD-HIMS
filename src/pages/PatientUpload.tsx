import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, UploadCloud, CheckCircle, XCircle, FileText, ShieldCheck } from 'lucide-react';
import { brand } from '../config/branding';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const DOC_TYPES = [
  { value: 'id_card', label: 'ID card (Aadhaar / PAN / etc.)' },
  { value: 'insurance_policy', label: 'Insurance / TPA policy copy' },
  { value: 'opd_paper', label: 'OPD / prescription paper' },
  { value: 'external_report', label: 'External lab / radiology report' },
  { value: 'other', label: 'Other document' },
];

interface Uploaded {
  name: string;
  docType: string;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

const PatientUpload: React.FC = () => {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('c');

  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  const [patientName, setPatientName] = useState('');
  const [clinicName, setClinicName] = useState('');

  const [docType, setDocType] = useState('insurance_policy');
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<Uploaded[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!code) { setStatus('not_found'); return; }
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/patient-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'info', code }),
        });
        const result = await res.json();
        if (result.status === 'ok') {
          setPatientName(result.patientName || '');
          setClinicName(result.clinicName || '');
          setStatus('ready');
        } else if (result.status === 'not_found') {
          setStatus('not_found');
        } else {
          setStatus('error');
        }
      } catch {
        setStatus('error');
      }
    })();
  }, [code]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !code) return;
    setErrorMsg(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 15 * 1024 * 1024) {
          setErrorMsg(`"${file.name}" is larger than 15 MB and was skipped.`);
          continue;
        }
        const base64 = await fileToBase64(file);
        const res = await fetch(`${SUPABASE_URL}/functions/v1/patient-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upload',
            code,
            docType,
            fileName: file.name,
            contentType: file.type,
            fileBase64: base64,
          }),
        });
        const result = await res.json();
        if (result.status === 'ok') {
          setUploaded((prev) => [{ name: file.name, docType }, ...prev]);
        } else {
          setErrorMsg(result.error || `Failed to upload "${file.name}"`);
        }
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const docLabel = (v: string) => DOC_TYPES.find((d) => d.value === v)?.label ?? v;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-3 shadow-lg">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Upload Documents</h1>
          <p className="text-sm text-gray-500 mt-1">Powered by {brand.companyShort}</p>
        </div>

        {status === 'loading' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-4" />
            <p className="text-gray-600 font-medium">Loading…</p>
          </div>
        )}

        {status === 'not_found' && (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="bg-red-500 px-6 py-4 flex items-center gap-3">
              <XCircle className="w-6 h-6 text-white flex-shrink-0" />
              <p className="text-white font-bold text-lg">Invalid link</p>
            </div>
            <div className="p-6 text-center text-gray-600">
              This upload link is invalid or has expired. Please contact the clinic for a new link.
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <XCircle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
            <p className="text-gray-700 font-semibold">Something went wrong</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
            >
              Retry
            </button>
          </div>
        )}

        {status === 'ready' && (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="bg-blue-600 px-6 py-4">
              <p className="text-white font-bold text-lg">{patientName || 'Patient'}</p>
              {clinicName && <p className="text-blue-100 text-xs">{clinicName}</p>}
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Please upload clear photos or PDFs of the requested documents. Your files are sent
                securely to the clinic.
              </p>

              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">
                  Document type
                </label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {DOC_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>

              <label
                className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-8 cursor-pointer transition-colors ${
                  uploading ? 'border-gray-200 bg-gray-50' : 'border-blue-300 hover:bg-blue-50'
                }`}
              >
                {uploading ? (
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                ) : (
                  <UploadCloud className="w-8 h-8 text-blue-500" />
                )}
                <span className="text-sm font-medium text-gray-700">
                  {uploading ? 'Uploading…' : 'Tap to take a photo or choose files'}
                </span>
                <span className="text-xs text-gray-400">Images or PDF · up to 15 MB each</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  disabled={uploading}
                  onChange={(e) => handleFiles(e.target.files)}
                  className="hidden"
                />
              </label>

              {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}

              {uploaded.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                    Uploaded ({uploaded.length})
                  </p>
                  {uploaded.map((u, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                      <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-gray-700">{u.name}</span>
                      <span className="text-xs text-gray-400">{docLabel(u.docType)}</span>
                    </div>
                  ))}
                  <p className="text-xs text-gray-400 pt-1">
                    Done? You can close this page — the clinic has received your documents.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          &copy; {new Date().getFullYear()} {brand.companyShort} · Secure document upload
        </p>
      </div>
    </div>
  );
};

export default PatientUpload;
