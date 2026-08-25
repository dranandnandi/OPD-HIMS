// The single RSA implementation for ABDM — G-04.
//
// This logic previously existed three times (abdm-request-otp, abdm-verify-otp,
// abdm-encrypt) with subtle differences, plus a standalone `abdm-encrypt` edge
// function that would encrypt *arbitrary caller-supplied plaintext* under
// ABDM's public key and hand back the result. That function is deleted; this
// module replaces it and is only reachable from server-side code.

/**
 * ABDM specifies `RSA/ECB/OAEPWithSHA-1AndMGF1Padding`.
 *
 * SHA-1 here is not a mistake and not ours to change: WebCrypto derives MGF1
 * from the same hash, so `{name:'RSA-OAEP', hash:'SHA-1'}` is exactly that Java
 * transformation. Using SHA-256 produces ciphertext ABDM cannot decrypt, and
 * the failure surfaces as an opaque upstream error rather than a crypto error.
 */
const ABDM_RSA_PARAMS = { name: 'RSA-OAEP', hash: 'SHA-1' } as const;

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Encrypts one sensitive value (Aadhaar, mobile, OTP, password) for ABDM.
 *
 * The certificate is passed in rather than fetched here so callers go through
 * the cached accessor in abdmSession.ts — re-fetching the certificate on every
 * encryption was half of the 3-round-trips-per-OTP problem (G-07).
 */
export async function abdmEncrypt(plaintext: string, certificatePem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'spki',
    pemToDer(certificatePem).buffer as ArrayBuffer,
    ABDM_RSA_PARAMS,
    false,
    ['encrypt'],
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(plaintext),
  );

  // Chunked rather than String.fromCharCode(...bytes): a spread over a large
  // Uint8Array blows the argument limit. 2048-bit output is only 256 bytes so
  // it would survive today, but this is the kind of latent break that appears
  // the day NHA rotates to a larger key.
  const bytes = new Uint8Array(ciphertext);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * SHA-256 hex of a sensitive identifier, for rate-limit bucketing (G-08).
 *
 * Lets us throttle per-target without ever storing the mobile or Aadhaar that
 * is being targeted — the rate-limit table must not become the PII store the
 * rest of this work is trying to avoid.
 */
export async function hashIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * ABDM wants `YYYY-MM-DD HH:mm:ss` in some request bodies (the `timeStamp`
 * field inside authData.otp), which is *not* the ISO-8601 the headers use.
 */
export function abdmBodyTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/** Normalises any Indian mobile input to the bare 10 digits ABDM expects. */
export function normaliseMobile(input: string | null | undefined): string {
  const digits = (input ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.length > 10 ? digits.slice(-10) : digits;
}
