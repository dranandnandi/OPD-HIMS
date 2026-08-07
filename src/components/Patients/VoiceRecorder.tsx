import React, { useState, useRef, useEffect } from 'react';
import { Mic, Loader2, Play, Square, Upload, CheckCircle, AlertCircle, Pause, RotateCcw, FileText, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PhysicalExamination, VoiceTranscript } from '../../types';
import { offlineSyncService, PendingRecording } from '../../services/offlineSyncService';
import { buildExaminationSchemaForAI, humanizeKey } from '../../utils/emrMapping';

interface VoiceRecorderProps {
    visitId?: string;
    chiefComplaint?: string;
    currentSymptoms?: string[];
    currentDiagnoses?: string[];
    examinationTemplate?: PhysicalExamination; // loaded template, or undefined for the standard schema
    patientAge?: number;
    patientGender?: string;
    doctorSpecialization?: string;
    onTranscriptReady?: (data: VoiceTranscript['extractedData']) => void;
    onApplyToForm?: (data: VoiceTranscript['extractedData']) => void;
}

/** Flatten the nested examination object into readable "Section › Field: value" rows. */
const flattenExaminationForPreview = (
    examination: unknown,
    trail: string[] = []
): Array<{ path: string; label: string; value: string }> => {
    if (examination === null || examination === undefined || trail.length > 3) return [];

    if (typeof examination !== 'object' || Array.isArray(examination)) {
        const value = Array.isArray(examination) ? examination.filter(Boolean).join(', ') : String(examination);
        if (!value.trim() || value === 'null') return [];
        return [{ path: trail.join('.'), label: humanizeKey(trail[trail.length - 1] || ''), value }];
    }

    return Object.entries(examination as Record<string, unknown>).flatMap(([key, child]) =>
        flattenExaminationForPreview(child, [...trail, key])
    );
};

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    visitId,
    chiefComplaint,
    currentSymptoms,
    currentDiagnoses,
    examinationTemplate,
    patientAge,
    patientGender,
    doctorSpecialization,
    onTranscriptReady,
    onApplyToForm
}) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [transcript, setTranscript] = useState<string | null>(null);
    const [extractedData, setExtractedData] = useState<VoiceTranscript['extractedData'] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [privacyRedactions, setPrivacyRedactions] = useState(0);
    const [pendingSync, setPendingSync] = useState<PendingRecording[]>([]);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [isRemapping, setIsRemapping] = useState(false);
    const [mappedTemplateName, setMappedTemplateName] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // What the AI is told to map findings onto: the doctor's loaded template if
    // there is one, otherwise the standard OPD schema. Never nothing.
    const examinationSchema = buildExaminationSchemaForAI(examinationTemplate);
    const activeTemplateName = examinationTemplate?.templateName
        || (examinationSchema.isTemplate ? 'Loaded examination template' : null);
    // The transcript was mapped against a different template than the one now loaded.
    const templateChangedSinceMapping =
        Boolean(transcript) && (mappedTemplateName || null) !== (activeTemplateName || null);

    // Examination arrives nested (section → field), so flatten it for display.
    const examinationPreview = flattenExaminationForPreview(extractedData?.examination);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationRef = useRef<number | null>(null);

    // Monitor online/offline status
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Load pending recordings on mount
    useEffect(() => {
        loadPendingRecordings();
    }, []);

    const loadPendingRecordings = async () => {
        const pending = await offlineSyncService.getPendingRecordings();
        setPendingSync(pending);
    };

    const startTimer = () => {
        timerRef.current = setInterval(() => {
            setRecordingSeconds(s => s + 1);
        }, 1000);
    };

    const stopTimer = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    const formatTime = (secs: number) => {
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const startRecording = async () => {
        setError(null);
        setTranscript(null);
        setExtractedData(null);
        setRecordingSeconds(0);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Setup audio context for visualization
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;

            // Start visualization
            drawWaveform();

            // Setup MediaRecorder
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                setAudioBlob(blob);
                setAudioUrl(URL.createObjectURL(blob));
                stream.getTracks().forEach(track => track.stop());
                if (animationRef.current) {
                    cancelAnimationFrame(animationRef.current);
                }
                stopTimer();
            };

            mediaRecorder.start(1000); // Collect data every second
            setIsRecording(true);
            setIsPaused(false);
            startTimer();

        } catch (err) {
            setError('Failed to access microphone. Please grant permission.');
            console.error('Microphone error:', err);
        }
    };

    const pauseRecording = () => {
        if (mediaRecorderRef.current && isRecording && !isPaused) {
            mediaRecorderRef.current.pause();
            setIsPaused(true);
            stopTimer();
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
                animationRef.current = null;
            }
        }
    };

    const resumeRecording = () => {
        if (mediaRecorderRef.current && isRecording && isPaused) {
            mediaRecorderRef.current.resume();
            setIsPaused(false);
            startTimer();
            drawWaveform();
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setIsPaused(false);
            stopTimer();
        }
    };

    const drawWaveform = () => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            ctx.fillStyle = 'rgb(249, 250, 251)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 2.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height;

                const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
                gradient.addColorStop(0, '#8B5CF6');
                gradient.addColorStop(1, '#3B82F6');

                ctx.fillStyle = gradient;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        };

        draw();
    };

    const buildVisitContext = () => ({
        chiefComplaint,
        currentSymptoms,
        currentDiagnoses,
        patientAge,
        patientGender,
        doctorSpecialization,
        examinationSchema,
        // Legacy key, kept so a not-yet-redeployed edge function still gets the template
        examinationTemplate
    });

    /**
     * Fold the response's top-level fields into the extracted payload.
     * chiefComplaint and suggestedDiagnoses live outside `extractedFields`, so
     * forwarding that object alone silently dropped both.
     */
    const collectExtraction = (data: any): VoiceTranscript['extractedData'] => ({
        ...(data.extractedFields || {}),
        chiefComplaint: data.extractedFields?.chiefComplaint ?? data.chiefComplaint ?? null,
        suggestedDiagnoses: data.extractedFields?.suggestedDiagnoses ?? data.suggestedDiagnoses ?? []
    });

    const persistTranscript = async (transcriptText: string, extraction: unknown) => {
        if (!visitId || !supabase || !transcriptText) return;
        try {
            await supabase.from('voice_transcripts').insert({
                visit_id: visitId,
                transcript: transcriptText,
                extracted_data: extraction,
                sync_status: 'synced',
                synced_at: new Date().toISOString()
            });
        } catch (err) {
            // The transcript is still on screen and applied to the form; an
            // archival failure must not block the consultation.
            console.error('Failed to archive voice transcript:', err);
        }
    };

    const handleResult = async (data: any) => {
        const extraction = collectExtraction(data);
        setTranscript(data.transcript);
        setExtractedData(extraction);
        setPrivacyRedactions(data.privacyRedactions || 0);
        setMappedTemplateName(
            data.examinationSchemaUsed?.isTemplate
                ? (data.examinationSchemaUsed.templateName || 'Loaded examination template')
                : null
        );
        onTranscriptReady?.(extraction);
        await persistTranscript(data.transcript, extraction);
    };

    const processRecording = async () => {
        if (!audioBlob) return;

        setIsProcessing(true);
        setError(null);

        try {
            // Convert blob to base64
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
                reader.onloadend = () => {
                    const base64 = (reader.result as string).split(',')[1];
                    resolve(base64);
                };
                reader.readAsDataURL(audioBlob);
            });
            const audioBase64 = await base64Promise;

            if (!isOnline) {
                // Save for later sync
                await offlineSyncService.saveRecording({
                    audioBase64,
                    mimeType: 'audio/webm',
                    visitContext: buildVisitContext(),
                    visitId
                });
                await loadPendingRecordings();
                setError('Saved offline. Will sync when connection is restored.');
                return;
            }

            if (!supabase) throw new Error('Database not connected');

            const { data, error: fnError } = await supabase.functions.invoke('transcribe-medical-audio', {
                body: {
                    audioBase64,
                    mimeType: 'audio/webm',
                    visitContext: buildVisitContext()
                }
            });

            if (fnError) throw new Error(fnError.message);

            if (data?.success) {
                await handleResult(data);
            } else {
                throw new Error(data?.error || 'Failed to process recording');
            }

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to process recording');
        } finally {
            setIsProcessing(false);
        }
    };

    /**
     * Re-run the mapping on the existing transcript. Needed when the doctor
     * loads (or changes) an examination template after dictating — the audio
     * does not need to be sent again.
     */
    const remapTranscript = async () => {
        if (!transcript) return;

        setIsRemapping(true);
        setError(null);

        try {
            if (!supabase) throw new Error('Database not connected');

            const { data, error: fnError } = await supabase.functions.invoke('transcribe-medical-audio', {
                body: { transcriptText: transcript, visitContext: buildVisitContext() }
            });

            if (fnError) throw new Error(fnError.message);
            if (!data?.success) throw new Error(data?.error || 'Failed to re-map transcript');

            const extraction = collectExtraction(data);
            setExtractedData(extraction);
            setMappedTemplateName(
                data.examinationSchemaUsed?.isTemplate
                    ? (data.examinationSchemaUsed.templateName || 'Loaded examination template')
                    : null
            );
            onTranscriptReady?.(extraction);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to re-map transcript');
        } finally {
            setIsRemapping(false);
        }
    };

    const applyToForm = () => {
        if (extractedData) {
            onApplyToForm?.(extractedData);
        }
    };

    const syncPendingRecordings = async () => {
        if (!isOnline) return;

        setIsProcessing(true);
        try {
            await offlineSyncService.syncPendingRecordings();
            await loadPendingRecordings();
        } catch (err) {
            console.error('Sync error:', err);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-green-50 to-blue-50 px-4 py-3 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-800">Voice Recording</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${isOnline ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                            }`}>
                            {isOnline ? 'Online' : 'Offline'}
                        </span>
                        {/* Which examination fields the AI will map findings onto */}
                        <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${activeTemplateName ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}
                            title={activeTemplateName
                                ? 'Findings will be mapped into your loaded examination template'
                                : 'No template loaded — findings map to the standard OPD examination fields'}
                        >
                            <FileText className="w-3 h-3" />
                            {activeTemplateName || 'Standard OPD fields'}
                        </span>
                    </div>

                    {pendingSync.length > 0 && (
                        <button
                            onClick={syncPendingRecordings}
                            disabled={!isOnline || isProcessing}
                            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
                        >
                            <Upload className="w-4 h-4" />
                            Sync ({pendingSync.length})
                        </button>
                    )}
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* Recording Controls */}
                <div className="flex items-center gap-2 flex-wrap">
                    {!isRecording ? (
                        <button
                            onClick={startRecording}
                            disabled={isProcessing}
                            className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium disabled:opacity-50"
                        >
                            <Mic className="w-5 h-5" />
                            {audioBlob ? 'New Recording' : 'Start Recording'}
                        </button>
                    ) : (
                        <>
                            {/* Pause / Resume */}
                            {!isPaused ? (
                                <button
                                    onClick={pauseRecording}
                                    className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium"
                                    title="Pause recording — audio so far is kept"
                                >
                                    <Pause className="w-5 h-5" />
                                    Pause
                                </button>
                            ) : (
                                <button
                                    onClick={resumeRecording}
                                    className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium animate-pulse"
                                    title="Resume recording"
                                >
                                    <Mic className="w-5 h-5" />
                                    Resume
                                </button>
                            )}

                            {/* Stop */}
                            <button
                                onClick={stopRecording}
                                className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium"
                            >
                                <Square className="w-5 h-5" />
                                Stop
                            </button>
                        </>
                    )}

                    {/* Timer */}
                    {isRecording && (
                        <span className={`flex items-center gap-1 text-sm font-mono font-medium px-3 py-2 rounded-lg ${isPaused ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                            {isPaused
                                ? <><Pause className="w-3 h-3" /> PAUSED &nbsp;{formatTime(recordingSeconds)}</>
                                : <><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse inline-block" /> REC &nbsp;{formatTime(recordingSeconds)}</>
                            }
                        </span>
                    )}

                    {audioBlob && !isRecording && (
                        <>
                            <audio src={audioUrl || undefined} controls className="h-10" />
                            <button
                                onClick={processRecording}
                                disabled={isProcessing}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50"
                            >
                                {isProcessing ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-5 h-5" />
                                        Transcribe
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>

                {/* Pause hint */}
                {isRecording && isPaused && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                        <Pause className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div>
                            <span className="font-medium">Recording paused.</span> All audio recorded so far is preserved.
                            Press <span className="font-medium">Resume</span> to continue, or <span className="font-medium">Stop</span> to finish and transcribe.
                        </div>
                    </div>
                )}

                {/* Waveform Visualization */}
                {isRecording && (
                    <div className="relative">
                        <canvas
                            ref={canvasRef}
                            width={600}
                            height={80}
                            className={`w-full h-20 rounded-lg bg-gray-50 transition-opacity ${isPaused ? 'opacity-30' : 'opacity-100'}`}
                        />
                        {isPaused && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-amber-600 font-semibold text-sm bg-amber-50 bg-opacity-90 px-3 py-1 rounded-full border border-amber-200">
                                    Microphone muted — private conversation
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Note about new recording clearing previous */}
                {audioBlob && !isRecording && (
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                        <RotateCcw className="w-3 h-3" />
                        "New Recording" will replace the current audio. Transcribe first if you want to keep it.
                    </p>
                )}

                {/* Error */}
                {error && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </div>
                )}

                {/* Transcript & Extracted Data */}
                {transcript && (
                    <div className="space-y-4">
                        {/* Transcript */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-gray-700">Transcript</label>
                                {privacyRedactions > 0 && (
                                    <span className="text-xs text-orange-600">
                                        {privacyRedactions} sensitive item(s) filtered
                                    </span>
                                )}
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 max-h-40 overflow-y-auto">
                                {transcript}
                            </div>
                        </div>

                        {/* Template changed after transcription — mapping is stale */}
                        {templateChangedSinceMapping && (
                            <div className="flex items-start justify-between gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                                <div className="flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <span className="font-medium">Examination fields changed since transcription.</span>{' '}
                                        This transcript was mapped to{' '}
                                        <span className="font-medium">{mappedTemplateName || 'the standard OPD fields'}</span>,
                                        but{' '}
                                        <span className="font-medium">{activeTemplateName || 'the standard OPD fields'}</span>{' '}
                                        {activeTemplateName ? 'is' : 'are'} now active. Re-map so findings land in the right fields.
                                    </div>
                                </div>
                                <button
                                    onClick={remapTranscript}
                                    disabled={isRemapping}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium disabled:opacity-50 flex-shrink-0"
                                >
                                    {isRemapping ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                    Re-map
                                </button>
                            </div>
                        )}

                        {/* Extracted Data Preview */}
                        {extractedData && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="block text-sm font-medium text-gray-700">
                                        Extracted Data
                                    </label>
                                    {!templateChangedSinceMapping && (
                                        <button
                                            onClick={remapTranscript}
                                            disabled={isRemapping}
                                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
                                            title="Re-run the mapping on this transcript without re-recording"
                                        >
                                            {isRemapping ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                            Re-map
                                        </button>
                                    )}
                                </div>

                                {/* Chief Complaint */}
                                {(extractedData as any).chiefComplaint && (
                                    <div className="p-2 bg-slate-50 rounded border border-slate-200">
                                        <span className="font-medium text-slate-700 text-sm">Chief Complaint</span>
                                        <p className="text-slate-600 text-sm mt-1">{(extractedData as any).chiefComplaint}</p>
                                    </div>
                                )}

                                {/* Symptoms - Enhanced Display */}
                                {extractedData.symptoms && extractedData.symptoms.length > 0 && (
                                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                                        <span className="font-medium text-blue-700 text-sm">Symptoms ({extractedData.symptoms.length})</span>
                                        <div className="mt-2 space-y-2">
                                            {extractedData.symptoms.map((s: any, idx: number) => (
                                                <div key={idx} className="bg-white p-2 rounded border border-blue-100">
                                                    <p className="font-medium text-blue-800">{s.name}</p>
                                                    <div className="flex flex-wrap gap-2 mt-1">
                                                        {s.location && (
                                                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                                                📍 {s.location}
                                                            </span>
                                                        )}
                                                        {s.duration && (
                                                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                                                ⏱️ {s.duration}
                                                            </span>
                                                        )}
                                                        {s.severity && (
                                                            <span className={`text-xs px-2 py-0.5 rounded ${s.severity === 'severe' ? 'bg-red-100 text-red-700' :
                                                                s.severity === 'moderate' ? 'bg-yellow-100 text-yellow-700' :
                                                                    'bg-green-100 text-green-700'
                                                                }`}>
                                                                {s.severity}
                                                            </span>
                                                        )}
                                                        {s.pattern && (
                                                            <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                                                                🔄 {s.pattern}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Diagnoses */}
                                {extractedData.diagnoses && extractedData.diagnoses.length > 0 && (
                                    <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                                        <span className="font-medium text-purple-700 text-sm">Diagnoses</span>
                                        <div className="mt-1 space-y-1">
                                            {extractedData.diagnoses.map((d: any, idx: number) => (
                                                <p key={idx} className="text-purple-600 text-sm flex items-center gap-2">
                                                    <span>{typeof d === 'string' ? d : d.name}</span>
                                                    {typeof d !== 'string' && d.icd10Code && (
                                                        <span className="text-xs bg-purple-100 px-1 rounded">{d.icd10Code}</span>
                                                    )}
                                                    {typeof d !== 'string' && d.isPrimary && (
                                                        <span className="text-xs bg-purple-200 text-purple-800 px-1 rounded">Primary</span>
                                                    )}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* AI Suggested Diagnoses */}
                                {(extractedData as any).suggestedDiagnoses && (extractedData as any).suggestedDiagnoses.length > 0 && (
                                    <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                                        <span className="font-medium text-indigo-700 text-sm">🤖 AI Suggested Diagnoses</span>
                                        <div className="mt-1 space-y-1">
                                            {(extractedData as any).suggestedDiagnoses.map((d: any, idx: number) => (
                                                <p key={idx} className="text-indigo-600 text-sm">
                                                    {typeof d === 'string' ? d : (
                                                        <>
                                                            <span className="font-medium">{d.name}</span>
                                                            {d.likelihood && (
                                                                <span className={`ml-2 text-xs px-1 rounded ${d.likelihood === 'high' ? 'bg-red-100 text-red-700' :
                                                                    d.likelihood === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                                        'bg-gray-100 text-gray-600'
                                                                    }`}>{d.likelihood}</span>
                                                            )}
                                                            {d.reasoning && <span className="text-xs text-indigo-500 ml-1">- {d.reasoning}</span>}
                                                        </>
                                                    )}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3">
                                    {/* Vitals */}
                                    {extractedData.vitals && Object.values(extractedData.vitals).some(v => v) && (
                                        <div className="p-2 bg-green-50 rounded border border-green-200">
                                            <span className="font-medium text-green-700 text-sm">Vitals</span>
                                            <p className="text-green-600 text-xs mt-1">
                                                {Object.entries(extractedData.vitals).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')}
                                            </p>
                                        </div>
                                    )}

                                    {/* Prescriptions */}
                                    {extractedData.prescriptions && extractedData.prescriptions.length > 0 && (
                                        <div className="p-2 bg-pink-50 rounded border border-pink-200">
                                            <span className="font-medium text-pink-700 text-sm">Prescriptions ({extractedData.prescriptions.length})</span>
                                            <div className="mt-1 space-y-1">
                                                {extractedData.prescriptions.slice(0, 3).map((p: any, idx: number) => (
                                                    <p key={idx} className="text-pink-600 text-xs">
                                                        💊 {p.medicine} {p.dosage && `- ${p.dosage}`} {p.frequency && `(${p.frequency})`}
                                                    </p>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Tests Ordered */}
                                    {extractedData.testsOrdered && extractedData.testsOrdered.length > 0 && (
                                        <div className="p-2 bg-orange-50 rounded border border-orange-200">
                                            <span className="font-medium text-orange-700 text-sm">Tests Ordered</span>
                                            <p className="text-orange-600 text-xs mt-1">
                                                {extractedData.testsOrdered.map((t: any) => t.testName).join(', ')}
                                            </p>
                                        </div>
                                    )}

                                    {/* Advice */}
                                    {extractedData.advice && extractedData.advice.length > 0 && (
                                        <div className="p-2 bg-yellow-50 rounded border border-yellow-200">
                                            <span className="font-medium text-yellow-700 text-sm">Advice</span>
                                            <p className="text-yellow-600 text-xs mt-1">
                                                {extractedData.advice.slice(0, 2).join('; ')}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Examination Findings (nested by section → field) */}
                                {examinationPreview.length > 0 && (
                                    <div className="p-2 bg-teal-50 rounded border border-teal-200">
                                        <span className="font-medium text-teal-700 text-sm">
                                            Examination Findings ({examinationPreview.length})
                                        </span>
                                        <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-1">
                                            {examinationPreview.map(item => (
                                                <p key={item.path} className="text-teal-600 text-xs">
                                                    <span className="font-medium">{item.label}:</span> {item.value}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Follow-up */}
                                {extractedData.followUp && (extractedData.followUp.duration || extractedData.followUp.instructions || extractedData.followUp.warningSignsToWatch?.length) && (
                                    <div className="p-2 bg-cyan-50 rounded border border-cyan-200">
                                        <span className="font-medium text-cyan-700 text-sm">Follow-up</span>
                                        <div className="mt-1 space-y-0.5">
                                            {extractedData.followUp.duration && (
                                                <p className="text-cyan-600 text-xs">After: {extractedData.followUp.duration}</p>
                                            )}
                                            {extractedData.followUp.instructions && (
                                                <p className="text-cyan-600 text-xs">{extractedData.followUp.instructions}</p>
                                            )}
                                            {extractedData.followUp.warningSignsToWatch?.map((sign, idx) => (
                                                <p key={idx} className="text-cyan-600 text-xs">⚠️ Return if: {sign}</p>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Other clinical content — nothing gets dropped, it goes to Doctor Notes */}
                                {((extractedData as any).doctorNotes || (extractedData as any).unmappedFindings?.length > 0) && (
                                    <div className="p-2 bg-gray-50 rounded border border-gray-200">
                                        <span className="font-medium text-gray-700 text-sm">
                                            Other Findings → Doctor Notes
                                        </span>
                                        <div className="mt-1 space-y-0.5">
                                            {(extractedData as any).doctorNotes && (
                                                <p className="text-gray-600 text-xs">{(extractedData as any).doctorNotes}</p>
                                            )}
                                            {((extractedData as any).unmappedFindings || []).map((item: any, idx: number) => (
                                                <p key={idx} className="text-gray-600 text-xs">
                                                    <span className="font-medium">{item.label}:</span> {item.value}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Apply Button */}
                        <button
                            onClick={applyToForm}
                            disabled={!extractedData}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white rounded-lg font-medium disabled:opacity-50"
                        >
                            <CheckCircle className="w-5 h-5" />
                            Apply to EMR Form
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VoiceRecorder;
