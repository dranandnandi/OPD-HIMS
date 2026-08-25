# ABDM Production Readiness Pack

This folder is a starter handoff pack for internal pre-audit review and for onboarding an STQC or CERT-In empaneled agency for Safe-to-Host certification.

## Start here

| Document | What it is |
|---|---|
| **`session-log-2026-08-21.md`** | **Latest work log and resume point.** Read this first — Phase 2, and the current deploy command. |
| `session-log-2026-08-20.md` | Phase 0 + Phase 1. Still the source for the migration warning and the smoke-test list. |
| `roadmap-m1-m4-and-security-gaps.md` | Full M1–M4 analysis, the G-01…G-14 gap list, and phasing |
| **`m2-prerequisites.md`** | M2 blockers and constraints — **read before any M2 work.** Covers the India-hosting requirement, the Fidelius/Deno problem, and everything the NHA FAQ settles |
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

M1 is complete **except scan-and-share**, which needs the HIECM/HIP spec — not
the ABHA V3 document in this repo.

Status: written and type-checked, **not yet deployed**. See the latest session log.

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
