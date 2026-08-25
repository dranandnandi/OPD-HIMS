import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Mic, Square, Pause, Loader2, Keyboard, CheckCircle2, Sparkles, X, FileText,
} from 'lucide-react';
import {
  documentVoiceService, DocumentDictationResult, DocumentField, DictatedSection,
} from '../../services/documentVoiceService';
import type { ComposeSubject } from '../../services/documentSubject';

interface Props {
  docType: string;
  documentNumber: string | null;
  /** who the document is for — an admission, or a pre-admission estimate form */
  subject: ComposeSubject;
  /** live editor content — the fields offered are read out of this */
  contentHtml: string;
  /** hand back the rewritten HTML; the editor saves it as the draft */
  onApply: (html: string) => Promise<void> | void;
}

/** One reviewable line of the result: what the model said, where it will go */
interface Draft extends DictatedSection {
  include: boolean;
}

/**
 * Dictate straight into a document. The document's own headings are read out
 * as the field list, sent along as context, and the transcript comes back
 * already assigned to those fields — each row re-routable before it is
 * written into the draft.
 */
export default function DocumentVoiceDictation({
  docType, documentNumber, subject, contentHtml, onApply,
}: Props) {
  const [open, setOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [result, setResult] = useState<DocumentDictationResult | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [applying, setApplying] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Re-read on every content change, but only while the panel is open — the
  // editor fires onChange per keystroke and this parses the whole document.
  const fields: DocumentField[] = useMemo(
    () => (open ? documentVoiceService.extractDocumentFields(contentHtml, docType) : []),
    [open, contentHtml, docType]
  );

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const labelFor = (fieldId: string) =>
    fields.find((f) => f.id === fieldId)?.label ?? 'New section';

  const startRecording = async () => {
    setResult(null);
    setDrafts([]);
    setSeconds(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size > 0) transcribe(blob);
      };
      rec.start(1000);
      setIsRecording(true);
      setIsPaused(false);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      toast.error('Could not access the microphone — grant permission and retry');
    }
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setIsRecording(false);
    setIsPaused(false);
    stopTimer();
  };

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (isPaused) {
      rec.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else {
      rec.pause();
      setIsPaused(true);
      stopTimer();
    }
  };

  const runDictation = async (payload: { audioBase64?: string; textInput?: string }) => {
    if (fields.length === 0) {
      toast.error('This document has no headings to dictate into — add a section heading first');
      return;
    }
    setProcessing(true);
    try {
      const context = documentVoiceService.buildDocumentContext(
        subject,
        { doc_type: docType, document_number: documentNumber },
        fields
      );
      const data = await documentVoiceService.dictate({ ...payload, context });
      setResult(data);
      setDrafts(data.sections.map((s) => ({ ...s, include: true })));
      if (data.sections.length === 0) {
        toast('Nothing matched a section — check the transcript below', { icon: '⚠️' });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const transcribe = async (blob: Blob) => {
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(blob);
    });
    await runDictation({ audioBase64: base64 });
  };

  const updateDraft = (idx: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d, i) => (i === idx ? { ...d, ...patch } : d)));

  const apply = async () => {
    const chosen = drafts.filter((d) => d.include && d.text.trim());
    if (chosen.length === 0) {
      toast.error('Nothing selected to write into the document');
      return;
    }
    setApplying(true);
    try {
      const { html, applied } = documentVoiceService.applyDictationToHtml(
        contentHtml,
        chosen,
        docType
      );
      await onApply(html);
      toast.success(`Written to: ${applied.join(', ')}`, { duration: 5000 });
      setResult(null);
      setDrafts([]);
      setTypedText('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white text-sm px-3 py-1.5 rounded-lg"
        title="Dictate into this document's sections"
      >
        <Mic className="w-4 h-4" /> Dictate
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-violet-200 w-full overflow-hidden">
      <div className="bg-gradient-to-r from-violet-50 to-blue-50 px-4 py-2.5 border-b border-violet-100 flex flex-wrap items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-semibold text-slate-800">Document dictation</span>
        <span className="text-xs text-slate-500 hidden sm:inline">
          speak the content — each part is filed into this document's own sections
        </span>
        <button
          onClick={() => { setOpen(false); if (isRecording) stopRecording(); }}
          className="ml-auto p-1 rounded text-slate-400 hover:text-slate-700"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* The context the model is given — the operator can see it too */}
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {fields.length} section{fields.length === 1 ? '' : 's'} available in this document
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {fields.map((f) => (
              <span
                key={f.id}
                className={`px-2 py-0.5 rounded border ${
                  f.currentText
                    ? 'bg-slate-50 border-slate-200 text-slate-600'
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}
                title={f.currentText || 'empty'}
              >
                {f.label}
                {!f.currentText && ' · empty'}
              </span>
            ))}
            {fields.length === 0 && (
              <span className="text-amber-700">
                No headings found — add a section heading to the document first.
              </span>
            )}
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          {!isRecording ? (
            <button
              onClick={startRecording}
              disabled={processing || fields.length === 0}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
            >
              <Mic className="w-4 h-4" /> {result ? 'Dictate again' : 'Start dictation'}
            </button>
          ) : (
            <>
              <button
                onClick={togglePause}
                className={`flex items-center gap-2 text-white text-sm px-3 py-2 rounded-lg ${isPaused ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-500 hover:bg-amber-600'}`}
              >
                {isPaused ? <Mic className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-2 rounded-lg"
              >
                <Square className="w-4 h-4" /> Stop & transcribe
              </button>
              <span className={`text-sm font-mono px-2 py-1 rounded ${isPaused ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                {isPaused ? 'PAUSED' : '● REC'} {fmt(seconds)}
              </span>
            </>
          )}

          <button
            onClick={() => setTyping((t) => !t)}
            className="flex items-center gap-1.5 border border-slate-300 text-slate-600 text-sm px-3 py-2 rounded-lg hover:bg-slate-50"
          >
            <Keyboard className="w-4 h-4" /> Type instead
          </button>

          {processing && (
            <span className="flex items-center gap-1.5 text-sm text-violet-700">
              <Loader2 className="w-4 h-4 animate-spin" /> Placing it into the sections…
            </span>
          )}
        </div>

        {typing && (
          <div className="space-y-2">
            <textarea
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              rows={3}
              placeholder="e.g. Hospital course — admitted with fever and cough, treated with IV antibiotics for four days, became afebrile on day three. Condition at discharge stable. Advice: tablet Augmentin 625 twice daily for five more days, review in OPD after one week, return earlier if fever recurs."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => runDictation({ textInput: typedText })}
              disabled={processing || typedText.trim().length < 10 || fields.length === 0}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
            >
              Place this text
            </button>
          </div>
        )}

        {result && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-500">
                Transcript
                {result.privacyRedactions > 0 && (
                  <span className="ml-2 text-xs text-orange-600">
                    {result.privacyRedactions} sensitive item(s) filtered
                  </span>
                )}
              </summary>
              <p className="mt-1 p-2 bg-slate-50 rounded text-slate-600 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {result.transcript}
              </p>
            </details>

            {drafts.map((d, i) => (
              <div
                key={i}
                className={`rounded-lg border p-2.5 text-sm ${
                  d.include ? 'bg-violet-50 border-violet-200' : 'bg-slate-50 border-slate-200 opacity-70'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <input
                    type="checkbox"
                    checked={d.include}
                    onChange={() => updateDraft(i, { include: !d.include })}
                  />
                  <select
                    value={d.fieldId}
                    onChange={(e) => updateDraft(i, { fieldId: e.target.value })}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs max-w-64 bg-white"
                    title="Which section this goes into"
                  >
                    {fields.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                    <option value="new">
                      + New section{d.heading ? `: ${d.heading}` : ''}
                    </option>
                  </select>
                  {d.fieldId === 'new' && (
                    <input
                      value={d.heading}
                      onChange={(e) => updateDraft(i, { heading: e.target.value })}
                      placeholder="New section heading"
                      className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white"
                    />
                  )}
                  <div className="flex rounded-lg overflow-hidden border border-slate-300 text-xs">
                    {(['append', 'replace'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => updateDraft(i, { mode })}
                        className={`px-2 py-1 ${
                          d.mode === mode ? 'bg-violet-600 text-white' : 'bg-white text-slate-600'
                        }`}
                        title={mode === 'append' ? 'Add below what is already there' : 'Replace this section'}
                      >
                        {mode === 'append' ? 'Add to' : 'Replace'}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-400 ml-auto">
                    → {d.fieldId === 'new' ? (d.heading || 'new section') : labelFor(d.fieldId)}
                  </span>
                </div>
                <textarea
                  value={d.text}
                  onChange={(e) => updateDraft(i, { text: e.target.value })}
                  rows={Math.min(8, Math.max(2, d.text.split('\n').length))}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                />
              </div>
            ))}

            {result.additionalNotes && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm">
                <p className="font-semibold text-slate-700 mb-1">
                  Not placed in any section
                </p>
                <p className="text-slate-600 whitespace-pre-wrap">{result.additionalNotes}</p>
                <button
                  onClick={() =>
                    setDrafts((ds) => [
                      ...ds,
                      {
                        fieldId: 'new',
                        heading: 'Additional Notes',
                        text: result.additionalNotes ?? '',
                        mode: 'append',
                        include: true,
                      },
                    ])
                  }
                  className="mt-1.5 text-xs text-violet-700 hover:text-violet-900 underline"
                >
                  Add this to the document as a section
                </button>
              </div>
            )}

            <button
              onClick={apply}
              disabled={applying || drafts.every((d) => !d.include)}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {applying ? 'Writing into the draft…' : 'Insert & save draft'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
