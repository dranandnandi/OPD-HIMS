// Every ABDM URL and environment flag in one place — G-06.
//
// Before this, `dev.abdm.gov.in`, `abhasbx.abdm.gov.in` and `X-CM-ID: 'sbx'`
// were hardcoded across five functions, so going to production meant editing
// code rather than flipping config. Auditors treat "prod and non-prod are not
// cleanly separated" as a finding in its own right.
//
// Note the three distinct hosts. They are genuinely different services and a
// single base URL cannot express them:
//   - gateway   -> session/token minting        (dev.abdm.gov.in | apis.abdm.gov.in)
//   - abha      -> enrolment, login, profile    (abhasbx… | abha.abdm.gov.in)
//   - phr       -> ABHA *address* verification  (spec section 14, different path root)

export type AbdmEnv = 'sandbox' | 'production';

export interface AbdmConfig {
  env: AbdmEnv;
  /** Value for the X-CM-ID header: 'sbx' in sandbox, 'abdm' in production. */
  cmId: string;
  /** Session/token host. */
  gatewayBase: string;
  /** ABHA enrolment + profile host. */
  abhaBase: string;
  /** ABHA-address (PHR) host — spec section 14 only. */
  phrBase: string;
  clientId: string;
  clientSecret: string;
}

const SANDBOX = {
  gatewayBase: 'https://dev.abdm.gov.in/api/hiecm',
  abhaBase: 'https://abhasbx.abdm.gov.in/abha/api',
  phrBase: 'https://abhasbx.abdm.gov.in/abha/api/v3/phr/web',
  cmId: 'sbx',
} as const;

const PRODUCTION = {
  gatewayBase: 'https://apis.abdm.gov.in/api/hiecm',
  abhaBase: 'https://abha.abdm.gov.in/api/abha',
  phrBase: 'https://phr.abdm.gov.in/api/phr/web/v3',
  cmId: 'abdm',
} as const;

export class AbdmConfigError extends Error {}

/**
 * Reads config from the environment, defaulting to sandbox.
 *
 * Defaulting to sandbox is deliberate: a missing or fat-fingered
 * ABDM_ENV must never silently point a test deployment at live ABDM and start
 * creating real health accounts.
 */
export function getAbdmConfig(): AbdmConfig {
  const raw = (Deno.env.get('ABDM_ENV') ?? 'sandbox').trim().toLowerCase();
  const env: AbdmEnv = raw === 'production' || raw === 'prod' ? 'production' : 'sandbox';
  const hosts = env === 'production' ? PRODUCTION : SANDBOX;

  const clientId = Deno.env.get('ABDM_CLIENT_ID');
  const clientSecret = Deno.env.get('ABDM_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new AbdmConfigError('ABDM credentials are not configured');
  }

  return {
    env,
    // X-CM-ID is derived from the environment rather than read separately.
    // Letting them drift (env=production, cmId=sbx) produces upstream errors
    // that are very hard to read from the outside.
    cmId: hosts.cmId,
    gatewayBase: Deno.env.get('ABDM_GATEWAY_BASE')?.replace(/\/+$/, '') || hosts.gatewayBase,
    abhaBase: Deno.env.get('ABDM_ABHA_BASE')?.replace(/\/+$/, '') || hosts.abhaBase,
    phrBase: Deno.env.get('ABDM_PHR_BASE')?.replace(/\/+$/, '') || hosts.phrBase,
    clientId,
    clientSecret,
  };
}

/** Headers every ABDM v3 call needs. `requestId` is echoed into the audit log. */
export function abdmHeaders(
  cfg: AbdmConfig,
  accessToken: string,
  requestId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'REQUEST-ID': requestId,
    'TIMESTAMP': new Date().toISOString(),
    'X-CM-ID': cfg.cmId,
    ...extra,
  };
}
