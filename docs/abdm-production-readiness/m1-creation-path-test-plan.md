# M1 — Aadhaar creation path, planned test run

Written 2026-09-01. This covers `CRT_ABHA_101–115` and `VRFY_ABHA_101`, the
only mandatory M1 tests still unexercised.

## Why this is planned rather than improvised

**Sandbox allows 100 ABHA creations per client ID, total, forever** (`ABDM-1227`).
There is no reset and no way to return one. A fumbled run — wrong mobile, wrong
scope, a retry after a timeout — consumes quota permanently, and the quota is
shared with every future test of this flow.

So: read the whole plan, have the Aadhaar holder and both phones physically
present, and do not start until every prerequisite below is ticked.

Every other M1 flow is now proven, so this is the last gate.

## Before starting

- [ ] A **real Aadhaar** whose holder is present and consenting. There is no
      synthetic test Aadhaar documented for ABDM sandbox — every flow proven so
      far used a real identity. **Confirm with NHA whether test Aadhaar numbers
      exist before burning the first creation**; if they do, use one.
- [ ] The **Aadhaar-linked mobile**, in hand, unlocked.
- [ ] A **second mobile** that is NOT the Aadhaar-linked one — this is what
      makes step 4 meaningful, and it is the common real-world case.
- [ ] The patient record to link against, in the test clinic.
- [ ] Browser devtools open on the Network tab; capture every `requestId`.
- [ ] Nobody else running ABDM tests against the same client ID concurrently.

## The run

Each step names the function, what to assert, and what NOT to retry.

| # | Step | Function | Assert |
|---|---|---|---|
| 1 | Consent screen shown before any Aadhaar entry | UI | The wording names ABDM and is the same string stored on the artefact |
| 2 | Aadhaar entered, OTP requested | `abdm-request-otp` | 200 + a `txnId`. **If it times out, do NOT retry blind** — a second request may have already been accepted |
| 3 | OTP entered, ABHA created | `abdm-verify-otp` | 200, profile carries a 14-digit ABHA number. **This is the step that consumes quota** |
| 4 | Mobile verification for a non-Aadhaar number (§3.4) | `abha-enrol-mobile-request-otp` → `abha-enrol-mobile-verify` | OTP lands on the SECOND phone, not the Aadhaar one |
| 5 | ABHA address suggestions (§3.6) | `abha-address-suggestions` | A non-empty list |
| 6 | ABHA address claimed | `abha-address-create` | The chosen address comes back and is stored |
| 7 | Card / QR | `abha-get-card` | QR renders; the composed card shows number, address, DOB, gender (CRT_ABHA_114) |
| 8 | Consent + link | `abha-link-patient` | Artefact written with `authMethod: 'aadhaar-otp'` |
| 9 | `VRFY_ABHA_101` — verify by ABHA **number** via Aadhaar OTP | fetch flow, `otpSystem: 'aadhaar'` | Returns the ABHA just created. **Consumes no quota** |

Steps 1–8 are one continuous flow; step 9 is separate and safe to repeat.

## Failure rules

- **A timeout is not a failure — it is an unknown.** Check whether the ABHA was
  created (search by the Aadhaar-linked mobile, which consumes nothing) before
  retrying anything at step 2 or 3.
- **Never retry step 3 on a 5xx** without first searching. That is the single
  most expensive mistake available in this flow.
- A 4xx at step 3 is safe to correct and retry — ABDM rejected it, so nothing
  was created.

## Record for each step

`requestId`, HTTP status, and whether an SMS actually arrived and on which
phone. The last one is the part nobody writes down and the part that explains
the next failure.

## After the run

- Note the remaining creation quota if ABDM exposes it; otherwise track our own
  count in this file.
- Update `m1-functional-test-coverage.md` §5 from ⚠️ to ✅ for CRT_ABHA_101–115
  and VRFY_ABHA_101.
- If step 4's OTP arrives on the Aadhaar phone rather than the second one, that
  is a real finding — the whole point of §3.4 is that they differ.
