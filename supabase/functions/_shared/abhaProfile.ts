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
  kycVerified: boolean;
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
    // authoritative one and already carries the right ordering.
    name: str(src.name) || composed,
    gender: str(src.gender),
    dob: buildDob(src),
    mobileMasked: maskMobile(src.mobile),
    kycVerified: src.kycVerified === true,
  };
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
      // ABDM expects the user token to carry its own Bearer prefix here.
      'X-Token': xToken.startsWith('Bearer ') ? xToken : `Bearer ${xToken}`,
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
  kycVerified: boolean;
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
      kycVerified: src.kycVerified === true,
    };
  }).filter((a) => a.abhaNumber);
}
