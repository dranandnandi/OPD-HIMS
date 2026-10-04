/**
 * ABDM operations that are the CLINIC's, not a patient's.
 *
 * `abhaService` covers identity — verifying and linking an ABHA. This covers
 * what happens afterwards: telling ABDM where to reach us, and announcing that
 * a visit exists so it appears in the patient's ABHA app.
 *
 * Kept separate because the blast radius differs. Nothing in `abhaService` is
 * irreversible; `linkCareContexts` here is permanent, and one file whose every
 * export needs a confirmation step is easier to keep honest than a mixed one.
 */

import { supabase, supabaseUrl } from '../lib/supabaseClient';

/**
 * ABDM's own execution region. Mirrors `abhaService` — health data must be
 * processed in India, and an edge function will otherwise run wherever the
 * caller happens to be.
 */
const ABDM_FUNCTION_REGION = 'ap-south-1';

export type CareContextStatus = 'not-recorded' | 'pending' | 'linked' | 'failed';

export interface CareContextView {
  /** `visit:<id>:<hiType>` — deterministic, and permanent once announced. */
  referenceNumber: string;
  /** Patient-facing label; this is the text shown in the ABHA app. */
  display: string;
  hiType: string;
  status: CareContextStatus;
  errorMessage: string | null;
  linkedAt: string | null;
}

export interface VisitLinkStatus {
  ready: boolean;
  /** Every reason this visit cannot be linked, not just the first. */
  blockers: string[];
  abhaAddress: string | null;
  abhaNumber: string | null;
  hipId: string | null;
  /** Absent means the first link attempt spends one of three daily
   *  generate-token calls and completes on a callback, not immediately. */
  linkToken: { present: boolean; expiresAt: string | null };
  careContexts: CareContextView[];
  requestId: string;
}

export interface LinkCareContextResult {
  /** ABDM accepted the announcement. Confirmation still arrives on a callback. */
  accepted?: boolean;
  /** A link token was requested; nothing was announced. Try again once it lands. */
  pending?: boolean;
  reason?: string;
  /** Every care context was already linked; nothing was sent. */
  alreadyLinked?: boolean;
  careContexts?: CareContextView[];
  requestId: string;
}

export interface RegisterCallbackResult {
  registered: boolean;
  url: string;
  env: 'sandbox' | 'production';
  requestId: string;
}

async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase client not initialised');

  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { 'x-region': ABDM_FUNCTION_REGION },
  });

  // supabase-js collapses every non-2xx into "Edge Function returned a
  // non-2xx status code" and hides the real message on `error.context`.
  if (error) {
    const context = (error as { context?: Response })?.context;
    let message = '';
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json();
        if (typeof payload?.error === 'string') message = payload.error;
      } catch {
        // Body was not JSON. Fall through to the generic message.
      }
    }
    throw new Error(message || error.message);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

/**
 * The callback base URL as ABDM should hold it.
 *
 * BASE ONLY — it stops at the function name. ABDM appends its own paths
 * (`/api/v3/hip/token/on-generate-token` and the rest), and Supabase routes
 * `/functions/v1/<name>/<anything>` to that function, so whatever ABDM adds
 * still lands on the dispatcher. Registering a full endpoint makes ABDM append
 * a second copy of the path, and callbacks then stop arriving with nothing
 * logged anywhere to explain it (FAQ v1.4 Q30).
 */
export function defaultCallbackBase(): string {
  if (!supabaseUrl) return '';
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/abdm-callback`;
}

export const abdmService = {
  /**
   * Point ABDM's callbacks at a URL. **Bridge-wide**, not per-clinic — this
   * moves where ABDM delivers data for every clinic sharing this bridge.
   */
  async registerCallback(url: string): Promise<RegisterCallbackResult> {
    return invokeFunction<RegisterCallbackResult>('abdm-register-callback', { url });
  },

  /** Read-only. Safe to call on render; never writes and never calls ABDM. */
  async getVisitLinkStatus(visitId: string, patientId: string): Promise<VisitLinkStatus> {
    return invokeFunction<VisitLinkStatus>('abdm-care-context-status', { visitId, patientId });
  },

  /**
   * Announce this visit's care contexts to ABDM.
   *
   * IRREVERSIBLE. Care contexts cannot be unlinked, renamed or withdrawn once
   * ABDM accepts them (FAQ v1.4 Q33). Callers must confirm with the operator
   * first — that is not a UI nicety, it is the only safeguard that exists.
   */
  async linkCareContexts(visitId: string, patientId: string): Promise<LinkCareContextResult> {
    return invokeFunction<LinkCareContextResult>('abdm-link-carecontext', { visitId, patientId });
  },
};
