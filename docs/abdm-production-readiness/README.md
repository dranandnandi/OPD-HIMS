# ABDM Production Readiness Pack

This folder is a starter handoff pack for internal pre-audit review and for onboarding an STQC or CERT-In empaneled agency for Safe-to-Host certification.

## Start here

| Document | What it is |
|---|---|
| **`m1-functional-test-coverage.md`** | **NHA's own M1 functional-test sheet, mapped to what we have.** Defines what M1 actually requires — read before planning any M1 work. Settles the ABHA-card question and adds two mandatory gaps. |
| **`m1-creation-path-test-plan.md`** | **Read before touching the Aadhaar creation path.** The last M1 gap, and the one where a fumbled attempt permanently burns sandbox quota. |
| **`session-log-2026-09-01.md`** | **START HERE.** The resume point: confirmed HFR/HIP identity, what M1 now covers, and the ordered next actions. |
| `session-log-2026-08-26.md` | The previous resume point. Its **twelve gotchas are still authoritative**; its status is superseded. |
| **`session-log-2026-08-25.md`** | The M1 sandbox testing detail — smoke-test results, the Get Profile investigation, G-13 verification. |
| `session-log-2026-08-21.md` | Phase 2 build log. Its *design decisions and spec gotchas* are still authoritative; its *status* section is not. |
| `session-log-2026-08-20.md` | Phase 0 + Phase 1. Still the source for the migration warning and the smoke-test list. |
| `roadmap-m1-m4-and-security-gaps.md` | Full M1–M4 analysis, the G-01…G-14 gap list, and phasing |
| **`m2-prerequisites.md`** | M2 blockers and constraints — **read before any M2 work.** Covers the India-hosting requirement, the Fidelius/Deno problem, and everything the NHA FAQ settles. Its **2026-08-25 addendum** settles facility/HIP-ID registration, the four callback NAT IPs, and the M2 rate limits and one-way operations |
| **`supabase-mumbai-migration-runbook.md`** | Moving the database Sydney → Mumbai (`nxbzrpmlnlvknmutyher` → `kiezgfhonvwryxpubfvl`), including the stored-URL rewrite that the generic Supabase guide omits |
| `api-inventory.md` | Current endpoint contracts |
| `app-overview.md` | Application overview |
| `pre-audit-checklist.md` | Pre-audit checklist — **predates the 2026-08-20 work, not yet refreshed** |

Current ABDM scope in this project:

- ABHA verification via **mobile OTP** (spec §7.4) — the primary OPD path
- Find ABHA by mobile (spec §7.6.1.1)
- ABHA creation via **Aadhaar OTP** (spec §3) — fallback for patients with no ABHA
- Mobile verification for non-Aadhaar numbers (spec §3.4)
- ABHA address suggestions and creation (spec §3.6)
- ABHA QR code and card (spec §10, §11)
- Patient record link after explicit consent, recorded as a versioned consent artefact
- Consent withdrawal and unlink

Status — **2026-09-01**. Deployed to the Mumbai project
(`kiezgfhonvwryxpubfvl`, ap-south-1). Every mandatory M1 flow on NHA's own
functional-test sheet is **proven against sandbox and reachable from the front
desk** — mobile OTP, ABHA address, and find-and-verify all run from one modal
with a shared consent artefact, and the ABHA card is composed locally so the
`/abha-card` 401 no longer touches M1.

**One M1 gap remains:** the Aadhaar-OTP **creation** path, built but never run,
behind a hard cap of 100 creations per client ID. It is planned rather than
improvised — see `m1-creation-path-test-plan.md` before attempting it.

**HFR Software Linkage completed 2026-09-01.** HIP ID `IN2410002622` is
confirmed, bridge `SBXID_027467`, callback base registered. This unblocks the
whole M2 track — care-context linking, discovery, and the scan-and-share QR all
key off the HIP ID. See `m4-nhpr.md` §"Software Linkage completed".

The facility itself is still **submitted, not validated**, but linkage did not
wait for that — an assumption worth not repeating.

Recommended files for agency handoff:

- `app-overview.md`
- `api-inventory.md`
- `pre-audit-checklist.md`

Recommended additions before external audit:

- architecture diagram PDF/PNG
- role and access matrix
- staging/UAT URL list
- test account sheet
- release version note
- known limitations / out-of-scope note

Important operational note:

- Sandbox and production ABDM credentials, URLs, and `X-CM-ID` values must be separated cleanly.
- No Aadhaar, OTP, or ABDM tokens should be logged or persisted outside intended transient request handling.
