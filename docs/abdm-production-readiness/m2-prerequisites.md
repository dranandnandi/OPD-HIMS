# M2 / M3 — specs held, blockers, and the build plan

Revised 2026-08-21 after receiving the full document set in
`abdm guidlines/`. **The specification gap is closed.** What remains are two
architectural decisions and the build itself.

---

## 1. Documents now held

| Document | Version | Dated | Covers |
|---|---|---|---|
| `M2_Document_16_02_2026_11822aedc7 (1).docx` | **2.8** | 13.02.2026 | Full HIP spec — gateway, HIP-initiated linking, user-initiated linking, data flow, scan & share |
| `M3_Dcoument_16_02_2026_2319bac7bf.docx` | **2.6** | 13.02.2026 | Full HIU spec — consent flow, data flow, **subscription flow** |
| `Scan_and_share_Document_03_03_25_8c48f696e0.pdf` | 1.0 | 03.03.2025 | Profile share + record share |
| `Running_Token_Status_Documentation_6a55ffc7f4.pdf` | — | — | Token number / queue status |
| `FAQ_20_11_2025_808a25df64.pdf` | **1.4** | 20.11.2025 | Supersedes the 27.05.2025 copy in the repo root |
| `ABDM_ABHA_V3_AP_Is_V1_31_07_2025_869ab8cda9.pdf` | 1.4 | 31.07.2025 | ABHA identity (M1) — already used |

The two root-level PDFs (`ABDM_ABHA_V3_AP_Is...`, `FAQ_28_05_2025...`) are now
duplicates/superseded. Worth deleting the root copies to avoid anyone reading
the stale FAQ.

---

## 2. Corrections to yesterday's notes

### The whitelist IP was wrong

FAQ v1.0 gave a single IP, `14.143.232.140`. **The M3 spec §1.1 gives three NAT
IPs, and they apply to both sandbox and production:**

```
13.203.243.253
13.203.245.166
65.0.113.207
```

Whitelist all three. The single older IP would have silently failed callbacks.

### Sandbox has a hard cap on ABHA creation

Error `ABDM-1227`: **maximum 100 ABHA creations per client ID in sandbox.**
Exceeded ones can be deleted at `https://abhasbx.abdm.gov.in/abha/v3`.

Practical consequence: **do not burn creations casually during M1 smoke
testing.** Prefer the mobile-OTP verification path (which creates nothing) and
reserve Aadhaar creation for the cases that genuinely need it.

### M3 has a subscription flow

Not in my earlier summary. M3 §6 covers subscriptions — standing permission to
receive updates, distinct from one-off consent requests. Adds scope to M3.

---

## 3. Blockers — both still stand

### B-1. Callbacks must reach an India-based, domain-named, IP-whitelistable server

**Confirmed: project `nxbzrpmlnlvknmutyher` is in `ap-southeast-2` (Sydney).**
Your LIMS project is in `ap-south-1` (Mumbai), so the region was available and
simply was not chosen here. Supabase regions cannot be changed after creation.

Supabase Edge Functions also expose no firewall configuration, so the
IP-whitelisting requirement cannot be met there even in an Indian project.

**Conclusion: a separate India-hosted HIP/HIU bridge service is required.** Not
a preference — the requirements do not fit Edge Functions.

Separately, and *do not conflate these*: whether Indian health data may sit at
rest in Sydney under the ABDM Health Data Management Policy and DPDP is a
question for your compliance advisor or the STQC/CERT-In assessor. I am flagging
it, not ruling on it. **Raise it explicitly and early** — if the answer is no,
that is much larger than M2.

### B-2. Fidelius crypto — ✅ largely resolved 2026-08-21

**A spike proved it runs on Deno.** See `scripts/fidelius-spike/` —
`deno run -A scripts/fidelius-spike/spike.ts`.

`@noble/curves` can build Curve25519 in Short Weierstrass form from parameters
derived off the Montgomery ones, and the full ECDH → HKDF-SHA256 → AES-256-GCM
chain round-trips. The derived `a` matches BouncyCastle's published constant.
HKDF and AES come from Web Crypto; only the key agreement needs the library.

**No separate crypto service is required** on this evidence. Remaining step:
run one Fidelius CLI reference vector through it to confirm wire compatibility
(key encoding, HKDF `info`, IV placement). Details in the spike's README.

The original statement of the problem is kept below for context.

### B-2 (as originally assessed) — Fidelius will not run on Deno / Web Crypto

The M2 spec confirms `cryptoAlg: "ECDH"`, `curve: "curve25519"`, with an
ephemeral public key and nonce supplied in the HI-request callback.

ABDM's Fidelius uses Curve25519 in **Short Weierstrass** form (BouncyCastle) —
not the Montgomery X25519 that Web Crypto, Deno, Node's built-in ECDH and
libsodium provide. A generic ECDH library fails against the gateway with
"encoded key spec not recognized", at integration time rather than compile time.

> **Superseded.** An earlier version of this section concluded that B-1 and B-2
> together forced a separate India-hosted JVM service. Both have since moved:
> the database is now in Mumbai, edge-function execution is pinned to
> `ap-south-1` via `x-region` and recorded in `abdm_audit_log.region`, and the
> spike shows Fidelius runs on Deno. **The current plan is that M2/M3 stay on
> Supabase Edge Functions**, pending the reference-vector check.

---

## 4. What the bridge must expose (inbound callbacks)

ABDM calls these on the URL registered via
`PATCH /api/hiecm/gateway/v3/bridge/url`. It appends the paths, so we register
one base and serve all of them.

| Callback path | Flow |
|---|---|
| `/api/v3/hip/token/on-generate-token` | HIP-initiated linking |
| `/api/v3/hip/patient/care-context/discover` | User-initiated linking — discovery |
| `/api/v3/hip/link/care-context/init` | User-initiated linking — init |
| `/api/v3/hip/link/care-context/confirm` | User-initiated linking — confirm |
| `/api/v3/consent/request/hip/notify` | Consent approved / revoked |
| `/api/v3/hip/health-information/request` | Data request (carries `dataPushUrl` + keys) |
| `/api/v3/hip/patient/share` | Scan & share |
| `/api/v3/hiu/patient/care-context/on-confirm` | HIU side (M3) |

> FAQ v1.3 warns of a "callback URL configuration issue (extra API endpoint
> appended)" — register the base URL exactly, without a trailing path segment,
> or ABDM builds a doubled path.

## 5. What the bridge calls outbound

| Endpoint | Purpose |
|---|---|
| `/api/hiecm/gateway/v3/sessions` | Auth token (same as M1) |
| `/api/hiecm/gateway/v3/bridge/url` | Register callback base (PATCH) |
| `/api/hiecm/gateway/v3/certs` | Keycloak certs — **for verifying inbound callback JWTs** |
| `/api/hiecm/v3/token/generate-token` | Linking token |
| `/api/hiecm/hip/v3/link/carecontext` | Link care contexts |
| `/api/hiecm/hip/v3/link/context/notify` | Notify care-context update |
| `/api/hiecm/hip/v3/link/patient/links` | Get all patient links |
| `/api/hiecm/hip/v3/link/patient/links/sms/notify2` | SMS notification |
| `/api/hiecm/user-initiated-linking/v3/patient/care-context/on-discover` | Discovery response |
| `/api/hiecm/user-initiated-linking/v3/link/care-context/on-init` | Link init response |
| `/api/hiecm/user-initiated-linking/v3/link/care-context/on-confirm` | Confirm response |
| `/api/hiecm/consent/v3/request/hip/on-notify` | Consent ack — **⏱ within 60s** |
| `/api/hiecm/data-flow/v3/health-information/hip/on-request` | HI request ack |
| `/api/hiecm/data-flow/v3/health-information/notify` | Transfer complete |
| `/api/hiecm/patient-share/v3/on-share` | Scan & share response |

Base URLs are the ones our `_shared/abdmConfig.ts` already models:
`https://dev.abdm.gov.in` (sandbox) / `https://apis.abdm.gov.in` (production),
`X-CM-ID: sbx` / `abdm`.

**Note the `/certs` endpoint.** Inbound callbacks carry a JWT. The bridge must
verify it against ABDM's Keycloak certificates — these endpoints are public and
serve health records, so an unverified callback handler is the worst failure
mode available to us.

---

## 6. Operational limits to design around

| Limit | Source | Consequence |
|---|---|---|
| **60 seconds** to send `on-notify` after `/hip/notify` | FAQ Q30 | Acknowledge immediately, build bundles asynchronously |
| **3 generate-token calls** per ABHA address per facility per day, then blocked 24h | FAQ Q25 | Cache the token — it is valid **6 months** |
| **100 ABHA creations** per client ID in sandbox | FAQ, ABDM-1227 | Do not burn them in testing |
| **Care contexts cannot be unlinked or deleted** | FAQ Q27 | No undo; get the reference scheme right first time |
| Up to **6 ABHA numbers per mobile** | FAQ Q13 | Vindicates the mandatory account picker already built |

---

## 7. Terminology (M2 §2)

- **Bridge ID** = your client ID from NHA (`SBX_00XXXX`)
- **Service ID** = facility ID from NHPR (`IN02100000XX`) — this is the HIP ID
- One facility ID serves **both** HIP (M2) and HIU (M3) roles

---

## 8. Plan

**Decisions first — neither needs more documents:**

1. **Where does the bridge live?** India-hosted, domain-named, firewall-capable.
   This is the gating decision; everything else follows from it.
2. **What runtime?** Driven by Fidelius. JVM/BouncyCastle is the proven path.

**Then, in order:**

3. Register the sandbox facility at `hspsbx.abdm.gov.in`, do Software Linkage,
   get the HIP ID. No dependency on 1 or 2.
4. Fidelius spike — prove encrypt/decrypt against the CLI's test vectors before
   touching the gateway.
5. Care-context identifiers on `visits` / `admissions`. Irreversible once
   linked, so design carefully.
6. `OPConsultRecord` FHIR bundle generation, validated offline:
   `java -jar validator_cli.jar bundle.json -ig https://nrces.in/ndhm/fhir/r4`
   (v6.2.1, JDK 8+; use `urn:uuid` references, never relative URLs).
7. Bridge skeleton: JWT verification against `/certs`, the eight callback
   routes, 60-second acknowledgement discipline.
8. HIP-initiated linking, then user-initiated linking, then data flow.
9. Decide capture for **ImmunizationRecord** and **WellnessRecord** — both
   mandatory HI types with no source data in the app today.

Items 3–6 can start immediately and in parallel with the hosting decision.

---

## 9. Still open

- **Data residency ruling** — for your compliance advisor / assessor.
- **HFR production registration** — per-clinic, so HIP ID must be a per-clinic
  setting in this multi-clinic app.
- **G-14 handoff pack** — architecture diagram, role/access matrix, staging
  URLs, test accounts. `pre-audit-checklist.md` still predates all M1 work.

---

# Addendum — 2026-08-25

Added after a full read of all six documents in `abdm guidlines/`. Sections 1–5
above stand; these settle three things that were left open.

## 6. Facility registration and HIP ID — the decision is already made for us

FAQ v1.4 **Q22–Q26** answers this outright. There is nothing to design:

| Concept | What it is | Who issues it |
|---|---|---|
| **Bridge ID** | Same value as our **client ID** (FAQ Q1). One per *integrator* — i.e. one for this whole product | NHA, at onboarding |
| **HFR ID** | The facility's registry ID, e.g. `IN0710000001`. One per **clinic** | The clinic registers, via the HFR portal |
| **HIP ID** | Generated for each **(facility × bridge)** pair | ABDM, on Software Linkage |

FAQ Q24's own worked example:

```
Facility (HFR ID)   Bridge ID        HIP ID
IN0710000001        SBXID_000001     IN0710000001
IN0710000001        SBXID_000002     IN0710000001_1
```

**Consequences, stated plainly:**

- We need **one** Bridge ID (our client ID) for the entire product — not one per
  clinic. Q24/Q25 also confirm a facility may link to several bridges at once,
  so a clinic already using another vendor does not have to drop them for us.
- Each clinic needs **its own** HFR registration. This is a clinic-side
  onboarding task, not an engineering task, and it cannot be done for them in
  bulk.
- **HIP ID is therefore per-clinic data.** It belongs in `clinic_settings`
  alongside `document_link_base`, not in an environment variable. The earlier
  note in §"Still outstanding" already reached this conclusion; the FAQ confirms
  it.
- The same ID serves as HIU for M3 (Q22) — **do not** register a second facility
  for the HIU role.
- Linking is done with the **"Software Linkage" button** on the portal, passing
  the client ID. Q23 is explicit that the `multipleHrPaddupdateService` API is
  *not* needed. No code.

Portals — and these must not be mixed (Q22):

| Environment | Portal |
|---|---|
| Sandbox | `https://hspsbx.abdm.gov.in/home` |
| Production | `https://nhpr.abdm.gov.in/home` |

A user manual for facility creation **and QR code generation** is on the sandbox
site under **Resource Center → User Manual → Health Facility**. Worth pulling
before building the scan-and-share QR.

## 7. Callback constraints — the numbers, corrected again

FAQ v1.4 **Q29** now lists **four** NAT IPs, not the three in §2 above. The
older single IP `14.143.232.140` is back in the list rather than superseded:

```
13.203.243.253
13.203.245.166
65.0.113.207
14.143.232.140
```

Whitelist all four.

Also from Q29/Q30, and each of these is a real failure someone else already hit:

- The callback URL must be a **domain name** — not an IP, not a port.
- The server must be **India-based**.
- **Register the base URL only.** ABDM appends the path itself. Registering
  `https://x.com/cb/api/v3/hip/token/on-generate-token` produces a doubled path
  and silent non-delivery. (This is the FAQ v1.3 warning already noted in §4
  above — Q30 gives the full worked example.)
- Production callback URLs are submitted on the **Exit Form**, *after* FT and
  WASA certification plus an internal NHA demo. Changing one later means going
  through ABDM Integration Support. **Choose the production callback hostname
  carefully and early** — it is not a value we can iterate on.

## 8. M2 build constraints worth knowing before writing any of it

From FAQ v1.4:

- **Q31 — the linking token is valid 6 months, and generating it is rate
  limited.** More than three `generate-token` calls for the same ABHA address
  from the same facility in one day returns "You are blocked for 24 hours" in
  the callback. **Cache the token; never call this per-visit.**
- **Q33 — care contexts can never be unlinked or deleted once linked.** There is
  no undo. A wrong link is permanent, so validate before linking, not after.
- **Q32 — the ABHA number must be passed to `/v3/link/carecontext` if and only
  if it was passed to `generate-token`.** The two calls must agree.
- **Q35 — the HIP sends the OTP in the discovery flow.** That is our side, and
  it is easy to miss when reading the sequence diagram.
- **Q34 — the discovery matching logic is ours to write.** ABDM gives the
  patient details; mapping them to our records is explicitly not specified.
- **Q2 — an HMIS must implement all 8 HI Types** for certification:
  Prescription, DiagnosticReport, OPConsultation, DischargeSummary,
  ImmunizationRecord, HealthDocumentRecord, WellnessRecord, Invoice. This app
  already produces the clinical content for most; the work is the **FHIR
  bundling**, which nothing in the codebase does yet. Treat it as its own
  workstream, not a detail of M2.

## 9. Running Token Status — a small M1 add-on we are unusually well placed for

`Running_Token_Status_Documentation.pdf` specifies
`POST /api/hiecm/patient-share/v3/running-token/status`: a patient who already
holds a token for a counter asks the HIP for the **current running token number
and the average minutes per token**, and the HIP answers.

Two reasons to note it now rather than later:

1. It rides on the scan-and-share plumbing — same `patient-share` family, same
   callback base. Building it after scan-and-share is cheap; designing
   scan-and-share as though it does not exist is not.
2. **The app already has the data.** The waiting-sequence feature tracks queue
   position, and the scan-and-share `on-share` acknowledgement body already
   carries `tokenNumber` and `expiry` (FAQ Q27's sample). Answering this API is
   mostly exposing what we compute for reception already.

## 10. HFR facility onboarding — the API route (added 2026-08-26)

`abdm guidlines/HFR_Documentation_SBX_Updated_08_04_2026...pdf` (64pp) documents
the **programmatic** route to facility registration. FAQ Q22/Q23 describe the
portal route and say the API is not required — the portal's "Software Linkage"
button does the same job. **The portal is the right choice for a handful of
clinics.** The API matters only if clinic onboarding is ever automated, which
for a multi-clinic product it eventually will be.

### A different host again

```
https://apihspsbx.abdm.gov.in/v4/int/...
```

Neither `dev.abdm.gov.in` (gateway) nor `abhasbx.abdm.gov.in` (ABHA). A third
base URL, so `abdmConfig.ts` needs a fourth entry if this is ever built.

### The prerequisite nobody mentions: an HPR ID

Facility creation is authenticated as a **person**, not as the integrator:

1. Create an **HPR ID** (Healthcare Professional ID) at `hspsbx.abdm.gov.in`
   using Aadhaar or Driving Licence, **with role "Facility Manager"**, and set a
   password.
2. Generate an **HPR token** from it.
3. Pass it as `x-hpird-auth` on the facility-creation APIs.

So facility onboarding needs a named human with an HPR ID. That is an
operational dependency, not a technical one, and it is easy to miss when
planning clinic onboarding.

### Onboarding sequence — order is mandatory

```
Basic Facility Information  ->  tracking id issued (becomes facilityId)
Additional Information
Detailed Information
Submit Facility              ->  facility id confirmed
```

- If Operational Status is **Functional**, all four run. Anything else goes
  straight from Basic to Submit.
- Re-running with the facility/tracking id **updates** rather than duplicates.
- `facilityName + address + state + district + sub-district + pincode` must be
  unique, or creation is rejected as a duplicate.
- **Search first** (§1, `POST /FacilityManagement/v1.5/facility/search`) so an
  already-registered clinic is not registered twice.

### Linking our bridge — where the HIP ID comes from

`POST /v4/int/v1/bridges/MutipleHRPAddUpdateServices` (the portal button's API
equivalent). Body: `facilityId`, `facilityName`, and an `HRP[]` of bridges:

```json
{ "bridgeId": "SBX_000135", "hipName": "Test Hospital 104",
  "type": "HIP", "active": true }
```

**`hipName` deserves attention — it is patient-facing.** It is what shows in the
ABHA/PHR app when a patient searches for the hospital. The rules are tight and
will bite:

- **15 characters maximum**
- no special characters
- must be **unique per bridge within a facility**
- the doc suggests hospital name + bridge suffix, which rarely fits in 15

Pick it deliberately per clinic. A clinic will care what patients see, and it is
not obviously changeable later.

`facilityId` must start with `IN` and be 12 characters.

### Where these values live in this app

`20260826000000_clinic_hfr_identity.sql` adds to `clinic_settings`:
`hfr_facility_id`, `abdm_hip_id`, `abdm_hip_name`, `abdm_counter_code` — with
CHECK constraints matching the HFR rules above, and a partial unique index on
`abdm_hip_id` so two clinics cannot share an ABDM identity.

Per-clinic, **not** environment variables: one bridge serves every clinic, and
ABDM mints a distinct HIP ID for each facility that links it.


## 11. M2 foundations built — 2026-08-26

### Care contexts (`20260826020000_abdm_care_contexts.sql`) — APPLIED, verified on Mumbai 2026-09-01

Two tables, both service-role only:

- **`abdm_link_tokens`** — the M2 §4.3.1 link token, cached. This is not an
  optimisation: the token is valid **six months**, and more than three
  generate-token calls for the same ABHA at the same facility in one day
  returns "You are blocked for 24 hours" (FAQ Q31). Calling it per visit would
  lock the clinic out of linking for a day.
- **`abdm_care_contexts`** — the durable mapping between our clinical rows and
  the references we announced to ABDM.

Modelled as its own table rather than columns on `visits`, for three reasons
that are all load-bearing:

1. **Care contexts can never be unlinked** (FAQ Q33). The reference we send is
   permanent, so it must not be coupled to a row a user can edit or delete.
2. One visit produces **two** care contexts — OPConsultation *and*
   Prescription — because ABDM treats them as separate HI types that a consent
   may authorise independently. Hence UNIQUE on `(source_type, source_id,
   hi_type)`, which is also the guard against ABDM-1090 "Duplicate HIP link
   request".
3. Visits, admissions and lab orders all become care contexts, so the mapping
   is polymorphic.

`status` distinguishes `pending` from `linked` because linking is asynchronous
— we announce, ABDM confirms on a callback that may never arrive. Without it a
failed link is indistinguishable from a successful one.

### FHIR R4 bundling — `_shared/fhir/`

**This is the piece nothing in the codebase did, and the largest unbudgeted item
in the programme.** All eight HI types are mandatory for an HMIS (FAQ Q2).

- `bundle.ts` — DocumentBundle assembly, NRCeS profile URLs and Composition
  type codings per HI type, Patient/Practitioner/Organization resources
  carrying the ABHA number, HPR id and HFR facility id respectively.
- `opConsult.ts` — the two an OPD visit yields: `OPConsultation` and
  `Prescription`.

Rules encoded because the validator enforces them and the failure is remote:

- `Bundle.type = "document"` and **entry[0] MUST be the Composition**.
- Every `reference` must resolve **within the same bundle** — no external
  references in a document bundle.
- Entries deduplicated by `fullUrl`; a repeated entry invalidates the bundle.
- `Composition.type` coding must match the profile, so a Prescription carrying
  an OPConsultation code fails even though both are well-formed FHIR.

Judgement calls worth knowing:

- **Nothing is invented.** A section with no data is omitted rather than filled
  with a placeholder. An empty Condition would validate and then sit in a
  patient's national record as a clinical assertion nobody made.
- **Dosage stays as text.** Parsing "1-0-1 after food" into FHIR timing codes is
  guesswork, and a wrong structured dose is more dangerous than an accurate
  unstructured one.
- **A visit with no clinical content refuses to compose** rather than emitting
  an empty document.

Verified locally: both bundles pass a structural check for bundle type,
Composition-first, duplicate entries and **dangling references** — the last
being the most common hand-built-FHIR failure. XHTML narrative escaping is
tested against `BP <120 & stable "ok"`, since a doctor's note containing `<` is
entirely ordinary.

**Not yet built:** the six remaining HI types, and every HIP callback
(link token, discovery, consent notify, data push).
