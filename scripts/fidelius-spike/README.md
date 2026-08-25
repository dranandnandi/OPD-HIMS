# Fidelius spike — result

**Question:** ABDM's M2/M3 data transfer needs ECDH on Curve25519 in *Short
Weierstrass* form. Deno's `crypto.subtle` only offers Montgomery X25519. Does
that force a separate crypto service, or can it run on Supabase Edge Functions?

**Answer so far: it runs on Deno.** No separate service needed on current
evidence.

```bash
deno run -A scripts/fidelius-spike/spike.ts
```

```
1. Curve parameters (derived from the Montgomery form)
   PASS  generator satisfies y² = x³ + ax + b
   PASS  n·G = point at infinity (order is correct)
   PASS  a and b are reduced mod p

2. ECDH → HKDF-SHA256 → AES-256-GCM round trip
   PASS  nonce XOR is order-independent (both sides derive the same salt/IV)
   PASS  HIU decrypted the HIP payload — shared secret agrees

3. Fidelius CLI reference vectors
   SKIPPED — no vector supplied
```

---

## What is settled

The curve parameters are **derived**, not copied from memory:

```
a  = 0x2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa984914a144
b  = 0x7b425ed097b425ed097b425ed097b425ed097b425ed097b4260b5e9c7710c864
Gx = 0x2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad245a
```

`fidelius.ts` computes them from the published Montgomery form
(A = 486662, B = 1, p = 2²⁵⁵−19) using the standard conversion, then checks the
generator satisfies the curve equation and has order n. **The derived `a`
matches BouncyCastle's published Curve25519 constant**, which is the
implementation ABDM uses — good independent corroboration that the derivation
is right.

Two things needed working around, both noted in the code:

- **Cofactor 8.** Noble refuses to validate points on a non-prime-order curve
  without an `isTorsionFree` implementation. Supplied.
- **`multiplyUnsafe` rejects scalar = n.** So the torsion check is written as
  `(n−1)·P = −P` rather than `n·P = 0`. Algebraically identical.

---

## What is NOT settled

**Wire compatibility with ABDM.** Everything above proves the mathematics is
self-consistent — two parties running *this* code agree on a key and exchange a
payload. It cannot prove we match the reference implementation on the parts
that are convention rather than mathematics:

- key encoding (uncompressed SEC1 `0x04||X||Y`? raw X? base64 of which?)
- the HKDF `info` parameter — currently empty
- whether the IV really is the *last* 12 bytes of the XORed nonces
- whether the shared secret is the X coordinate alone

Get all four wrong and the code still runs perfectly and produces ciphertext
ABDM cannot read.

### Closing it

Clone the reference CLI and generate one vector:

```bash
git clone https://github.com/mgrmtech/fidelius-cli
# follow its README to run an encrypt with fixed inputs, then record:
#   senderPrivateKey, senderPublicKey, senderNonce,
#   receiverPublicKey, receiverNonce, plaintext, expected ciphertext
```

Paste it into the `VECTOR` constant in `spike.ts` and re-run. If check 3 passes,
the question is fully closed and M2/M3 stay on Supabase.

If it fails, the four items above are the search space — adjust one at a time.
That is much cheaper than discovering it against the live gateway, where the
only feedback is "encoded key spec not recognized".

---

## If it graduates

Move `fidelius.ts` to `supabase/functions/_shared/fidelius.ts` alongside
`abdmCrypto.ts`, pin the `@noble/*` versions (they are pinned here already),
and keep `spike.ts` as a regression test.

Note that HKDF-SHA256 and AES-256-GCM come from Web Crypto, not from noble —
only the ECDH key agreement needs the library. That keeps the trusted surface
small.
