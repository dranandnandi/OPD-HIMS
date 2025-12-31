// Offline sync service for Capacitor/Web
// Stores audio recordings locally when offline and syncs when connection is restored

import { supabase } from '../lib/supabase';

export interface PendingRecording {
    id: string;
    audioBase64: string;
    mimeType: string;
    visitContext: {
        chiefComplaint?: string;
        currentSymptoms?: string[];
    };
    visitId?: string;
    createdAt: Date;
    retryCount: number;
}

const DB_NAME = 'opd_offline_db';
const STORE_NAME = 'pending_recordings';

class OfflineSyncService {
    private db: IDBDatabase | null = null;

    async init(): Promise<void> {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    }

    async saveRecording(data: Omit<PendingRecording, 'id' | 'createdAt' | 'retryCount'>): Promise<string> {
        await this.init();
        if (!this.db) throw new Error('Database not initialized');

        const recording: PendingRecording = {
            ...data,
            id: `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            createdAt: new Date(),
            retryCount: 0
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.add(recording);

            request.onsuccess = () => resolve(recording.id);
            request.onerror = () => reject(request.error);
        });
    }

    async getPendingRecordings(): Promise<PendingRecording[]> {
        await this.init();
        if (!this.db) return [];

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteRecording(id: string): Promise<void> {
        await this.init();
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async updateRetryCount(id: string, retryCount: number): Promise<void> {
        await this.init();
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const getRequest = store.get(id);

            getRequest.onsuccess = () => {
                const recording = getRequest.result;
                if (recording) {
                    recording.retryCount = retryCount;
                    const updateRequest = store.put(recording);
                    updateRequest.onsuccess = () => resolve();
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    resolve();
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async syncPendingRecordings(): Promise<{ synced: number; failed: number }> {
        if (!navigator.onLine) {
            return { synced: 0, failed: 0 };
        }

        const pending = await this.getPendingRecordings();
        let synced = 0;
        let failed = 0;

        for (const recording of pending) {
            if (recording.retryCount >= 3) {
                // Max retries reached, skip
                failed++;
                continue;
            }

            try {
                if (!supabase) throw new Error('Supabase not available');

                const { data, error } = await supabase.functions.invoke('transcribe-medical-audio', {
                    body: {
                        audioBase64: recording.audioBase64,
                        mimeType: recording.mimeType,
                        visitContext: recording.visitContext
                    }
                });

                if (error) throw error;

                if (data?.success) {
                    // Save to voice_transcripts table if visitId available
                    if (recording.visitId) {
                        await supabase.from('voice_transcripts').insert({
                            visit_id: recording.visitId,
                            transcript: data.transcript,
                            extracted_data: data.extractedFields,
                            sync_status: 'synced',
                            synced_at: new Date().toISOString()
                        });
                    }

                    await this.deleteRecording(recording.id);
                    synced++;
                } else {
                    throw new Error(data?.error || 'Sync failed');
                }
            } catch (err) {
                console.error(`Failed to sync recording ${recording.id}:`, err);
                await this.updateRetryCount(recording.id, recording.retryCount + 1);
                failed++;
            }
        }

        return { synced, failed };
    }

    // Setup background sync when online
    setupAutoSync(): void {
        window.addEventListener('online', () => {
            console.log('Connection restored, syncing pending recordings...');
            this.syncPendingRecordings()
                .then(result => console.log('Sync result:', result))
                .catch(err => console.error('Sync error:', err));
        });
    }
}

export const offlineSyncService = new OfflineSyncService();

// Auto-setup sync on import
if (typeof window !== 'undefined') {
    offlineSyncService.setupAutoSync();
}
