import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Save, Timer } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../Auth/useAuth';

/**
 * Pacing and timing for the server-side reminder scheduler.
 *
 * The two Netlify scheduled functions (queue-auto-reminders, hourly, and
 * process-whatsapp-queue, every 5 minutes) read exactly these values. Nothing
 * here runs in the browser -- this screen only edits the config the scheduler
 * obeys, so reminders continue overnight and at weekends with no tab open.
 */

interface AutoSendConfig {
  minGapMinutes: number;
  maxGapMinutes: number;
  sendWindowStart: string;
  sendWindowEnd: string;
  appointmentReminderHoursBefore: number;
  followUpLeadDays: number;
}

const DEFAULT_CONFIG: AutoSendConfig = {
  minGapMinutes: 5,
  maxGapMinutes: 10,
  sendWindowStart: '09:00',
  sendWindowEnd: '20:00',
  appointmentReminderHoursBefore: 24,
  followUpLeadDays: 0
};

interface SendState {
  next_send_after: string | null;
  last_sent_at: string | null;
  failure_streak: number;
  last_error: string | null;
}

interface QueueStats {
  pending: number;
  sentToday: number;
  failed: number;
}

interface FailedMessage {
  id: string;
  event_type: string;
  phone_number: string;
  error: string | null;
  retry_count: number;
  updated_at: string;
}

/**
 * Failures are counted over a trailing window rather than all-time. An
 * all-time count surfaces long-dead rows from the retired in-browser processor
 * as though the scheduler were broken right now.
 */
const FAILURE_LOOKBACK_DAYS = 7;

const ReminderAutomationSettings: React.FC = () => {
  const { user } = useAuth();
  const [config, setConfig] = useState<AutoSendConfig>(DEFAULT_CONFIG);
  const [sendState, setSendState] = useState<SendState | null>(null);
  const [stats, setStats] = useState<QueueStats>({ pending: 0, sentToday: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [failures, setFailures] = useState<FailedMessage[] | null>(null);
  const [loadingFailures, setLoadingFailures] = useState(false);

  const load = useCallback(async () => {
    if (!user?.clinicId || !supabase) return;

    try {
      setLoading(true);

      const { data: clinic } = await supabase
        .from('clinic_settings')
        .select('whatsapp_auto_send_config')
        .eq('id', user.clinicId)
        .maybeSingle();

      setConfig({ ...DEFAULT_CONFIG, ...(clinic?.whatsapp_auto_send_config || {}) });

      const { data: state } = await supabase
        .from('whatsapp_send_state')
        .select('next_send_after, last_sent_at, failure_streak, last_error')
        .eq('clinic_id', user.clinicId)
        .maybeSingle();

      setSendState(state as SendState | null);

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const failureCutoff = new Date(Date.now() - FAILURE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

      const [pending, sentToday, failed] = await Promise.all([
        supabase
          .from('whatsapp_message_queue')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', user.clinicId)
          .eq('status', 'pending'),
        supabase
          .from('whatsapp_message_queue')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', user.clinicId)
          .eq('status', 'sent')
          .gte('sent_at', startOfToday.toISOString()),
        supabase
          .from('whatsapp_message_queue')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', user.clinicId)
          .eq('status', 'failed')
          .gte('updated_at', failureCutoff.toISOString())
      ]);

      setStats({
        pending: pending.count ?? 0,
        sentToday: sentToday.count ?? 0,
        failed: failed.count ?? 0
      });
    } catch (error) {
      console.error('Failed to load reminder automation settings:', error);
      setMessage({ type: 'error', text: 'Failed to load reminder automation settings' });
    } finally {
      setLoading(false);
    }
  }, [user?.clinicId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFailures = async () => {
    if (failures) {
      setFailures(null);
      return;
    }
    if (!user?.clinicId || !supabase) return;

    try {
      setLoadingFailures(true);
      const cutoff = new Date(Date.now() - FAILURE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from('whatsapp_message_queue')
        .select('id, event_type, phone_number, error, retry_count, updated_at')
        .eq('clinic_id', user.clinicId)
        .eq('status', 'failed')
        .gte('updated_at', cutoff.toISOString())
        .order('updated_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setFailures((data ?? []) as FailedMessage[]);
    } catch (error) {
      console.error('Failed to load failed messages:', error);
      setMessage({ type: 'error', text: 'Could not load the failed messages' });
    } finally {
      setLoadingFailures(false);
    }
  };

  const save = async () => {
    if (!user?.clinicId || !supabase) return;

    // maxGap below minGap would make the randomised gap negative and send in a burst.
    const normalised: AutoSendConfig = {
      ...config,
      minGapMinutes: clamp(config.minGapMinutes, 2, 240),
      maxGapMinutes: clamp(Math.max(config.maxGapMinutes, config.minGapMinutes), 2, 240),
      appointmentReminderHoursBefore: clamp(config.appointmentReminderHoursBefore, 1, 168),
      followUpLeadDays: clamp(config.followUpLeadDays, 0, 30)
    };

    try {
      setSaving(true);
      const { error } = await supabase
        .from('clinic_settings')
        .update({ whatsapp_auto_send_config: normalised })
        .eq('id', user.clinicId);

      if (error) throw error;

      setConfig(normalised);
      setMessage({ type: 'success', text: 'Reminder automation settings saved' });
    } catch (error) {
      console.error('Failed to save reminder automation settings:', error);
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </div>
    );
  }

  const perHour = throughputPerHour(config);
  const sessionBroken = (sendState?.failure_streak ?? 0) >= 3;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Timer className="w-6 h-6 text-green-600" />
          <h3 className="text-lg font-semibold text-gray-800">Reminder Automation</h3>
        </div>
        <p className="text-sm text-gray-600">
          Appointment and follow-up reminders are queued and sent by the server on a schedule. They keep
          going when nobody is signed in.
        </p>
      </div>

      {sessionBroken && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-800">
              WhatsApp sending is failing ({sendState?.failure_streak} attempts in a row)
            </p>
            <p className="text-red-700 mt-1">
              Reminders are still queuing but not going out. This usually means the shared WhatsApp session
              has disconnected &mdash; reconnect it in WhatsApp settings.
            </p>
            {sendState?.last_error && (
              <p className="text-red-600 mt-1 font-mono text-xs break-all">{sendState.last_error}</p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile label="Waiting in queue" value={stats.pending} />
        <StatTile label="Sent today" value={stats.sentToday} />
        <StatTile
          label={`Failed (last ${FAILURE_LOOKBACK_DAYS} days)`}
          value={stats.failed}
          tone={stats.failed > 0 ? 'warn' : 'plain'}
          onClick={stats.failed > 0 ? toggleFailures : undefined}
          actionLabel={failures ? 'Hide details' : 'Show details'}
        />
      </div>

      {loadingFailures && <p className="text-sm text-gray-500">Loading failed messages...</p>}

      {failures && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {failures.length === 0 ? (
            <p className="text-sm text-gray-600 p-4">
              No failures in the last {FAILURE_LOOKBACK_DAYS} days.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">When</th>
                    <th className="text-left font-medium px-4 py-2">Type</th>
                    <th className="text-left font-medium px-4 py-2">To</th>
                    <th className="text-left font-medium px-4 py-2">Tries</th>
                    <th className="text-left font-medium px-4 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.map((f) => (
                    <tr key={f.id} className="border-t border-gray-200 align-top">
                      <td className="px-4 py-2 whitespace-nowrap text-gray-700">
                        {new Date(f.updated_at).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-700">{f.event_type}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-700">{f.phone_number}</td>
                      <td className="px-4 py-2 text-gray-700">{f.retry_count}</td>
                      <td className="px-4 py-2 text-red-700 break-all">{f.error || 'No error recorded'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Gap between messages (minutes)</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={2}
              max={240}
              value={config.minGapMinutes}
              onChange={(e) => setConfig({ ...config, minGapMinutes: Number(e.target.value) })}
              className="input-field"
            />
            <span className="text-gray-500 text-sm">to</span>
            <input
              type="number"
              min={2}
              max={240}
              value={config.maxGapMinutes}
              onChange={(e) => setConfig({ ...config, maxGapMinutes: Number(e.target.value) })}
              className="input-field"
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            A random gap in this range is used after every send, so the cadence never looks automated.
            Roughly <strong>{perHour}</strong> messages per hour. Minimum 2 minutes &mdash; sending faster
            risks the number being flagged by WhatsApp.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Sending hours</label>
          <div className="flex items-center gap-3">
            <input
              type="time"
              value={config.sendWindowStart}
              onChange={(e) => setConfig({ ...config, sendWindowStart: e.target.value })}
              className="input-field"
            />
            <span className="text-gray-500 text-sm">to</span>
            <input
              type="time"
              value={config.sendWindowEnd}
              onChange={(e) => setConfig({ ...config, sendWindowEnd: e.target.value })}
              className="input-field"
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Messages queued outside these hours wait until the window reopens. Times are IST.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Send appointment reminders this many hours before
          </label>
          <input
            type="number"
            min={1}
            max={168}
            value={config.appointmentReminderHoursBefore}
            onChange={(e) => setConfig({ ...config, appointmentReminderHoursBefore: Number(e.target.value) })}
            className="input-field"
          />
          <p className="text-xs text-gray-500 mt-2">24 = the day before. Only Scheduled and Confirmed appointments are reminded.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Send follow-up reminders this many days early
          </label>
          <input
            type="number"
            min={0}
            max={30}
            value={config.followUpLeadDays}
            onChange={(e) => setConfig({ ...config, followUpLeadDays: Number(e.target.value) })}
            className="input-field"
          />
          <p className="text-xs text-gray-500 mt-2">0 = on the follow-up date itself.</p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Clock className="w-4 h-4" />
          {sendState?.last_sent_at
            ? <span>Last message sent {new Date(sendState.last_sent_at).toLocaleString('en-IN')}</span>
            : <span>No messages sent yet</span>}
        </div>
        <button onClick={save} className="primary-button" disabled={saving}>
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving...' : 'Save Settings'}</span>
        </button>
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 text-sm rounded-lg px-4 py-3 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {message.text}
        </div>
      )}
    </div>
  );
};

const StatTile: React.FC<{
  label: string;
  value: number;
  tone?: 'plain' | 'warn';
  onClick?: () => void;
  actionLabel?: string;
}> = ({ label, value, tone = 'plain', onClick, actionLabel }) => {
  const body = (
    <>
      <p className={`text-2xl font-semibold ${tone === 'warn' ? 'text-amber-700' : 'text-gray-800'}`}>{value}</p>
      <p className="text-xs text-gray-600 mt-1">{label}</p>
      {onClick && actionLabel && (
        <p className="text-xs text-blue-600 mt-2 font-medium">{actionLabel}</p>
      )}
    </>
  );

  const className = `rounded-lg border p-4 text-left w-full ${
    tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'
  } ${onClick ? 'hover:brightness-95 transition' : ''}`;

  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
};

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min;

const throughputPerHour = (config: AutoSendConfig): string => {
  const min = Math.max(config.minGapMinutes, 2);
  const max = Math.max(config.maxGapMinutes, min);
  const fastest = Math.floor(60 / min);
  const slowest = Math.floor(60 / max);
  return slowest === fastest ? `${fastest}` : `${slowest}-${fastest}`;
};

export default ReminderAutomationSettings;
