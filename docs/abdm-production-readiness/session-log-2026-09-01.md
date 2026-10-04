# ABDM Work Log — 2026-09-01 — **RESUME POINT**

Read this first. `session-log-2026-08-26.md` is the previous resume point and
its **gotchas are still authoritative**; its *status* is not.

---

## 1. What changed today, in one line

**HFR Software Linkage completed** — the HIP ID is real — and **M1 is code-complete
except the Aadhaar creation run**.

---

## 2. Live environment — corrected and verified

```
Supabase project   kiezgfhonvwryxpubfvl  (Clinic_suite_india, ap-south-1)
Custom domain      clinic.anprohealthtech.com
Clinic row id      e9106ae7-98b5-44a5-9f57-98c480b34f30
Bridge ID          SBXID_027467   (Anpro Solutions pvt ltd)
HFR facility id    IN2410002622
HIP ID             IN2410002622   <-- CONFIRMED, no longer provisional
HIP name           Meditrust Clinics   (17 chars — see §5)
Counter code       1              (category OPD on the portal QR)
HPR ID             71-6118-7122-5361
Callback base      https://clinic.anprohealthtech.com/functions/v1/abdm-callback
Test ABHA          91-5268-5170-0066 / 91526851700066@sbx (mobile 9909249725)
```

All four values are **written to `clinic_settings` and verified by query**, not
assumed.

`clinic_name` is `Meditrust Clinic Shela` while `abdm_hip_name` is
`Meditrust Clinics`. **That divergence is correct** — one is ours, the other is
what patients see in the ABHA app. Do not "tidy" them to match.

---

## 3. Two assumptions that were wrong

### Software Linkage was never gated on facility validation

The facility still reads **submitted, not validated**, yet linkage went through
and ABDM minted the HIP ID. We had been treating the whole M2 track as blocked
on that validation. It was not.

Unclear what validation still gates now that linkage has passed — **ask NHA
rather than assume**, which is the lesson repeating itself.

### The 15-character `hipName` cap does not hold on the portal

`Meditrust Clinics` is 17 characters and the portal accepted it. The cap in the
HFR API documentation (`m2-prerequisites.md` §10) is either API-route-specific
or unenforced.

This mattered: `20260826000000_clinic_hfr_identity.sql` constrained
`abdm_hip_name` to `{1,15}`, which would have **rejected the value ABDM itself
holds**. `20260901000000_hip_name_length.sql` raises it to 50. The column exists
to mirror ABDM's record; a constraint forbidding ABDM's own value is worse than
no constraint. The earlier plan to use `Meditrust Shela` is moot.

---

## 4. M1 — what was built today

Everything below is written and **typechecks clean** (`tsc` on the frontend,
`deno check` on the functions). None of it has been exercised through the UI
against sandbox yet — that is the first job next session.

### The five proven functions are finally reachable

`abha-address-*` and `abha-fetch-*` were proven at the API on 2026-08-27 and
callable by nothing. `ABHAVerifyModal` now opens on a **method picker**:

| Route | Spec | Tests |
|---|---|---|
| Mobile number | 7.4 | VRFY_ABHA_201 |
| ABHA address | 14.1 / 14.2 | VRFY_ABHA_102, 202 |
| Find & verify | 7.6.1 / 7.6.2 | VRFY_ABHA_301-305, 401-405 |

One consent step, one artefact, one card, shared across all three — three copies
of the consent wording is how consent text drifts between paths.

Design decisions worth not re-deriving:

- **The OTP route picker is driven by ABDM's `authMethods`, not ours.** An empty
  list means ABDM said nothing, so both routes are offered; a non-empty list
  with no OTP route in it means ABDM said something real (password /
  demographics) and no OTP button should be invented.
- **`blockedAuthMethods` is displayed** so the desk can explain *why* a route is
  unavailable rather than just failing.
- **`authMethod` on the consent artefact records what the patient PROVED**, not
  which screen they came from: an address verification completed by Aadhaar OTP
  is stored as `aadhaar-otp`.
- The search handle and the OTP handle are **separate state** in the fetch flow.
  Requesting an OTP mints a new session and leaves the search one claimable,
  which is what allows going back to pick a different family member.

### A real bug this surfaced

`handleConfirmAccount` fell back to `kycVerified: chosen?.kycVerified ?? false`
when Get Profile did not answer — asserting ABDM had said the ABHA is **not**
KYC-verified when ABDM had said nothing. The exact false negative the 08-27
notes warned about, sitting in the *oldest* flow rather than the new ones.

Now `?? null`, and the consent screen renders three states: Verified / Not
verified / **Not stated by ABDM**.

### CRT_ABHA_114 without ABDM's card endpoint

`ABHACardPanel` composes the card from the verified profile plus the QR that
works. `/abha-card`'s 401 no longer touches M1; its output is used only if it
ever starts arriving.

Preview and print share **one markup builder** — two copies drift, and the first
anyone notices is a printed card disagreeing with what the operator approved on
screen. Values are escaped before interpolation. Where a flow returns no
demographics (the address route returns identity only) those rows are **omitted
rather than faked**, which still satisfies CRT_ABHA_115.

### The misleading 502

`'ABDM returned no ABHA details'` was an `AbdmUpstreamError` with status 502,
rendering as *"ABDM is unavailable right now"*. That is a lie — ABDM replied,
our parsing failed — and it sent one investigation hunting a sandbox outage.

New `AbdmResponseShapeError` in `_shared/abdmSession.ts`, mapped in
`errorResponse` **before** `AbdmUpstreamError`, to a 500 saying the fault is
ours and to report the request id.

---

## 5. Files touched today

**New:**

| File | What |
|---|---|
| `supabase/migrations/20260901000000_hip_name_length.sql` | hipName cap 15 → 50. **APPLIED** |
| `docs/abdm-production-readiness/hfr-registered-identity.sql` | the hand-run UPDATE. **APPLIED and verified** |
| `docs/abdm-production-readiness/m1-creation-path-test-plan.md` | the last M1 gap, planned |
| `docs/abdm-production-readiness/session-log-2026-09-01.md` | this file |

**Changed:**

- `src/components/Patients/ABHAVerifyModal.tsx` — rewritten, three routes
- `src/components/Patients/ABHACardPanel.tsx` — composes the card, takes `profile`
- `src/components/Patients/ABHALinkModal.tsx` — passes `profile` to the panel
- `src/services/abhaService.ts` — six new methods, `index` on `ABHASearchHit`
- `supabase/functions/_shared/abdmSession.ts` — `AbdmResponseShapeError`
- `supabase/functions/_shared/abdmHttp.ts` — maps it before the upstream case
- `supabase/functions/abha-address-verify/index.ts`, `abha-fetch-verify/index.ts`
- `docs/.../m1-functional-test-coverage.md` §5 refreshed, §9 added
- `docs/.../m4-nhpr.md`, `README.md` — linkage outcome and status

---

## 6. Next actions, in order

1. **Deploy all 21 ABDM functions** — not just the two edited. The change is in
   `_shared/abdmSession.ts` and `_shared/abdmHttp.ts`, which every one of them
   bundles at deploy time.

   ```bash
   for fn in supabase/functions/ab*/; do
     supabase functions deploy "$(basename "$fn")"
   done
   ```

   `abdm-callback` takes `verify_jwt = false` from `config.toml` (it is called by
   ABDM, which carries no Supabase JWT). **Every other ABDM function keeps JWT
   verification** — do not pass `--no-verify-jwt` to them.

2. **Smoke-test the three routes through the UI.** Patients → open a saved
   patient → ABHA box → "Verify existing ABHA". Unlink between routes to reset.
   Watch for: the KYC line never reading "Not verified" wrongly; the route
   picker offering only what ABDM returned; the composed card rendering and
   printing identically.

   Rate limit is **5 per target per hour** per action
   (`20260820000000_abdm_phase0_hardening.sql:121`). If a 429 appears, wait —
   **do not re-add the 5→500 testing override.**

3. **The Aadhaar creation run** — the last M1 gap. Read
   `m1-creation-path-test-plan.md` first; the 100-creation cap is permanent and
   a fumbled retry burns it.

4. **M2 discovery** — `care-context/discover` → `on-discover`. Not written.
   `abdm-callback/index.ts` ROUTES still covers only `on-generate-token` and
   `on-add-contexts`. Held deliberately until the M1 smoke test passes, so a bug
   in today's UI work is fixed before new work lands on top of it.

5. **Care-context linking test** — `abdm-link-carecontext` is built and never
   run; the HIP ID was the missing piece and now exists. Choose the test patient
   deliberately: **care contexts can never be unlinked** (FAQ Q33).

---

## 7. Still open with NHA

Unchanged from 26-08 apart from one addition:

1. `/v3/profile/account` 401s with an empty body while `qrCode` works on the
   same X-token. Put it as **"profile enrichment fails across all three flows"**,
   not as one endpoint.
2. Is scan & share required for an HMIS at M1, or only M2?
3. **Do sandbox test Aadhaar numbers exist?** Every flow proven so far used a
   real identity. This gates how the creation run is done and is worth an answer
   before burning the first of 100 creations.
4. What does facility *validation* still gate, now that Software Linkage has
   already completed without it?

---

## 8. Unfinished business carried forward

- **Nothing is committed.** Everything from 26-08, 27-08 and today is untracked
  or modified in the working tree.
- **Rotate `drpranav@thedoctorpreneuracademy.com`'s password** — still
  outstanding from 26-08, still passed in plain text through those sessions.
- **`20260826010000_normalise_abha_numbers.sql`** — only the ALTERs were
  confirmed run. Verify the CHECK constraint exists on Mumbai.
- **Decode the portal's scan-and-share QR.** The Manage QR dialog shows a
  **Category** field (`OPD`) that `scanAndShareService.ts` does not emit at all,
  and the QR would also settle the `hipId` vs `hipid` casing question we hedge
  by emitting both spellings. One scan of that QR resolves both. Not yet done.
- **G-14 handoff pack** and **STQC/CERT-In agency shortlisting** — both calendar
  time, both still unstarted, and the audit + VAPT gate M4.

---

# Addendum — M2 entry, same day

M1 was smoke-tested through the UI and everything from §4 was committed and
pushed. What follows is the start of M2.

## 9. Live state, re-probed rather than read off §4

Two status lines above were already stale within the day:

- **`abdm_care_contexts` and `abdm_link_tokens` exist on Mumbai.**
  `m2-prerequisites.md` §11 still says "NEEDS RUNNING". It was run.
- **All 21 ABDM functions are deployed**, `abdm-callback` included. An unsigned
  POST to it returns `{"error":"Rejected"}` — its own callback auth, not a
  gateway 401 — so `verify_jwt = false` is live and the door is failing closed.

Probe recipe that needs no service-role key: a POST to a deployed function
returns 401, a non-existent one returns 404. For tables, the anon key
distinguishes `42501` (exists, RLS denies) from `PGRST205` (no such table).

## 10. ############ THE CLI IS LINKED TO THE WRONG PROJECT ############

`supabase/.temp/project-ref` and `linked-project.json` both read
**`nxbzrpmlnlvknmutyher` — the decommissioned Sydney project**, and
`supabase projects list` marks Sydney as the linked one.

So the deploy loop in §6.1 above, **as written, deploys to Sydney.** Every
`supabase` command run from this repo without an explicit ref does.

Always pass the ref:

```bash
supabase functions deploy <name> --project-ref kiezgfhonvwryxpubfvl
```

Not re-linked deliberately — an explicit ref on every command is harder to get
wrong than a hidden state file that already pointed at the wrong project once.

## 11. The UI for M2, built

`abdm-register-callback` and `abdm-link-carecontext` were written on 26-08 and
had **no caller anywhere in `src/`**. They could only ever have been driven by a
hand-assembled curl — which, for an operation with no undo, is the wrong
instrument.

**New — `supabase/functions/abdm-care-context-status/index.ts`.** Read-only:
what a link attempt *would* announce, what is already recorded, whether a link
token is cached. Writes nothing, calls ABDM nothing.

Kept as its own function rather than a mode on `abdm-link-carecontext`, and the
reason is the whole point: that function's contract is that calling it changes
something permanently. A read behind the same door invites a UI that renders a
page by calling the endpoint that announces care contexts to the national
registry.

**New — Settings → ABDM / ABHA** (`src/components/Settings/AbdmSettings.tsx`):

1. ABDM's identity for this clinic, read-only. It is ABDM's record, not ours.
2. The callback URL, prefilled from this deployment and diffed against it, with
   the bridge-wide warning and the doubling trap stated on screen rather than
   in a comment nobody reads at the moment they press the button.
3. The scan-and-share counter QR, with print.

**New — `src/components/Visits/VisitAbhaLinkPanel.tsx`**, on `VisitDetails`,
only for patients who actually hold an ABHA. It names the ABHA address, shows
the patient-facing label of every care context that would be announced, says
whether a link token is cached, and puts all of that *in front of* a confirm
step that states the link cannot be undone. A 202 is reported as "ABDM
accepted", never as "shared" — the callback is what makes it true.

Also: `visitService` now carries `abha_*` through on the joined patient, so a
visit can tell whether ABDM applies without a round trip per visit opened.

`vite build` passes. The new files add no TypeScript errors of their own (the
repo's ~1200 pre-existing ones are a broken `Database` generic, unrelated).

## 12. Next actions, revised

1. **Deploy the new function** — with the explicit `--project-ref` from §10.
2. ~~**Confirm the bridge's callback URL.**~~ **DONE 2026-09-01**, from the new
   Settings panel — and it appears to have been the first time it was ever set.

   ```
   PATCH {gateway}/gateway/v3/bridge/url   -> { "registered": true, "env": "sandbox" }
   url        https://clinic.anprohealthtech.com/functions/v1/abdm-callback
   bridge     SBXID_027467
   requestId  431f3ebf-609b-454c-850d-4f86e0c5f8d2
   ```

   This proves ABDM **accepted** the URL. It does not prove ABDM **delivers** to
   it — only an inbound callback does that, which is why 3 below comes next and
   not after something rate-limited.
3. **Scan-and-share as the pre-flight, before anything rate-limited.** A patient
   scanning the counter QR produces an inbound callback that costs no quota and
   can be repeated. It proves registration, ABDM's signature verification and
   dispatcher routing in one go. **No ABDM callback has ever been verified
   end-to-end here** — every M1 flow is request/response — so `on-generate-token`
   would otherwise be the first one ever, at the exact moment a mistake is
   expensive. It also settles the `Category` field and the `hipId`/`hipid`
   casing question left open in §8.
4. **Then the care-context link**, on a deliberately chosen patient. Permanent.
5. **Fidelius reference vector.** The spike proved the chain round-trips on
   Deno; it has never been run against a Fidelius CLI vector. Until it is,
   "M2/M3 stay on Edge Functions" is a plan, not a fact.
6. **The remaining six HI types.** ImmunizationRecord and WellnessRecord have no
   source data in the app at all — a product decision before a coding one.

---

# 2026-09-02 — first live callback exchange

## 13. Discovery works, in both directions

`abdm-callback` verified an inbound ABDM JWT, matched the patient, and ABDM
accepted our reply. **This is the first complete callback round trip this
integration has ever done** — every M1 flow is request/response.

The path ABDM actually uses, observed rather than read off the spec:

```
/abdm-callback/api/v3/hip/patient/care-context/discover
```

`handleDiscover` (`_shared/callbacks/discover.ts`) answers on
`/user-initiated-linking/v3/patient/care-context/on-discover`.

## 14. ############ THE SPEC'S hiType ENUM IS WRONG ############

The M2 document §5.3.3 documents the discovery hiType enum as **UPPERCASE**
and **without `Invoice`**. Sending exactly that is rejected:

```
ABDM-9999 "Invalid HIType, it must be in Prescription,DiagnosticReport,
OPConsultation,DischargeSummary,ImmunizationRecord,HealthDocumentRecord,
WellnessRecord,Invoice"
```

The real enum is **CamelCase and includes Invoice** — which is
character-for-character our own `HiType` union, so the value now passes
through unchanged.

Confirmed against sandbox 2026-09-02. **Believe the gateway, not the document.**
This is the third time a written ABDM constraint has failed to hold on the live
system (after the 15-char `hipName` cap and the facility-validation gate).

**Resolved:** the 1–20 care-context cap is **per patient entry, not per reply.**
A reply carrying 29 across two entries (20 OPConsultation + 9 Prescription) was
accepted 202 and rendered in the PHR. The per-entry cap in `discover.ts` is the
correct place for it.

**PHR rendering note.** The sandbox PHR lists one row per care context but
labels each with the *patient* entry's `referenceNumber` and `display` — so the
patient sees our internal patient UUID repeated 29 times, and the per-context
`display` ("OPD Consultation - 2026-08-28") is never shown. Our payload is
spec-correct; this is the PHR's rendering. Worth revisiting whether
`patient.referenceNumber` should carry something less internal than a UUID,
since it is evidently patient-visible.

## 15. `abha-link-patient` audited success without writing

Two `abha_link` audit rows from 26-08 read `success` while **no patient row in
the database carried an ABHA at all**.

Cause: **PostgREST reports no error when an UPDATE matches zero rows.** The
consent artefact is inserted first (deliberately), then the patient UPDATE runs
with `.eq(id).eq(clinic_id)`. If that matched nothing, `error` was null, the
function returned `{ linked: true }`, and the audit recorded success — while
the two records disagreed permanently. The only symptom was "no patient
matched" in a discovery callback, two weeks later and three layers away.

Now reads back with `.select('id')` and throws if nothing changed. **Any
Supabase UPDATE whose success matters needs this** — there are others in this
codebase that do not have it.

Re-linking through the UI on 2026-09-02 worked and is verified in the row:
patient `da0f5762-96c0-46a6-9d7a-bd89e465b14f`, `91526851700066@sbx`, bare-digit
ABHA number, consent recorded.

The composed ABHA card and QR also rendered from the verified profile — that is
**CRT_ABHA_114/115 evidence**, worth capturing for the functional test sheet.
