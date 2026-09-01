# ABDM / infra status check — 2026-08-25

Not a build session. This is a **verification pass against the live Mumbai
project**, written because the logs and the deployed reality had drifted a long
way apart. Read it before trusting the status lines in the older logs.

---

## 1. The older logs are stale. Here is what is actually true.

`session-log-2026-08-21.md` ends with "still nothing deployed and no SQL
executed". That has not been true for some days. Probed directly against
`clinic.anprohealthtech.com` today:

| Claim in the old logs | Actual state on 2026-08-25 |
|---|---|
| Database still in Sydney | ❌ **Mumbai.** `clinic.anprohealthtech.com` → `kiezgfhonvwryxpubfvl` (ap-south-1) |
| No ABDM migration ever run | ❌ **Applied.** `abdm_audit_log`, `abha_consent_artefacts`, `abdm_flow_sessions` all exist and answer |
| No functions deployed | ❌ **Deployed.** All 13 ABDM functions return 401 (auth required), not 404 |
| Four retired functions still to delete | ✅ **Gone.** `abdm-session`, `abdm-encrypt`, `abdm-fetch-profile`, `abdm-get-public-key` all 404 — they never existed on Mumbai |
| HIECM/HIP spec not held | ❌ **Held since 2026-08-21.** See §3 |

How this was checked, so it can be repeated:

```bash
# Which project is the custom domain in front of?
curl -sI https://clinic.anprohealthtech.com/rest/v1/ | grep sb-project-ref

# Deployed or not: 401 = exists, 404 = absent
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://clinic.anprohealthtech.com/functions/v1/<fn> -d "{}"

# Migration applied or not: 200 = column/table exists, 404/400 = missing
curl -s "https://clinic.anprohealthtech.com/rest/v1/<table>?select=<col>&limit=1" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

**Lesson worth keeping:** a status line in a log is a claim about the past.
Probe before planning off it.

---

## 2. Live defect found: pre-admission estimates cannot be saved

`ipd_documents.subject_context` **does not exist on Mumbai**:

```
{"code":"42703","message":"column ipd_documents.subject_context does not exist"}
```

But `documentService.ts:912` inserts into it on every pre-admission estimate
save, and `PreAdmissionEstimates.tsx` reads it back at lines 181 and 420. So
**saving a pre-admission estimate fails outright in production today.**

The cause is not a skipped migration. `20260820110000_pre_admission_estimates.sql`
is a single `BEGIN … COMMIT`, and its *other* column, `patient_id`, **is**
present — a transaction cannot half-apply. The only explanation that fits is
that an **earlier version of that file was executed**, and `subject_context`
(plus whatever else follows it) was added to the file afterwards and never
re-run.

That failure mode is specific to running migrations by hand in the SQL editor,
which is what the Mumbai runbook instructs. Nothing records which *version* of a
file was pasted.

**Fix:** re-run `20260820110000_pre_admission_estimates.sql` in full. It is
idempotent — `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`,
`CREATE INDEX IF NOT EXISTS` throughout — so a second run is safe.

**Then check the same way for every other migration edited after it was run.**
This one was caught because a column happened to be probed. Others may not have
been.

---

## 3. Scan-and-share is unblocked. The spec arrived on 2026-08-21.

`session-log-2026-08-21.md` was written at 00:13; the documents landed in
`abdm guidlines/` at 13:21 the same day. Its "Next #1: obtain the HIECM/HIP V3
spec" was answered hours after it was written, and `m2-prerequisites.md` (15:18)
already reflects that. The README, the roadmap and `api-inventory.md` did not,
and have now been corrected.

**`Scan_and_share_Document_03_03_25_8c48f696e0.pdf` (55pp, v1.0) contains every
piece the exclusion cited as missing:**

| Needed | Where |
|---|---|
| Gateway session / auth token | §3.2.1 — same `/api/hiecm/gateway/v3/sessions` we already call |
| **Keycloak certs (JWKS)** for verifying inbound callback JWTs | §3.2.2 OpenID config, §3.2.3 `/api/hiecm/gateway/v3/certs` |
| Callback base registration | §3.2.4 `PATCH /api/hiecm/gateway/v3/bridge/url` |
| Facility ↔ software linkage, bridge/service lookup | §3.2.5–3.2.7 |
| **Profile share** (the scan-and-share half of M1) | §4.3.1 `POST /api/hiecm/patient-share/v3/share` |
| Its inbound callback | §4.3.2 `{callback_url}/api/v3/hip/patient/share` |
| Response leg + its callback | §4.3.3–4.3.4 `/api/hiecm/patient-share/v3/on-share`, `{callback_url}/api/v3/hiu/patient/on-share` |
| Record share, scan-and-pay | §4.4, §4.5 |
| Error codes | §5 |

The QR the patient scans is just a URL carrying two parameters:

```
https://phrsbx.abdm.gov.in/share-profile?hipid=IN3410000260&counterid=12345
```

— the **HIP ID** and a **facility-defined context** (counter code). Generating it
needs no API call at all. What it needs is an **HIP ID**, which is the HFR
registration that is still not started (§5 below).

`M2_Document_16_02_2026` (v2.8, dated 13.02.2026) is broader still and covers
HIP-initiated linking (link token generation → care-context linking → notify),
user-initiated linking (discovery → init → confirm), the consent and data-flow
callbacks, **and** scan-and-share as its §7. It supersedes the scan-and-share
PDF where they overlap — it is a year newer.

**So the M1 scan-and-share exclusion is lifted.** The blocker is no longer
paper. It is HFR registration and the callback-hosting decision in
`m2-prerequisites.md` §B-1.

---

## 4. Fixed today: the `/r/*` stable-PDF redirect would have broken on next deploy

`netlify.toml` and `public/_redirects` both carried a `/r/*` rule with a
hardcoded project ref, and **they had drifted**: `_redirects` was repointed to
Mumbai on 2026-08-21, `netlify.toml` still said Sydney.

**Netlify applies `netlify.toml` redirects before `_redirects`**, so the Sydney
copy was the one that would win. The live site currently 302s to Mumbai on both
domains — the deploy in front of users is ahead of `HEAD`, which contains
neither rule — so nothing is broken *right now*. The next git-based deploy would
have silently sent **every stable PDF link already sent over WhatsApp** to the
old project, with no error anywhere to explain it.

The rule now lives **only in `netlify.toml`**, pointed at Mumbai.
`public/_redirects` carries a comment saying why it must not be re-added there.
`supabase-mumbai-migration-runbook.md` §4d named `_redirects` as the only home
for the rule and has been corrected.

---

## 4b. First ABDM smoke test — 2026-08-25 — **PASS**

**Test:** `abha-search` (find ABHA by mobile). Chosen because it sends no OTP
and creates no ABHA, so it costs nothing against the sandbox's 100-creation cap
while still exercising the entire chain.

**This is the first successful ABDM call this project has ever made.**

| Leg | Result |
|---|---|
| Password sign-in against Mumbai | OK |
| `authenticateCaller` - JWT -> profile -> clinic | OK |
| Rate limiter (30/actor/hr, 5/target/hr) | OK |
| **ABDM session token** - client id + secret | OK |
| **Certificate fetch + RSA-OAEP encryption** | OK |
| **ABDM search call** | OK |
| 404 -> `{found:false}` mapping | OK |
| **Execution region** | **`ap-south-1`** (`x-abdm-region` header) |

Evidence:

```
9876543210  -> found:true   xx-xxxx-xxxx-7482  Goda Pavani  F  kycVerified
8281147080  -> found:true   xx-xxxx-xxxx-5516  Girija V     F  kycVerified
7000000001  -> found:false  HTTP 200
6123456789  -> found:false  HTTP 200
```

`8281147080` returning "Girija V" confirms this is the same sandbox the docs
were written against - `girija@sbx` is the ABHA address in the FAQ's own sample
JWT.

**There is no credential problem.** `ABDM_CLIENT_ID` / `ABDM_CLIENT_SECRET` on
the Mumbai project are valid against `dev.abdm.gov.in`, and the whole crypto
path works on Deno in production, not only in the spike.

### The earlier 400 was the test number, not the system

A first run against the synthetic number `9999999999` returned HTTP 400
("ABDM rejected the request"). That was ABDM refusing an implausible number -
not our credentials and not our payload. Worth recording *why* it was not
diagnosable from the response alone, because it will happen again:

- `errorResponse` withholds the upstream body by design (G-03).
- `auditReason` records only `upstream_400`.
- ABDM answers invalid credentials with HTTP 400 too - verified directly against
  `dev.abdm.gov.in` with deliberately bad creds - so the status is genuinely
  ambiguous between "bad creds" and "bad input".

**The cheap discriminator, for next time: try several distinct numbers.** A
credential fault fails all of them identically; an input fault does not. That
took four calls and needed no logs, no service-role key and no dashboard access.

**Worth fixing:** ABDM rejecting a format-valid number with 400 rather than 404
means reception can type a wrong-but-plausible number and get "ABDM rejected the
request" instead of "no ABHA found" - only 404 is mapped to the friendly path.
Mapping a 400 on *search* to the same "not found" message would be kinder and
would hide nothing staff can act on.

### Two smaller notes from the run

- **The masking comment in `abha-search` is backwards.** It says numbers arrive
  as `91-5259-8743-XXXX`; they actually arrive as `xx-xxxx-xxxx-7482` - the
  *last* four visible, not the first. Harmless in itself, but reception matches
  patients on those digits, so anyone trusting the comment looks at the wrong
  end.
- **The empty `abdm_audit_log` read is not a bug.** The G-01 policy grants
  SELECT to `admin`/`super_admin` only and the test account is a Doctor. Rows
  are being written; that account cannot see them.

## 4c. Second smoke test — mobile-OTP login — **partial pass, one real bug**

Run against a live sandbox ABHA on a real mobile (owner consented, own number).
Smoke tests 1-3 of the 08-21 list.

| Step | Function | Result |
|---|---|---|
| 1 | `abha-login-request-otp` | **PASS** - real SMS delivered, ABDM echoed "ending with ******9725" |
| 2 | `abha-login-verify` | **PASS** - OTP accepted, account returned in full |
| 3 | `abha-login-verify-user` | **FAIL - HTTP 401** |
| 4 | `abha-get-card` | fails as a consequence (410) |

Step 2 returned a complete, correct record - full 14-digit ABHA number, the
`@sbx` address confirming sandbox, name, gender, DOB, `ACTIVE`, `kycVerified`.
The client received only an opaque `sessionId`: no `txnId`, no T-token, no
X-token. **G-02 holds in production.**

### The bug: the profile is fetched from the wrong endpoint family

The 401 is *not* where it appears. `abha-login-verify-user` has an explicit
`401/403 -> 410 "expired"` branch around the account-selection call, and the
response we got was the **generic** 401 from `errorResponse`. So the selection
succeeded and returned its X-token; the failure is the next line -
`fetchAbhaProfile`.

`abhaProfile.ts` calls `${cfg.abhaBase}/v3/profile/account`. **FAQ v1.4 Q21 says
that is the wrong API for a login-derived token**, and that the symptom of
getting it wrong is a misleading token error:

| Verification flow | Profile | Card |
|---|---|---|
| Aadhaar, ABHA Number, Find ABHA, and ABHA creation | `/v3/profile/account` | `/v3/profile/account/abha-card` |
| **Login-family tokens** | `/v3/phr/web/login/profile/abha-profile` | `/v3/phr/web/login/profile/abha/phr-card` |

The corroborating tell is in our own code: **`cfg.phrBase` is defined in
`abdmConfig.ts` for both environments and then used absolutely nowhere.** The
PHR family was modelled during Phase 1 and never wired up. `abha-get-card` has
the same defect - it uses `${cfg.abhaBase}/v3/profile/account/qrCode` and
`/abha-card`.

**Honest limit on this diagnosis:** Q21 is written about *ABHA-address*
verification, and its list of `/v3/profile/account` flows (Aadhaar, ABHA Number,
Find ABHA, creation) does not mention mobile login either way. Mobile login
living in the PHR bucket is an inference from the endpoint family
(`/v3/profile/login/...`) plus the unused `phrBase`. It is the strongest
available reading, not a quotation. **One deploy settles it.**

### Proposed fix

Select the endpoint by flow rather than hardcoding one family. The flow session
already records which it is (`mobile-login` vs `enrolment`), so the information
is present at the call site:

- `fetchAbhaProfile(cfg, accessToken, xToken, requestId, flow)` -> `phrBase`
  login-profile path for `mobile-login`, `abhaBase` for `enrolment`.
- Same switch in `abha-get-card` for QR and card.

Do **not** paper over it with a try-one-then-the-other fallback: the two
families return different token errors, and a silent fallback would turn a
precise 401 into an intermittent one.

### What this does and does not block

The OTP legs - the security-critical part, and the bulk of the primary OPD
path - work. What is broken is reading the profile back after selection, so
**ABHA verification cannot yet complete end to end**, and the card/QR cannot be
reached at all. Smoke tests 13 and 14 are untestable until this is fixed.

## 4d. Chasing the verify-user 401 — what was ruled out, and the one clue

Four more OTP cycles against the same consenting tester. **Not solved.** Written
up so the next attempt starts from the evidence rather than from scratch.

### Ruled out

| Hypothesis | Verdict |
|---|---|
| Profile lives on the PHR host (`phrBase`) for login tokens | **WRONG.** `phrBase` answered 400 on `abha-profile` and 404 on `abhaprofile`. FAQ Q21 is about ABHA-*address* verification only. Spec 7.4 and 7.6.1.3 both post to `/v3/profile/login/verify`, which is the ABHA family. |
| Wrong path spelling | No. Both spellings tried in one request. |
| `X-Token` vs `X-token` header casing | No. Deno normalises header names to lowercase on the wire, so both are identical. The retired `abdm-fetch-profile` (88f41e8) used the exact same `X-Token: Bearer <t>` against the exact same URL. |
| Our implementation diverges from spec 7.4 | No. Spec 7.4: `login/verify` -> 300s **T-token** + accounts; `login/verify/user` -> 1800s **X-token**; then 9.0 `/v3/profile/account`. That is precisely what the code does. |
| Credentials / session token | No. `abha-search` uses the same cached session token against the same `abhaBase` host and works. |

### The clue

A temporary diagnostic (since removed) returned the upstream body. It is
**empty**, with status 401:

```
_debugStatus: 401
_debugBody:            <- nothing at all
```

**That matters more than it looks.** ABDM application errors are JSON with a
code (`ABDM-1094`, `ABDM-9999`, ...). An empty 401 is a *gateway* rejection —
the request was refused before any ABHA service saw it. So there is no ABDM
error message to find, and **reading the dashboard logs will not help**: the
logged body is the same empty string.

### The strongest remaining hypothesis, and the cheap way to test it

Spec **7.6.1.3** (Find ABHA using Mobile) posts to the *same*
`/v3/profile/login/verify` with the *same* `["abha-login","mobile-verify"]`
scope, but its response carries the **X-token directly** (`expiresIn: 1800`) and
has **no verify/user step at all**. Spec 7.4 returns a **T-token**
(`expiresIn: 300`) and requires the selection step.

Two observations point at us being in the 7.6.1.3 shape, not 7.4:

1. Spec 7.4's `accounts[]` shows a **masked** `ABHANumber`
   (`91-2568-7073-XXXX`). Ours came back **unmasked** (`91-5268-5170-0066`).
2. If step 2 already handed us an X-token and we then spend it as a T-token on
   `verify/user`, a gateway-level empty 401 on the following profile call is
   exactly the shape of failure you would expect.

**One field settles it: `expiresIn` on the `login/verify` response.** 300 means
T-token and spec 7.4 is right; 1800 means X-token and `verify/user` should be
skipped entirely when the mobile resolves to a single account. It is not
currently read or stored.

Cheapest next step: surface `expiresIn` from `abha-login-verify` (it is not
sensitive - it is a duration), one OTP, done.

### Housekeeping from this session

The diagnostic deliberately returned upstream ABDM bodies to the client, which
is exactly what G-03 forbids. **It was reverted and all four functions
redeployed from the committed tree** (`git checkout HEAD -- ...` then deploy),
so nothing of it survives in production or in the working tree. Preferred
approach - gating it behind an `ABDM_DEBUG_UPSTREAM` secret - was not available:
`supabase secrets set` was refused by the local permission layer.

## 4e. Mobile-OTP verification — where it actually stands

**Working, proven against a live sandbox ABHA:** OTP request, OTP verification,
account resolution. **Blocked:** the profile read that follows, and therefore
the card and QR.

### Settled by measurement, not inference

- **`tokenExpiresIn` = 300.** So `login/verify` returns a **T-token** and this
  is spec **7.4**, not 7.6.1.3. `verify/user` genuinely is required, and the
  implementation follows the spec correctly. The 7.6.1.3 theory is dead.
- **`verify/user` succeeds** and returns a token.
- **`GET /v3/profile/account` refuses everything**, with an **empty-bodied 401**.
  Tested in one request: the `/verify/user` token and the `login/verify` token,
  each as `Bearer <t>` and as a bare token — **four combinations, all refused.**
- **Adding `abha-profile` to the login scope does not help** — `request/otp`
  rejects that combination with a 400 before an OTP is even sent. That scope
  belongs to profile-management flows that already hold an X-token.

### What that leaves

The failure is **not** the URL, the host, the path spelling, the header name,
the header format, the token choice, the scope, or the credentials — every one
of those has been eliminated by test. `abha-search` proves the same session
token works against the same `abhaBase` host.

An empty-bodied 401 from a gateway, on a correctly-formed request, most likely
means **this client ID is not entitled to `/v3/profile/account` on sandbox**.
That is an NHA-side question, not a code change. **Raise it with ABDM
Integration Support**, quoting: mobile-OTP login (7.4) completes, `verify/user`
returns a token, and 9.0 Get Profile returns 401 with an empty body.

### The design change worth making regardless

**The profile call is redundant here.** `login/verify` already returns
everything `AbhaProfile` holds — ABHA number, address, name, gender, DOB,
status, `kycVerified` — for the very account being selected. Only
`mobileMasked` is absent, and that is the number the desk just typed.

Failing an entire ABHA verification because an optional re-fetch of data we
already hold was refused is the wrong behaviour for a front desk. **Build the
profile from the selected account, and treat 9.0 as enrichment**: if it answers,
prefer it; if not, proceed and still retain the X-token for the card.

That needs the account list to survive step 2 -> step 3, and
`abdm_flow_sessions` has no JSONB column for it. **One small migration**
(`ADD COLUMN accounts jsonb`) plus reading it back in `verify-user`. Not done
here: it needs SQL executed against production, which is the owner's call.

This would unblock verification today, independently of whatever NHA say.

## 4f. Verification completed end to end — and G-13 verified

### The fix that unblocked it

Get Profile (spec 9.0) is now **enrichment, not a gate**. `login/verify` already
returns the whole account — ABHA number, address, name, gender, DOB, status,
`kycVerified` — so Get Profile adds only `mobileMasked`, which is the number the
desk just typed. Refusing to complete a verification ABDM has already performed,
because an optional re-fetch of data we already hold was declined, is the wrong
behaviour for a front desk.

`verify-user` therefore returns `profile: null` on refusal and the client falls
back to the selected account. The audit row records
`profile_enrichment_unavailable` so the trail shows which verifications ran
without it — identity is still confirmed by the OTP and the account selection.

### The 401 diagnosis was WRONG, and the QR proves it

§4e concluded the client ID was probably not entitled to `/v3/profile/account`.
**That is not the case.** With the same X-token, same host, same
`X-token: Bearer …` header, in the same request:

```
GET /v3/profile/account/qrCode     -> 200, a real 20 KB PNG      ✅
GET /v3/profile/account            -> 401, empty body            ❌
GET /v3/profile/account/abha-card  -> refused                    ❌
```

A sibling endpoint under the same path prefix accepts the token happily. So the
token, the credentials, the host, the header and our request construction are
**all correct**, and the refusal is specific to those two endpoints. That is a
far sharper thing to put to NHA than "we get a 401".

### Smoke test results — 2026-08-26

| # | Test | Result |
|---|---|---|
| — | Find ABHA by mobile (7.6.1) | ✅ |
| 1 | Mobile OTP request | ✅ real SMS, ABDM echoed the masked number |
| 2 | OTP verify + account picker | ✅ full account, `tokenExpiresIn` 300 |
| 3 | Account selection / verification | ✅ completes |
| 13 | QR code renders | ✅ |
| 13b | ABHA card renders | ❌ ABDM refuses |
| 14 | Session TTL lapse -> "verify again" | ✅ observed repeatedly |
| **15** | **Unlink revokes, never deletes** | ✅ see below |
| **16** | **Re-link after withdrawal** | ✅ second artefact created, first stays revoked |

**G-13 in full**, against a temporary patient since deleted:

```
link    -> abha_number 91526851700066 (mask stripped to 14 digits)
           artefact written, revoked_at null
unlink  -> abha_number/address/linked_at cleared, consent_given false
           artefact NOT deleted: same id, revoked_at + revoked_by set
           mobile_verified deliberately LEFT true
re-link -> a second artefact; the first stays revoked
```

Every documented intention held: the mask is stripped before storage, the
artefact survives withdrawal, `mobile_verified` persists because the mobile
really was verified and that fact does not depend on the link.

### Not tested, and why

**The Aadhaar creation path (1.3-1.5) remains unexercised.** It needs an Aadhaar
number, which should not be pasted into a chat transcript, and the tester's
Aadhaar already carries an ABHA so creation would only return "already exists".
Run it locally against a sandbox test Aadhaar. Note the **100-creation cap per
client ID** (`ABDM-1227`).

## 4g. Scan-and-share — built 2026-08-26

Facility registered: **`IN2410002622`** (Meditrust Clinic Shela), stored in
`clinic_settings.hfr_facility_id` via `20260826000000_clinic_hfr_identity.sql`.
HIP ID still to be confirmed after Software Linkage — expected to be the same
string, since a facility's *first* bridge gets a HIP ID equal to its HFR id
(FAQ Q24), but a second bridge would make it `IN2410002622_1`.

### Outbound half — done

`src/services/scanAndShareService.ts`. The QR needs no ABDM call: it is
`{phr_host}/share-profile?hipid=<hip>&counterid=<code>`, so this is string
building plus `qrcode`, which the project already depends on.
`checkScanShareReadiness()` refuses to render when the HIP ID is missing or
malformed and says *what* is missing — "registered but bridge not linked" and
"not registered at all" are weeks apart operationally, and a QR that scans into
a dead end inside a patient's app leaves no trace on our side.

**Testing note that cost some confusion: the production ABHA app cannot scan a
sandbox QR.** `phrsbx.abdm.gov.in/share-profile` 301s to
`/phr/v3/share-profile`, the sandbox PHR **web** app. Test by opening that URL
in a browser and logging in with a sandbox ABHA — a phone camera works, the
ABHA app does not.

### Inbound half — built and deployed

`supabase/functions/abdm-patient-share/` — spec §4.3.2, `verify_jwt = false`.

**This is the only inbound ABDM route in the project, and the only endpoint a
stranger can reach that writes patient records.** Its defence is
`_shared/abdmCallbackAuth.ts`: every request must carry an ABDM-signed JWT that
verifies against ABDM's JWKS before the body is used for anything.

**Gotcha worth recording: ABDM's JWKS is not public.** Both
`{gateway}/v3/certs` and `.well-known/openid-configuration` answer **401**
without a session token (verified on sandbox). So `createRemoteJWKSet`, which
fetches anonymously, cannot be used at all — it would fail on every callback.
We fetch the key set with the gateway token, cache it 6h in-isolate, and verify
against a *local* JWKS. Consequence: verifying an inbound call requires an
outbound authenticated one, so an ABDM session outage costs us shares rather
than safety — we refuse rather than trust.

Shape of the handler, both parts deliberate:

1. **202 first, work after.** ABDM's callback timeout is short and a patient is
   at the counter. Matching, registration and the reply all happen after the
   response is sent.
2. **The reply is a separate outbound call** to §4.3.3 `patient-share/v3/on-share`,
   not the response body. ABDM correlates on `requestId`.

Matching is on **ABHA number only**, with phone as no more than a hint: families
share mobile numbers, and merging two patients' records is far worse than
creating a duplicate.

Scan-and-share is treated as consent in itself — the patient acted from their
own ABHA app on their own device against a KYC'd identity — recorded as an
artefact with `auth_method: 'qr-scan'`, reusing the existing vocabulary rather
than inventing a spelling that would silently drop out of an auditor's filter.

**Spec erratum:** §4.3.3's parameter table describes `expiry` as "Patient year
of birth". It is the token's validity in minutes; the spec's own sample sends
`600`.

### Verified today

| Check | Result |
|---|---|
| Unsigned callback | ✅ 401, body `{"error":"Rejected"}`, no detail |
| Forged bearer token | ✅ 401, identical response |
| Anything written by either | ✅ nothing — no patient row created |

### Callback registration — built, not yet run

`supabase/functions/abdm-register-callback/` wraps §3.2.4
`PATCH {gateway}/v3/bridge/url`. Admin-only: registering a callback redirects
where ABDM sends patient data for the **whole bridge**, every clinic on it, so a
single clinic's Doctor must not be able to change it.

It refuses, rather than registers, a URL that already contains an ABDM callback
path. That is FAQ v1.4 Q30 and the most reported ABDM integration failure:
register a full endpoint, ABDM appends its own path again, and callbacks
silently stop arriving with nothing in any log to explain it.

**The base to register:**

```
https://clinic.anprohealthtech.com/functions/v1/abdm-patient-share
```

**Verified 2026-08-26** that Supabase routes `/functions/v1/<name>/<anything>`
to `<name>`: a POST to
`.../abdm-patient-share/api/v3/hip/patient/share` returned the function's own
`{"error":"Rejected"}` 401, not a platform 404. So whatever ABDM appends still
lands on the handler, which ignores the path. No Netlify rewrite is needed.

**Blocked on:** an admin login. The test account (`drpranav@…`) is a **Doctor**,
and the role gate is correct as written.

## 5. What is actually pending

**Code / config**

1. **Re-run `20260820110000_pre_admission_estimates.sql`** — §2. Production bug.
2. **Audit the other migrations for the same drift** — any file edited after it
   was pasted into the SQL editor. §2 gives the probe.
3. `abdm guidlines/` is untracked (6 documents, ~14 MB). Decide whether NHA
   specs belong in the repo at all — they are large, not ours, and versioned by
   NHA. ~~Delete the stale root FAQ copy~~ **already done**: the root-level
   `abdm.pdf` is staged as deleted and the 27.05.2025 FAQ copy is gone.
   `m2-prerequisites.md` §1 still asks for this; it is complete.
4. **144 uncommitted paths.** Nothing has been committed since 2026-08-18
   (`37cc13f`), and the live deploy is ahead of `HEAD`. There is no commit
   anywhere that reproduces what is running in production.

**Not code — and these are now the real M1 blockers**

5. **HFR registration.** Still not started — and now the single thing standing
   between us and scan-and-share. **The "per-clinic HIP ID" decision it was
   waiting on is already answered by FAQ v1.4 Q24–Q26** and needs no debate:
   each clinic registers its own facility, our one Bridge ID links to all of
   them, and ABDM mints one HIP ID per (facility × bridge) pair. See
   `m2-prerequisites.md` §6.
6. **Callback hosting decision** — `m2-prerequisites.md` §B-1. Supabase Edge
   Functions expose no firewall config, and ABDM requires IP-whitelistable
   callbacks from three NAT IPs. The database move to Mumbai addressed residency
   but not whitelisting.
7. **G-14 handoff pack** — architecture diagram, role/access matrix, staging
   URLs, test-account sheet. `pre-audit-checklist.md` still predates all the
   2026-08-20 work.
8. **Sandbox smoke tests 1–16** from the 08-20 and 08-21 logs. Still none run,
   and now they *can* be — the functions are deployed. Note the sandbox cap:
   **100 ABHA creations per client ID** (`ABDM-1227`), so prefer the mobile-OTP
   path, which creates nothing.
