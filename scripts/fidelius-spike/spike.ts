// Fidelius spike — can Deno do ABDM's health-data encryption?
//
// Run:  deno run -A scripts/fidelius-spike/spike.ts
//
// Three checks, in increasing order of what they prove:
//
//   1. Curve parameters   — the derived Weierstrass a/b/G are internally
//                           consistent. Rules out a bad constant.
//   2. Round trip         — two parties agree a key and exchange a payload.
//                           Proves the ECDH + HKDF + AES-GCM chain works.
//   3. Reference vectors  — output matches the Fidelius CLI byte for byte.
//                           ONLY this proves ABDM compatibility.
//
// Checks 1 and 2 run today. Check 3 needs vectors pasted in from
// https://github.com/mgrmtech/fidelius-cli — see VECTOR below.

import {
  CURVE_A,
  CURVE_B,
  GX,
  GY,
  N,
  P,
  curve25519Weierstrass,
  decrypt,
  deriveAesKey,
  deriveSaltAndIv,
  encrypt,
  fromBase64,
  generateKeyPair,
  toHex,
  validateCurve,
} from './fidelius.ts';

const pass = (m: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const fail = (m: string) => console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
const info = (m: string) => console.log(`        ${m}`);

let failures = 0;

// ── 1. Curve parameters ──────────────────────────────────────────────────────

console.log('\n1. Curve parameters (derived from the Montgomery form)\n');

info(`p  = 2^255 - 19`);
info(`a  = 0x${CURVE_A.toString(16)}`);
info(`b  = 0x${CURVE_B.toString(16)}`);
info(`Gx = 0x${GX.toString(16)}`);
info(`n  = 0x${N.toString(16)}`);
console.log();

const { onCurve, correctOrder } = validateCurve();
onCurve ? pass('generator satisfies y² = x³ + ax + b') : (fail('generator is NOT on the curve'), failures++);
correctOrder ? pass('n·G = point at infinity (order is correct)') : (fail('n·G ≠ infinity'), failures++);

// Sanity: p must be prime-ish in shape and a/b must be in range.
const inField = CURVE_A > 0n && CURVE_A < P && CURVE_B > 0n && CURVE_B < P;
inField ? pass('a and b are reduced mod p') : (fail('a or b out of field range'), failures++);

// ── 2. Round trip between two parties ────────────────────────────────────────

console.log('\n2. ECDH → HKDF-SHA256 → AES-256-GCM round trip\n');

try {
  // HIP and HIU each generate an ephemeral keypair and a 32-byte nonce.
  const hip = generateKeyPair();
  const hiu = generateKeyPair();
  const hipNonce = crypto.getRandomValues(new Uint8Array(32));
  const hiuNonce = crypto.getRandomValues(new Uint8Array(32));

  info(`HIP public key (65B uncompressed): ${toHex(hip.publicKey).slice(0, 32)}...`);

  // Both sides derive the same salt/IV from the XOR of the two nonces.
  const a = deriveSaltAndIv(hipNonce, hiuNonce);
  const b = deriveSaltAndIv(hiuNonce, hipNonce);
  const symmetric = toHex(a.salt) === toHex(b.salt) && toHex(a.iv) === toHex(b.iv);
  symmetric
    ? pass('nonce XOR is order-independent (both sides derive the same salt/IV)')
    : (fail('salt/IV differ by party — XOR layout is wrong'), failures++);

  // ECDH must agree.
  const hipKey = await deriveAesKey(hip.privateKey, hiu.publicKey, a.salt);
  const hiuKey = await deriveAesKey(hiu.privateKey, hip.publicKey, b.salt);

  const bundle = JSON.stringify({
    resourceType: 'Bundle',
    type: 'document',
    entry: [{ resource: { resourceType: 'Composition', title: 'OP Consult Record' } }],
  });

  const ciphertext = await encrypt(bundle, hipKey, a.iv);
  info(`ciphertext: ${ciphertext.slice(0, 44)}...`);

  const recovered = await decrypt(ciphertext, hiuKey, b.iv);
  recovered === bundle
    ? pass('HIU decrypted the HIP payload — shared secret agrees')
    : (fail('decrypted payload does not match'), failures++);
} catch (err) {
  fail(`round trip threw: ${err instanceof Error ? err.message : err}`);
  failures++;
}

// ── 3. Reference vectors ─────────────────────────────────────────────────────

console.log('\n3. Fidelius CLI reference vectors\n');

/**
 * Paste a vector from the fidelius-cli repo here.
 *
 * Everything above proves the maths is self-consistent. It cannot prove we
 * encode keys the way ABDM does, or that the HKDF `info` is empty, or that the
 * IV really is the last 12 bytes rather than the first. Those are conventions
 * of the reference implementation, and only its own vectors settle them.
 *
 * Get one by running the CLI's encrypt with fixed inputs and recording:
 *   senderPrivateKey, senderPublicKey, senderNonce,
 *   receiverPublicKey, receiverNonce, plaintext, expected ciphertext.
 */
const VECTOR: {
  senderPrivateKey: string;
  receiverPublicKey: string;
  senderNonce: string;
  receiverNonce: string;
  plaintext: string;
  expectedCiphertext: string;
} | null = null;

if (!VECTOR) {
  info('SKIPPED — no vector supplied.');
  info('This is the check that proves ABDM compatibility. Until it runs,');
  info('the conclusion below is "the maths works", not "ABDM will accept it".');
} else {
  try {
    const { salt, iv } = deriveSaltAndIv(
      fromBase64(VECTOR.senderNonce),
      fromBase64(VECTOR.receiverNonce),
    );
    const key = await deriveAesKey(
      fromBase64(VECTOR.senderPrivateKey),
      fromBase64(VECTOR.receiverPublicKey),
      salt,
    );
    const got = await encrypt(VECTOR.plaintext, key, iv);
    got === VECTOR.expectedCiphertext
      ? pass('output matches the Fidelius CLI exactly')
      : (fail(`ciphertext mismatch\n        expected ${VECTOR.expectedCiphertext}\n        got      ${got}`), failures++);
  } catch (err) {
    fail(`vector check threw: ${err instanceof Error ? err.message : err}`);
    failures++;
  }
}

// ── Verdict ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(66));
if (failures === 0) {
  console.log(
    VECTOR
      ? '\nFidelius runs on Deno. M2/M3 can stay on Supabase Edge Functions.\n'
      : '\nThe curve and crypto chain work on Deno.\n' +
        'Supply a Fidelius CLI vector to confirm wire compatibility before\n' +
        'committing to this approach.\n',
  );
} else {
  console.log(`\n${failures} check(s) failed — see above.\n`);
}

console.log(`Curve point size: ${curve25519Weierstrass.getPublicKey(
  curve25519Weierstrass.utils.randomPrivateKey(),
  false,
).length} bytes uncompressed\n`);

Deno.exit(failures === 0 ? 0 : 1);
