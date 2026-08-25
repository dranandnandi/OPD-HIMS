// CORS, error sanitisation and audit logging for the ABDM functions.
//
// Closes G-03 (raw upstream error bodies were returned to the browser),
// G-09 (`Access-Control-Allow-Origin: '*'` on six PII endpoints) and G-11
// (upstream bodies written to function logs).

import type { AbdmCaller } from './abdmAuthz.ts';
import { AbdmAuthError } from './abdmAuthz.ts';
import { AbdmUpstreamError } from './abdmSession.ts';
import { AbdmConfigError } from './abdmConfig.ts';

/**
 * Origins allowed to call the ABDM endpoints.
 *
 * Wildcard CORS on endpoints that move Aadhaar, OTPs and health identifiers is
 * a routine audit finding, and combined with G-05 it widened the blast radius
 * of any stolen token. Configure ABDM_ALLOWED_ORIGINS as a comma-separated list.
 */
function allowedOrigins(): string[] {
  return (Deno.env.get('ABDM_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get('Origin') ?? '').replace(/\/+$/, '');
  const allowed = allowedOrigins();

  // An empty allowlist means "not configured yet". Echoing the origin here
  // keeps existing deployments working rather than breaking the ABHA flow the
  // moment this ships — but it is logged loudly, because shipping to production
  // in this state is the finding, not the fix.
  const permit =
    allowed.length === 0
      ? (console.warn('[abdm] ABDM_ALLOWED_ORIGINS unset — CORS is not restricted'), origin || '*')
      : allowed.includes(origin)
        ? origin
        : '';

  return {
    // No match => no ACAO header at all, so the browser blocks the response.
    ...(permit ? { 'Access-Control-Allow-Origin': permit } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Responses vary per Origin; without this a cache could serve one clinic's
    // permitted response to a disallowed origin.
    'Vary': 'Origin',
  };
}

/**
 * The region this invocation is actually running in.
 *
 * Supabase runs Edge Functions in the region closest to the *caller*, not the
 * project's region — so a Mumbai project does not by itself guarantee Indian
 * execution. The frontend pins `x-region: ap-south-1`, but a header can be
 * omitted or a future call site can forget, and inbound ABDM callbacks cannot
 * set it at all (they are routed by proximity from ABDM's own servers).
 *
 * So we record where we really ran rather than assuming. This is both the
 * alarm and the evidence: a security assessor asking "can you show these calls
 * executed in India?" gets an answer from the audit log instead of a promise.
 */
export function currentRegion(): string {
  return Deno.env.get('SB_REGION') ?? 'unknown';
}

const EXPECTED_REGION = 'ap-south-1';

/** Warns once per invocation if execution drifted outside India. */
export function assertRegion(requestId: string): void {
  const region = currentRegion();
  // 'unknown' is not treated as a failure: SB_REGION is not populated in local
  // `supabase functions serve`, and failing there would block development.
  if (region !== 'unknown' && region !== EXPECTED_REGION) {
    console.warn(
      `[abdm][${requestId}] executing in ${region}, expected ${EXPECTED_REGION} — ` +
        'ABDM requires India-based processing. Check the x-region header on the caller.',
    );
  }
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      // Lets the browser and any integration test confirm the region without
      // reading function logs.
      'x-abdm-region': currentRegion(),
    },
  });
}

export function preflight(req: Request): Response {
  return new Response('ok', { headers: corsHeaders(req) });
}

/**
 * Turns any thrown error into a safe client response, logging the detail
 * server-side against the correlation id.
 *
 * The contract: the client gets a message and a `requestId`; it never gets the
 * upstream body, the request metadata we sent, or a stack. Support can join the
 * requestId to abdm_audit_log and the function logs to see everything.
 */
export function errorResponse(req: Request, err: unknown, requestId: string): Response {
  if (err instanceof AbdmAuthError) {
    return jsonResponse(req, { error: err.message, requestId }, err.status);
  }

  if (err instanceof AbdmConfigError) {
    console.error(`[abdm][${requestId}] config error:`, err.message);
    return jsonResponse(req, { error: 'ABDM is not configured', requestId }, 500);
  }

  if (err instanceof AbdmUpstreamError) {
    // The upstream body is the sensitive part — it goes to logs only.
    console.error(`[abdm][${requestId}] upstream ${err.status}:`, err.upstreamBody);
    // 4xx from ABDM is usually a user-correctable problem (wrong OTP, expired
    // txn). 5xx is ours to own. Either way the text is ours, not ABDM's.
    const clientStatus = err.status >= 400 && err.status < 500 ? err.status : 502;
    return jsonResponse(
      req,
      { error: userMessageForUpstream(err.status), requestId },
      clientStatus,
    );
  }

  console.error(`[abdm][${requestId}] unhandled:`, err instanceof Error ? err.message : err);
  return jsonResponse(req, { error: 'Something went wrong', requestId }, 500);
}

/** Generic, non-leaking phrasing keyed off the upstream status. */
function userMessageForUpstream(status: number): string {
  switch (status) {
    case 400:
      return 'ABDM rejected the request. Please check the details and try again.';
    case 401:
    case 403:
      return 'ABDM refused this request. Please try again, or contact support if it persists.';
    case 404:
      return 'No matching ABHA record was found.';
    case 409:
      return 'This request conflicts with an existing ABDM record.';
    case 429:
      return 'ABDM is rate-limiting this request. Please wait and try again.';
    default:
      return 'ABDM is unavailable right now. Please try again shortly.';
  }
}

export type AbdmAuditAction =
  | 'otp_request'
  | 'otp_verify'
  | 'profile_fetch'
  | 'login_otp_request'
  | 'login_otp_verify'
  | 'login_verify_user'
  | 'abha_search'
  | 'abha_link'
  | 'abha_unlink'
  | 'abha_address_create'
  | 'abha_card_fetch'
  | 'enrol_mobile_otp_request'
  | 'enrol_mobile_otp_verify';

/**
 * Writes one audit row. Best-effort by design: losing an audit row must not
 * fail the clinical action in front of the patient. Failures are logged so the
 * gap is still visible.
 *
 * `errorMessage` is a short server-authored reason — never an upstream body,
 * never anything carrying Aadhaar, OTP or a token.
 */
export async function writeAudit(
  caller: Pick<AbdmCaller, 'admin' | 'clinicId' | 'userId'>,
  entry: {
    action: AbdmAuditAction;
    requestId: string;
    status: 'success' | 'failure';
    patientId?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  assertRegion(entry.requestId);
  try {
    await caller.admin.from('abdm_audit_log').insert({
      patient_id: entry.patientId ?? null,
      clinic_id: caller.clinicId,
      action: entry.action,
      request_id: entry.requestId,
      status: entry.status,
      error_message: entry.errorMessage ?? null,
      // Where this call actually executed. Evidence for the assessor, and the
      // only way to notice region drift after the fact.
      region: currentRegion(),
    });
  } catch (e) {
    console.error('[abdm] audit write failed:', e instanceof Error ? e.message : e);
  }
}

/** Short, safe reason string for the audit log's error_message column. */
export function auditReason(err: unknown): string {
  if (err instanceof AbdmUpstreamError) return `upstream_${err.status}`;
  if (err instanceof AbdmAuthError) return `auth_${err.status}`;
  if (err instanceof AbdmConfigError) return 'config_error';
  return 'internal_error';
}
