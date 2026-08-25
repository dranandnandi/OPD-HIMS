# API Inventory

Last updated 2026-08-20, after Phase 0 (security remediation) and Phase 1
(mobile-OTP ABHA verification). See
`roadmap-m1-m4-and-security-gaps.md` for the gap IDs referenced below.

## Shared modules

All ABDM edge functions are built on `supabase/functions/_shared/`:

| Module | Responsibility |
|---|---|
| `abdmConfig.ts` | Environment-driven base URLs and `X-CM-ID`. One place to switch sandbox↔production (G-06). |
| `abdmCrypto.ts` | The single RSA-OAEP/SHA-1 implementation, plus identifier hashing and timestamp formatting (G-04). |
| `abdmSession.ts` | Cached bearer token and RSA certificate, backed by `_abdm_session` (G-07). |
| `abdmAuthz.ts` | Caller authentication, clinic derivation from JWT, patient-ownership check, rate-limit gate (G-05, G-08). |
| `abdmHttp.ts` | CORS allowlist, error sanitisation, audit writes (G-03, G-09, G-11). |
| `abdmFlowSession.ts` | Server-side custody of in-flight ABDM tokens with bounded retries. |
| `abhaProfile.ts` | Normalises ABDM profile payloads; the boundary deciding what the browser may see. |

## Mobile-OTP verification — spec 7.4 (primary path)

### `abha-login-request-otp`
- `POST {abhaBase}/v3/profile/login/request/otp`
- In: `mobile`, optional `patientId`
- Out: `sessionId` (opaque handle), `message` (ABDM's masked confirmation), `requestId`
- The ABDM `txnId` is held server-side, not round-tripped through the client.

### `abha-login-verify`
- `POST {abhaBase}/v3/profile/login/verify`
- In: `sessionId`, `otp`
- Out: `sessionId` (fresh handle), `accounts[]`, `requestId`
- Returns **every** ABHA registered on that mobile. The caller must present a
  picker — one mobile commonly carries a whole family's accounts, and
  auto-selecting links the wrong person.
- Empty `accounts[]` is a valid outcome: no ABHA on this mobile.
- `profilePhoto` is stripped; the T-token never leaves the server.

### `abha-login-verify-user`
- `POST {abhaBase}/v3/profile/login/verify/user`, then `GET {abhaBase}/v3/profile/account`
- In: `sessionId`, `abhaNumber` (as shown in the picker, mask included)
- Out: normalised `profile`, `requestId`
- Both the T-token and the X-token are spent server-side and never returned.
- Upstream 401/403 is translated to 410 — that is the 5-minute T-token expiring.

### `abha-search`
- `POST {abhaBase}/v3/profile/account/abha/search` — spec 7.6.1.1
- In: `mobile`, optional `patientId`
- Out: `found`, `accounts[]`, `requestId`
- Sends no OTP. Rate-limited harder than the OTP endpoints because it discloses
  that a mobile has health accounts without the patient authenticating.

## Aadhaar-OTP creation — spec 3 (fallback)

### `abdm-request-otp`
- `POST {abhaBase}/v3/enrollment/request/otp`, `scope: ["abha-enrol"]`
- In: `aadhaar`, optional `patientId`
- Out: `txnId`, `message`, `requestId`
- Aadhaar is encrypted server-side and is never stored, logged, or echoed back.

### `abdm-verify-otp`
- `POST {abhaBase}/v3/enrollment/enrol/byAadhaar`
- In: `txnId`, `otp`, optional `mobile`, `patientId`
- Out: normalised `profile`, `txnId`, `requestId`
- **No longer returns `_raw` or `xToken`** (G-02). The X-token is a bearer
  credential for the patient's ABHA profile; it is spent server-side.

## Post-enrolment steps — spec 3.4 / 3.6 (Phase 2)

Both chain off the enrolment `txnId`, held in an `enrolment` flow session
created by `abdm-verify-otp`. Both are optional in the UI — neither should
block a patient being seen.

### `abha-enrol-mobile-request-otp` / `abha-enrol-mobile-verify`
- `POST {abhaBase}/v3/enrollment/request/otp` then `POST {abhaBase}/v3/enrollment/auth/byAbdm`
- Scope `["abha-enrol","mobile-verify"]`, `loginHint: "mobile"`
- For when the Aadhaar-linked mobile is not the number the clinic holds — common
  enough that skipping it makes `mobile_verified` untrue.
- Note the endpoint is `auth/byAbdm`, not `enrol/byAadhaar`.

### `abha-address-suggestions` / `abha-address-create`
- `GET {abhaBase}/v3/enrollment/enrol/suggestion` — txnId travels in a
  **`Transaction_Id` header**, not a body; this is a GET.
- `POST {abhaBase}/v3/enrollment/enrol/abha-address` with `preferred: 1`
- Without an address the new ABHA has no handle for M2/M3 care-context linking.
- 400/409 upstream is mapped to "address not available" — the suggestion list
  goes stale as soon as another integrator claims one.
- Writes the result back to `patients.abha_address`; a failure there is logged,
  not surfaced, because the address does exist at ABDM either way.

## Card and QR — spec 10 / 11 (Phase 2)

### `abha-get-card`
- `GET {abhaBase}/v3/profile/account/qrCode` and `.../abha-card`
- In: `sessionId`. Accepts either a `mobile-login` or an `enrolment` session.
- Out: `qrCode`, `card` — data URIs, either may be null.
- **Only works while the verification session is live.** Both endpoints
  authenticate as the patient with the X-token, which is retained server-side
  for one TTL after verification and then discarded. Re-printing later requires
  re-verification. Nothing is persisted, so the clinic never stores ABHA cards
  at rest.
- Tolerates JSON or raw-bytes responses; ABDM differs by environment.

## Linking

### `abha-link-patient`
- No upstream call. Writes `abha_consent_artefacts` then updates `patients`.
- In: `patientId`, `abhaNumber`, `abhaAddress`, `consentText`, `authMethod`
- Out: `linked`, `requestId`
- Rejects masked ABHA numbers (must be 14 digits) — storing a mask would
  silently break every later ABDM call.
- Artefact is written before the patient update: a consent with no link is
  recoverable, a link with no consent is the audit finding.

## Retired

| Function | Why |
|---|---|
| `abdm-encrypt` | Encryption oracle over caller-supplied plaintext (G-04). Replaced by `_shared/abdmCrypto.ts`. |
| `abdm-get-public-key` | Dead code, and built the wrong URL (certificate host ≠ gateway host). Replaced by `_shared/abdmSession.ts`. |
| `abdm-session` | Dead code; read a table no migration created. Replaced by `_shared/abdmSession.ts`. |
| `abdm-fetch-profile` | Required the client to hold an X-token, which is the thing G-02 removed. Profile fetch is now server-side inside the verify steps. |

## Security posture

- ABDM secrets are server-side only and must never carry a `VITE_` prefix.
- The frontend never calls ABDM directly.
- Clinic scope is derived from the caller's JWT. A client-supplied `clinicId` is
  ignored — it is forgeable (G-05).
- Upstream error bodies are logged against a `requestId` and never returned to
  the client; the client gets generic text plus that id (G-03).
- All ABDM calls write to `abdm_audit_log`, which is service-role-write and
  admin-read-within-clinic (G-01).
- Aadhaar and OTP values are never persisted. Rate-limit buckets store a
  SHA-256 of the target, never the identifier.

### `abha-unlink-patient` (G-13)
- No upstream call — linking is a local act, so withdrawal is too. The
  patient's ABHA account is untouched and remains theirs.
- In: `patientId`, optional `reason`. Out: `unlinked`, `requestId`.
- Revokes **every** live artefact for the patient, not just the newest: a
  patient re-linked after an earlier withdrawal has more than one.
- Artefacts are marked revoked, never deleted — erasing them would destroy the
  evidence that consent was lawfully obtained, which is the opposite of what an
  auditor needs.
- Revoke first, clear second. The reverse order could leave the clinic holding
  an ABHA with no consent behind it.
- `mobile_verified` is deliberately left set: the mobile really was verified,
  and that fact does not depend on the ABHA link.

## Known gaps still open

- **Scan-and-share QR + HIP-initiated linking token** — now part of M1
  functional testing, but **not specified in the ABHA V3 PDF we hold**. Needs
  the HIECM/HIP spec (linking token, synchronous discovery) before it can be
  built. This is the only remaining M1 item.
- No migration has been applied to any environment yet; see the roadmap's
  deployment notes.
