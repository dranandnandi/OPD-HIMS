# Pre-Audit Checklist

## Must Be True Before Engaging Security Agency

- `ABDM_CLIENT_ID`, `ABDM_CLIENT_SECRET`, and `ABDM_X_CM_ID` are stored only in server secrets
- sandbox and production configuration are separated
- Aadhaar is not stored in database tables
- OTP is not stored in database tables
- ABDM tokens are not logged
- patient consent timestamp is stored when ABHA is linked
- audit events exist for OTP request, OTP verify, and profile fetch
- staging/UAT environment is stable and HTTPS-only
- test accounts are prepared for assessor

## Code/Config Checks

- remove temporary debug logs from production-critical flows
- ensure auth debug logging is disabled in production builds
- validate inputs on all ABDM edge functions
- confirm sensitive error messages are sanitized for end users
- verify no secrets exist in frontend bundle or repo files

## Manual Test Cases

- valid Aadhaar -> OTP request success
- invalid Aadhaar -> request rejected safely
- valid OTP -> ABHA created/linked
- wrong OTP -> clear failure message
- expired OTP -> clear failure message
- reused transaction ID -> clear failure message
- missing patient mobile -> verification blocked in UI
- already-linked patient -> relink behavior reviewed

## Documents To Prepare

- architecture diagram
- API inventory
- role/access matrix
- release candidate version note
- staging URL and access instructions
- test account sheet
- known limitations list

## Open Gaps To Review In This Project

- broader codebase still contains many debug logs unrelated to ABDM
- rate limiting for ABDM edge functions should be reviewed explicitly
- role-based access review for patient CRUD and linked ABHA data should be documented
