import { supabase } from '../utils/supabaseClient';
export type ExternalWhatsAppStatus =
  | 'not_configured'
  | 'checking'
  | 'not_registered'
  | 'not_initialized'
  | 'initializing'
  | 'qr_pending'
  | 'connected'
  | 'error';

export interface ExternalWhatsAppQrPayload {
  status: ExternalWhatsAppStatus;
  sessionName?: string;
  qrCode?: string | null;
  qrCodeUrl?: string | null;
  qrDataUrl?: string | null;
  qrTimestamp?: number | null;
  phoneNumber?: string | null;
}

export interface ExternalWhatsAppSession {
  sessionId?: string;
  sessionName: string;
  status: string;
  phoneNumber?: string | null;
  isConnected: boolean;
  isAuthenticated: boolean;
  lastConnectedAt?: string | null;
}

export interface ExternalWhatsAppStatusPayload {
  sessions: ExternalWhatsAppSession[];
}

export interface ExternalWhatsAppAdminUser {
  id: string;
  email?: string | null;
  name?: string | null;
  role: string;
}


async function requestExternal<T>(action: string, userId?: string, sessionName?: string): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in to Task Manager.');
  const { data, error } = await supabase.functions.invoke('workforce-whatsapp', {
    body: { action, ...(userId ? { user_id: userId } : {}), ...(sessionName ? { session_name: sessionName } : {}) },
  });
  if (error) {
    const response = (error as { context?: Response }).context;
    const details = response instanceof Response ? await response.json().catch(() => null) : null;
    const failure = new Error(details?.error || 'WhatsApp server connection is unavailable.');
    Object.assign(failure, { status: response?.status });
    throw failure;
  }
  if (data?.success !== true) throw new Error(data?.error || 'WhatsApp operation failed.');
  return data.data as T;
}
export const externalWhatsAppService = {
  isConfigured: Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY),
  handshake: (userId: string) => requestExternal<{ userId: string; existed: boolean }>('handshake', userId),
  syncAdmins: () => requestExternal<{ organizationId: string; received: number; synced: number; users: Array<{ id: string; username: string; role: string }> }>('sync_admins'),
  connect: (userId: string, sessionName = 'default') => requestExternal<ExternalWhatsAppQrPayload>('connect', userId, sessionName),
  refreshQr: (userId: string, sessionName = 'default') => requestExternal<ExternalWhatsAppQrPayload>('refresh_qr', userId, sessionName),
  getQr: (userId: string, sessionName = 'default') => requestExternal<ExternalWhatsAppQrPayload>('qr', userId, sessionName),
  getStatus: (userId: string) => requestExternal<ExternalWhatsAppStatusPayload>('status', userId),
  disconnect: (userId: string, sessionName = 'default') => requestExternal<{ status: string; sessionName: string }>('disconnect', userId, sessionName),
};
