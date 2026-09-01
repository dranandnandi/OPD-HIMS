# ABDM Work Log — 2026-08-26 — **RESUME POINT**

Read this first, then `session-log-2026-08-25.md` for the M1 testing detail.
Everything older is superseded on status (though its design notes still stand).

---

## 1. Where the project actually is

**M1 is proven end to end against ABDM sandbox** with a real ABHA on a real
mobile. Not "written and type-checked" — actually exercised:

| Capability | State |
|---|---|
| Session token, RSA-OAEP encryption on Deno | ✅ proven |
| Find ABHA by mobile (7.6.1) | ✅ proven |
| Mobile-OTP login → account picker → verification (7.4) | ✅ proven |
| QR code (§10) | ✅ proven — real PNG returned |
| Link / unlink / re-link, consent artefacts (G-13) | ✅ proven |
| Get Profile (§9), ABHA card (§11) | ⚠️ **ABDM refuses** — see §3 |
| Scan & share | ⚠️ built both halves; round trip never run — see §3 |
| Aadhaar creation path (1.3–1.5) | ⚠️ built, deliberately untested |

Execution region is `ap-south-1` on every call, and no ABDM token has ever
reached a browser.

**M2 foundations exist but nothing is wired end to end.** Care-context and
link-token tables are live, FHIR bundling works, the callback door is open and
registered. No care context has been linked yet.

---

## 2. Live environment — verified facts, not assumptions

```
Supabase project   kiezgfhonvwryxpubfvl  (Clinic_suite_india, ap-south-1)
Custom domain      clinic.anprohealthtech.com
Clinic             Meditrust Clinic Shela  e9106ae7-98b5-44a5-9f57-98c480b34f30
HFR facility id    IN2410002622
HIP ID             IN2410002622   <-- PROVISIONAL, still unconfirmed
Callback base      https://clinic.anprohealthtech.com/functions/v1/abdm-callback
Test ABHA          91-5268-5170-0066 / 91526851700066@sbx  (mobile 9909249725)
```

**Do not trust status lines in docs — probe.** The recipe that works:

```bash
# which project is behind the domain
curl -sI https://clinic.anprohealthtech.com/rest/v1/ | grep sb-project-ref
# function deployed? 401 = yes, 404 = no
curl -s -o /dev/null -w "%{http_code}\n" -X POST .../functions/v1/<fn> --data '{}'
# migration applied? 200 = column exists, 400/404 = missing
curl -s ".../rest/v1/<table>?select=<col>&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $JWT"
```

**`supabase_migrations.schema_migrations` on Mumbai is EMPTY.** The restore
carried the schema but not the history. Consequences:

- **NEVER run `supabase db push`** — it would replay ~110 migrations against an
  already-populated database.
- Migrations are run by hand in the SQL editor, so nothing records *which
  version* of a file was applied. This already bit us twice today.

---

## 3. The three things blocked on NHA — one ticket

1. **`/v3/profile/account` and `/v3/profile/account/abha-card` return 401 with an
   EMPTY body**, while **`/v3/profile/account/qrCode` returns 200** — same
   X-token, same host, same header, same request. That rules out our request
   construction, the token, the header format and the credentials. Ask why.
2. **Is the ABHA card required for M1 certification?** Cannot be determined from
   the API spec; needs NHA's M1 functional-testing checklist.
3. **How is scan & share exercised on sandbox?** The PHR *web* app at
   `phrsbx.abdm.gov.in/phr/v3/share-profile` returns "Page not found" with valid
   params while logged in. Likely a mobile-app-only flow. Without an answer the
   round trip cannot be tested at all.

---

## 4. Waiting on the clinic (not code)

- **`hipName`** for HFR Software Linkage — **15 chars max**, no special
  characters, **patient-facing** (it is what shows in the ABHA app).
  `Meditrust Shela` is exactly 15. Once linked, confirm the HIP ID and replace
  the provisional value in `clinic_settings.abdm_hip_id`.
- **M4 / NHCX documentation** — we hold M1, M2, M3, HFR, Scan & Share, Running
  Token and the FAQ. **There is no M4 document at all.** M4 is unreachable
  until NHA provides it.

---

## 5. Built today

**Migrations — all three APPLIED to Mumbai:**

| File | What |
|---|---|
| `20260826000000_clinic_hfr_identity.sql` | per-clinic `hfr_facility_id`, `abdm_hip_id`, `abdm_hip_name`, `abdm_counter_code` |
| `20260826010000_normalise_abha_numbers.sql` | ABHA numbers to 14 bare digits. **Only the ALTERs were run; the `DO $$` block may not have** — the CHECK constraint was absent afterwards. Re-run the constraint if it still is |
| `20260826020000_abdm_care_contexts.sql` | `abdm_link_tokens`, `abdm_care_contexts` |

**Code:**

- `src/services/scanAndShareService.ts` — counter QR
- `supabase/functions/abdm-callback/` — **the single callback dispatcher**
- `supabase/functions/_shared/callbacks/` — `types.ts`, `patientShare.ts`,
  `onGenerateToken.ts`
- `supabase/functions/_shared/abdmCallbackAuth.ts` — ABDM JWT verification
- `supabase/functions/_shared/abdmLinkToken.ts` — link-token caching
- `supabase/functions/_shared/fhir/` — `bundle.ts`, `opConsult.ts`
- `supabase/functions/abdm-register-callback/` — bridge URL registration

**Everything above is deployed.** `abdm-patient-share` was deleted and replaced
by `abdm-callback` — do not resurrect it.

---

## 6. Gotchas found the hard way — do not re-derive these

1. **ABDM stores ONE callback base per bridge** and appends its own path for
   every flow. Per-flow functions are impossible. Hence one dispatcher.
2. **Register the BASE only.** Registering a full endpoint makes ABDM append
   again; callbacks then silently never arrive (FAQ Q30). `abdm-register-callback`
   refuses such a URL.
3. **Gateway APIs live under `/gateway`** — `{gatewayBase}/gateway/v3/bridge/url`,
   `/gateway/v3/certs`, `/gateway/v3/sessions`. But sibling families do **not**:
   `{gatewayBase}/patient-share/v3/on-share`, `{gatewayBase}/v3/token/generate-token`.
   Getting it wrong returns a 404 that ABDM renders as
   **"No matching ABHA record was found"**, which sends you hunting in the wrong
   place entirely.
4. **ABDM's JWKS is NOT public** — `/gateway/v3/certs` and even
   `.well-known/openid-configuration` answer 401 without a session token. So
   `createRemoteJWKSet` cannot be used; fetch authenticated, verify locally.
5. **The scan & share QR uses `hipId` / `counterId` (camelCase).** The spec's
   sample shows lowercase `hipid`/`counterid`; the PHR app bundle contains
   `"hipId"` and **zero** occurrences of `"hipid"`. We emit both spellings until
   production is confirmed.
6. **The PHR app is a Flutter SPA** — it returns HTTP 200 for *any* path and
   decides validity client-side. `curl` returning 200 proves nothing.
7. **Link tokens: 6-month validity, max 3 generate calls per ABHA per facility
   per day**, else a 24-hour block delivered on the callback. Always read cache
   first.
8. **Care contexts can never be unlinked** (FAQ Q33). A wrong link is permanent.
9. **`generate-token` returns a bare 202** — the token only ever arrives on
   `on-generate-token`. Linking is inherently two-phase.
10. **Spec erratum:** on-share's `expiry` is documented as "Patient year of
    birth". It is token validity in minutes; the spec's own sample sends `600`.
11. **HFR onboarding needs an HPR ID** (role "Facility Manager", created with
    Aadhaar/DL) before any facility API works. `hipName` ≤ 15 chars.
12. **Sandbox caps ABHA creation at 100 per client ID** (`ABDM-1227`). Prefer
    mobile-OTP paths, which create nothing.

---

## 7. Next actions, in order

1. **Discovery callbacks** — `care-context/discover` → `on-discover`. This is
   the patient-initiated linking path and the next real milestone step.
2. **Care-context linking** — `{gateway}/hip/v3/link/carecontext` plus its
   callback, using `abdmLinkToken.ts` and writing `abdm_care_contexts`.
3. **Consent notify + data flow** — `consent/request/hip/notify`,
   `health-information/hip/request`, data push. Needs **Fidelius** (the spike in
   `scripts/fidelius-spike/` runs on Deno; one CLI reference vector still
   unverified for wire compatibility).
4. **The six remaining HI types** — only OPConsultation and Prescription exist.
   All eight are mandatory for an HMIS (FAQ Q2).
5. **G-14 handoff pack** — architecture diagram, role/access matrix, staging
   URLs, test accounts. Required before an STQC/CERT-In agency will engage;
   `pre-audit-checklist.md` still predates all of this.

---

## 8. Housekeeping

- **Rotate `drpranav@thedoctorpreneuracademy.com`'s password.** It passed
  through the 2026-08-25/26 sessions in plain text repeatedly.
- The rate-limit testing override (per-target 5 → 500) **was removed** and
  redeployed. `_shared/abdmAuthz.ts` carries a comment saying to remove it again
  if re-added.
- The temporary G-03 diagnostic that returned ABDM error bodies to clients
  **was removed** and all functions redeployed from the committed tree.
- Nothing from today is committed. `git status` shows the new functions,
  migrations and docs as untracked.
