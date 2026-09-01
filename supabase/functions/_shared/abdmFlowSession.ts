// Server-side custody of in-flight ABDM tokens.
//
// The mobile-OTP login (spec 7.4) is three chained calls and ABDM's T-token has
// to survive from step 2 to step 3. Handing it to the browser is what G-02 was;
// instead the token stays server-side and the client carries an opaque handle.
//
// Single use: reading a session deletes it. A replayed handle finds nothing,
// so an intercepted handle cannot be used twice.

import type { AbdmCaller } from './abdmAuthz.ts';
import { AbdmAuthError } from './abdmAuthz.ts';

/**
 * ABDM's T-token is valid for 300s. Six minutes covers that plus the human
 * pause between picking an account and confirming, without letting a stale
 * token linger meaningfully longer than ABDM would honour it anyway.
 */
const FLOW_TTL_MS = 6 * 60_000;

export type AbdmFlow =
  /** Spec 7.4 — verify an existing ABHA by mobile OTP. */
  | 'mobile-login'
  /** Spec 7.6.1.1 — find ABHA by mobile. */
  | 'abha-search'
  /**
   * Spec 14.1/14.2 — verify an ABHA by its ADDRESS.
   *
   * Kept distinct from 'mobile-login' because the X-token it mints belongs to
   * the PHR endpoint family: spending an address-flow handle on a mobile-login
   * step (or the reverse) would send the token to the wrong host and produce a
   * misleading "X-token expired" (FAQ v1.4 Q21).
   */
  | 'abha-address'
  /**
   * Spec 3 — Aadhaar enrolment, and the steps that chain off it: mobile
   * verification (3.4) and ABHA address creation (3.6). Those steps are
   * identified upstream by the enrolment `txnId`, which is why the session
   * outlives the enrol call itself.
   */
  | 'enrolment';

export interface FlowSessionData {
  txnId: string | null;
  tToken: string | null;
  xToken: string | null;
  patientId: string | null;
}

/** Stores the tokens and returns the handle to give the client. */
export async function createFlowSession(
  caller: AbdmCaller,
  flow: AbdmFlow,
  data: FlowSessionData,
): Promise<string> {
  const { data: row, error } = await caller.admin
    .from('abdm_flow_sessions')
    .insert({
      user_id: caller.userId,
      clinic_id: caller.clinicId,
      patient_id: data.patientId,
      flow,
      txn_id: data.txnId,
      t_token: data.tToken,
      x_token: data.xToken,
      expires_at: new Date(Date.now() + FLOW_TTL_MS).toISOString(),
    })
    .select('id')
    .single();

  if (error || !row) {
    // Not best-effort: without the session the next step cannot run, and
    // silently continuing would strand the user mid-flow.
    throw new Error(`Could not start ABDM flow session: ${error?.message ?? 'no row'}`);
  }
  return row.id as string;
}

/**
 * Claims one attempt against a session, without destroying it.
 *
 * Deliberately not consume-on-read. A wrong OTP is the common case at a busy
 * desk, and destroying the session on the first mistyped digit would force a
 * fresh SMS for every typo. So the session survives a failure and the attempt
 * counter — capped and incremented atomically in SQL — is what stops the handle
 * becoming a brute-force oracle for a 6-digit code.
 *
 * Call `completeFlowSession` once the step actually succeeds.
 */
export async function claimFlowSession(
  caller: AbdmCaller,
  handle: string,
  flow: AbdmFlow,
): Promise<FlowSessionData> {
  const { data, error } = await caller.admin.rpc('abdm_claim_flow_session', {
    p_id: handle,
    p_user_id: caller.userId,
    p_flow: flow,
  });

  if (error) throw new AbdmAuthError('Could not resume the ABDM session', 500);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    // Expired, attempts exhausted, or someone else's handle. All three get the
    // same answer and the same remedy: start again.
    throw new AbdmAuthError('This verification step has expired. Please start again.', 410);
  }

  return {
    txnId: (row.txn_id as string | null) ?? null,
    tToken: (row.t_token as string | null) ?? null,
    xToken: (row.x_token as string | null) ?? null,
    patientId: (row.patient_id as string | null) ?? null,
  };
}

/**
 * Claims a session that may belong to any of several flows.
 *
 * The ABHA card and QR are reachable from both the mobile-login flow and the
 * Aadhaar enrolment flow, and the handle alone does not say which. Rather than
 * having the client declare its flow — which it could get wrong, or lie about —
 * the server tries each in turn. A non-matching flow claims no attempt, because
 * the SQL predicate includes `flow` and simply matches no row.
 */
export async function claimFlowSessionAny(
  caller: AbdmCaller,
  handle: string,
  flows: AbdmFlow[],
): Promise<{ data: FlowSessionData; flow: AbdmFlow }> {
  for (const flow of flows) {
    try {
      return { data: await claimFlowSession(caller, handle, flow), flow };
    } catch (err) {
      // Only a "no such live session" is worth trying the next flow for;
      // anything else (a genuine lookup failure) should surface immediately.
      if (err instanceof AbdmAuthError && err.status === 410) continue;
      throw err;
    }
  }
  throw new AbdmAuthError('This verification step has expired. Please start again.', 410);
}

/**
 * Updates a live session in place and resets its TTL.
 *
 * Used where a flow continues past the step that produced a token: the ABHA
 * card and QR (spec 10/11) need the X-token, and the enrolment chain needs its
 * txnId to survive into mobile verification and address creation.
 *
 * The trade-off is explicit: a live X-token sits at rest for up to another
 * FLOW_TTL_MS. That is bounded, single-clinic, service-role-only, and still
 * strictly better than the alternative it replaced — handing the token to the
 * browser. Callers that have no follow-up step must call `completeFlowSession`
 * instead of this.
 */
export async function extendFlowSession(
  caller: AbdmCaller,
  handle: string,
  patch: Partial<FlowSessionData>,
): Promise<void> {
  const update: Record<string, unknown> = {
    expires_at: new Date(Date.now() + FLOW_TTL_MS).toISOString(),
    // Reset the attempt counter: the next step is a different challenge, and
    // carrying over attempts spent on the OTP would shorten it arbitrarily.
    attempts: 0,
  };
  if (patch.txnId !== undefined) update.txn_id = patch.txnId;
  if (patch.tToken !== undefined) update.t_token = patch.tToken;
  if (patch.xToken !== undefined) update.x_token = patch.xToken;

  const { error } = await caller.admin
    .from('abdm_flow_sessions')
    .update(update)
    .eq('id', handle)
    .eq('user_id', caller.userId);

  if (error) throw new Error(`Could not extend ABDM flow session: ${error.message}`);
}

/**
 * Retires a session once its step has succeeded.
 *
 * Best-effort: the step already completed, and the row expires on its own
 * within minutes, so failing here must not turn a successful verification into
 * an error the user sees.
 */
export async function completeFlowSession(caller: AbdmCaller, handle: string): Promise<void> {
  try {
    await caller.admin.from('abdm_flow_sessions').delete().eq('id', handle);
  } catch (e) {
    console.warn('[abdm] flow session cleanup failed:', e instanceof Error ? e.message : e);
  }
}

/** Opportunistic sweep of expired rows; safe to call and ignore. */
export async function purgeExpiredFlowSessions(caller: AbdmCaller): Promise<void> {
  try {
    await caller.admin
      .from('abdm_flow_sessions')
      .delete()
      .lt('expires_at', new Date().toISOString());
  } catch {
    // Housekeeping only — never worth failing a patient-facing call.
  }
}
