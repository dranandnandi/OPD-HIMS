import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, MessageCircle, QrCode, RefreshCw, ShieldAlert } from 'lucide-react';
import QRCodeLib from 'qrcode';
import { useAuth } from '../Auth/useAuth';
import { whatsappApi, type WhatsAppQrResponse, type WhatsAppStatusResponse } from '../../services/whatsappApi';
import { formatPhoneForWhatsApp } from '../../utils/phoneUtils';

const defaultMessage = (clinicName?: string) =>
  `Hello! This is ${clinicName || 'our clinic'}. This is a quick test message to confirm that WhatsApp notifications are working.`;

const formatDate = (value?: string) => {
  if (!value) return '—';
  return new Date(value).toLocaleString();
};

const WhatsAppConnectionCard: React.FC = () => {
  const { user } = useAuth();
  const clinicId = user?.clinicId;
  const clinicName = user?.clinic?.clinicName;

  const [status, setStatus] = useState<WhatsAppStatusResponse | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [action, setAction] = useState<'connect' | 'disconnect' | 'qr' | 'send' | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState(defaultMessage(clinicName));

  const context = useMemo(() => ({ clinicId: clinicId || undefined, userId: user?.id }), [clinicId, user?.id]);

  const fetchStatus = useCallback(async () => {
    if (!clinicId) return;
    try {
      setLoadingStatus(true);
      const data = await whatsappApi.getStatus({}, context);
      setStatus(data);
    } catch (error) {
      console.error('Failed to fetch WhatsApp status', error);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Unable to load status' });
    } finally {
      setLoadingStatus(false);
    }
  }, [clinicId, context]);

  useEffect(() => {
    if (clinicId) {
      fetchStatus();
    }
  }, [clinicId, fetchStatus]);

  const handleConnect = async () => {
    if (!clinicId) return;
    setQr(null); // Clear any existing QR code
    setFeedback(null);
    try {
      setAction('connect');
      await whatsappApi.connect({ sessionName: clinicId, userId: user?.id }, context);
      setFeedback({ type: 'success', message: 'Connection requested. Generate the QR and scan using WhatsApp.' });
      await fetchStatus();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Failed to initiate connection' });
    } finally {
      setAction(null);
    }
  };

  const handleDisconnect = async () => {
    if (!clinicId) return;
    setQr(null); // Clear any existing QR code
    setFeedback(null);
    try {
      setAction('disconnect');
      await whatsappApi.disconnect({}, context);
      setFeedback({ type: 'success', message: 'WhatsApp session disconnected.' });
      await fetchStatus();
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Failed to disconnect session' });
    } finally {
      setAction(null);
    }
  };

  const handleQr = async () => {
    if (!clinicId) return;
    // Clear any existing QR code before attempting to generate new one
    setQr(null);
    setFeedback(null);
    
    try {
      setAction('qr');
      const payload: WhatsAppQrResponse = await whatsappApi.getQr({}, context);
      
      // Get the raw QR string from the response
      const qrString = payload.qrCode || payload.qr || '';
      console.log('QR Response:', { 
        payload, 
        qrStringLength: typeof qrString === 'string' ? qrString.length : 0,
        qrPreview: typeof qrString === 'string' ? qrString.substring(0, 50) + '...' : 'N/A'
      });
      
      if (qrString && typeof qrString === 'string') {
        // If it's already a data URL (base64 image), use it directly
        if (qrString.startsWith('data:')) {
          setQr(qrString);
        } else {
          // Generate QR code image from the WhatsApp pairing string
          // WhatsApp uses specific QR settings for proper scanning
          try {
            const qrDataUrl = await QRCodeLib.toDataURL(qrString, {
              errorCorrectionLevel: 'M',
              type: 'image/png',
              margin: 4,
              width: 300,
              color: {
                dark: '#000000',
                light: '#FFFFFF'
              }
            });
            console.log('QR Code generated successfully');
            setQr(qrDataUrl);
          } catch (qrError) {
            console.error('Failed to generate QR code image:', qrError);
            setQr(null); // Ensure QR is cleared on error
            setFeedback({ type: 'error', message: 'Failed to generate QR code image' });
            return;
          }
        }
        setFeedback({ type: 'success', message: 'Scan the QR within 2 minutes to complete pairing.' });
      } else {
        setQr(null); // Ensure QR is cleared when no valid string received
        setFeedback({ type: 'error', message: 'No QR code received from server' });
      }
    } catch (error) {
      setQr(null); // Clear QR on any error
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Failed to fetch QR code' });
    } finally {
      setAction(null);
    }
  };

  const handleSendTest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!testPhone.trim()) {
      setFeedback({ type: 'error', message: 'Enter a patient phone number to send a test message.' });
      return;
    }

    try {
      setAction('send');
      await whatsappApi.sendMessage(
        {
          phone: formatPhoneForWhatsApp(testPhone.trim()),
          message: testMessage.trim(),
          metadata: { source: 'OPD_APP_TEST' }
        },
        context
      );
      setFeedback({ type: 'success', message: 'Test message sent successfully.' });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Failed to send message' });
    } finally {
      setAction(null);
    }
  };

  if (!user) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <p className="text-gray-600">Please log in to configure WhatsApp.</p>
      </div>
    );
  }

  if (!clinicId) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-yellow-200 p-6">
        <div className="flex items-center gap-3 text-yellow-700">
          <ShieldAlert className="w-5 h-5" />
          <p>Assign this user to a clinic to enable WhatsApp messaging.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500">WhatsApp Status</p>
          <div className="flex items-center gap-2 text-lg font-semibold text-gray-800">
            {status?.connected ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                Connected
              </>
            ) : (
              <>
                <ShieldAlert className="w-5 h-5 text-amber-500" />
                Not Connected
              </>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {status?.phoneNumber ? `Linked number: ${status.phoneNumber}` : 'No WhatsApp session detected.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className="primary-button"
            onClick={handleConnect}
            disabled={action === 'connect' || loadingStatus}
          >
            {action === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span>{status?.connected ? 'Reconnect' : 'Connect'}</span>
          </button>
          <button
            className="secondary-button"
            onClick={handleQr}
            disabled={action === 'qr'}
          >
            {action === 'qr' ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
            <span>Generate QR</span>
          </button>
          {status?.connected && (
            <button
              className="secondary-button text-red-600 hover:text-red-700"
              onClick={handleDisconnect}
              disabled={action === 'disconnect'}
            >
              {action === 'disconnect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
              <span>Disconnect</span>
            </button>
          )}
        </div>
      </div>

      {qr && (
        <div className="border border-dashed border-gray-300 rounded-xl p-4 flex flex-col sm:flex-row gap-4 items-center">
          <img src={qr} alt="WhatsApp QR" className="w-48 h-48 object-contain" />
          <div>
            <p className="font-semibold text-gray-800">Scan to link WhatsApp Web</p>
            <p className="text-sm text-gray-500">
              Open WhatsApp &gt; Linked devices &gt; Link a device, then scan this QR code. It refreshes every ~2 minutes.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Session Details</p>
          <dl className="space-y-2 text-sm text-gray-600">
            <div className="flex justify-between">
              <dt>Business Name</dt>
              <dd className="font-medium text-gray-800">{status?.businessName || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Last Sync</dt>
              <dd className="font-medium text-gray-800">{formatDate(status?.lastSyncAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Started</dt>
              <dd className="font-medium text-gray-800">{formatDate(status?.startedAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Queue Size</dt>
              <dd className="font-medium text-gray-800">{status?.queueSize ?? 0}</dd>
            </div>
          </dl>
        </div>
        <form className="rounded-xl border border-gray-200 p-4 space-y-3" onSubmit={handleSendTest}>
          <div className="flex items-center gap-2 text-gray-800 font-medium">
            <MessageCircle className="w-4 h-4 text-green-600" /> Send Test Message
          </div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Patient Phone *</label>
          <input
            type="tel"
            value={testPhone}
            onChange={(event) => setTestPhone(event.target.value)}
            placeholder="e.g., 9198XXXXXX"
            className="input-field"
          />
          <label className="text-xs text-gray-500 uppercase tracking-wide">Message</label>
          <textarea
            value={testMessage}
            onChange={(event) => setTestMessage(event.target.value)}
            className="input-field min-h-[120px]"
          />
          <button
            type="submit"
            className="primary-button w-full"
            disabled={action === 'send'}
          >
            {action === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
            <span>Send Test Message</span>
          </button>
        </form>
      </div>

      {feedback && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {loadingStatus && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Refreshing status...
        </div>
      )}
    </div>
  );
};

export default WhatsAppConnectionCard;
