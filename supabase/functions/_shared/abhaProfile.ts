// Normalising ABDM profile payloads into the one shape the app stores.
//
// ABDM returns the same person under different field names depending on the
// endpoint and the environment: `ABHANumber` vs `abhaNumber` vs
// `healthIdNumber`, `preferredAbhaAddress` vs `phrAddress[0]` vs `healthId`,
// a whole name vs first/middle/last. Every call site was reimplementing this
// guessing game slightly differently.
//
// This module is also the boundary that decides what the browser may see.
// Everything ABDM sends that we do not explicitly map is dropped, so a future
// upstream addition cannot silently start flowing to the client (G-02).

import { type AbdmConfig, abdmHeaders } from './abdmConfig.ts';
import { AbdmUpstreamError } from './abdmSession.ts';

export interface AbhaProfile {
  abhaNumber: string;
  abhaAddress: string;
  name: string;
  gender: string;
  dob: string;
  /** Masked to the last four digits — the client never needs the full number. */
  mobileMasked: string;
  /**
   * `null` means ABDM did not state it — NOT that the ABHA failed KYC.
   *
   * The fetch-details flows (spec 7.6.1.3 / 7.6.2.3) return a thinner accounts
   * payload than mobile login (7.4) and omit this field entirely. Collapsing
   * that to `false` would show reception a false negative on an identity
   * assurance flag.
   */
  kycVerified: boolean | null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** `9876543210` -> `******3210`. Enough to confirm identity, not to dial. */
export function maskMobile(raw: unknown): string {
  const digits = str(raw).replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

/**
 * Builds a date of birth from whichever representation ABDM used.
 *
 * Some endpoints send `dob: "07-03-1997"`, others send the three parts
 * separately, and a partial date (year only) is legitimate for ABHAs created
 * without full KYC — so a missing day/month is not an error.
 */
function buildDob(src: Record<string, unknown>): string {
  const direct = str(src.dob);
  if (direct) return direct;

  const year = str(src.yearOfBirth);
  if (!year) return '';
  const month = str(src.monthOfBirth).padStart(2, '0');
  const day = str(src.dayOfBirth).padStart(2, '0');
  if (!month || month === '00') return year;
  if (!day || day === '00') return `${month}-${year}`;
  return `${day}-${month}-${year}`;
}


/**
 * ABDM's KYC flag, preserving "not stated".
 *
 * `src.kycVerified === true` looks harmless and is not: ABDM omits this field
 * entirely from several response shapes, and collapsing absent to `false`
 * tells reception a KYC-verified ABHA is unverified. Observed on the
 * enrol/byAadhaar response and on the fetch-details accounts payload, both for
 * an account the search endpoint reports as `kycVerified: true`.
 *
 * ABDM also sends it as the STRING "true" on some endpoints, which a strict
 * `=== true` silently reads as false.
 */
function kycFlag(v: unknown): boolean | null {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return null;
}

export function normaliseAbhaProfile(raw: unknown): AbhaProfile {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const phrList = Array.isArray(src.phrAddress) ? src.phrAddress : [];
  const abhaAddress =
    str(src.preferredAbhaAddress) ||
    str(src.abhaAddress) ||
    str(phrList[0]) ||
    str(src.healthId);

  const composed = [str(src.firstName), str(src.middleName), str(src.lastName)]
    .filter(Boolean)
    .join(' ');

  return {
    abhaNumber: str(src.ABHANumber) || str(src.abhaNumber) || str(src.healthIdNumber),
    abhaAddress,
    // `name` first: when ABDM sends both, the whole-name field is the
    // authoritative one and already carries the right ordering. `fullName` is
    // the ABHA-address family's spelling of the same thing (spec 14.1 Step 3).
    name: str(src.name) || str(src.fullName) || composed,
    gender: str(src.gender),
    dob: buildDob(src),
    mobileMasked: maskMobile(src.mobile),
    // `kycStatus` is the ABHA-address family's equivalent, carrying a string
    // such as "VERIFIED" rather than a boolean.
    kycVerified:
      src.kycVerified !== undefined
        ? kycFlag(src.kycVerified)
        : typeof src.kycStatus === 'string'
          ? (src.kycStatus.toUpperCase() === 'VERIFIED' ? true : false)
          : null,
  };
}


/**
 * Which family of ABDM endpoints an X-token belongs to.
 *
 * ABDM has two, and a token from one is NOT accepted by the other — the
 * rejection arrives as a misleading "X-token expired" / 401 rather than a
 * routing error, which is what makes this expensive to diagnose (FAQ v1.4 Q21).
 *
 *  - `enrolment` / `login`: tokens from Aadhaar enrolment, ABHA-number login,
 *    find-ABHA and mobile-OTP login (spec 7.4). All on `abhaBase`, profile at
 *    spec 9.0 `/v3/profile/account`.
 *  - `abha-address`: tokens from ABHA-*address* login only (spec 14.1/14.2).
 *    On `phrBase`.
 *
 * 2026-08-25: mobile-OTP login was briefly routed to `phrBase` on the strength
 * of Q21. That was WRONG and is recorded so it is not retried — spec 7.4 and
 * 7.6.1.3 both post to `/v3/profile/login/verify`, the ABHA family, and
 * `phrBase` answered 400/404. Q21 is about ABHA-address verification only.
 *
 * Pick from the flow that produced the token, never from the endpoint you wish
 * to call.
 */
export type AbhaTokenFamily = 'login' | 'enrolment' | 'abha-address';

/**
 * Profile, card and QR endpoints for a token family.
 *
 * One function rather than three constants: the whole bug class here is calling
 * one family's profile endpoint alongside the other's card endpoint, and a
 * single returned object makes that mismatch hard to write.
 */
export function abhaEndpoints(cfg: AbdmConfig, family: AbhaTokenFamily): {
  profile: string;
  qrCode: string;
  card: string;
} {
  if (family === 'abha-address') {
    return {
      profile: `${cfg.phrBase}/login/profile/abha-profile`,
      qrCode: `${cfg.phrBase}/login/profile/abha/qr-code`,
      card: `${cfg.phrBase}/login/profile/abha/phr-card`,
    };
  }
  return {
    profile: `${cfg.abhaBase}/v3/profile/account`,
    qrCode: `${cfg.abhaBase}/v3/profile/account/qrCode`,
    card: `${cfg.abhaBase}/v3/profile/account/abha-card`,
  };
}

/**
 * The X-token header.
 *
 * Spelled `X-token` to match the spec. Header names are case-insensitive and
 * Deno lowercases them on the wire, so the casing is documentation rather than
 * behaviour — but it stops the next reader "fixing" it to X-Token and wondering
 * whether that mattered. It did not: see session-log-2026-08-25.md 4e.
 */
export function xTokenHeader(xToken: string): Record<string, string> {
  return { 'X-token': xToken.startsWith('Bearer ') ? xToken : `Bearer ${xToken}` };
}

/**
 * GET {abhaBase}/v3/profile/account — spec section 9.
 *
 * Server-side only. The X-token stays in this process; it is never returned to
 * a caller, which is what makes dropping `_raw` (G-02) actually stick.
 */
export async function fetchAbhaProfile(
  cfg: AbdmConfig,
  accessToken: string,
  xToken: string,
  requestId: string,
): Promise<AbhaProfile> {
  const res = await fetch(`${cfg.abhaBase}/v3/profile/account`, {
    method: 'GET',
    headers: abdmHeaders(cfg, accessToken, requestId, {
      // Spec 9.0: the user token carries its own Bearer prefix here.
      'X-token': xToken.startsWith('Bearer ') ? xToken : `Bearer ${xToken}`,
    }),
  });

  if (!res.ok) {
    throw new AbdmUpstreamError('ABHA profile fetch failed', res.status, await res.text());
  }

  return normaliseAbhaProfile(await res.json());
}

/** One entry of the `accounts[]` list returned by mobile-OTP login (§7.4). */
export interface AbhaAccountChoice {
  /** Already masked by ABDM, e.g. "91-2568-7073-XXXX". */
  abhaNumber: string;
  abhaAddress: string;
  name: string;
  gender: string;
  dob: string;
  status: string;
  /** null = ABDM did not state it, NOT a failed KYC. */
  kycVerified: boolean | null;
}

/**
 * Maps `accounts[]` for the picker, dropping `profilePhoto`.
 *
 * The photo is a multi-kilobyte base64 blob of biometric-adjacent personal
 * data. It is not needed to choose between two family members on one mobile
 * number, so it never leaves the function.
 */
export function normaliseAccountChoices(raw: unknown): AbhaAccountChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const src = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const phrList = Array.isArray(src.phrAddress) ? src.phrAddress : [];
    return {
      abhaNumber: str(src.ABHANumber) || str(src.abhaNumber),
      abhaAddress: str(src.preferredAbhaAddress) || str(phrList[0]),
      name:
        str(src.name) ||
        [str(src.firstName), str(src.middleName), str(src.lastName)].filter(Boolean).join(' '),
      gender: str(src.gender),
      dob: buildDob(src),
      // ABDM returns DEACTIVATED accounts alongside ACTIVE ones; the UI has to
      // show the difference rather than silently offer a dead account.
      status: str(src.status) || 'UNKNOWN',
      kycVerified: kycFlag(src.kycVerified),
    };
  }).filter((a) => a.abhaNumber);
}
