import { useEffect, useMemo, useState } from 'react';
import { HiCheckCircle, HiExclamationCircle, HiLogout, HiQrcode, HiRefresh } from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';
import {
  externalWhatsAppService,
  type ExternalWhatsAppQrPayload,
  type ExternalWhatsAppSession,
  type ExternalWhatsAppStatus,
} from '../services/externalWhatsAppService';

const POLL_MS = 5000;
const ADMIN_ROLES = new Set(['admin', 'superadmin']);

const statusLabel: Record<ExternalWhatsAppStatus, string> = {
  not_configured: 'Not configured',
  checking: 'Checking',
  not_registered: 'Not registered',
  not_initialized: 'Not initialized',
  initializing: 'Initializing',
  qr_pending: 'Scan QR',
  connected: 'Connected',
  error: 'Error',
};

function normalizeStatus(payload: ExternalWhatsAppQrPayload | null, sessions: ExternalWhatsAppSession[]): ExternalWhatsAppStatus {
  if (sessions.some((session) => session.isConnected || session.isAuthenticated || session.status === 'connected')) {
    return 'connected';
  }
  return payload?.status || 'not_initialized';
}

type TaskManagerUser = {
  id: string;
  organization_id: string;
  name: string | null;
  email: string | null;
  role: string;
  is_active?: boolean;
};

export default function WhatsAppConnection() {
  const [currentUserId, setCurrentUserId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [externalUserId, setExternalUserId] = useState('');
  const [sessionName, setSessionName] = useState('default');
  const [status, setStatus] = useState<ExternalWhatsAppStatus>(
    externalWhatsAppService.isConfigured ? 'checking' : 'not_configured',
  );
  const [qrPayload, setQrPayload] = useState<ExternalWhatsAppQrPayload | null>(null);
  const [sessions, setSessions] = useState<ExternalWhatsAppSession[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const userId = useMemo(() => externalUserId.trim() || currentUserId, [currentUserId, externalUserId]);
  const connectedSession = sessions.find((session) => session.isConnected || session.isAuthenticated || session.status === 'connected');

  const syncOrganizationAdmins = async (profile: TaskManagerUser) => {
    if (!externalWhatsAppService.isConfigured || !ADMIN_ROLES.has(profile.role)) return;
    const result = await externalWhatsAppService.syncAdmins();
    setMessage(`Synced ${result.synced} admin users for this organization.`);
  };

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const authId = data.user?.id || '';
        if (!authId) return;

        const { data: profile, error } = await supabase
          .from('users')
          .select('id, organization_id, name, email, role, is_active')
          .eq('auth_id', authId)
          .single();

        if (error) throw error;
        if (!profile?.id) return;

        const typedProfile = profile as TaskManagerUser;
        setCurrentUserId(typedProfile.id);
        setOrganizationId(typedProfile.organization_id || '');
        setExternalUserId((previous) => previous || typedProfile.id);
        await syncOrganizationAdmins(typedProfile);
      } catch (error) {
        setFailure(error);
      }
    };
    loadCurrentUser();
  }, []);

  const setFailure = (error: unknown) => {
    const httpStatus = (error as any)?.status;
    setStatus(httpStatus === 404 ? 'not_registered' : 'error');
    setMessage(error instanceof Error ? error.message : 'Unable to reach external WhatsApp API');
  };

  const refreshStatus = async (targetUserId = userId) => {
    if (!externalWhatsAppService.isConfigured || !targetUserId) return;
    try {
      const data = await externalWhatsAppService.getStatus(targetUserId);
      setSessions(data.sessions || []);
      setStatus(normalizeStatus(qrPayload, data.sessions || []));
      setMessage('');
    } catch (error) {
      setFailure(error);
    }
  };

  const startHandshake = async () => {
    if (!userId) {
      setMessage('User ID is required');
      return;
    }
    setBusy(true);
    setStatus('checking');
    setMessage('');
    try {
      await externalWhatsAppService.handshake(userId);
      const payload = await externalWhatsAppService.connect(userId, sessionName || 'default');
      setQrPayload(payload);
      await refreshStatus(userId);
      setStatus(normalizeStatus(payload, sessions));
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const refreshQr = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const payload = await externalWhatsAppService.refreshQr(userId, sessionName || 'default');
      setQrPayload(payload);
      setStatus(payload.status || 'qr_pending');
      setMessage('');
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await externalWhatsAppService.disconnect(userId, sessionName || 'default');
      setQrPayload(null);
      setSessions([]);
      setStatus('not_initialized');
      setMessage('Disconnected');
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!externalWhatsAppService.isConfigured || !userId || status === 'not_configured') return;
    const timer = window.setInterval(async () => {
      try {
        const [statusData, qrData] = await Promise.all([
          externalWhatsAppService.getStatus(userId),
          externalWhatsAppService.getQr(userId, sessionName || 'default'),
        ]);
        setSessions(statusData.sessions || []);
        setQrPayload(qrData);
        setStatus(normalizeStatus(qrData, statusData.sessions || []));
      } catch {
        // Manual actions surface errors; background polling stays quiet.
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [userId, sessionName, status]);

  if (!externalWhatsAppService.isConfigured) {
    return (
      <section className="max-w-4xl mx-auto px-4">
        <div className="bg-white border border-amber-200 rounded-lg p-5">
          <div className="flex items-center gap-3 text-amber-700">
            <HiExclamationCircle className="w-6 h-6" />
            <h2 className="text-lg font-semibold">External WhatsApp API not configured</h2>
          </div>
          <p className="mt-2 text-sm text-gray-600">
            Your Task Manager server connection is not configured. Contact your administrator.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-5xl mx-auto px-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">WhatsApp Connection</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-gray-600">
            {status === 'connected' ? (
              <HiCheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <HiQrcode className="w-5 h-5 text-blue-600" />
            )}
            <span>{statusLabel[status]}</span>
            {connectedSession?.phoneNumber && <span>{connectedSession.phoneNumber}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={refreshQr}
            disabled={busy || status === 'connected'}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
            title="Refresh QR"
          >
            <HiRefresh className="w-5 h-5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
            title="Disconnect"
          >
            <HiLogout className="w-5 h-5" />
            Disconnect
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Task administrator ID</span>
            <input
              value={externalUserId}
              onChange={(event) => setExternalUserId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder={currentUserId || 'task-manager public users id'}
            />
          </label>
          {organizationId && (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Organization: {organizationId}
            </div>
          )}
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Session name</span>
            <input
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="default"
            />
          </label>
          <button
            type="button"
            onClick={startHandshake}
            disabled={busy || !userId}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            <HiQrcode className="w-5 h-5" />
            {busy ? 'Working...' : 'Connect'}
          </button>
          {message && <p className="text-sm text-gray-700">{message}</p>}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            {status === 'connected' ? (
              <div className="text-center">
                <HiCheckCircle className="mx-auto h-16 w-16 text-green-600" />
                <p className="mt-3 text-base font-medium text-gray-900">Connected</p>
              </div>
            ) : qrPayload?.qrDataUrl || qrPayload?.qrCodeUrl ? (
              <img
                src={qrPayload.qrDataUrl || qrPayload.qrCodeUrl || ''}
                alt="WhatsApp QR"
                className="h-auto w-full max-w-[280px]"
              />
            ) : (
              <div className="text-center text-gray-600">
                <HiQrcode className="mx-auto h-16 w-16 text-gray-400" />
                <p className="mt-3 text-sm">QR will appear here after the handshake.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
