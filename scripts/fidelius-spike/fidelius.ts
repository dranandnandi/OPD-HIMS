// Fidelius (ABDM health-data encryption) in pure TypeScript, for Deno.
//
// WHY THIS EXISTS
// ---------------
// ABDM's M2/M3 data transfer uses ECDH on Curve25519 — but in **Short
// Weierstrass** form (BouncyCastle's `custom.djb.Curve25519`), not the
// Montgomery X25519 that WebCrypto, Deno, Node and libsodium expose. Same
// curve, different representation, incompatible key encodings. So
// `crypto.subtle.deriveBits({name:'X25519'})` cannot talk to ABDM, and a
// generic ECDH library fails against the gateway with "encoded key spec not
// recognized".
//
// This module derives the Weierstrass parameters from the published Montgomery
// ones and builds the curve with @noble/curves' generic constructor. If it
// works, M2/M3 stay on Supabase Edge Functions and no separate crypto service
// is needed.
//
// WHAT IS PROVEN AND WHAT IS NOT
// ------------------------------
// The parameter derivation is self-validating: the generator is checked to
// satisfy the curve equation, and its order is checked to be n. That rules out
// a typo'd constant.
//
// It does NOT prove byte-for-byte compatibility with ABDM. Only running the
// Fidelius CLI's own test vectors through `verifyAgainstVector()` can do that,
// because the parts that are convention rather than mathematics — key
// encoding, the HKDF `info` string, the nonce/IV layout — are only knowable
// from the reference implementation. See spike.ts.

import { weierstrass } from 'https://esm.sh/@noble/curves@1.7.0/abstract/weierstrass';
import { Field } from 'https://esm.sh/@noble/curves@1.7.0/abstract/modular';
import { sha256 } from 'https://esm.sh/@noble/hashes@1.6.1/sha256';
import { hmac } from 'https://esm.sh/@noble/hashes@1.6.1/hmac';
import { randomBytes } from 'https://esm.sh/@noble/hashes@1.6.1/utils';

// ── Curve parameters, derived rather than recalled ───────────────────────────
//
// Curve25519 as a Montgomery curve:  B·v² = u³ + A·u² + u,  A = 486662, B = 1
// Short Weierstrass:                     y² = x³ + a·x + b
//
// Standard conversion:
//   a = (3 − A²)  / (3B²)
//   b = (2A³ − 9A)/ (27B³)
//   x_W = (u + A/3) / B
//
// Hardcoding a and b from memory is exactly how this goes silently wrong, so
// they are computed here and then verified.

export const P = 2n ** 255n - 19n;
const A = 486662n;

/** Curve order (number of points in the prime-order subgroup). */
export const N = 2n ** 252n + 27742317777372353535851937790883648493n;

/** Cofactor. */
export const H = 8n;

const Fp = Field(P);

const A_OVER_3 = Fp.div(A, 3n);

/** a = (3 − A²) / 3 */
export const CURVE_A = Fp.div(Fp.sub(3n, Fp.sqr(A)), 3n);

/** b = (2A³ − 9A) / 27 */
export const CURVE_B = Fp.div(
  Fp.sub(Fp.mul(2n, Fp.mul(Fp.sqr(A), A)), Fp.mul(9n, A)),
  27n,
);

// Montgomery base point u = 9, and its v coordinate (RFC 7748).
const MONT_GX = 9n;
const MONT_GY =
  14781619447589544791020593568409986887264606134616475288964881837755586237401n;

/** Generator in Weierstrass coordinates: x = u + A/3, y unchanged (B = 1). */
export const GX = Fp.add(MONT_GX, A_OVER_3);
export const GY = MONT_GY;

/**
 * Curve25519 in Short Weierstrass form.
 *
 * `lowS: false` — low-S normalisation is an ECDSA malleability convention and
 * has no meaning for ECDH. Leaving it on would silently rewrite nothing here,
 * but stating it avoids the reader wondering.
 */
export const curve25519Weierstrass = weierstrass({
  a: CURVE_A,
  b: CURVE_B,
  Fp,
  n: N,
  Gx: GX,
  Gy: GY,
  h: H,
  lowS: false,
  /**
   * Curve25519 has cofactor 8, so the group is not of prime order and noble
   * refuses to validate points without being told how to check subgroup
   * membership. (secp256k1 and friends have h = 1, which is why this is
   * usually absent.)
   *
   * A point is torsion-free exactly when n·P is the identity — that is what
   * rules out the small-subgroup points an attacker could send to leak bits of
   * our private key during ECDH.
   *
   * Expressed as (n−1)·P = −P rather than n·P = 0 because noble's
   * `multiplyUnsafe` rejects any scalar outside 0 ≤ k < n, and n itself is
   * therefore not a legal argument. The two are algebraically identical.
   */
  isTorsionFree: (_c: unknown, point: WPoint) => hasOrderN(point),
  hash: sha256,
  hmac: (key: Uint8Array, ...msgs: Uint8Array[]) => hmac(sha256, key, concat(...msgs)),
  randomBytes,
});

/** The bit of a noble projective point this module actually touches. */
interface WPoint {
  multiplyUnsafe(scalar: bigint): WPoint;
  negate(): WPoint;
  equals(other: WPoint): boolean;
  is0(): boolean;
}

/** True when n·P is the identity, i.e. P lies in the prime-order subgroup. */
function hasOrderN(point: WPoint): boolean {
  if (point.is0()) return true;
  return point.multiplyUnsafe(N - 1n).equals(point.negate());
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// ── Self-validation of the derived parameters ────────────────────────────────

/**
 * Confirms the generator is on the curve and has order n.
 *
 * A wrong `a` or `b` still produces a working-looking library that computes
 * shared secrets — they just will not match ABDM's. This catches that at
 * startup rather than at gateway-integration time.
 */
export function validateCurve(): { onCurve: boolean; correctOrder: boolean } {
  // y² == x³ + ax + b
  const lhs = Fp.sqr(GY);
  const rhs = Fp.add(Fp.add(Fp.mul(Fp.sqr(GX), GX), Fp.mul(CURVE_A, GX)), CURVE_B);
  const onCurve = Fp.eql(lhs, rhs);

  // The generator must lie in the prime-order subgroup: n·G = identity.
  let correctOrder = false;
  try {
    correctOrder = hasOrderN(
      curve25519Weierstrass.ProjectivePoint.BASE as unknown as WPoint,
    );
  } catch {
    correctOrder = false;
  }

  return { onCurve, correctOrder };
}

// ── Fidelius key agreement and payload encryption ────────────────────────────

export interface FideliusKeyPair {
  privateKey: Uint8Array;
  /** Uncompressed SEC1 point, 65 bytes: 0x04 || X || Y. */
  publicKey: Uint8Array;
}

export function generateKeyPair(): FideliusKeyPair {
  const privateKey = curve25519Weierstrass.utils.randomPrivateKey();
  return {
    privateKey,
    publicKey: curve25519Weierstrass.getPublicKey(privateKey, false),
  };
}

/**
 * XOR the two 32-byte nonces, then split.
 *
 * ABDM's scheme: first 20 bytes become the HKDF salt, the last 12 become the
 * AES-GCM IV. Both sides compute the same value because XOR is commutative —
 * which is the point, since neither side transmits the derived IV.
 */
export function deriveSaltAndIv(
  nonceA: Uint8Array,
  nonceB: Uint8Array,
): { salt: Uint8Array; iv: Uint8Array } {
  if (nonceA.length !== 32 || nonceB.length !== 32) {
    throw new Error('Fidelius nonces must be 32 bytes each');
  }
  const xored = new Uint8Array(32);
  for (let i = 0; i < 32; i++) xored[i] = nonceA[i] ^ nonceB[i];
  return { salt: xored.slice(0, 20), iv: xored.slice(20, 32) };
}

/**
 * ECDH → HKDF-SHA256 → AES-256 key.
 *
 * `info` is the one parameter that cannot be derived from first principles —
 * it is a convention of the reference implementation. It is exposed rather
 * than buried so the vector harness can pin it down.
 */
export async function deriveAesKey(
  privateKey: Uint8Array,
  peerPublicKey: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array = new Uint8Array(0),
): Promise<CryptoKey> {
  // Noble returns the shared point; for ECDH only the X coordinate is used.
  const shared = curve25519Weierstrass.getSharedSecret(privateKey, peerPublicKey, true);
  const sharedX = shared.slice(1); // drop the 0x02/0x03 parity prefix

  const ikm = await crypto.subtle.importKey('raw', sharedX, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    ikm,
    256,
  );
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encrypt(
  plaintext: string,
  key: CryptoKey,
  iv: Uint8Array,
): Promise<string> {
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return base64(new Uint8Array(ct));
}

export async function decrypt(
  ciphertextB64: string,
  key: CryptoKey,
  iv: Uint8Array,
): Promise<string> {
  const ct = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
