/**
 * Shared plumbing for the two scheduled reminder functions.
 *
 * The important property: this reuses forwardToWhatsApp() and the exact payload
 * shape of netlify/functions/whatsapp-send-message.ts, so an automatic reminder
 * travels the identical path as a message a receptionist sends by hand. The only
 * difference is who supplies the auth id -- staff send as themselves, the
 * scheduler sends as clinic_settings.whatsapp_shared_session_user_id.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { forwardToWhatsApp } from './whatsappClient';
import { getUserIdFromAuthId } from './userLookup';

export interface AutoSendConfig {
  minGapMinutes: number;
  maxGapMinutes: number;
  sendWindowStart: string;
  sendWindowEnd: string;
  appointmentReminderHoursBefore: number;
  followUpLeadDays: number;
}

export const DEFAULT_CONFIG: AutoSendConfig = {
  minGapMinutes: 5,
  maxGapMinutes: 10,
  sendWindowStart: '09:00',
  sendWindowEnd: '20:00',
  appointmentReminderHoursBefore: 24,
  followUpLeadDays: 0
};

export interface QueueRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  phone_number: string;
  event_type: string;
  message_content: string;
  metadata: Record<string, unknown> | null;
  retry_count: number;
}

let cachedClient: SupabaseClient | null = null;

/** Service-role client: the scheduler has no user session, so RLS must be bypassed. */
export function getServiceClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('SUPABASE_URL is not configured for scheduled functions.');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured for scheduled functions.');

  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return cachedClient;
}

export function parseConfig(raw: unknown): AutoSendConfig {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<AutoSendConfig>;
  const min = numberOr(value.minGapMinutes, DEFAULT_CONFIG.minGapMinutes);
  const max = numberOr(value.maxGapMinutes, DEFAULT_CONFIG.maxGapMinutes);

  return {
    // 2 minutes is the floor -- anything faster reads as automation to WhatsApp.
    minGapMinutes: clamp(min, 2, 240),
    maxGapMinutes: clamp(Math.max(max, min), 2, 240),
    sendWindowStart: typeof value.sendWindowStart === 'string' ? value.sendWindowStart : DEFAULT_CONFIG.sendWindowStart,
    sendWindowEnd: typeof value.sendWindowEnd === 'string' ? value.sendWindowEnd : DEFAULT_CONFIG.sendWindowEnd,
    appointmentReminderHoursBefore: clamp(
      numberOr(value.appointmentReminderHoursBefore, DEFAULT_CONFIG.appointmentReminderHoursBefore),
      1,
      168
    ),
    followUpLeadDays: clamp(numberOr(value.followUpLeadDays, DEFAULT_CONFIG.followUpLeadDays), 0, 30)
  };
}

const numberOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Minutes since midnight, IST. The send window is expressed in clinic-local time. */
export function istMinutesOfDay(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata'
  }).formatToParts(at);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

export function istDateString(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at); // YYYY-MM-DD
}

const parseClockMinutes = (value: string, fallback: number): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  return clamp(Number(match[1]), 0, 23) * 60 + clamp(Number(match[2]), 0, 59);
};

/** Build an instant from an IST calendar date (YYYY-MM-DD) plus minutes-of-day. */
function istInstant(dateStr: string, minutes: number): Date {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return new Date(`${dateStr}T${hh}:${mm}:00+05:30`);
}

function shiftIstDate(dateStr: string, days: number): string {
  // Midday anchor keeps the shift clear of any DST/offset edge.
  const anchor = new Date(`${dateStr}T12:00:00+05:30`);
  return istDateString(new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000));
}

/**
 * The latest moment at or before `ideal` that falls inside the send window.
 *
 * A reminder whose natural send time lands outside the window must be pulled
 * EARLIER, never later. Pushing it later is what made a 12-hour lead useless: a
 * 10am appointment wants its reminder at 10pm, the window closes at 8pm, and
 * waiting for the window to reopen delivered it at 9am -- an hour before the
 * appointment. Pulling back to the previous close sends it at 8pm instead.
 */
export function windowAdjustedSendTime(ideal: Date, config: AutoSendConfig): Date {
  const start = parseClockMinutes(config.sendWindowStart, 9 * 60);
  const end = parseClockMinutes(config.sendWindowEnd, 20 * 60);
  const minutes = istMinutesOfDay(ideal);
  const date = istDateString(ideal);

  if (start <= end) {
    if (minutes >= start && minutes <= end) return ideal;
    // After close: back to today's close. Before open: back to yesterday's close.
    return minutes > end ? istInstant(date, end) : istInstant(shiftIstDate(date, -1), end);
  }

  // Window wraps past midnight (e.g. 22:00 -> 06:00); inside is start..24h plus 0..end.
  if (minutes >= start || minutes <= end) return ideal;
  return istInstant(date, end);
}

/**
 * Every reminder whose ideal time fell outside the window lands on the same
 * closing minute. Left there, the sender would deliver one at the close and the
 * next a gap later -- past the close -- stalling the rest until the window
 * reopens, which is the very failure windowAdjustedSendTime exists to prevent.
 *
 * So rows sharing one instant are laid out backwards from it, one max-gap
 * apart, earliest appointment first (lowest `priority`) so send order matches
 * appointment order. Clamped at `now`; a group too large to fit stacks at the
 * front and drips over following days, which the queue count makes visible.
 */
export function spreadBackwardsFromWindowClose(
  rows: { scheduled_at: unknown; priority: unknown }[],
  config: AutoSendConfig,
  now: Date
): void {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = String(row.scheduled_at);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const stepMs = config.maxGapMinutes * 60 * 1000;

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    group.sort((a, b) => Number(a.priority) - Number(b.priority));
    const anchor = new Date(key).getTime();

    group.forEach((row, index) => {
      const offset = (group.length - 1 - index) * stepMs;
      row.scheduled_at = new Date(Math.max(anchor - offset, now.getTime())).toISOString();
    });
  }
}

export function isWithinSendWindow(config: AutoSendConfig, at: Date = new Date()): boolean {
  const now = istMinutesOfDay(at);
  const start = parseClockMinutes(config.sendWindowStart, 9 * 60);
  const end = parseClockMinutes(config.sendWindowEnd, 20 * 60);

  // A window that wraps past midnight (e.g. 22:00 -> 06:00) is two ranges.
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}

/** Randomised so the outgoing cadence never looks like a fixed-interval bot. */
export function nextGapMinutes(config: AutoSendConfig): number {
  const spread = config.maxGapMinutes - config.minGapMinutes;
  return config.minGapMinutes + Math.random() * spread;
}

export function formatPhoneForWhatsApp(phone: string, defaultCountryCode = '91'): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '').replace(/^0+/, '');
  if (cleaned.startsWith(defaultCountryCode)) return cleaned;
  if (cleaned.length === 10) return `${defaultCountryCode}${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `9${cleaned}`;
  return `${defaultCountryCode}${cleaned}`;
}

/**
 * Sends one claimed queue row. Resolves the clinic's shared WhatsApp session
 * and posts the same body whatsapp-send-message builds.
 */
export async function deliverQueuedMessage(params: {
  row: QueueRow;
  sessionAuthId: string;
}): Promise<void> {
  const { row, sessionAuthId } = params;

  const backendUserId = await getUserIdFromAuthId(sessionAuthId);
  if (!backendUserId) {
    throw new Error(
      'Clinic WhatsApp session user is not synced to the WhatsApp backend. Reconnect WhatsApp in Settings.'
    );
  }

  const phone = formatPhoneForWhatsApp(row.phone_number);
  if (!phone) throw new Error('Queued message has no usable phone number.');

  await forwardToWhatsApp({
    path: `/api/users/${backendUserId}/whatsapp/send-message`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phoneNumber: phone,
      phone,
      text: row.message_content,
      message: row.message_content,
      labId: row.clinic_id,
      channel: 'OPD'
    })
  });
}
