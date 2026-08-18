/**
 * Scheduled every 5 minutes. Sends AT MOST ONE queued message per clinic per
 * run, then pushes that clinic's clock forward by a random 5-10 minute gap.
 *
 * Throughput is deliberately low: roughly 6-12 messages per clinic per hour,
 * ~50-90 across a working day. That is the anti-ban budget for a WhatsApp Web
 * session, not an oversight. Clinics that need to go faster can lower
 * minGapMinutes (floor 2) in Settings.
 */

import type { Handler } from '@netlify/functions';
import {
  deliverQueuedMessage,
  getServiceClient,
  isWithinSendWindow,
  nextGapMinutes,
  parseConfig,
  type QueueRow
} from './_shared/autoSender';

interface ClinicRow {
  id: string;
  whatsapp_shared_session_user_id: string | null;
  whatsapp_auto_send_config: unknown;
}

const handler: Handler = async () => {
  const supabase = getServiceClient();
  const summary = { clinicsChecked: 0, sent: 0, failed: 0, skipped: [] as string[] };

  // Only look at clinics that actually have work waiting.
  const { data: dueRows, error: dueError } = await supabase
    .from('whatsapp_message_queue')
    .select('clinic_id')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .lt('retry_count', 3);

  if (dueError) {
    console.error('[whatsapp-queue] failed to scan queue:', dueError.message);
    return { statusCode: 500, body: JSON.stringify({ error: dueError.message }) };
  }

  const clinicIds = [...new Set((dueRows ?? []).map((r) => r.clinic_id as string))];
  if (clinicIds.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ ...summary, note: 'nothing due' }) };
  }

  const { data: clinics, error: clinicError } = await supabase
    .from('clinic_settings')
    .select('id, whatsapp_shared_session_user_id, whatsapp_auto_send_config')
    .in('id', clinicIds);

  if (clinicError) {
    console.error('[whatsapp-queue] failed to load clinics:', clinicError.message);
    return { statusCode: 500, body: JSON.stringify({ error: clinicError.message }) };
  }

  const now = new Date();

  for (const clinic of (clinics ?? []) as ClinicRow[]) {
    summary.clinicsChecked += 1;
    const config = parseConfig(clinic.whatsapp_auto_send_config);

    if (!isWithinSendWindow(config, now)) {
      summary.skipped.push(`${clinic.id}: outside send window`);
      continue;
    }

    if (!clinic.whatsapp_shared_session_user_id) {
      summary.skipped.push(`${clinic.id}: no shared WhatsApp session configured`);
      continue;
    }

    // The drip clock. A missing row means this clinic has never sent -- go now.
    const { data: state } = await supabase
      .from('whatsapp_send_state')
      .select('next_send_after')
      .eq('clinic_id', clinic.id)
      .maybeSingle();

    if (state?.next_send_after && new Date(state.next_send_after) > now) {
      summary.skipped.push(`${clinic.id}: gap not elapsed`);
      continue;
    }

    const { data: claimed, error: claimError } = await supabase.rpc('claim_next_whatsapp_message', {
      p_clinic_id: clinic.id
    });

    if (claimError) {
      console.error(`[whatsapp-queue] claim failed for ${clinic.id}:`, claimError.message);
      continue;
    }

    const row = (Array.isArray(claimed) ? claimed[0] : claimed) as QueueRow | undefined;
    if (!row) continue;

    // The appointment may have been cancelled or rescheduled in the hours since
    // the reminder was queued. Sending "your appointment is tomorrow" for a
    // cancelled slot is worse than sending nothing.
    if (await isStale(supabase, row)) {
      await supabase
        .from('whatsapp_message_queue')
        .update({ status: 'cancelled', claimed_at: null, error: 'Appointment no longer scheduled' })
        .eq('id', row.id);
      summary.skipped.push(`${clinic.id}: dropped stale reminder`);
      continue; // no send happened, so the gap clock is untouched
    }

    try {
      await deliverQueuedMessage({ row, sessionAuthId: clinic.whatsapp_shared_session_user_id });

      await supabase
        .from('whatsapp_message_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .eq('id', row.id);

      await supabase.from('whatsapp_message_log').insert({
        clinic_id: row.clinic_id,
        patient_id: row.patient_id,
        phone_number: row.phone_number,
        event_type: row.event_type,
        message_content: row.message_content,
        status: 'sent',
        sent_at: new Date().toISOString(),
        metadata: { ...(row.metadata ?? {}), sentBy: 'scheduler' }
      });

      await bumpClock(supabase, clinic.id, config, { ok: true });
      summary.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown send error';
      const attempts = row.retry_count + 1;

      // Back to 'pending' so it retries on a later run; 3 strikes and the claim
      // query stops picking it up.
      await supabase
        .from('whatsapp_message_queue')
        .update({
          status: attempts >= 3 ? 'failed' : 'pending',
          claimed_at: null,
          retry_count: attempts,
          error: message
        })
        .eq('id', row.id);

      if (attempts >= 3) {
        await supabase.from('whatsapp_message_log').insert({
          clinic_id: row.clinic_id,
          patient_id: row.patient_id,
          phone_number: row.phone_number,
          event_type: row.event_type,
          message_content: row.message_content,
          status: 'failed',
          sent_at: new Date().toISOString(),
          error: message,
          metadata: { ...(row.metadata ?? {}), sentBy: 'scheduler' }
        });
      }

      // A failure still consumes the gap slot -- retrying instantly against a
      // dead session is exactly what gets a number flagged.
      await bumpClock(supabase, clinic.id, config, { ok: false, error: message });
      summary.failed += 1;
      console.error(`[whatsapp-queue] send failed for clinic ${clinic.id}:`, message);
    }
  }

  return { statusCode: 200, body: JSON.stringify(summary) };
};

/**
 * True when the thing a queued reminder refers to no longer warrants a message.
 * Only auto-generated reminders are re-validated; anything a human queued by
 * hand is sent as-is.
 */
async function isStale(supabase: ReturnType<typeof getServiceClient>, row: QueueRow): Promise<boolean> {
  const metadata = row.metadata ?? {};
  if (metadata.source !== 'auto_reminder') return false;

  if (row.event_type === 'appointment_reminder' && typeof metadata.appointmentId === 'string') {
    const { data, error } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', metadata.appointmentId)
      .maybeSingle();

    // On a lookup error, err toward sending: a transient DB blip should not
    // silently cancel a legitimate reminder.
    if (error) return false;
    if (!data) return true;
    return !['Scheduled', 'Confirmed'].includes(data.status);
  }

  if (row.event_type === 'follow_up_reminder' && typeof metadata.visitId === 'string') {
    const { data, error } = await supabase
      .from('visits')
      .select('follow_up_date')
      .eq('id', metadata.visitId)
      .maybeSingle();

    if (error) return false;
    return !data || !data.follow_up_date;
  }

  return false;
}

async function bumpClock(
  supabase: ReturnType<typeof getServiceClient>,
  clinicId: string,
  config: Parameters<typeof nextGapMinutes>[0],
  result: { ok: true } | { ok: false; error: string }
) {
  const nextSendAfter = new Date(Date.now() + nextGapMinutes(config) * 60 * 1000).toISOString();

  const patch: Record<string, unknown> = { clinic_id: clinicId, next_send_after: nextSendAfter };

  if (result.ok) {
    patch.last_sent_at = new Date().toISOString();
    patch.failure_streak = 0;
    patch.last_error = null;
  } else {
    const { data: current } = await supabase
      .from('whatsapp_send_state')
      .select('failure_streak')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    patch.failure_streak = (current?.failure_streak ?? 0) + 1;
    patch.last_error = result.error;
    patch.last_error_at = new Date().toISOString();
  }

  await supabase.from('whatsapp_send_state').upsert(patch, { onConflict: 'clinic_id' });
}

export { handler };
