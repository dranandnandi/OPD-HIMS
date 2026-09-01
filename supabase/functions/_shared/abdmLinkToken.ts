// HIP linking token — M2 spec §4.3.1.
//
//   POST {gateway}/v3/token/generate-token   -> 202, answered on a CALLBACK
//
// The token authenticates us as the HIP for one patient at one facility, and
// every care-context link needs it.
//
// ############ WHY THIS IS CACHED, AND WHY THAT IS NOT OPTIONAL #############
//
// The token is valid for SIX MONTHS. More than **three** generate-token calls
// for the same ABHA address from the same facility in a single day returns
// "You are blocked for 24 hours" on the callback (FAQ v1.4 Q31).
//
// So a naive "generate a token, then link" on every visit would lock a clinic
// out of linking for a day on the third patient visit — and the failure would
// arrive asynchronously on a callback, long after the desk moved on. Read the
// cache first, always.
// ###########################################################################
//
// Note the shape: generate-token returns **202**, not the token. ABDM delivers
// it to `{callback}/api/v3/hip/token/on-generate-token`. So this module can
// only *request* a token and read one the callback has already stored — it can
// never synchronously return a fresh one.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { type AbdmConfig, abdmHeaders } from './abdmConfig.ts';
import { AbdmUpstreamError } from './abdmSession.ts';

/** Renew this far before nominal expiry, so a link never starts on a token
 *  that dies mid-flight. Generous because re-requesting is rate limited. */
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

export interface LinkTokenRow {
  linkToken: string;
  abhaAddress: string;
  /** Whether the ABHA number was sent at generate time. FAQ Q32: link/carecontext
   *  must match that choice exactly, so it travels with the token. */
  abhaNumber: string | null;
}

/** A usable cached token, or null. Never calls ABDM. */
export async function readCachedLinkToken(
  admin: SupabaseClient,
  clinicId: string,
  abhaAddress: string,
): Promise<LinkTokenRow | null> {
  const { data } = await admin
    .from('abdm_link_tokens')
    .select('link_token, abha_address, abha_number, expires_at')
    .eq('clinic_id', clinicId)
    .eq('abha_address', abhaAddress)
    .gt('expires_at', new Date(Date.now() + RENEW_BEFORE_MS).toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    linkToken: data.link_token as string,
    abhaAddress: data.abha_address as string,
    abhaNumber: (data.abha_number as string | null) ?? null,
  };
}

export interface GenerateTokenArgs {
  hipId: string;
  abhaAddress: string;
  /** Optional. If supplied here it MUST also be supplied on link/carecontext. */
  abhaNumber?: string | null;
  name?: string | null;
  gender?: string | null;
  yearOfBirth?: number | null;
}

/**
 * Asks ABDM to issue a link token. Returns nothing useful on purpose.
 *
 * The response is a bare 202. The token arrives later on
 * `/api/v3/hip/token/on-generate-token`, which is what persists it. Callers
 * must treat linking as a two-phase operation, not a function call.
 */
export async function requestLinkToken(
  cfg: AbdmConfig,
  accessToken: string,
  requestId: string,
  args: GenerateTokenArgs,
): Promise<void> {
  const res = await fetch(`${cfg.gatewayBase}/v3/token/generate-token`, {
    method: 'POST',
    headers: abdmHeaders(cfg, accessToken, requestId, { 'X-HIP-ID': args.hipId }),
    body: JSON.stringify({
      abhaAddress: args.abhaAddress,
      // Only include when we have it — sending null would commit us to sending
      // it on link/carecontext too, where a null would then mismatch.
      ...(args.abhaNumber ? { abhaNumber: args.abhaNumber } : {}),
      ...(args.name ? { name: args.name } : {}),
      ...(args.gender ? { gender: args.gender } : {}),
      ...(args.yearOfBirth ? { yearOfBirth: args.yearOfBirth } : {}),
    }),
  });

  if (!res.ok) {
    throw new AbdmUpstreamError('Link token request rejected', res.status, await res.text());
  }
  await res.text();
}

/** Persist a token delivered by the on-generate-token callback. */
export async function storeLinkToken(
  admin: SupabaseClient,
  clinicId: string,
  patientId: string | null,
  abhaAddress: string,
  abhaNumber: string | null,
  linkToken: string,
  validForMs = 180 * 24 * 60 * 60 * 1000,
): Promise<void> {
  await admin.from('abdm_link_tokens').insert({
    clinic_id: clinicId,
    patient_id: patientId,
    abha_address: abhaAddress,
    abha_number: abhaNumber,
    link_token: linkToken,
    expires_at: new Date(Date.now() + validForMs).toISOString(),
  });

  // Keep one live token per (clinic, ABHA). Older rows are not merely
  // redundant: readCachedLinkToken orders by expiry, so a stale row can never
  // be served, but leaving them accumulates a table of live HIP credentials.
  await admin
    .from('abdm_link_tokens')
    .delete()
    .eq('clinic_id', clinicId)
    .eq('abha_address', abhaAddress)
    .lt('expires_at', new Date().toISOString());
}
