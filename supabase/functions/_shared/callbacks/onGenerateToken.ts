// M2 §4.3.2 — the link token arrives here.
//
//   POST {base}/api/v3/hip/token/on-generate-token
//   { "abhaAddress": "...", "linkToken": "...", "response": { "requestId": "..." } }
//
// This is the ONLY place a link token is ever obtained. `generate-token` answers
// a bare 202; the token itself only ever comes through this callback. If this
// handler fails, no care context for that patient can be linked — and because
// re-requesting is capped at three per ABHA per facility per day (FAQ Q31), a
// silent failure here is expensive to recover from.
//
// ABDM also delivers its rate-limit refusal on this same callback: the body
// carries a message rather than a token. That is not an error to swallow — it
// is the signal that we have been calling generate-token too often.

import { storeLinkToken } from '../abdmLinkToken.ts';
import { type CallbackContext, clinicForHipId } from './types.ts';

export async function handleOnGenerateToken(ctx: CallbackContext): Promise<void> {
  const abhaAddress = String(ctx.body.abhaAddress ?? '').trim();
  const linkToken = String(ctx.body.linkToken ?? '').trim();

  if (!linkToken) {
    // No token means ABDM refused. The commonest reason is the 24-hour block
    // from too many generate-token calls, and the reason travels in the body.
    console.error(
      `[abdm-cb][${ctx.requestId}] on-generate-token carried NO token for ${abhaAddress || '<no address>'}: ` +
        JSON.stringify(ctx.body).slice(0, 400),
    );
    return;
  }

  if (!abhaAddress) {
    console.error(`[abdm-cb][${ctx.requestId}] on-generate-token has a token but no abhaAddress`);
    return;
  }

  const clinic = await clinicForHipId(ctx.admin, ctx.hipId);
  if (!clinic) {
    console.error(`[abdm-cb][${ctx.requestId}] on-generate-token for unknown HIP ID ${ctx.hipId}`);
    return;
  }

  // Best-effort patient association. The token is keyed on (clinic, ABHA
  // address) and works without a patient row, so a failure to match must not
  // discard a token that cost us one of three daily requests.
  const { data: patient } = await ctx.admin
    .from('patients')
    .select('id, abha_number')
    .eq('clinic_id', clinic.id)
    .eq('abha_address', abhaAddress)
    .maybeSingle();

  await storeLinkToken(
    ctx.admin,
    clinic.id,
    patient?.id ?? null,
    abhaAddress,
    (patient?.abha_number as string | null) ?? null,
    linkToken,
  );

  console.log(`[abdm-cb][${ctx.requestId}] link token stored for ${abhaAddress} at ${clinic.clinic_name}`);
}
