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
