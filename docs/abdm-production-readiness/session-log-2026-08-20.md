# ABDM Work Log — 2026-08-20

Resume point for the next session. Everything below is **written and type-checked
but nothing is deployed and no SQL has been executed.**

Companion documents:
- `roadmap-m1-m4-and-security-gaps.md` — the full analysis, gap IDs (G-01…G-14), phasing
- `api-inventory.md` — current endpoint contracts (refreshed today)
- `pre-audit-checklist.md` — pre-existing, **not yet updated** for today's changes

---

## 1. Where we started, where we are

We began with an Aadhaar-only ABHA sandbox integration at roughly 25% of M1, and
a set of security defects that would have failed a CERT-In / STQC review.

Today closed **12 of 14 gaps** and added the mobile-OTP verification path.

| Was | Now |
|---|---|
| Aadhaar OTP only | Mobile-OTP verify (primary) + Aadhaar create (fallback) |
| X-token + full ABDM payload sent to browser, then `console.log`'d | Both tokens spent server-side; only a normalised profile crosses the wire |
| No RLS on the audit log; any user could forge rows | Service-role writes, admin-read-within-clinic |
| No authorization check on patientId/clinicId | Clinic derived from JWT; cross-clinic access returns 404 |
| Sandbox URLs hardcoded in 5 files | One `ABDM_ENV` switch |
| 3 ABDM round-trips per OTP request | Token + certificate cached |
| No rate limiting | Per-actor and per-target caps, fails closed |

---

## 2. Decisions taken (do not relitigate without new information)

1. **Keep the Aadhaar creation path.** It is the mainstream path across HMS
   vendors and yields an immediately KYC-verified 14-digit ABHA.
2. **Drop the Driving Licence path.** `enrol/byDocument` returns an
   *enrolment number* — a temporary identifier the patient must still get
   verified at a facility — and needs base64 front/back JPEGs plus NEPIX
   validation. Worst option at a busy OPD desk.
3. **Mobile-first, not mobile-only.** Mobile OTP verifies an existing ABHA;
   it cannot create one. Target stack is QR → mobile OTP → Aadhaar OTP.
4. **Defer M4 (NHCX)** until after M2 ships; it is a separate commercial call.
5. **Correction on the record:** an ABDM integrator is **not an AUA or KUA**.
   We never touch UIDAI's CIDR — we call NHA's APIs and NHA is the
   authentication agency. There is no UIDAI onboarding or audit obligation on
   us. An earlier draft of the roadmap claimed otherwise and recommended
   dropping Aadhaar on that basis; that recommendation was wrong and has been
   reversed. Real obligations: don't persist Aadhaar or OTP, encrypt before
   transmitting, log metadata. The code already met all three.

---

## 3. What was built

### Migration (1 file, **not yet applied**)
`supabase/migrations/20260820000000_abdm_phase0_hardening.sql`

- `_abdm_session` — token + certificate cache. Never existed; `abdm-session`
  had always read and written a table no migration created.
- `abdm_audit_log` — RLS enabled, policies added.
- `abdm_rate_limit` + `abdm_check_rate_limit()` — atomic count-and-insert.
- `abha_consent_artefacts` — versioned consent with verbatim text, operator id,
  and revocation columns.
- `abdm_flow_sessions` + `abdm_claim_flow_session()` — server-side token custody
  with a capped attempt counter.

### Shared modules (7 new)
`supabase/functions/_shared/` — `abdmConfig.ts`, `abdmCrypto.ts`,
`abdmSession.ts`, `abdmAuthz.ts`, `abdmHttp.ts`, `abdmFlowSession.ts`,
`abhaProfile.ts`.

### Edge functions
| Function | State |
|---|---|
| `abdm-request-otp` | rewritten onto shared modules |
| `abdm-verify-otp` | rewritten; returns profile, no `_raw`, no X-token |
| `abha-login-request-otp` | **new** — spec §7.4 step 1 |
| `abha-login-verify` | **new** — §7.4 step 2, returns account list |
| `abha-login-verify-user` | **new** — §7.4 step 3, T-token → X-token → profile |
| `abha-search` | **new** — §7.6.1.1 Find ABHA by mobile |
| `abha-link-patient` | **new** — consent artefact + patient update |
| `abdm-encrypt` | **deleted** (encryption oracle) |
| `abdm-get-public-key` | **deleted** (dead; wrong host baked in) |
| `abdm-session` | **deleted** (dead; broken table reference) |
| `abdm-fetch-profile` | **deleted** (required a client-held X-token) |

### Frontend
- `src/services/abhaService.ts` — rewritten; adds login-flow methods,
  `ABHASessionExpiredError`, error-body extraction from `functions.invoke`.
- `src/components/Patients/ABHAVerifyModal.tsx` — **new**, 5 steps with the
  mandatory account picker.
- `src/components/Patients/ABHALinkModal.tsx` — Aadhaar flow, corrected copy.
- `src/components/Patients/PatientModal.tsx` — two entry buttons + hand-off.
- `src/utils/abhaConsent.ts` — **new**, single source of the consent wording.
- `.env.example` — ABDM section added.

---

## 4. Gotchas found today — keep these in mind

1. **`REVOKE ... FROM PUBLIC` locks out `service_role` too.** It is not a
   superuser. Both new SQL functions therefore carry an explicit
   `GRANT EXECUTE ... TO service_role`. Without it the rate limiter fails to
   execute, `enforceRateLimit` fails closed, and *every* OTP request returns 503.
2. **Never consume a flow session on a failed OTP.** The first version did, so
   every mistyped digit would have cost the patient a fresh SMS. Now: claim an
   attempt, cap it in SQL, delete only on success.
3. **Pre-existing bug fixed:** `PatientModal`'s `onLinked` called
   `setShowABHAModal(false)`, unmounting the modal before its success step could
   render. That step was unreachable. Modals now close via their own Done button.
4. **ABDM masks numbers in `accounts[]`** (`91-2568-7073-XXXX`) — only the
   profile carries the real one. `abha-link-patient` rejects anything that is
   not 14 digits; storing a mask would silently break every later ABDM call.
5. **One mobile commonly carries several ABHAs** (whole families share a
   number). Auto-selecting the first is a data-integrity failure assessors
   specifically test for. The picker is mandatory, and `DEACTIVATED` accounts
   are shown but not selectable.
6. **`profiles.role_name`, not `profiles.role`** — matches
   `20250731125108_still_castle.sql`. RLS clinic scoping uses
   `public.user_clinic_ids()`.
7. **Three distinct ABDM hosts**, not one base URL: gateway (session), abha
   (enrolment/login/profile), phr (ABHA *address*, spec §14 only).
8. **SHA-1 in the RSA params is correct** and not ours to change — it is
   ABDM's `OAEPWithSHA-1AndMGF1Padding`. SHA-256 produces ciphertext ABDM
   cannot decrypt, and it surfaces as an opaque upstream error.

---

## 5. Verification status

| Check | Result |
|---|---|
| `deno check` on all 7 edge functions | ✅ clean |
| `tsc` on the frontend files touched | ✅ clean (repo has many pre-existing errors elsewhere, untouched) |
| `vite build` | ✅ succeeds |
| Migration SQL executed | ❌ **never run** — no Docker, no `psql` on this machine |
| Functions deployed | ❌ none |
| ABDM sandbox call | ❌ none made |

The SQL is the least-validated artefact here. Treat the first `db push` as a
real test, not a formality.

---

## 6. Start here tomorrow

> ### ⚠️ Do NOT run `supabase db push` on this project
>
> Checked against the linked project (`nxbzrpmlnlvknmutyher`) on 2026-08-20.
> The CLI migration ledger is badly out of sync with the actual database:
> `supabase migration list` reports ~25 local migrations as unapplied
> (`remote: ""`), but the objects they create **already exist remotely** —
> `idx_patients_abha_number`, `abdm_audit_log` and its three indexes,
> `document_links`, `ipd_treatment_plans` are all present.
>
> This project's remote schema has evidently been managed by pasting SQL into
> the Supabase SQL editor, which never records anything in
> `supabase_migrations.schema_migrations`. A `db push` would therefore try to
> replay ~25 migrations that are already applied. The ones guarded with
> `IF NOT EXISTS` would no-op; the rest (bare `CREATE POLICY`,
> `ALTER TABLE ... ADD COLUMN`) would error or partially apply.
>
> **Apply today's migration through the SQL editor instead**, matching how the
> rest of this database was built. The file is written to be safely re-runnable:
> `CREATE TABLE/INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` before each
> `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, and idempotent GRANT/REVOKE.
>
> Reconciling the ledger (`supabase migration repair --status applied ...`) is
> worth doing eventually, but it is a separate task and not a prerequisite here.

**Step 1 — apply the migration**

Paste `supabase/migrations/20260820000000_abdm_phase0_hardening.sql` into the
Supabase SQL editor and run it. Then confirm:

```sql
select tablename from pg_tables
where schemaname = 'public'
  and tablename in ('_abdm_session','abdm_rate_limit',
                    'abha_consent_artefacts','abdm_flow_sessions');
-- expect 4 rows

select relname, relrowsecurity from pg_class
where relname in ('abdm_audit_log','_abdm_session','abdm_rate_limit',
                  'abha_consent_artefacts','abdm_flow_sessions');
-- expect relrowsecurity = true for all 5

select proname from pg_proc
where proname in ('abdm_check_rate_limit','abdm_claim_flow_session');
-- expect 2 rows
```

**Step 2 — deploy the functions**:

```bash
supabase functions deploy abdm-request-otp abdm-verify-otp \
  abha-login-request-otp abha-login-verify abha-login-verify-user \
  abha-search abha-link-patient

# Deleting the source does NOT undeploy. Leaving abdm-encrypt live keeps
# G-04 open regardless of what the repo says.
supabase functions delete abdm-encrypt
supabase functions delete abdm-get-public-key
supabase functions delete abdm-session
supabase functions delete abdm-fetch-profile

supabase secrets set ABDM_ENV=sandbox
supabase secrets set ABDM_ALLOWED_ORIGINS=https://<your-app-domain>
# ABDM_CLIENT_ID / ABDM_CLIENT_SECRET should already be set.
# ABDM_BASE_URL and ABDM_X_CM_ID are no longer read and can be removed.
```

**Step 3 — sandbox smoke test**, in this order:
1. Mobile OTP against a number with **one** ABHA → picker → link.
2. Mobile OTP against a number with **several** ABHAs → confirm no auto-select.
3. Wrong OTP twice, then correct → confirm no new SMS was needed.
4. Wrong OTP four times → confirm the attempt cap trips.
5. Wait >6 min at the picker → confirm the 410 resets cleanly to the mobile step.
6. Mobile with no ABHA → confirm the hand-off to the Aadhaar flow.
7. Aadhaar create → confirm the profile renders and links.
8. Cross-clinic `patientId` → confirm 404, not 403 (no existence oracle).
9. Check `abdm_audit_log` has a row per call and `abha_consent_artefacts` holds
   the verbatim text.

**Step 4 — then pick one:**
- **Phase 2 (M1 completion):** §3 Step 4 Aadhaar mobile-verification — needed
  whenever the Aadhaar-linked mobile differs from the one given at reception,
  which is very common; §3 Step 6 ABHA address creation — without it a freshly
  enrolled ABHA has no address for M2/M3 linking; §10/§11 QR + card;
  scan-and-share.
- **G-13:** de-link / consent withdrawal UI. Columns exist, nothing writes them.
- **G-14:** architecture diagram, role/access matrix, staging URLs, test-account
  sheet — an agency will not start without these.

---

## 7. Open questions for you

1. **HFR registration** — not started, and it is operational, not code. Each
   physical clinic needs its own HFR ID, which becomes its HIP ID. Since this
   app is multi-clinic, HIP ID should become a per-clinic setting **now**;
   retrofitting it during M2 is expensive.
2. **Which security agency, and when?** Shortlisting should start during Phase 2
   — STQC/CERT-In empanelled agencies commonly quote 4–8 weeks and will not
   begin until the section 4 findings are closed and the G-14 pack exists.
3. **Is the sandbox test-account sheet available?** Needed for the smoke test
   in section 6 and later for the assessor.

---

## 8. Not mine

`ABHA_MOBILE_LOGIN_PLAN.md` (repo root) appeared in the working tree during the
session and was not written by this session. Its contents are consistent with
what was built. Left untouched — fold it into these docs or delete it, your call.
