# M1 Functional Test — scope and coverage

Source: `abdm guidlines/new document/Copy_of_M1_ABHA_CREATION_AND_VERIFICATION_WITH_APIS_UPDATED_V1_2_7_Aug_1...xlsx`
(NHA, v1.2, 7 Aug). This is **NHA's own functional-test sheet** — the document
we had been inferring M1 scope from the API spec without. Written 2026-08-27.

**This supersedes our guesses about what M1 requires.** Several things we
thought were gaps are out of scope, and two things we had not built are
mandatory.

---

## 1. What applies to us

We are a **Private** entity integrating an **HMIS**. The sheet's "Applicable To"
column scopes whole sections:

| Section | Applicable To | Applies to us? |
|---|---|---|
| ABHA Creation via Aadhaar OTP | All | ✅ yes |
| ABHA Creation via Aadhaar Biometric | All | ⚠️ only if we offer biometric creation |
| ABHA Creation via Demo Auth / Offline | **Government** | ❌ **no** |
| ABHA Creation via Driving Licence / PAN | Optional for Private | ❌ no — confirms the earlier decision |
| ABHA Verification (all four sub-sections) | All | ✅ yes |
| Fetching ABHA details using Aadhaar Number | All | ✅ yes |
| Reading ABHA Info using ABHA QR Code | All (Optional) | ➖ optional |
| Profile Update | All (Optional) | ➖ optional |
| Tagging ABHA to a unique patient ID | All | ✅ yes |
| **Share Patient Profile** | **PHR app** | ⚠️ **see §4** |

**Two scope reductions confirmed in writing:** Demo Auth is Government-only, and
Driving Licence/PAN is Optional for Private. The decision to drop the Driving
Licence path was right, and Demo Auth was never ours to build.

---

## 2. The ABHA card is NOT a blocker

This was the open question, and the sheet answers it directly.

`CRT_ABHA_114` and `CRT_ABHA_115` are a **conditional pair**:

- **114** — *"If integrators is generating ABHA card"*. The card must show:
  ABHA Number (mandatory), user photo (**optional**), **ABHA QR code**, date of
  birth and gender, ABHA address.
- **115** — *"If integrators is **not** generating ABHA card"*. Then print
  **ABHA Number and ABHA Address** on your own program/scheme card, and store
  them against the HIMS beneficiary ID.

So a private integrator that does not call ABDM's card API satisfies M1 through
115 instead.

**And we can satisfy 114 anyway.** Every element it lists is already in hand:

| 114 requires | We have it from |
|---|---|
| ABHA Number | `login/verify` accounts payload |
| ABHA QR code | `/v3/profile/account/qrCode` — **works today** |
| Date of birth, gender | `login/verify` accounts payload |
| ABHA Address | `login/verify` accounts payload |
| User photo | optional — deliberately stripped for privacy |

**We do not need ABDM's `/abha-card` endpoint at all.** It returns a rendered
PNG; we can compose the same card ourselves from data we already hold plus the
QR that already works. The 401 on `/abha-card` therefore drops from "blocks
certification" to "cosmetic, and avoidable".

That leaves only **Get Profile** (`/v3/profile/account`) still refused — and
§4f already established that it is enrichment rather than a gate.

---

## 3. Mandatory tests we do NOT yet satisfy

Two real gaps, neither previously understood as mandatory:

### 3.1 ABHA **Address** verification — `VRFY_ABHA_102`, `VRFY_ABHA_202`

Mandatory, applicable to All. Verify an ABHA by its **address**
(`user@sbx`), via Aadhaar OTP *and* via mobile OTP. This is spec §14.1 on the
**PHR base URL** — the `phrBase` that is defined in `abdmConfig.ts` and used
nowhere.

Our roadmap listed this as item 1.12 "missing" without marking it mandatory.
It is mandatory.

**Note the irony:** this is the one flow for which FAQ Q21's
`login/profile/abha-profile` PHR endpoints genuinely are correct. The
`abha-address` family already stubbed in `abhaEndpoints()` exists for exactly
this and is currently unreachable.

### 3.2 Fetch ABHA details using **Aadhaar Number** — `VRFY_ABHA_401`–`405`

Mandatory, applicable to All. Spec §7.6.2 (Search ABHA using Aadhaar): search →
generate OTP → verify. We built §7.6.1 (search by **mobile**) and proved it; the
Aadhaar equivalent does not exist.

---

## 4. Scan & share may not be ours to demonstrate

`SHARE_PATIENT_PROFILE_701` is marked **Applicable To: PHR app** — the *patient
side* of the flow, where the user scans the facility's QR. We are the HMIS, i.e.
the receiving side.

That is consistent with what we hit on 2026-08-26: the sandbox PHR **web** app
would not serve `share-profile`, and the flow reads as mobile-app-first.

**Do not conclude scan & share is out of scope.** The receiving half is still an
HMIS obligation and is likely tested under M2, whose §7 covers it. What this
does change is urgency: it is probably not an M1 blocker, so it should stop
gating M1 sign-off.

**Add to the NHA ticket:** *is scan & share required for an HMIS at M1, or only
at M2?*

---

## 5. Coverage against the mandatory list

Kept current — last revised 2026-09-01.

| Test | Requirement | State |
|---|---|---|
| CRT_ABHA_101–113 | Aadhaar-OTP creation: option, consent, Aadhaar entry, OTP, resend, auth, mobile verification, suggested address, display number | ⚠️ **built, never tested** — 100-creation sandbox cap. **The only remaining M1 gap**; see `m1-creation-path-test-plan.md` |
| CRT_ABHA_114 **or** 115 | View/download ABHA details | ✅ **built** 2026-09-01 — composed locally from QR + profile, see §9 |
| VRFY_ABHA_101 | ABHA **Number** verification via Aadhaar OTP | ⚠️ built and reachable; **untested** — see `m1-creation-path-test-plan.md` |
| VRFY_ABHA_102 | ABHA **Address** verification via Aadhaar OTP | ✅ **proven** (§8), wired into the UI (§9) |
| VRFY_ABHA_201 | ABHA **Number** verification via mobile OTP | ✅ **proven** |
| VRFY_ABHA_202 | ABHA **Address** verification via mobile OTP | ✅ **proven** (§8), wired into the UI (§9) |
| VRFY_ABHA_301–305 | Fetch ABHA details using mobile | ✅ **proven** (`abha-search`) |
| VRFY_ABHA_401–405 | Fetch ABHA details using Aadhaar | ✅ **proven** (§7), wired into the UI (§9) |
| TAGGING_UNIQUEPATIENTID | One ABHA linked to one HIMS patient id | ✅ **proven** (link/unlink/re-link, G-13) |
| SHARE_PATIENT_PROFILE_701 | Share patient profile | ⚠️ PHR-app scoped — see §4 |

---

## 6. What this changes

**Removed from the critical path:** the ABHA card 401, Demo Auth, Driving
Licence/PAN, and probably scan & share.

**Added to it:** ABHA *address* verification (two mandatory tests) and
find-ABHA-by-Aadhaar (five mandatory tests).

**Unchanged and now the largest single risk:** the Aadhaar-OTP creation path is
**mandatory and completely untested**, with a hard sandbox cap of 100 creations
per client ID (`ABDM-1227`). Those tests need a sandbox test Aadhaar and should
be planned rather than improvised — every failed attempt burns quota that
cannot be recovered.


---

## 7. Fetch-ABHA-details built and proven — 2026-08-27

`VRFY_ABHA_301–305` and `VRFY_ABHA_401–405` are **one implementation**, because
the only difference between them is where ABDM sends the OTP:

| Group | `otpSystem` | OTP goes to |
|---|---|---|
| 301–305 (by mobile) | `abdm` | the ABHA's *communication* number |
| 401–405 (by Aadhaar) | `aadhaar` | the **Aadhaar-registered** number |

That distinction is user-visible and matters at the desk: ABDM's own message
changes to *"OTP sent to **Aadhaar registered** mobile number ending with
******9725"*, and the Aadhaar number may be a phone the patient is not holding.

**Proven end to end against sandbox** (Aadhaar path, 2026-08-27): search →
OTP → verify returned `91-5268-5170-0066` / `91526851700066@sbx` /
`Priyadarshi Anand`.

### Functions

- `abha-search` gained opt-in `chain: true`. Default behaviour is unchanged —
  still a pure pre-check with no txnId and no session — so the existing UI is
  untouched. Chaining keeps the txnId server-side and returns an opaque handle.
- `abha-fetch-request-otp` — addresses the account by **index**, which ABDM
  requires **RSA-encrypted** even though it is a single digit.
- `abha-fetch-verify` — completes the flow.

### Two findings

1. **This flow returns the X-token directly** (`expiresIn: 1800`), unlike §7.4's
   300-second T-token needing exchange on `/verify/user`. No account picker
   either: the account was chosen by index at the OTP step. So it is
   structurally simpler than the login path, and the QR becomes reachable
   immediately.

2. **Its accounts payload is THINNER than §7.4's.** Per the spec's own sample
   and confirmed on sandbox, it carries only `ABHANumber`,
   `preferredAbhaAddress`, `name`, `status`, `profilePhoto` — **no gender, no
   dob, no kycVerified**.

   The first run therefore reported `kycVerified: false` for a field ABDM never
   sent. That is a **false negative on an identity-assurance flag** — reception
   would read "this ABHA is not KYC-verified" when the truth is "ABDM did not
   say". `AbhaProfile.kycVerified` is now `boolean | null`, and this path
   returns `null`. Render it as *unknown*, never as "not verified".

   The fields it omits are exactly the ones Get Profile would supply — which is
   the endpoint NHA is refusing us. That makes the Get Profile 401 more
   consequential than §4e suggested: it degrades this flow as well.

Rate limiting here is keyed on the **search transaction**, not a phone number:
at that point we hold no patient identifier, only an opaque index. Capping per
txn stops one search being walked account-by-account to spray OTPs at a family
sharing a number.


---

## 8. ABHA address verification built and proven — 2026-08-27

**`VRFY_ABHA_102` and `VRFY_ABHA_202` both pass.** The last mandatory M1 gap is
closed.

```
via mobile OTP  (202) -> 91-5268-5170-0066 / 91526851700066@sbx / kycVerified true
via Aadhaar OTP (102) -> identical, OTP delivered to the Aadhaar-registered number
```

Three functions, all on **`phrBase`** — the config value defined in Phase 1 and
used by nothing until now:

| Function | Spec | Note |
|---|---|---|
| `abha-address-search` | 14.1 Step 1 | returns `authMethods` **and `blockedAuthMethods`** |
| `abha-address-request-otp` | 14.1/14.2 Step 2 | scope `abha-address-login`, not `abha-login` |
| `abha-address-verify` | 14.1/14.2 Step 3 | reads `users[]`, token at `tokens.token` |

`blockedAuthMethods` is the operationally useful part: it says which routes ABDM
will refuse **before** one is offered to a patient. Offering a blocked method
produces a failure the desk cannot explain.

### This is the one flow where FAQ Q21 is right

The X-token minted here belongs to the **PHR** family, so its profile is at
`{phrBase}/login/profile/abha-profile` — not `{abhaBase}/v3/profile/account`.
`abha-address-verify` deliberately does **not** reuse `fetchAbhaProfile()`.
Mixing the families is what produced the misleading "X-token expired" chase on
2026-08-26.

The flow session kind is `'abha-address'`, distinct from `'mobile-login'`, so a
handle from one cannot be spent on the other — `claimFlowSession` puts the flow
in the SQL predicate, making that a database guarantee rather than a convention.

### A fourth response shape for the same person

Diagnosing this cost a round trip, so it is recorded:

| Flow | Details in | Name field | Token at | KYC as |
|---|---|---|---|---|
| Aadhaar enrolment | `ABHAProfile` | `name` | top level | `kycVerified` bool |
| Mobile login | `accounts[]` | `name` | top level | `kycVerified` bool |
| Fetch details | `accounts[]` (thinner) | `name` | top level | **absent** |
| **ABHA address** | **`users[]`** | **`fullName`** | **`tokens.token`** | **`kycStatus` string** |

`normaliseAbhaProfile` now absorbs all four. Centralising it is what stops the
next flow rediscovering the same thing — which is exactly what this one did.

### Known limitation

This flow returns identity (ABHA number, address, name, KYC status) but **no
demographics** — `gender`, `dob` and `mobileMasked` come back empty, and the PHR
profile enrichment does not fill them.

Acceptable: the test asks for verification, not a profile, and demographics are
already on the patient record. But it is now the **third** flow where profile
enrichment adds nothing. Put to NHA as *"profile enrichment fails across all
flows"* rather than as an isolated `/v3/profile/account` complaint.

### Worth fixing separately

`'ABDM returned no ABHA details'` is thrown as a **502**, which maps to "ABDM is
unavailable right now". That is our parsing failing, not ABDM being down, and it
sent this investigation looking for an outage. It should be a 5xx distinct from
the upstream-unavailable message.

---

## 9. Wired into the UI — 2026-09-01

Everything in §7 and §8 was proven at the API and reachable by nothing. It is
now in the front-desk flow, which is what the functional test actually
exercises — an assessor cannot click an edge function.

### One modal, three routes

`ABHAVerifyModal` opens on a **method picker** and branches:

| Route | Spec | Tests |
|---|---|---|
| Mobile number | 7.4 | VRFY_ABHA_201 |
| ABHA address | 14.1 / 14.2 | VRFY_ABHA_102, VRFY_ABHA_202 |
| Find & verify | 7.6.1 / 7.6.2 | VRFY_ABHA_301-305, VRFY_ABHA_401-405 |

They share consent, the artefact, linking and the card. That is deliberate:
three copies of the consent wording is how consent text drifts between paths,
and the artefact is the evidence an assessor asks for.

Three things the UI now gets right that the API alone could not:

1. **The OTP route is chosen from ABDM's `authMethods`, not from ours.**
   Offering a route ABDM has blocked produces a failure reception cannot explain
   to a patient standing in front of them. `blockedAuthMethods` is shown so the
   desk can say *why*.
2. **The Aadhaar route says so, in the button.** "OTP to the Aadhaar-registered
   mobile — may be a different phone, check the patient has it before sending."
   That distinction is the entire reason 401-405 exists separately from 301-305.
3. **`authMethod` on the consent artefact follows what the patient PROVED**, not
   which screen they came from. An ABHA-address verification completed by
   Aadhaar OTP is recorded as `aadhaar-otp`.

### A real bug this surfaced

`handleConfirmAccount` fell back to `kycVerified: chosen?.kycVerified ?? false`
when Get Profile did not answer — asserting that ABDM said this ABHA is **not**
KYC-verified when ABDM had said nothing at all. That is the exact false negative
§7 warned about, in the oldest flow rather than the new one. Now `?? null`, and
the consent screen renders three states: Verified / Not verified / **Not stated
by ABDM**.

### CRT_ABHA_114 satisfied without ABDM's card endpoint

`ABHACardPanel` composes the card from the verified profile plus the QR that
works, and prints it. `/abha-card`'s 401 no longer touches M1 at all — its
output is used only if it ever starts arriving.

Preview and print share **one markup builder**, for the same reason the consent
text is shared: two copies drift, and the first anyone notices is a printed card
that disagrees with what the operator approved on screen. Values are escaped
before interpolation.

Where a flow returns no demographics — the ABHA-address route returns identity
only — those rows are **omitted rather than faked**, and the card still carries
number, address and QR, which is what CRT_ABHA_115 asks of an integrator not
generating ABDM's own card.

### The 502 fixed

`'ABDM returned no ABHA details'` was thrown as an `AbdmUpstreamError` with
status 502, rendering as *"ABDM is unavailable right now"* — a lie that sent one
investigation hunting for a sandbox outage. There is now an
`AbdmResponseShapeError`, mapped to a 500 that says the fault is ours and to
report the request id.

### What remains

Only the **Aadhaar creation path** (CRT_ABHA_101-115) and **VRFY_ABHA_101**,
both untested behind the 100-creation cap. See
`m1-creation-path-test-plan.md` — it is planned rather than improvised because
every failed attempt burns quota that cannot be recovered.
