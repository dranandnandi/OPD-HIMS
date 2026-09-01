# ABDM Roadmap: M1 → M4, Security Gaps, and the Mobile-Only Plan

> ## ⚠️ CORRECTION 2026-08-27 — M4 is NHPR, not NHCX
>
> Every reference below to "M4 — NHCX (National Health Claims Exchange)" is
> **wrong**. It predates NHA's own description of the milestone.
>
> **M4 is the National Healthcare Providers Registry (NHPR):** integrating
> registration of health *professionals* (HPID/HPR) and health *facilities*
> (HFR) natively into the software, so a clinic can onboard from inside this
> app instead of on the NHA portal.
>
> What the mix-up changes:
> - M4 is **not** insurance or claims work and has nothing to do with
>   `billingService`. The "only worth it for cashless/insurance" reasoning below
>   is void, as is "defer until commercially justified".
> - We are **already partly inside M4**: the HFR facility APIs in
>   `abdm guidlines/HFR_Documentation_SBX_...pdf` are M4's facility half, and
>   `m2-prerequisites.md` §10 documents them.
> - M4 needs **M1, M2 and M3 complete first**, plus NHA assigning the **HPID**
>   and **HFR** roles to our client ID. Those are not enabled by default.
> - Sign-off needs a **video recording of the workflow** and a **security audit
>   + VAPT report** — a longer lead time than any code in it.
>
> See `m4-nhpr.md`. Treat the M4 sections below as historical error.


> Assessed 2026-08-20 against `ABDM_ABHA_V3_AP_Is_V1_31_07_2025.pdf` (ABHA V3 APIs, Integrator Guide v1.4)
> Current state: ABHA sandbox integration via **Aadhaar OTP enrolment** only.

---

## 0. Scope reality check — read this first

Three things about the PDF you gave me change the plan:

1. **That document covers M1 only.** It is the ABHA identity spec (session, encryption,
   enrolment, login, profile, QR/card, Find-ABHA, ABHA-address verification). M2/M3/M4 are
   *not in it*. You will need three more spec sets before you can build them:
   - **M2/M3** — HIECM V3 (link/discovery/consent/data-transfer), NRCeS FHIR R4 India profiles,
     and Fidelius (ECDH) encryption library.
   - **M4** — NHCX (National Health Claims Exchange) FHIR spec.

2. **Mobile OTP cannot *create* an ABHA.** In the spec, mobile OTP appears only under
   §7.4 *Login via Mobile OTP* (verification) and §14.1 *ABHA Address Verification via Mobile OTP*.
   Every **creation** path requires something stronger: Aadhaar (§3), Driving Licence (§4),
   Demographic Auth (§5), or Biometrics (§6). So "mobile-only" gets you
   **verify + link an existing ABHA**, not enrolment. **Keep the Aadhaar path** — see §6.

   **Encryption is not optional on any path.** RSA-OAEP/SHA-1 against the ABDM public certificate
   is required for *every* flow in this spec, Aadhaar or not. The DL flow (§4) encrypts the mobile
   at Step 1 (`loginId` — "needs to be RSA encrypted using a Public key") and the OTP at Step 2
   (`otpValue` — "Encrypted OTP value"). Only the DL number, photos and demographics go plaintext.
   Session token + certificate fetch + RSA encrypt is baseline ABDM plumbing, not an Aadhaar tax.

3. **M1 is not just ABHA identity anymore.** Current NHA M1 functional testing also expects
   **scan-and-share QR** and **HIP-initiated linking via the linking token** — i.e. a slice of
   HIP behaviour lands in M1. Budget for it. Also, M1 requires a **production HFR facility
   registration** (the HFR ID becomes your HIP ID) — that is an operational task, not code, and
   it is on nobody's list right now.

---

## 1. What is built today

| Component | File | State |
|---|---|---|
| Bearer session + cache | `supabase/functions/abdm-session/index.ts` | Written, **dead code** (see G-06) |
| Public certificate fetch | `supabase/functions/abdm-get-public-key/index.ts` | Written, **dead code** |
| Generic RSA encrypt | `supabase/functions/abdm-encrypt/index.ts` | Written, **dead code**, and a liability (G-04) |
| Aadhaar OTP request | `supabase/functions/abdm-request-otp/index.ts` | Working (sandbox) |
| Aadhaar OTP verify + enrol | `supabase/functions/abdm-verify-otp/index.ts` | Working (sandbox) |
| Profile fetch | `supabase/functions/abdm-fetch-profile/index.ts` | Working (sandbox) |
| Frontend service | `src/services/abhaService.ts` | Working |
| 4-step link UI + consent | `src/components/Patients/ABHALinkModal.tsx` | Working |
| Patient ABHA columns | `supabase/migrations/20260402_add_abha_fields.sql` | Applied |
| Audit log table | `supabase/migrations/20260402_add_abdm_audit_log.sql` | Applied, **no RLS** (G-01) |

**Coverage against M1:** roughly **25%**. One creation path, one profile read, no QR,
no scan-and-share, no linking token, no ABHA address creation, no ABHA card.

---

## 2. M1 gap list (against the PDF)

> **Refreshed 2026-08-25** after Phases 1-2 and the first live sandbox testing.
> "proven" = exercised end to end against ABDM sandbox with a real ABHA on a
> real mobile. "built" = written and deployed, never yet exercised.

| # | Spec § | Capability | Status |
|---|---|---|---|
| 1.1 | §1.0 | Generate session token | ✅ **proven** |
| 1.2 | §2.0 | Encrypt Aadhaar/Mobile/OTP/Password (RSA-OAEP on Deno) | ✅ **proven** |
| 1.3 | §3 Step 1-3 | ABHA creation via Aadhaar OTP → `enrol/byAadhaar` | ✅ built, untested (burns sandbox quota — 100 cap) |
| 1.4 | §3 Step 4 | ABHA mobile verification (`auth/byAbdm`) | ✅ built, untested |
| 1.5 | §3 Step 6 | ABHA address suggestions + creation | ✅ built, untested |
| 1.6 | §4 | Creation via Driving Licence | ⏸️ deliberately not built — yields an *enrolment number*, not a KYC'd ABHA |
| 1.7 | §7.4 | **Login via Mobile OTP** — the core OPD path | ✅ **proven end to end** |
| 1.8 | §7.3 | Login via ABHA number + OTP | ❌ missing |
| 1.9 | §7.6.1 | Find ABHA using mobile | ✅ **proven** |
| 1.10 | §9.0 | Get profile | ⚠️ **built, refused by ABDM** — empty-bodied 401. Now optional enrichment; verification no longer depends on it. See session-log-2026-08-25.md §4e/§4f |
| 1.11 | §10 | Generate QR code | ✅ **proven** — real QR PNG returned |
| 1.11b | §11 | Generate ABHA card | ⚠️ **built, refused by ABDM** — same empty 401 as 1.10. Returns null; the UI hides the option |
| 1.12 | §14.1 | ABHA *address* verification via mobile OTP (PHR base) | ❌ missing |
| 1.13 | — | Scan-and-share | ❌ missing — spec now held; blocked only on an HIP ID |
| 1.14 | — | HFR facility registration → HIP ID | ❌ **not started (operational)** — now the single biggest blocker |

**The 1.10 / 1.11b anomaly is worth stating precisely**, because it is the one
open technical question in M1: `/v3/profile/account/qrCode` **succeeds** with a
given X-token while `/v3/profile/account` and `/v3/profile/account/abha-card`
return **401 with an empty body** using that same token, same host, same header,
in the same request. That rules out our request construction, the token, the
header format and the credentials. It is an NHA-side question.

Deliberately out of scope, and I recommend keeping them out: biometrics (§6, §7.5, §13.6.3),
Benefit APIs (§13 — government integrators only), Child ABHA (§13.7 — NHA-approved integrators only),
delete/deactivate/re-KYC (§8 — the ABHA app owns these; an OPD system should not).

---

## 3. M2 / M3 / M4 — what "pending" actually means

Nothing exists for any of these. Grep for `fhir`, `care_context`, `consent_artefact`,
`linkToken` across `src/` and `supabase/functions/` returns zero hits.

### M2 — HIP (share records on consent)
The heaviest milestone by far. Needs:
- **Care-context model.** A visit/admission must become an addressable care context with a
  stable reference. Your data is there (`visits`, `admissions`), the ABDM-facing layer is not.
- **FHIR R4 bundle generation**, NRCeS India profiles. *Corrected 2026-08-21 against
  the live IG (v6.5.0, FHIR 4.0.1) — an earlier draft of this document used the
  names that circulate in blog posts, which do not match the actual profiles:*
  `OPConsultRecord` (your OPD visit + EMR form), `PrescriptionRecord`,
  `DiagnosticReportRecord` (LIMS results), `DischargeSummaryRecord` (IPD),
  `HealthDocumentRecord` (scanned uploads), `ImmunizationRecord`,
  `WellnessRecord`, and `InvoiceRecord` (billing). All are **Composition**-based
  and wrap into a `DocumentBundle`. There is no `ImagingStudy` clinical
  artefact — radiology goes in `DiagnosticReportRecord`.
  This is where the real effort sits — your EMR is free-text/voice-dictation heavy, and FHIR
  wants coded, structured resources. Expect to add SNOMED/LOINC/ICD-10 coding discipline.
- **Fidelius ECDH encryption** for the data push. ⚠️ **This does not run on your
  current stack.** Fidelius uses Curve25519 in *Short Weierstrass* form (the
  BouncyCastle implementation), not the Montgomery X25519 that Web Crypto,
  Deno, Node's built-in ECDH and libsodium all provide. A Supabase Edge Function
  therefore **cannot** do this with `crypto.subtle`, and a generic ECDH library
  fails against the gateway with errors like "encoded key spec not recognized".
  Budget for a separate crypto service or a WASM port built from the Fidelius
  CLI's own parameters and test vectors. See `m2-prerequisites.md`.
- **Publicly reachable callback endpoints** for consent notify / HI request. Supabase Edge
  Functions can host these, but they must be `verify_jwt = false` + ABDM-signature-validated,
  which is a new auth pattern for this codebase.

### M3 — HIU (request and consume records)
Lighter than M2 once M2's crypto and FHIR parsing exist:
- Consent request initiation, consent artefact handling, per-consent key-pair storage,
  HI request, Fidelius **decrypt**, and a clinician-facing viewer for heterogeneous external bundles.
- Realistically: build after M2, reuse the crypto layer.

### M4 — NHCX claims
- Only worth it if you are doing cashless/insurance. `src/services/billingService.ts` and the
  TPA work in the IPD module are the natural feed. Requires `CoverageEligibilityRequest/Response`,
  `Claim`, `ClaimResponse`, `ExplanationOfBenefit`, and ICD-10 coding across existing data.
- **Recommendation: defer.** It does not gate M1–M3 and it is a separate commercial decision.

---

## 4. Security / certification gaps (STQC / CERT-In Safe-to-Host)

These are the findings that will actually get flagged. Ordered by severity.

### Blockers

**G-01 — `abdm_audit_log` has no RLS.**
`supabase/migrations/20260402_add_abdm_audit_log.sql` never calls `ENABLE ROW LEVEL SECURITY`
and defines no policy. 33 of 107 migrations in this repo do enable RLS, so the omission is
inconsistent with your own baseline. Any authenticated user of any clinic can read every
clinic's ABDM audit trail — and can also **insert forged audit rows**, which destroys the
non-repudiation value the table exists for. An auditor will find this immediately.
→ Enable RLS, service-role write only, clinic-scoped admin read.

**G-02 — Full upstream ABDM response is returned to the browser.**
`supabase/functions/abdm-verify-otp/index.ts:209` returns `_raw: abdmData`, and
`src/components/Patients/ABHALinkModal.tsx:124` then `console.log`s the whole thing —
including the ABHA **X-token**, the KYC-verified profile, and the base64 profile photo.
That token is a bearer credential for the patient's ABHA profile, now sitting in browser
console history and any error-reporting pipeline. Direct OWASP A09 / sensitive-data-exposure finding.
→ Delete `_raw` and the `console.log`; return only the normalized profile fields you need.

**G-03 — Raw upstream error bodies leak to the client.**
`abdm-request-otp/index.ts:170`, `abdm-verify-otp/index.ts:172`,
`abdm-fetch-profile/index.ts:87`, `abdm-session/index.ts:63`, `abdm-get-public-key/index.ts:60`
all pass `detail: <ABDM error text>` straight through, plus `requestMeta` echoing scope/loginHint.
Your own `pre-audit-checklist.md` already lists this as a must-fix.
→ Log server-side against the REQUEST-ID, return a generic message + correlation ID to the client.

**G-04 — `abdm-encrypt` is an exposed encryption oracle.**
It encrypts arbitrary attacker-supplied plaintext under ABDM's public key and returns it,
to any authenticated user. It is also unused — every function inlines its own `rsaEncrypt`.
→ Delete the function. Move the shared crypto into `supabase/functions/_shared/abdmCrypto.ts`
(the pattern already exists — see `_shared/documentLinks.ts`).

**G-05 — No authorization check inside the ABDM functions.**
`verify_jwt` defaults to true (only `verify-prescription` and `doc-link` opt out in
`supabase/config.toml`), so a Supabase JWT is required — but nothing verifies that the caller
is entitled to act on the `patientId`/`clinicId` in the body. Any authenticated user of any
clinic can trigger Aadhaar OTP against any patient record and write audit rows attributed to
another clinic. Classic IDOR / broken object-level authorization (OWASP A01).
→ Resolve the caller's clinic from their JWT server-side; reject cross-clinic `patientId`.

### High

**G-06 — Sandbox URLs are hardcoded; there is no production switch.**
`abdm-request-otp:27,51,139`, `abdm-verify-otp:26,45,141`, `abdm-fetch-profile:18,60` hardcode
`dev.abdm.gov.in` and `abhasbx.abdm.gov.in`, and `X-CM-ID: 'sbx'` is hardcoded at
`abdm-request-otp:33`, `abdm-verify-otp:32`, `abdm-fetch-profile:24`. Only `abdm-session` and
`abdm-get-public-key` read `ABDM_BASE_URL` / `ABDM_X_CM_ID` — and those two are never called.
Going live is currently a code edit across five files, not a config change. Auditors treat
"prod and non-prod not cleanly separated" as a finding in its own right.
→ Centralize base URLs and `X-CM-ID` in one `_shared/abdmConfig.ts` driven by env.

**G-07 — Session and certificate caching is bypassed; `_abdm_session` table does not exist.**
`abdm-session` selects from and inserts into `_abdm_session`, but no migration ever creates it —
grep across all 107 migrations returns nothing. The function would fail on both queries. Meanwhile
each of the three live functions mints a fresh session token *and* re-fetches the RSA certificate
on every single user action: **3 ABDM round-trips per OTP request**. That is a rate-limit and
latency problem in production, and NHA does watch session-API abuse.
→ Add the migration (service-role only, RLS on), make all functions go through one cached
session + cached certificate helper.

**G-08 — No rate limiting on OTP request.**
Nothing throttles `abdm-request-otp`. An authenticated user can pump OTPs at arbitrary Aadhaar
numbers — SMS-bombing a third party through your NHA credentials, with your client ID on it.
Already flagged as an open gap in `pre-audit-checklist.md`, still open.
→ Per-user + per-target rate limit, backed by a table with an index on `(actor, window)`.

**G-09 — `Access-Control-Allow-Origin: '*'` on all six ABDM functions.**
`abdm-encrypt:4`, `abdm-fetch-profile:5`, `abdm-get-public-key:4`, `abdm-request-otp:5`,
`abdm-session:5`, `abdm-verify-otp:5`. Combined with G-05 this widens the blast radius of any
stolen token. Auditors flag wildcard CORS on PII endpoints as a matter of routine.
→ Allowlist your app origins.

### Medium

**G-10 — Inaccurate Aadhaar copy in the UI.** *(downgraded from High — see note)*
`ABHALinkModal.tsx:199` tells the user "Aadhaar number is encrypted before transmission".
It is not: `ABHALinkModal.tsx:50,203-215` holds Aadhaar in React state and posts it
application-layer-plaintext (over TLS) to the edge function, which encrypts it server-side.
An assessor who reads the code will flag the mismatch between claim and behaviour.
→ Cheapest correct fix is to reword the copy to what actually happens ("sent over an encrypted
channel, encrypted for ABDM on our server, never stored"). Client-side encryption against the
ABDM certificate is a defensible hardening, but it is **not** required for certification.

> **Correction to an earlier draft of this document.** A previous version claimed you are
> "handling Aadhaar under the Aadhaar Act without the surrounding controls" and recommended
> dropping Aadhaar on that basis. That overstated the burden. An ABDM integrator is **not an
> AUA or KUA** — you never touch UIDAI's CIDR; you call NHA's ABHA APIs and **NHA** is the
> authentication agency. There is no UIDAI onboarding or audit obligation on you. The actual
> obligations are narrower: do not persist Aadhaar or OTP, encrypt before transmitting to ABDM,
> and log metadata for audit. **The current code already meets all three** — Aadhaar is never
> written to a table, and the `console.error` calls log ABDM's response body, not the request
> body. The only real defect is the UI copy above.

**G-11 — Console logging around sensitive flows.**
`abdm-request-otp:159,196`, `abdm-verify-otp:161,213`, `abdm-fetch-profile:53,59,78,91,123` —
error paths log full upstream bodies to Supabase function logs, which are retained and broadly
readable. Checklist says "ABDM tokens are not logged"; this is not yet true.

**G-12 — Consent is a boolean, not an artefact.**
`abhaService.ts:74-81` stores `abha_consent_given` + `abha_consent_at`. There is no record of
*which* consent text/version the patient agreed to, no operator identity, no purpose code, and
no revocation path. ABDM consent is versioned (`{code: "abha-enrollment", version: "1.4"}`) and
the audit expects you to prove what was shown. M2/M3 will need a real consent-artefact table anyway.

**G-13 — No ABHA de-link / revocation.**
A patient cannot withdraw. Needed for the data-principal rights section of the audit and under DPDP.

**G-14 — Handoff pack is stale.**
`docs/abdm-production-readiness/api-inventory.md` still describes `abdm-verify-otp` as returning
`_raw` as if that were intended, and lists no `abdm-session` / `abdm-encrypt` / `abdm-get-public-key`.
Missing entirely: architecture diagram, role/access matrix, staging URLs, test-account sheet,
DPDP data-flow map. These are hard prerequisites before an agency will start.

---

## 4b. Implementation status (2026-08-20)

Phase 0 and the Phase 1 core are **written but not yet deployed**. Nothing in
this section has run against a database or against ABDM sandbox.

| Gap | Status |
|---|---|
| G-01 audit-log RLS | ✅ `20260820000000_abdm_phase0_hardening.sql` |
| G-02 `_raw` / X-token to browser | ✅ removed; tokens now spent server-side |
| G-03 raw upstream errors | ✅ `_shared/abdmHttp.ts` — generic text + `requestId` |
| G-04 `abdm-encrypt` oracle | ✅ function deleted; `_shared/abdmCrypto.ts` |
| G-05 missing authorization | ✅ `_shared/abdmAuthz.ts` — clinic from JWT |
| G-06 hardcoded sandbox URLs | ✅ `_shared/abdmConfig.ts` — `ABDM_ENV` |
| G-07 broken session cache | ✅ `_abdm_session` created; token + cert cached |
| G-08 no rate limiting | ✅ `abdm_check_rate_limit`, fails closed |
| G-09 wildcard CORS | ✅ allowlist via `ABDM_ALLOWED_ORIGINS` |
| G-10 inaccurate Aadhaar copy | ✅ reworded to match actual behaviour |
| G-11 logging upstream bodies | ✅ bodies to logs only, keyed by `requestId` |
| G-12 consent as boolean | ✅ `abha_consent_artefacts`, text stored verbatim |
| G-13 no de-link / withdrawal | ✅ **closed 2026-08-21** — `abha-unlink-patient` + UI |
| G-14 stale handoff pack | 🔶 `api-inventory.md` refreshed; diagrams/matrix still missing |

**Phase 2 landed 2026-08-21** — spec §3.4 mobile verification, §3.6 ABHA
address, §10/§11 card and QR, plus G-13 unlink. Six more functions and
`ABHACardPanel.tsx`. **13 edge functions now need deploying, not 7.** Details
in `session-log-2026-08-21.md`. M1 is complete except scan-and-share.

> **Superseded 2026-08-25.** "13 edge functions now need deploying" and "the
> HIECM/HIP spec we do not hold" are both out of date. The functions **are
> deployed** to the Mumbai project, and the spec **arrived 2026-08-21**
> (`abdm guidlines/`). Scan-and-share is now blocked on HFR registration, not on
> documentation. See `session-log-2026-08-25.md`.

Phase 1 additions: `abha-login-request-otp`, `abha-login-verify`,
`abha-login-verify-user`, `abha-search`, `abha-link-patient`, and
`ABHAVerifyModal.tsx` with the mandatory account picker.

**Before this can be exercised:**
1. `supabase db push` — four new tables plus RLS and two functions.
2. `supabase functions deploy` for the seven ABDM functions.
3. `supabase functions delete abdm-encrypt abdm-get-public-key abdm-session abdm-fetch-profile`
   — deleting the source does **not** undeploy them, and leaving `abdm-encrypt`
   live leaves G-04 open regardless of the repo state.
4. `supabase secrets set ABDM_ENV=... ABDM_ALLOWED_ORIGINS=...`
5. End-to-end run against ABDM sandbox — none of this has been exercised
   against live ABDM yet.

---

## 5. Sequencing

```
Now ──────────────────────────────────────────────────────────────────────►

  Phase 0   Security remediation           G-01…G-14        ~2 weeks
            (must land before anything else — it is cheaper to fix
             6 functions than 20)

  Phase 1   Mobile-first M1 core           §7.4, §7.6.1     ~3 weeks
            mobile-OTP verify + find + link (Aadhaar path retained as-is)

  Phase 2   M1 completion                  §3.4, §3.6,      ~3 weeks
            Aadhaar mobile-verify, ABHA     §10/11
            address, QR/card, scan-and-share

  Phase 3   HFR registration + sandbox functional testing    ~2 weeks
            (NHA-side turnaround is the variable, not your code)

  Phase 4   STQC/CERT-In Safe-to-Host engagement            4–8 weeks
            (external; start paperwork during Phase 2)

  Phase 5   M2 HIP — FHIR + Fidelius + care contexts        ~10-12 weeks

  Phase 6   M3 HIU — consent request + decrypt + viewer     ~5 weeks

  Phase 7   M4 NHCX — defer until commercially justified
```

Phase 0 is non-negotiable and comes first. Every finding in section 4 gets more expensive to
fix once M2 doubles the surface area, and a failed security assessment costs you a full
re-audit cycle.

---

## 6. The basic mobile-first ABDM plan

**Goal:** an OPD front desk that resolves a patient's ABHA in the fewest possible steps.

**Revised recommendation: keep Aadhaar.** It is the mainstream creation path across HMS vendors,
it is fully certifiable, and per G-10 the compliance burden is far lighter than first assessed.
"Mobile-first" here means mobile OTP is the *primary* path because most OPD walk-ins already
have an ABHA — not that Aadhaar is removed.

**What other HMS actually ship**, in order of front-desk usage:

| Path | Use | Vendor adoption |
|---|---|---|
| **Scan-and-share QR** | Patient has ABHA card/app — zero typing, zero OTP | Very common; NHA pushes it hardest |
| **Aadhaar OTP creation** | Patient has no ABHA — instant, KYC-verified 14-digit ABHA | The default creation path |
| **Mobile OTP verify** | Patient has ABHA but no card to hand | Common |
| **DL / PAN creation** | — | Rare. High friction, and it yields an *enrolment number* |

So the target stack is **QR → mobile OTP → Aadhaar OTP**, with DL dropped.

### 6.1 Primary flow — verify an existing ABHA by mobile OTP (§7.4)

```
Reception enters patient's 10-digit mobile
  ↓  POST /v3/profile/login/request/otp
     { scope: ["abha-login","mobile-verify"], loginHint: "mobile",
       loginId: <RSA-OAEP-SHA1(mobile)>, otpSystem: "abdm" }
  →  { txnId }

Patient reads out the 6-digit OTP
  ↓  POST /v3/profile/login/verify
     { scope: ["abha-login","mobile-verify"],
       authData: { authMethods:["otp"], otp:{ txnId, otpValue:<RSA(otp)> } } }
  →  { token (T-token, 5 min TTL), accounts: [ …ABHA numbers on this mobile… ] }

One mobile can carry several ABHAs (family). Show the masked list, let the patient pick.
  ↓  POST /v3/profile/login/verify/user
     headers: T-token: Bearer <token>
     { ABHANumber, txnId }
  →  { token }   ← this is the X-token

  ↓  GET /v3/profile/account   headers: X-Token: Bearer <X-token>
  →  profile

  ↓  Consent screen → store ABHA number + address + consent artefact on the patient
```

Three things to get right here, because they differ from the Aadhaar flow you already have:
- **The account picker is mandatory.** `accounts[]` is a list. Skipping it links the wrong
  family member — a data-integrity failure an assessor will test for.
- **The T-token expires in 5 minutes.** Handle expiry explicitly with a clean "start again" path.
- **`scope` is `["abha-login","mobile-verify"]`, not `["abha-enrol"]`,** and the base path is
  `/v3/profile/login/*`, not `/v3/enrollment/*`. This is a different API family from your
  current code — a new function, not an edit to `abdm-verify-otp`.

### 6.2 Secondary — Find ABHA by mobile (§7.6.1)

For patients who know they have an ABHA but not the number:
`POST /v3/profile/account/abha/search` → OTP → verify. Same mobile, no Aadhaar.
Small addition, disproportionately useful at the front desk.

### 6.3 Creation — Aadhaar OTP (§3), retained

**Keep the code you already have.** `abdm-request-otp` + `abdm-verify-otp` cover §3 Steps 1–3 and
work in sandbox today. What is missing from §3 is the tail of the flow, and it matters:

- **§3 Step 4 — mobile verification** (`/v3/enrollment/auth/byAbdm`). Required when the patient's
  Aadhaar-linked mobile differs from the mobile they give the clinic, which is extremely common.
- **§3 Step 6 — ABHA address** (`/v3/enrollment/enrol/suggestion` → `/v3/enrollment/enrol/abha-address`).
  Without it, a freshly enrolled ABHA has no usable address, and M2/M3 linking needs one.

Apply the G-10 copy fix to the existing modal and this path is audit-ready.

### 6.3b Why DL is dropped

Confirmed from spec §4 and from NHA's own guidance: `enrol/byDocument` returns
`{ enrolmentNumber, enrolmentState: "VERIFIED" }` — an **enrolment number is a temporary
identifier**, not a KYC'd 14-digit ABHA, and the patient must still get it verified at a
facility. Combined with base64 front/back JPEG capture and NEPIX validation latency, it is the
worst option at a busy OPD desk. It also does **not** avoid encryption (see §0). Revisit only if
you hit a real population of patients with neither ABHA nor Aadhaar.

### 6.4 Then finish M1 (§3.6, §10, §11, §14.1)

ABHA address suggestions + creation, QR code, ABHA card, and ABHA-address verification via
mobile OTP — note §14 uses a **different base URL**
(`https://abhasbx.abdm.gov.in/abha/api/v3/phr/web`), which is exactly the kind of thing G-06's
centralized config needs to accommodate.

### 6.5 What Phase 1 ships

| New | Purpose |
|---|---|
| `supabase/functions/_shared/abdmConfig.ts` | Base URLs + `X-CM-ID`, env-driven (fixes G-06) |
| `supabase/functions/_shared/abdmCrypto.ts` | One RSA-OAEP impl (fixes G-04, kills 3× duplication) |
| `supabase/functions/_shared/abdmSession.ts` | Cached token + cached certificate (fixes G-07) |
| `supabase/functions/_shared/abdmAuthz.ts` | Caller → clinic → patient check (fixes G-05) |
| `supabase/functions/abha-login-request-otp/` | §7.4 Step 1 |
| `supabase/functions/abha-login-verify/` | §7.4 Step 2 — returns masked `accounts[]` only |
| `supabase/functions/abha-login-verify-user/` | §7.4 Step 3 — T-token → X-token |
| `supabase/functions/abha-search/` | §7.6.1 Find ABHA by mobile |
| `migrations/…_abdm_session.sql` | The missing table, RLS on |
| `migrations/…_abdm_audit_rls.sql` | Fixes G-01 |
| `migrations/…_abha_consent_artefacts.sql` | Fixes G-12, groundwork for M2/M3 |
| `migrations/…_abdm_rate_limit.sql` | Fixes G-08 |
| `src/components/Patients/ABHAVerifyModal.tsx` | Mobile → OTP → **account picker** → consent |

| Changed | Why |
|---|---|
| `abdm-verify-otp/index.ts:209` | Drop `_raw` (G-02) |
| `ABHALinkModal.tsx:124` | Drop the `console.log` (G-02) |
| All `abdm-*` functions | Sanitize `detail` (G-03), scope CORS (G-09), trim logs (G-11) |
| `src/services/abhaService.ts` | Add the login-flow methods |
| `docs/abdm-production-readiness/*` | Refresh before the agency engagement (G-14) |

| Retired | Why |
|---|---|
| `supabase/functions/abdm-encrypt/` | Encryption oracle (G-04) |

The Aadhaar path stays. `ABHALinkModal.tsx` becomes one of two entry points alongside the new
mobile-verify modal, with the G-10 copy fix applied. Phase 2 adds §3 Step 4 (mobile verification)
and §3 Step 6 (ABHA address) to complete it, plus scan-and-share QR.

---

## 7. Open decisions for you

1. ~~Do you keep the Aadhaar path?~~ **Resolved: yes, keep it.** It is the mainstream creation
   path, the integrator is not an AUA/KUA, and the current code already satisfies the real
   obligations. Only the UI copy (G-10) needs fixing. DL is dropped instead.
2. **Is M4 (NHCX) in scope this year?** Recommendation: no — decide after M2 ships.
3. **Single HFR facility or multi-clinic?** Certification is per-software, deployment is
   per-facility — each physical clinic needs its own HFR ID / HIP ID. Since this app is
   multi-clinic, the HIP ID has to be a per-clinic setting from day one. Designing that in
   during Phase 1 is nearly free; retrofitting it during M2 is not.
4. **Who runs the security audit?** Start agency shortlisting during Phase 2 — STQC/CERT-In
   empanelled agencies commonly quote 4–8 weeks and they will not begin until the section 4
   findings are closed and the handoff pack in G-14 exists.
