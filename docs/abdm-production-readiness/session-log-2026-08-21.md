# ABDM Work Log — 2026-08-21 (Phase 2)

Continues `session-log-2026-08-20.md`. Still **nothing deployed and no SQL
executed** — yesterday's migration has not been run yet either.

**Phase 2 needs no new migration.** Everything here reuses tables created in
`20260820000000_abdm_phase0_hardening.sql`. The `flow` column is plain TEXT with
no CHECK constraint, so the new `enrolment` flow needed no schema change, and
`abha_consent_artefacts` already carried the `revoked_*` columns G-13 required.

---

## What Phase 2 adds

M1 is now complete **except scan-and-share** (see the exclusion below).

| Spec | Capability | Function(s) |
|---|---|---|
| §3.4 | Verify a mobile that is not the Aadhaar-linked one | `abha-enrol-mobile-request-otp`, `abha-enrol-mobile-verify` |
| §3.6 | ABHA address suggestions + creation | `abha-address-suggestions`, `abha-address-create` |
| §10/§11 | QR code + ABHA card | `abha-get-card` |
| G-13 | Consent withdrawal / unlink | `abha-unlink-patient` |

Frontend: `ABHACardPanel.tsx` (new), post-enrolment steps in `ABHALinkModal`,
card panel on both success screens, unlink control in `PatientModal`.

**G-13 is now closed. All 14 gaps from the security review are addressed.**

---

## Scan-and-share is NOT included — and why

It is part of current M1 functional testing, but it is **not in the ABHA V3 PDF
we hold**. It needs the HIECM/HIP specification: the V3 linking token, the
share-profile API, and synchronous discovery. Those are a different document set
from NHA.

**Action for you:** obtain the HIECM/HIP V3 spec before this can be built. It is
also the same document set M2 depends on, so getting it unblocks both.

---

## Design decisions worth knowing

1. **The enrolment does not end at `enrol/byAadhaar`.** Two steps chain off its
   `txnId`, so `abdm-verify-otp` now creates an `enrolment` flow session and
   returns a `sessionId` plus `needsAbhaAddress`. Both follow-up steps are
   skippable in the UI — neither should block a patient being seen.

2. **The X-token now survives verification by one TTL.** The card and QR
   (§10/§11) authenticate *as the patient*, and there is no other way to call
   them. `abha-login-verify-user` therefore retains the X-token against the
   session instead of destroying it, and returns the handle.

   This is a deliberate, bounded loosening of yesterday's position — the token
   is still server-side, still service-role-only, still minutes-lived, and the
   client still only holds an opaque handle. It is nothing like the original
   defect (G-02), which put the token in the browser console.

   The consequence to explain to the clinic: **the ABHA card can be printed at
   the end of a verification, but not on demand from a patient record days
   later.** Re-printing means re-verifying. That is the correct trade — the card
   is the patient's identity document, not the clinic's asset — and nothing is
   stored, so the clinic never accumulates ABHA cards at rest.

3. **`abha-get-card` accepts either flow.** The card is reachable from both the
   mobile-login and Aadhaar-enrolment paths, and the handle does not say which.
   `claimFlowSessionAny` tries each rather than trusting the client to declare
   its flow. A non-matching flow claims no attempt, because `flow` is part of
   the SQL predicate.

4. **Unlink revokes, never deletes.** Every live artefact for the patient is
   revoked, not just the newest — a patient re-linked after an earlier
   withdrawal has more than one. Revoke first, clear second: the reverse order
   could leave the clinic holding an ABHA with no consent behind it.
   `mobile_verified` is left set, because the mobile really was verified and
   that fact does not depend on the link.

5. **Audit actions were mislabelled at first.** Address creation and unlink were
   both writing `abha_link`, which would have made the trail unreadable exactly
   where an auditor looks hardest. Now: `abha_unlink`, `abha_address_create`,
   `abha_card_fetch`, `enrol_mobile_otp_request`, `enrol_mobile_otp_verify`.
   `abdm_audit_log.action` is plain TEXT, so no migration was needed.

---

## Spec gotchas found today

1. **`enrol/suggestion` is a GET and takes the txnId in a `Transaction_Id`
   header**, not in a body. It has no body at all.
2. **Mobile verification uses `auth/byAbdm`, not `enrol/byAadhaar`.** Same
   enrolment family, different verb — one confirms control of a number, the
   other creates an account.
3. **The §3.4 request must carry the enrolment `txnId`.** Omit it and ABDM
   treats the call as a brand-new enrolment.
4. **ABDM rotates the `txnId` between legs.** Each step's response txnId is
   stored back onto the session rather than reusing the original.
5. **`preferred: 1` is the only accepted value** for an ABHA address, so it is
   hardcoded rather than exposed.
6. **QR/card responses differ by environment** — JSON in some, raw image bytes
   in others, and the card returns 202 not 200. `fetchArtefact` sniffs the
   content type and normalises both to a data URI.
7. **Address 400/409 almost always means "already taken"** — the suggestion
   list goes stale the moment another integrator claims one. Mapped to a
   "choose another" message rather than a generic failure.

---

## Verification status

| Check | Result |
|---|---|
| `deno check` on all **13** edge functions | ✅ clean |
| `tsc` on the frontend files touched | ✅ clean |
| `vite build` | ✅ succeeds |
| Migration SQL executed | ❌ still never run |
| Functions deployed | ❌ none |
| ABDM sandbox call | ❌ none made |

---

## Deploy — supersedes yesterday's command

Migration first (SQL editor — **not** `supabase db push`; see the warning in
yesterday's log), then:

```bash
npx supabase functions deploy \
  abdm-request-otp \
  abdm-verify-otp \
  abha-login-request-otp \
  abha-login-verify \
  abha-login-verify-user \
  abha-search \
  abha-link-patient \
  abha-enrol-mobile-request-otp \
  abha-enrol-mobile-verify \
  abha-address-suggestions \
  abha-address-create \
  abha-get-card \
  abha-unlink-patient
```

Still name them explicitly — a bare `functions deploy` ships all 51, including
other people's uncommitted work.

The four deletions and the secrets from yesterday's log are unchanged and still
outstanding.

---

## Smoke tests to add to yesterday's list

10. Aadhaar create where the Aadhaar mobile differs from the clinic's → confirm
    the §3.4 step appears with both last-4 digits shown, and that Skip works.
11. Aadhaar create on an account with no address → confirm suggestions load and
    one can be claimed.
12. Claim an address that is already taken → confirm the "choose another"
    message, not a generic error.
13. Fetch the ABHA card on both paths → confirm QR and card render and print.
14. Wait past the session TTL, then fetch the card → confirm the "verify again"
    message rather than a crash.
15. Unlink a patient → confirm `patients` columns clear, `abha_consent_artefacts`
    rows get `revoked_at`/`revoked_by`, and **no row is deleted**.
16. Re-link after unlinking → confirm it succeeds and creates a second artefact.

---

## Next

1. **Get the HIECM/HIP V3 spec** — blocks scan-and-share (last M1 item) and all
   of M2.
2. **G-14 handoff pack** — architecture diagram, role/access matrix, staging
   URLs, test-account sheet. An agency will not start without these, and
   `pre-audit-checklist.md` still predates all of this work.
3. **HFR registration** — still not started, still operational rather than code.
   The per-clinic HIP ID decision gets more expensive the longer it waits.
