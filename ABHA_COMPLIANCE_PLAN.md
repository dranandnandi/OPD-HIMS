# ABHA ID Compliance Implementation Plan
## AnPro OPD Management — ABDM V3 API Integration

> **Stack:** React + TypeScript + Supabase + Supabase Edge Functions
> **Flow:** Mobile OTP-based ABHA login (recommended for OPD)
> **Date:** 2026-04-02

---

## Overview

This document outlines the step-by-step plan to make the AnPro OPD Management app ABHA (Ayushman Bharat Health Account) compliant using the ABDM V3 API. The chosen approach is the **Mobile OTP flow** — faster, less friction, better UX for OPD patients.

---

## Phase 1: Backend Infrastructure (Supabase)

### 1.1 Database — Add ABHA Fields to Patients Table

**Migration file:** `supabase/migrations/YYYYMMDD_add_abha_fields.sql`

```sql
ALTER TABLE patients
  ADD COLUMN abha_number TEXT UNIQUE,
  ADD COLUMN abha_address TEXT,        -- e.g. patient@abdm
  ADD COLUMN abha_linked_at TIMESTAMPTZ,
  ADD COLUMN abha_consent_given BOOLEAN DEFAULT FALSE,
  ADD COLUMN abha_consent_at TIMESTAMPTZ,
  ADD COLUMN mobile_verified BOOLEAN DEFAULT FALSE;
```

**Update `src/types/index.ts` — Patient interface:**
```ts
abha_number?: string;
abha_address?: string;
abha_linked_at?: Date;
abha_consent_given?: boolean;
mobile_verified?: boolean;
```

---

### 1.2 Supabase Secrets — Store ABDM Credentials

In Supabase dashboard → Settings → Secrets:

| Secret Name          | Value                      |
|----------------------|----------------------------|
| `ABDM_CLIENT_ID`     | Your client ID from NHA    |
| `ABDM_CLIENT_SECRET` | Your client secret from NHA |
| `ABDM_BASE_URL`      | `https://dev.abdm.gov.in` (sandbox) / `https://live.abdm.gov.in` (prod) |
| `ABDM_X_CM_ID`       | `sbx` (sandbox) / `abdm` (prod) |

---

### 1.3 Edge Function: `abdm-session`

**File:** `supabase/functions/abdm-session/index.ts`

**Purpose:** Generate and cache ABDM Bearer token.

**Logic:**
1. `POST /gateway/v3/sessions` with `clientId + clientSecret`
2. Cache `accessToken` + `expiresIn` in Supabase `_abdm_session` table or edge cache
3. Return `accessToken` to caller

**Required Headers on ABDM call:**
```
Content-Type: application/json
REQUEST-ID: <UUID v4>
TIMESTAMP: <ISO 8601>
```

**Session cache table (optional but recommended):**
```sql
CREATE TABLE _abdm_session (
  id SERIAL PRIMARY KEY,
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 1.4 Edge Function: `abdm-get-public-key`

**File:** `supabase/functions/abdm-get-public-key/index.ts`

**Purpose:** Fetch ABDM RSA public key for encryption.

**ABDM API:**
```
GET /v3/profile/public/certificate
Authorization: Bearer <token>
REQUEST-ID: <UUID>
TIMESTAMP: <ISO>
```

**Logic:**
1. Call session function to get token
2. Fetch public cert from ABDM
3. Return PEM-formatted public key
4. Cache for 24 hours (key does not change often)

---

### 1.5 Edge Function: `abdm-encrypt`

**File:** `supabase/functions/abdm-encrypt/index.ts`

**Purpose:** Encrypt sensitive data (mobile, OTP, Aadhaar) using ABDM public key.

**Algorithm:** `RSA/ECB/OAEPWithSHA-1AndMGF1Padding`

**Input:** `{ plaintext: string }`
**Output:** `{ encrypted: string }` (Base64)

> **CRITICAL:** All sensitive data MUST be encrypted. Never send plain mobile/OTP to ABDM.

**Deno implementation note:** Use `crypto.subtle` with `RSA-OAEP` + `SHA-1` algorithm.

---

### 1.6 Edge Function: `abdm-request-otp`

**File:** `supabase/functions/abdm-request-otp/index.ts`

**Purpose:** Send OTP to patient's mobile via ABDM.

**Input:** `{ mobile: string }` (plain — function will encrypt internally)

**ABDM API:**
```
POST /v3/enrollment/request/otp
Authorization: Bearer <token>
REQUEST-ID: <UUID>
TIMESTAMP: <ISO>
X-CM-ID: sbx

{
  "scope": ["abha-enrol"],
  "loginHint": "mobile",
  "loginId": "<ENCRYPTED_MOBILE>",
  "otpSystem": "abdm"
}
```

**Output:** `{ txnId: string }` — Store this in frontend session state

> **CRITICAL:** `txnId` must be passed unchanged to the next step.

---

### 1.7 Edge Function: `abdm-verify-otp`

**File:** `supabase/functions/abdm-verify-otp/index.ts`

**Purpose:** Verify OTP and enrol/fetch ABHA profile.

**Input:** `{ txnId: string, otp: string, mobile: string }`

**Logic:**
1. Encrypt OTP using public key
2. Call ABDM verify endpoint with txnId + encrypted OTP
3. Receive ABHA number, ABHA address, profile
4. Return profile to frontend

**ABDM API (mobile enrol):**
```
POST /v3/enrollment/enrol/byAadhaar   ← or mobile equivalent
Authorization: Bearer <token>
REQUEST-ID: <UUID>
TIMESTAMP: <ISO>
X-CM-ID: sbx

{
  "authData": {
    "authMethods": ["MOBILE_OTP"],
    "otp": {
      "txnId": "<txnId>",
      "otpValue": "<ENCRYPTED_OTP>"
    },
    "mobile": "<ENCRYPTED_MOBILE>"
  },
  "consent": {
    "code": "abha-enrollment",
    "version": "1.4"
  }
}
```

**Output:** `{ abhaNumber, abhaAddress, name, gender, dob, mobile }`

---

### 1.8 Edge Function: `abdm-fetch-profile`

**File:** `supabase/functions/abdm-fetch-profile/index.ts`

**Purpose:** Fetch ABHA profile by ABHA number for existing patients.

**ABDM API:**
```
GET /v3/profile
Authorization: Bearer <token>
X-Token: <abha-token>
REQUEST-ID: <UUID>
TIMESTAMP: <ISO>
```

---

## Phase 2: Frontend Components

### 2.1 ABHA Linking Modal

**File:** `src/components/Patients/ABHALinkModal.tsx`

**UI Flow:**

```
[Step 1: Enter Mobile]
  └─ Input: Mobile Number (10 digits)
  └─ Button: "Send OTP via ABDM"

[Step 2: Enter OTP]
  └─ Info: "OTP sent to XXXXXXXXXX"
  └─ Input: 6-digit OTP
  └─ Link: Resend OTP (after 30s cooldown)
  └─ Button: "Verify OTP"

[Step 3: Consent Screen]  ← MANDATORY for ABDM compliance
  └─ Display: Patient name, ABHA number (masked)
  └─ Checkbox: "I consent to linking my ABHA ID with this clinic"
  └─ Button: "Confirm & Link ABHA"

[Step 4: Success]
  └─ Show: ABHA Number (formatted: XX-XXXX-XXXX-XXXX)
  └─ Show: ABHA Address (e.g. patient@abdm)
  └─ Button: "Done"
```

**State management:**
```ts
const [step, setStep] = useState<'mobile' | 'otp' | 'consent' | 'success'>('mobile');
const [txnId, setTxnId] = useState<string>('');
const [abhaProfile, setAbhaProfile] = useState<ABHAProfile | null>(null);
const [mobile, setMobile] = useState('');
const [otp, setOtp] = useState('');
const [consentGiven, setConsentGiven] = useState(false);
```

---

### 2.2 Patient Type Update

**File:** `src/types/index.ts`

Add to `Patient` interface:
```ts
abha_number?: string;
abha_address?: string;
abha_linked_at?: Date;
abha_consent_given?: boolean;
mobile_verified?: boolean;
```

Add new type:
```ts
export interface ABHAProfile {
  abhaNumber: string;
  abhaAddress: string;
  name: string;
  gender: string;
  dob: string;
  mobile: string;
}
```

---

### 2.3 ABHA Service

**File:** `src/services/abhaService.ts`

```ts
export const abhaService = {
  requestOTP: async (mobile: string): Promise<{ txnId: string }>,
  verifyOTP: async (txnId: string, otp: string, mobile: string): Promise<ABHAProfile>,
  linkABHAToPatient: async (patientId: string, profile: ABHAProfile, consentGiven: boolean): Promise<void>,
  fetchProfileByABHA: async (abhaNumber: string): Promise<ABHAProfile>,
}
```

Each method calls the corresponding Supabase Edge Function.

---

### 2.4 ABHA Badge in Patient Cards

**File:** `src/components/Patients/PatientModal.tsx` (modify existing)

Add ABHA section:
- If `patient.abha_number` exists: show green badge "ABHA Linked" + number
- If not: show button "Link ABHA ID"
- Button opens `ABHALinkModal`

---

### 2.5 ABHA Status in Patient List

**File:** `src/components/Patients/PatientTimeline.tsx` (or patient list) (modify existing)

Add small ABHA indicator icon/badge on patient cards where ABHA is linked.

---

## Phase 3: Request-ID & Audit Logging

### 3.1 Request-ID Utility

**File:** `src/utils/requestId.ts`

```ts
export const generateRequestId = (): string => crypto.randomUUID();
```

Every Edge Function must generate a new UUID per ABDM API call and include it as `REQUEST-ID` header. This is **mandatory** for ABDM compliance traceability.

---

### 3.2 ABDM Audit Log Table

```sql
CREATE TABLE abdm_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id),
  action TEXT,           -- 'otp_request', 'otp_verify', 'profile_fetch'
  request_id UUID,
  status TEXT,           -- 'success' | 'failure'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Log every ABDM API call for traceability (required for compliance approval).

---

## Phase 4: Settings & Configuration

### 4.1 ABHA Settings in Clinic Settings

**File:** `src/components/Settings/` — add ABHA section

Settings to expose:
- Environment toggle: Sandbox / Production
- ABHA feature enable/disable per clinic
- View linked ABHA count statistics

---

## Phase 5: Compliance Checklist

### ABDM Minimum Requirements

| Requirement | Implementation | Status |
|---|---|---|
| ABHA number capture | PatientModal + ABHALinkModal | To Do |
| Mobile OTP verification | `abdm-request-otp` + `abdm-verify-otp` | To Do |
| RSA encryption of sensitive data | `abdm-encrypt` edge function | To Do |
| Explicit patient consent | Step 3 in ABHALinkModal | To Do |
| Bearer token auth | `abdm-session` edge function | To Do |
| REQUEST-ID UUID per call | `generateRequestId()` utility | To Do |
| TIMESTAMP ISO 8601 per call | Added in each edge function | To Do |
| X-CM-ID header | Added in each edge function | To Do |
| txnId session management | Frontend state + passed to verify | To Do |
| Store ABHA in patient record | `abha_service.linkABHAToPatient()` | To Do |
| Audit logging | `abdm_audit_log` table | To Do |

---

## Implementation Order (Priority)

```
Week 1:
  [x] DB migration — add ABHA fields to patients
  [x] DB migration — abdm_audit_log table
  [x] Supabase secrets setup
  [ ] abdm-session edge function
  [ ] abdm-get-public-key edge function
  [ ] abdm-encrypt edge function

Week 2:
  [ ] abdm-request-otp edge function
  [ ] abdm-verify-otp edge function
  [ ] abhaService.ts (frontend service)
  [ ] ABHALinkModal component (4-step flow)
  [ ] Update Patient type with ABHA fields

Week 3:
  [ ] Integrate ABHALinkModal into PatientModal
  [ ] ABHA badge in patient cards/list
  [ ] ABHA section in clinic settings
  [ ] Audit log integration in all edge functions

Week 4:
  [ ] End-to-end testing on ABDM sandbox
  [ ] Switch to production credentials
  [ ] Submit for ABDM compliance review
```

---

## Key Architecture Decisions

| Decision | Rationale |
|---|---|
| Encryption in Edge Functions (not frontend) | Client secrets and public key fetching must not be exposed to browser |
| txnId stored in React state (not DB) | Ephemeral — only needed for duration of OTP flow session |
| Mobile OTP flow (not Aadhaar) | Faster, less friction, sufficient for OPD patient onboarding |
| Consent step before linking | ABDM mandatory requirement — without it, compliance fails |
| Audit log in Supabase | Traceability requirement for ABDM compliance certification |

---

## ABDM Sandbox Testing

**Sandbox base URL:** `https://dev.abdm.gov.in`

**Test credentials:** Apply at [NHA Developer Portal](https://developer.abdm.gov.in)

**Test mobile numbers:** ABDM provides test numbers that trigger sandbox OTPs without real SMS.

**Sandbox OTP:** Static `123456` for test numbers in ABDM sandbox environment.

---

## Common Mistakes to Avoid

- Never send plain mobile number or OTP to ABDM — always encrypt first
- Never reuse `txnId` across sessions
- Never skip the `REQUEST-ID` header — ABDM rejects calls without it
- Never skip the consent step — compliance requirement
- Use `otpSystem: "abdm"` not `"nic"` for mobile OTP flow
- Refresh Bearer token before expiry (token TTL is typically 30 minutes)
- Mobile must be verified even if Aadhaar flow is used

---

## Files to Create (New)

| File | Purpose |
|---|---|
| `supabase/functions/abdm-session/index.ts` | ABDM Bearer token manager |
| `supabase/functions/abdm-get-public-key/index.ts` | Fetch RSA public key |
| `supabase/functions/abdm-encrypt/index.ts` | Encrypt mobile/OTP |
| `supabase/functions/abdm-request-otp/index.ts` | Send OTP via ABDM |
| `supabase/functions/abdm-verify-otp/index.ts` | Verify OTP + enrol |
| `supabase/functions/abdm-fetch-profile/index.ts` | Fetch ABHA profile |
| `src/components/Patients/ABHALinkModal.tsx` | 4-step ABHA linking UI |
| `src/services/abhaService.ts` | Frontend ABHA API service |
| `src/utils/requestId.ts` | UUID generator for REQUEST-ID |
| `supabase/migrations/YYYYMMDD_add_abha_fields.sql` | Patient table migration |
| `supabase/migrations/YYYYMMDD_add_abdm_audit_log.sql` | Audit log migration |

## Files to Modify (Existing)

| File | Change |
|---|---|
| `src/types/index.ts` | Add `abha_number`, `abha_address`, `ABHAProfile` type |
| `src/components/Patients/PatientModal.tsx` | Add ABHA section + link button |
| `src/components/Patients/PatientTimeline.tsx` | Add ABHA badge on linked patients |
| `src/components/Settings/WhatsappAndAIReviewSettings.tsx` | Add ABHA settings section |
