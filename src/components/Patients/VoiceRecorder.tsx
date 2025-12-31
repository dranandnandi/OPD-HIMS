import React, { useState, useRef, useEffect } from 'react';
import { Mic, Loader2, Play, Square, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { VoiceTranscript } from '../../types';
import { offlineSyncService, PendingRecording } from '../../services/offlineSyncService';

interface VoiceRecorderProps {
    visitId?: string;
    chiefComplaint?: string;
    currentSymptoms?: string[];
    examinationTemplate?: any; // AI-generated examination template structure
    onTranscriptReady?: (data: VoiceTranscript['extractedData']) => void;
    onApplyToForm?: (data: VoiceTranscript['extractedData']) => void;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    visitId,
    chiefComplaint,
    currentSymptoms,
    examinationTemplate,
    onTranscriptReady,
    onApplyToForm
}) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [transcript, setTranscript] = useState<string | null>(null);
    const [extractedData, setExtractedData] = useState<VoiceTranscript['extractedData'] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [privacyRedactions, setPrivacyRedactions] = useState(0);
    const [pendingSync, setPendingSync] = useState<PendingRecording[]>([]);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

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

    const startRecording = async () => {
        setError(null);
        setTranscript(null);
        setExtractedData(null);

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
            };

            mediaRecorder.start(1000); // Collect data every second
            setIsRecording(true);

        } catch (err) {
            setError('Failed to access microphone. Please grant permission.');
            console.error('Microphone error:', err);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
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
                    visitContext: { chiefComplaint, currentSymptoms, examinationTemplate },
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
                    visitContext: { chiefComplaint, currentSymptoms, examinationTemplate }
                }
            });

            if (fnError) throw new Error(fnError.message);

            if (data?.success) {
                setTranscript(data.transcript);
                setExtractedData(data.extractedFields);
                setPrivacyRedactions(data.privacyRedactions || 0);
                onTranscriptReady?.(data.extractedFields);
            } else {
                throw new Error(data?.error || 'Failed to process recording');
            }

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to process recording');
        } finally {
            setIsProcessing(false);
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
                <div className="flex items-center gap-4">
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        disabled={isProcessing}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${isRecording
                            ? 'bg-red-500 hover:bg-red-600 text-white'
                            : 'bg-green-500 hover:bg-green-600 text-white'
                            } disabled:opacity-50`}
                    >
                        {isRecording ? (
                            <>
                                <Square className="w-5 h-5" />
                                Stop Recording
                            </>
                        ) : (
                            <>
                                <Mic className="w-5 h-5" />
                                Start Recording
                            </>
                        )}
                    </button>

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

                {/* Waveform Visualization */}
                {isRecording && (
                    <div className="relative">
                        <canvas
                            ref={canvasRef}
                            width={600}
                            height={80}
                            className="w-full h-20 rounded-lg bg-gray-50"
                        />
                        <div className="absolute top-2 right-2 flex items-center gap-1">
                            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                            <span className="text-xs text-red-600 font-medium">REC</span>
                        </div>
                    </div>
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

                        {/* Extracted Data Preview */}
                        {extractedData && (
                            <div className="space-y-3">
                                <label className="block text-sm font-medium text-gray-700">
                                    Extracted Data
                                </label>

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

                                {/* Examination Findings */}
                                {extractedData.examination && Object.values(extractedData.examination).some(v => v && v !== null) && (
                                    <div className="p-2 bg-teal-50 rounded border border-teal-200">
                                        <span className="font-medium text-teal-700 text-sm">Examination Findings</span>
                                        <div className="mt-1 grid grid-cols-2 gap-1">
                                            {Object.entries(extractedData.examination)
                                                .filter(([k, v]) => v && v !== null && k !== 'other')
                                                .map(([k, v]) => (
                                                    <p key={k} className="text-teal-600 text-xs">
                                                        <span className="font-medium capitalize">{k}:</span> {String(v)}
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
