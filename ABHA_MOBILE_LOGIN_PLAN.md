# ABHA Mobile-OTP Login — Implementation Plan

> **Source spec:** ABDM ABHA V3 APIs — Integrator Guide v1.4 (28-01-2025), §7.4 *Login via Mobile OTP*, §9.0 *Get Profile*
> **Goal:** Verify an **existing** ABHA via mobile OTP and link it to a patient record — the "ABHA verification" half of M1 that the app is currently missing.
> **Not in scope:** ABHA *creation* by mobile (the spec only allows creation via Aadhaar / driving licence / biometric), care-context linking (M2).

---

## 1. Current state

| Piece | Status |
|---|---|
| Session token, RSA-OAEP/SHA-1 encryption, REQUEST-ID / TIMESTAMP / X-CM-ID headers | Working, but **duplicated inside every function** |
| Aadhaar enrolment (`abdm-request-otp` → `abdm-verify-otp` → `abdm-fetch-profile`) | Working on sandbox |
| Base URLs | **Hardcoded** to `dev.abdm.gov.in` / `abhasbx.abdm.gov.in` in all four functions |
| Mobile-OTP verification of an existing ABHA | **Missing — this document** |
| `_raw` ABDM payload + `xToken` returned to the browser | Present in the Aadhaar flow; must not be repeated here |

---

## 2. API sequence (exact, from the spec)

**Base URLs**

| | Session | ABHA base (`{{base_url}}`) | `X-CM-ID` |
|---|---|---|---|
| Sandbox | `https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions` | `https://abhasbx.abdm.gov.in/abha/api` | `sbx` |
| Production | `https://apis.abdm.gov.in/api/hiecm/gateway/v3/sessions` | `https://abha.abdm.gov.in/api/abha` | `abdm` |

Headers on every call: `REQUEST-ID` (fresh UUID v4), `TIMESTAMP` (ISO 8601), `Authorization: Bearer <accessToken>`, `X-CM-ID`.

### Step 1 — Request OTP

`POST {{base_url}}/v3/profile/login/request/otp`

```json
{
  "scope": ["abha-login", "mobile-verify"],
  "loginHint": "mobile",
  "loginId": "<RSA-OAEP/SHA-1 encrypted 10-digit mobile>",
  "otpSystem": "abdm"
}
```

Returns `{ "txnId": "...", "message": "OTP sent to mobile number ending with ******9260" }`

### Step 2 — Verify OTP

`POST {{base_url}}/v3/profile/login/verify`

```json
{
  "scope": ["abha-login", "mobile-verify"],
  "authData": {
    "authMethods": ["otp"],
    "otp": { "txnId": "<txnId>", "otpValue": "<encrypted OTP>" }
  }
}
```

Returns `txnId`, `authResult: "success"`, `token` (**T-token**, `expiresIn` 300) and `accounts[]` — each with `ABHANumber`, `preferredAbhaAddress`, `name`, `gender`, `dob`, `status`, `kycVerified`, `profilePhoto`.

Two things to get right here:

- **One mobile can hold several ABHAs** — `accounts` is an array, so the UI needs a picker.
- **The verify response carries its own `txnId`** — carry that one forward, not the request's.

### Step 3 — Verify user (select the account)

`POST {{base_url}}/v3/profile/login/verify/user`
Extra header: `T-token: Bearer <token from step 2>` (valid 5 minutes)

```json
{ "ABHANumber": "91-2568-7073-XXXX", "txnId": "<txnId from step 2>" }
```

Returns `token` (**X-token**, `expiresIn` 1800), `refreshToken`, `refreshExpiresIn`.

### Step 4 — Get profile

`GET {{base_url}}/v3/profile/account`
Extra header: `X-token: Bearer <token from step 3>`

Returns the full profile: `ABHANumber`, `preferredAbhaAddress`, `name`, `gender`, `yearOfBirth` / `monthOfBirth` / `dayOfBirth`, `mobile`, `address`, `stateName`, `districtName`, `kycVerified`, `verificationStatus`, `profilePhoto`, `kycPhoto`.

Optional extras once the X-token is held: `GET /v3/profile/account/qrCode` (§10) and `GET /v3/profile/account/abha-card` (§11).

---

## 3. Files to create

### 3.1 `supabase/functions/_shared/abdm.ts` (new — shared by all ABDM functions)

Kills the copy-paste across the four existing functions and removes the hardcoded sandbox URLs.

```ts
export const ABDM_ENV          // 'sandbox' | 'production', from ABDM_ENV
export const ABDM_SESSION_URL  // env override, else the per-env default above
export const ABDM_BASE_URL     // env override, else the per-env default above
export const X_CM_ID           // env override, else 'sbx' | 'abdm'

getAccessToken(): Promise<string>          // cached in-isolate until expiresIn - 60s
getPublicKeyPem(): Promise<string>         // GET /v3/profile/public/certificate, cached 24h
rsaEncrypt(plain: string): Promise<string> // RSA-OAEP + SHA-1, base64 (spec: RSA/ECB/OAEPWithSHA-1AndMGF1Padding)
abdmHeaders(token, extra?): { headers, requestId }
audit(supabase, { patientId, clinicId, action, requestId, status, error })
fail(message, code, status)                // sanitized client error; full upstream body only to console
cors / jsonResponse helpers
```

Two rules baked into the module:

- Never return raw ABDM bodies or any ABDM token to the browser. Upstream error text goes to `console.error` plus `abdm_audit_log.error_message` only; the client gets a short message and a code.
- Strip `profilePhoto` / `kycPhoto` (large base64 PHI) from anything returned to the browser.

### 3.2 `supabase/functions/abdm-mobile-request-otp/index.ts`

- **In:** `{ mobile, patientId?, clinicId? }`
- Validate `^[6-9]\d{9}$` before any upstream call.
- Encrypt the mobile, run step 1.
- **Out:** `{ txnId, message }`
- Audit action `mobile_otp_request`.

### 3.3 `supabase/functions/abdm-mobile-verify-otp/index.ts`

- **In:** `{ txnId, otp, patientId?, clinicId? }`
- Encrypt the OTP, run step 2.
- Persist `{ txnId (from the response), tToken, accounts, patientId, clinicId, expires_at = now() + 5 min }` into `abdm_login_sessions`.
- **Out:** `{ txnId, accounts: [{ abhaNumber, abhaAddress, name, gender, dob, status, kycVerified }] }` — **no token, no photo**.
- Audit `mobile_otp_verify`.

### 3.4 `supabase/functions/abdm-mobile-select-abha/index.ts`

- **In:** `{ txnId, abhaNumber, patientId?, clinicId? }`
- Load the session row; reject if missing or expired.
- **Reject if `abhaNumber` is not one of the stored `accounts`** — stops a tampered client picking an arbitrary ABHA.
- Step 3 (T-token) → step 4 (X-token) → normalise the profile → delete the session row (single use).
- **Out:** `{ profile }` only.
- Audit `mobile_profile_fetch`.

### 3.5 `supabase/migrations/20260820000000_abdm_mobile_login.sql`

```sql
-- short-lived server-side holder for the ABDM T-token (never sent to the browser)
CREATE TABLE IF NOT EXISTS abdm_login_sessions (
  txn_id      TEXT PRIMARY KEY,
  t_token     TEXT NOT NULL,
  accounts    JSONB NOT NULL DEFAULT '[]'::jsonb,
  patient_id  UUID REFERENCES patients(id) ON DELETE SET NULL,
  clinic_id   UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);
ALTER TABLE abdm_login_sessions ENABLE ROW LEVEL SECURITY;   -- no policies: service role only

-- how the ABHA was linked, for the audit trail
ALTER TABLE patients ADD COLUMN IF NOT EXISTS abha_link_method TEXT;  -- 'aadhaar' | 'mobile'

-- fixes an existing gap: the audit log is currently RLS-less and exposed via PostgREST
ALTER TABLE abdm_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY abdm_audit_log_read ON abdm_audit_log FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));
```

Expired `abdm_login_sessions` rows also want a scheduled cleanup, on top of the delete-on-use in 3.4.

---

## 4. Files to modify

### 4.1 `src/services/abhaService.ts`

```ts
export interface ABHAAccount {
  abhaNumber: string; abhaAddress: string; name: string;
  gender?: string; dob?: string; status?: string; kycVerified?: boolean;
}

requestMobileOTP(mobile, patientId?, clinicId?): Promise<{ txnId: string; message: string }>
verifyMobileOTP(txnId, otp, patientId?, clinicId?): Promise<{ txnId: string; accounts: ABHAAccount[] }>
selectAbhaAccount(txnId, abhaNumber, patientId?, clinicId?): Promise<ABHAProfile>
linkABHAToPatient(patientId, profile, method: 'aadhaar' | 'mobile')   // add 3rd arg -> abha_link_method
```

Extend `ABHAProfile` with optional `kycVerified`, `verificationStatus`, `stateName`, `districtName`.

### 4.2 `src/components/Patients/ABHALinkModal.tsx`

- Add a method toggle at the top: **Mobile OTP** (default — no Aadhaar needed at the counter) and **Aadhaar**.
- Steps become `identity → otp → accounts (mobile only, and only when more than one) → consent → success`. The step indicator must be built from the active method's step list rather than the hardcoded four-item array.
- The mobile path prefills its input from `patientMobile`.
- Accounts step: radio list of `name — 91-XXXX-XXXX-XXXX (abhaAddress)`, with `kycVerified` shown as a badge.
- **Remove** `console.log('[ABHA] Verify OTP raw response: …')` — no raw ABDM payload in the browser console.
- Consent copy for this flow: the patient is confirming linkage of an existing ABHA, so no enrolment consent artefact is sent to ABDM here.

### 4.3 Existing Aadhaar functions (same PR or the next)

Repoint `abdm-request-otp`, `abdm-verify-otp`, `abdm-fetch-profile` and `abdm-get-public-key` at `_shared/abdm.ts`, so the sandbox URLs stop being literals and production becomes a config flip.

---

## 5. Configuration

Supabase secrets — server-side only, never in the frontend bundle:

| Secret | Sandbox | Production |
|---|---|---|
| `ABDM_CLIENT_ID` / `ABDM_CLIENT_SECRET` | NHA sandbox credentials | NHA production credentials |
| `ABDM_ENV` | `sandbox` | `production` |
| `ABDM_SESSION_URL` | *(optional override)* | *(optional override)* |
| `ABDM_BASE_URL` | *(optional override)* | *(optional override)* |
| `ABDM_X_CM_ID` | `sbx` | `abdm` |
| `ABDM_DEBUG_ERRORS` | `true` while testing | **unset** |

In `supabase/config.toml`, leave `verify_jwt` at its default (`true`) for all the ABDM functions — only signed-in clinic staff may call them.

---

## 6. Security checklist (all must be true before merge)

- [ ] No ABDM token (`accessToken`, `T-token`, `X-token`, `refreshToken`) appears in any response body reaching the browser.
- [ ] No `_raw` or upstream error body reaches the browser; `ABDM_DEBUG_ERRORS` unset in production.
- [ ] `profilePhoto` / `kycPhoto` stripped from every browser-bound payload.
- [ ] Mobile and OTP are RSA-encrypted server-side, and neither is written to any table or log.
- [ ] `abdm_login_sessions` rows are deleted on use and expire in 5 minutes.
- [ ] `abhaNumber` is validated against the stored `accounts` list in 3.4.
- [ ] RLS enabled on `abdm_audit_log` and `abdm_login_sessions`.
- [ ] Every ABDM call carries a fresh `REQUEST-ID` and is written to `abdm_audit_log` — successes and failures alike.
- [ ] Rate limiting on the three new functions (per clinic and per mobile) — currently missing across all ABDM functions.

---

## 7. Test cases (ABDM sandbox)

| # | Case | Expected |
|---|---|---|
| 1 | Valid mobile with one ABHA | OTP → single account auto-selected → profile → link |
| 2 | Valid mobile with several ABHAs | Account picker appears; the chosen ABHA is the one linked |
| 3 | Mobile with no ABHA | Clean "No ABHA found for this mobile number" message |
| 4 | Wrong OTP | Clear failure; `txnId` still usable for a retry |
| 5 | Expired OTP / reused txnId | Clear failure; user restarted at step 1 |
| 6 | T-token expired (over 5 minutes on the picker) | "Session expired, please request a new OTP" |
| 7 | Tampered `abhaNumber` at step 3 | Rejected server-side (403), audited as a failure |
| 8 | Invalid mobile format | Rejected before any upstream ABDM call |
| 9 | Patient already has an ABHA linked | Relink behaviour confirmed — block or overwrite, decide before build |
| 10 | Audit rows | `mobile_otp_request`, `mobile_otp_verify`, `mobile_profile_fetch` all present with their `request_id` |

---

## 8. Order of work

1. `_shared/abdm.ts` and the migration.
2. The three edge functions — test each against sandbox with curl before wiring any UI.
3. `abhaService.ts` methods.
4. `ABHALinkModal.tsx` — method toggle, accounts step, remove the raw-response log.
5. Repoint the existing Aadhaar functions at the shared module.
6. Run the test table above, then add the three new endpoints to `docs/abdm-production-readiness/api-inventory.md`.
