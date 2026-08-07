import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Mic, Square, Pause, Loader2, Keyboard, CheckCircle2, Sparkles, X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  voiceService, DictationResult, DictationSelections, AdmissionVoiceContext,
} from '../../services/voiceService';
import { DIET_TYPES } from '../../services/dietService';
import type { Admission, ServiceMaster } from '../../types/ipd';

interface Props {
  admission: Admission;
  /** called after entries were written to the chart */
  onApplied?: () => void;
  /** collapsed by default when embedded in a busy tab */
  defaultOpen?: boolean;
}

/**
 * One dictation → the whole round. The doctor says "today's progress note …,
 * add this medicine …, nursing note …, send for cardiology opinion …" and the
 * transcript is split into the chart's own fields for review before saving.
 */
export default function VoiceDictation({ admission, onApplied, defaultOpen = false }: Props) {
  const { clinicId, profile } = useAuth();
  const [open, setOpen] = useState(defaultOpen);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [result, setResult] = useState<DictationResult | null>(null);
  const [matches, setMatches] = useState<Array<{ suggestion: ServiceMaster | null; options: ServiceMaster[] }>>([]);
  const [selections, setSelections] = useState<DictationSelections | null>(null);
  const [applying, setApplying] = useState(false);
  const [context, setContext] = useState<AdmissionVoiceContext | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open || context) return;
    voiceService.buildContext(admission).then(setContext).catch(() => setContext({}));
  }, [open, admission, context]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const startRecording = async () => {
    setResult(null);
    setSelections(null);
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

  const buildSelections = (data: DictationResult, serviceIds: Array<string | null>): DictationSelections => ({
    plan: true,
    nursingNote: !!data.nursingNote,
    vitals: Object.values(data.vitals ?? {}).some((v) => v !== null && v !== undefined && v !== ''),
    medications: data.medications.map(() => true),
    investigationServiceIds: serviceIds,
    consultations: data.consultations.map(() => true),
    diet: !!data.diet,
    tasks: data.nursingTasks.map(() => true),
    io: data.intakeOutput.map(() => true),
  });

  const runDictation = async (payload: { audioBase64?: string; textInput?: string }) => {
    setProcessing(true);
    try {
      const ctx = context ?? (await voiceService.buildContext(admission));
      setContext(ctx);
      const data = await voiceService.dictate({ ...payload, context: ctx });
      const m = await voiceService.matchInvestigations(clinicId!, data.investigations);
      setResult(data);
      setMatches(m);
      setSelections(buildSelections(data, m.map((x) => x.suggestion?.id ?? null)));
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

  const apply = async () => {
    if (!result || !selections || !clinicId) return;
    setApplying(true);
    try {
      const { applied, failed } = await voiceService.applyDictation({
        clinicId,
        admission,
        userId: profile?.id,
        data: result,
        selections,
      });
      if (applied.length) toast.success(`Saved: ${applied.join(', ')}`, { duration: 5000 });
      if (failed.length) toast.error(`Not saved: ${failed.join(' · ')}`, { duration: 8000 });
      if (applied.length) {
        setResult(null);
        setSelections(null);
        setTypedText('');
        onApplied?.();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const upd = (patch: Partial<DictationSelections>) =>
    setSelections((s) => (s ? { ...s, ...patch } : s));

  const toggleAt = (key: 'medications' | 'consultations' | 'tasks' | 'io', idx: number) =>
    setSelections((s) => {
      if (!s) return s;
      const next = [...s[key]];
      next[idx] = !next[idx];
      return { ...s, [key]: next };
    });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white text-sm px-3 py-1.5 rounded-lg"
      >
        <Mic className="w-4 h-4" /> Voice dictation
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-violet-200 mb-3 overflow-hidden">
      <div className="bg-gradient-to-r from-violet-50 to-blue-50 px-4 py-2.5 border-b border-violet-100 flex flex-wrap items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-semibold text-slate-800">Ward-round dictation</span>
        <span className="text-xs text-slate-500 hidden sm:inline">
          say the progress note, medicines, tests, consults, diet — each goes to its own field
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
        <div className="flex flex-wrap items-center gap-2">
          {!isRecording ? (
            <button
              onClick={startRecording}
              disabled={processing}
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
              <Loader2 className="w-4 h-4 animate-spin" /> Understanding the dictation…
            </span>
          )}
        </div>

        {typing && (
          <div className="space-y-2">
            <textarea
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              rows={3}
              placeholder="e.g. Today patient better, no fever. Continue IV antibiotics. Add Pantoprazole 40 mg IV OD. Send CBC and creatinine tomorrow morning. Cardiology opinion for chest pain. Diabetic diet 1800 kcal. Nursing note: monitor input output hourly."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => runDictation({ textInput: typedText })}
              disabled={processing || typedText.trim().length < 10}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
            >
              Structure this text
            </button>
          </div>
        )}

        {result && selections && (
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

            {/* Treatment plan */}
            {[result.treatmentPlan.subjective, result.treatmentPlan.objective,
              result.treatmentPlan.assessment, result.treatmentPlan.plan,
              result.treatmentPlan.advice].some((v) => v) && (
              <Section
                title="Treatment plan (today)"
                checked={selections.plan}
                onToggle={() => upd({ plan: !selections.plan })}
                tone="violet"
              >
                {([
                  ['Subjective', result.treatmentPlan.subjective],
                  ['Objective', result.treatmentPlan.objective],
                  ['Assessment', result.treatmentPlan.assessment],
                  ['Plan', result.treatmentPlan.plan],
                  ['Advice', result.treatmentPlan.advice],
                ] as Array<[string, string | null]>)
                  .filter(([, v]) => v)
                  .map(([label, v]) => (
                    <p key={label} className="text-slate-700">
                      <span className="text-slate-400">{label}:</span> {v}
                    </p>
                  ))}
              </Section>
            )}

            {/* Nursing note */}
            {result.nursingNote && (
              <Section
                title="Nursing note"
                checked={selections.nursingNote}
                onToggle={() => upd({ nursingNote: !selections.nursingNote })}
                tone="sky"
              >
                <p className="text-slate-700 whitespace-pre-wrap">{result.nursingNote}</p>
              </Section>
            )}

            {/* Vitals */}
            {Object.entries(result.vitals ?? {}).some(([, v]) => v !== null && v !== '') && (
              <Section
                title="Vitals"
                checked={selections.vitals}
                onToggle={() => upd({ vitals: !selections.vitals })}
                tone="emerald"
              >
                <p className="text-slate-700">
                  {Object.entries(result.vitals)
                    .filter(([, v]) => v !== null && v !== '')
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </p>
              </Section>
            )}

            {/* Medications */}
            {result.medications.length > 0 && (
              <SectionShell title={`Medicines (${result.medications.length})`} tone="pink">
                {result.medications.map((m, i) => (
                  <label key={i} className="flex items-start gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={selections.medications[i]}
                      onChange={() => toggleAt('medications', i)}
                      className="mt-1"
                    />
                    <span className="text-slate-700">
                      <span className={`text-[10px] uppercase font-semibold mr-1.5 px-1 rounded ${
                        m.action === 'stop' ? 'bg-red-100 text-red-700'
                          : m.action === 'continue' ? 'bg-slate-100 text-slate-500'
                            : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {m.action}
                      </span>
                      <b>{m.medicine}</b> {m.dose ?? ''} {m.route ? `· ${m.route}` : ''} · {m.frequency.toUpperCase()}
                      {m.action === 'start' && m.frequency !== 'stat' ? ` × ${m.days ?? 3}d` : ''}
                      {m.instructions ? <span className="text-slate-400"> — {m.instructions}</span> : null}
                      {m.action === 'continue' && (
                        <span className="text-xs text-slate-400"> (already running — nothing to create)</span>
                      )}
                    </span>
                  </label>
                ))}
              </SectionShell>
            )}

            {/* Investigations — each line needs a catalog service to be orderable */}
            {result.investigations.length > 0 && (
              <SectionShell title={`Tests / imaging (${result.investigations.length})`} tone="orange">
                {result.investigations.map((inv, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 py-1">
                    <span className="text-slate-700 min-w-40">
                      <span className="text-[10px] uppercase bg-slate-100 text-slate-500 rounded px-1 mr-1.5">
                        {inv.category}
                      </span>
                      {inv.testName}
                      {inv.urgency !== 'routine' && (
                        <span className="ml-1.5 text-[10px] uppercase font-semibold text-red-700 bg-red-100 rounded px-1">
                          {inv.urgency}
                        </span>
                      )}
                    </span>
                    <select
                      value={selections.investigationServiceIds[i] ?? ''}
                      onChange={(e) => {
                        const next = [...selections.investigationServiceIds];
                        next[i] = e.target.value || null;
                        upd({ investigationServiceIds: next });
                      }}
                      className="border border-slate-300 rounded-lg px-2 py-1 text-xs max-w-72"
                    >
                      <option value="">— don't order (no catalog match) —</option>
                      {(matches[i]?.options ?? []).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.service_code} — {o.name} (₹{o.base_price})
                        </option>
                      ))}
                    </select>
                    {inv.instructions && <span className="text-xs text-slate-400">{inv.instructions}</span>}
                  </div>
                ))}
                {matches.some((m) => !m.suggestion) && (
                  <p className="text-xs text-amber-700 mt-1">
                    Tests without a catalog match can't be ordered — add them under Masters → Services first.
                  </p>
                )}
              </SectionShell>
            )}

            {/* Consultations */}
            {result.consultations.length > 0 && (
              <SectionShell title={`Cross consultation (${result.consultations.length})`} tone="indigo">
                {result.consultations.map((c, i) => (
                  <label key={i} className="flex items-start gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={selections.consultations[i]}
                      onChange={() => toggleAt('consultations', i)}
                      className="mt-1"
                    />
                    <span className="text-slate-700">
                      <b className="capitalize">{c.specialty}</b>
                      {c.urgency !== 'routine' && (
                        <span className="ml-1.5 text-[10px] uppercase font-semibold text-red-700 bg-red-100 rounded px-1">
                          {c.urgency}
                        </span>
                      )}
                      {c.reason ? <span className="text-slate-500"> — {c.reason}</span> : null}
                    </span>
                  </label>
                ))}
              </SectionShell>
            )}

            {/* Diet */}
            {result.diet && (
              <Section
                title="Diet order"
                checked={selections.diet}
                onToggle={() => upd({ diet: !selections.diet })}
                tone="lime"
              >
                <p className="text-slate-700">
                  <b>{DIET_TYPES.find((d) => d.key === result.diet!.dietType)?.label ?? result.diet.dietType}</b>
                  {' · '}{result.diet.route}
                  {result.diet.caloriesKcal ? ` · ${result.diet.caloriesKcal} kcal` : ''}
                  {result.diet.fluidRestrictionMl ? ` · fluids ${result.diet.fluidRestrictionMl} ml/day` : ''}
                </p>
                {result.diet.instructions && <p className="text-slate-500">{result.diet.instructions}</p>}
                {result.diet.restrictions && <p className="text-slate-500">Avoid: {result.diet.restrictions}</p>}
              </Section>
            )}

            {/* Nursing tasks */}
            {result.nursingTasks.length > 0 && (
              <SectionShell title={`Nursing tasks (${result.nursingTasks.length})`} tone="sky">
                {result.nursingTasks.map((t, i) => (
                  <label key={i} className="flex items-start gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={selections.tasks[i]}
                      onChange={() => toggleAt('tasks', i)}
                      className="mt-1"
                    />
                    <span className="text-slate-700">
                      {t.task}
                      {t.recurrence ? <span className="text-slate-400"> · {t.recurrence}</span> : null}
                      {t.dueInHours != null ? <span className="text-slate-400"> · in {t.dueInHours}h</span> : null}
                    </span>
                  </label>
                ))}
              </SectionShell>
            )}

            {/* Intake / output */}
            {result.intakeOutput.length > 0 && (
              <SectionShell title="Intake / output" tone="cyan">
                {result.intakeOutput.map((io, i) => (
                  <label key={i} className="flex items-start gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={selections.io[i]}
                      onChange={() => toggleAt('io', i)}
                      className="mt-1"
                    />
                    <span className="text-slate-700 capitalize">
                      {io.ioType} · {io.route} · {io.volumeMl} ml
                    </span>
                  </label>
                ))}
              </SectionShell>
            )}

            <button
              onClick={apply}
              disabled={applying}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {applying ? 'Filing to the chart…' : 'Save to chart'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const TONES: Record<string, string> = {
  violet: 'bg-violet-50 border-violet-200',
  sky: 'bg-sky-50 border-sky-200',
  emerald: 'bg-emerald-50 border-emerald-200',
  pink: 'bg-pink-50 border-pink-200',
  orange: 'bg-orange-50 border-orange-200',
  indigo: 'bg-indigo-50 border-indigo-200',
  lime: 'bg-lime-50 border-lime-200',
  cyan: 'bg-cyan-50 border-cyan-200',
};

function SectionShell({
  title, tone, children,
}: {
  title: string; tone: string; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-2.5 text-sm ${TONES[tone] ?? TONES.violet}`}>
      <p className="font-semibold text-slate-700 mb-1">{title}</p>
      {children}
    </div>
  );
}

function Section({
  title, checked, onToggle, tone, children,
}: {
  title: string; checked: boolean; onToggle: () => void; tone: string; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-2.5 text-sm ${TONES[tone] ?? TONES.violet}`}>
      <label className="flex items-center gap-2 font-semibold text-slate-700 mb-1">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        {title}
      </label>
      <div className="pl-6 space-y-0.5">{children}</div>
    </div>
  );
}
