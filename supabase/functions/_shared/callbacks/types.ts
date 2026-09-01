// Shared shape for every ABDM callback handler.
//
// Handlers receive an ALREADY-VERIFIED request: the dispatcher checks ABDM's
// signature once, centrally, so no handler can forget to. They also run AFTER
// the 202 has been sent, which has two consequences worth stating plainly:
//
//  1. A handler cannot influence the HTTP response. Failure is reported to
//     ABDM on that flow's own `on-*` reply, not by throwing.
//  2. A handler must be safe to run more than once. ABDM retries what it
//     considers unanswered, and the 202 goes out before the work completes, so
//     duplicate delivery is normal rather than exceptional.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import type { getAbdmConfig } from '../abdmConfig.ts';

export interface CallbackContext {
  admin: SupabaseClient;
  cfg: ReturnType<typeof getAbdmConfig>;
  /** Our correlation id for this delivery. ABDM's own id is in the body. */
  requestId: string;
  /** From the X-HIP-ID header — which facility this callback is for. */
  hipId: string;
  body: Record<string, unknown>;
}

export type CallbackHandler = (ctx: CallbackContext) => Promise<void>;

/** Resolve the clinic a callback belongs to, by its ABDM facility identity. */
export async function clinicForHipId(
  admin: SupabaseClient,
  hipId: string,
): Promise<{ id: string; clinic_name: string } | null> {
  const { data } = await admin
    .from('clinic_settings')
    .select('id, clinic_name')
    .eq('abdm_hip_id', hipId)
    .maybeSingle();
  return (data as { id: string; clinic_name: string } | null) ?? null;
}
