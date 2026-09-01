// M2 §4.3.4 — ABDM confirms (or refuses) a care-context link.
//
//   POST {base}/api/v3/hip/link/care-context/on-add-contexts
//
// This is where `pending` becomes `linked`. Until it arrives we have announced
// care contexts to ABDM and have no idea whether the patient can see them, so a
// missing callback is not a cosmetic gap — it is the difference between "shared"
// and "believed shared".
//
// The reply carries either an acknowledgement or an `error`. Both matter:
// ABDM-1090 (duplicate) means the reference was already announced, which is a
// bug in our idempotency rather than a transient failure, and it must be
// visible rather than retried.

import { markCareContextsFailed, markCareContextsLinked } from '../careContext.ts';
import { type CallbackContext, clinicForHipId } from './types.ts';

export async function handleOnLinkCareContext(ctx: CallbackContext): Promise<void> {
  const response = (ctx.body.response ?? {}) as Record<string, unknown>;
  const error = (ctx.body.error ?? null) as Record<string, unknown> | null;
  const abdmRequestId = String(response.requestId ?? '').trim();

  const clinic = await clinicForHipId(ctx.admin, ctx.hipId);
  if (!clinic) {
    console.error(`[abdm-cb][${ctx.requestId}] on-add-contexts for unknown HIP ID ${ctx.hipId}`);
    return;
  }

  // ABDM correlates on ITS requestId, which is the one we sent as REQUEST-ID on
  // the link call. We do not persist that against the rows, so the callback is
  // matched on the care contexts still pending for this clinic — narrow enough
  // in practice because linking is per-visit and settles in seconds.
  //
  // If linking ever becomes bulk or slow, this needs the request id stored on
  // the row instead. Recorded rather than silently assumed.
  const { data: pending } = await ctx.admin
    .from('abdm_care_contexts')
    .select('id')
    .eq('clinic_id', clinic.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20);

  const ids = (pending ?? []).map((r) => r.id as string);
  if (!ids.length) {
    console.warn(`[abdm-cb][${ctx.requestId}] on-add-contexts with nothing pending for ${clinic.clinic_name}`);
    return;
  }

  if (error) {
    const code = String(error.code ?? '');
    const message = String(error.message ?? 'unknown');
    // ABDM-1090 is "already linked". Treating it as a failure would be wrong —
    // the contexts ARE linked, just not by this request — but it is also a
    // signal that our idempotency guard let a duplicate through.
    if (code.includes('1090')) {
      console.warn(`[abdm-cb][${ctx.requestId}] duplicate link (${code}); marking linked and review idempotency`);
      await markCareContextsLinked(ctx.admin, ids, abdmRequestId || ctx.requestId);
      return;
    }
    console.error(`[abdm-cb][${ctx.requestId}] link refused ${code}: ${message}`);
    await markCareContextsFailed(ctx.admin, ids, `${code} ${message}`);
    return;
  }

  await markCareContextsLinked(ctx.admin, ids, abdmRequestId || ctx.requestId);
  console.log(`[abdm-cb][${ctx.requestId}] ${ids.length} care context(s) linked for ${clinic.clinic_name}`);
}
