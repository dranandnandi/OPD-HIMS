# ABDM Production Readiness Pack

This folder is a starter handoff pack for internal pre-audit review and for onboarding an STQC or CERT-In empaneled agency for Safe-to-Host certification.

Current ABDM scope in this project:

- ABHA request OTP via Aadhaar
- ABHA verify OTP via Aadhaar enrolment flow
- ABHA profile fetch
- Patient record link after explicit consent

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
