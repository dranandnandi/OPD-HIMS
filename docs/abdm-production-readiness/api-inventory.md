# API Inventory

## ABDM Edge Functions

### `abdm-request-otp`

- Purpose: request Aadhaar-linked OTP from ABDM
- Input:
  - `aadhaar`
  - `patientId`
  - `clinicId`
- Output:
  - `txnId`
- Sensitive handling:
  - encrypts Aadhaar before calling ABDM
  - writes audit log entries

### `abdm-verify-otp`

- Purpose: verify OTP and complete Aadhaar ABHA enrolment
- Input:
  - `txnId`
  - `otp`
  - `mobile`
  - `patientId`
  - `clinicId`
- Output:
  - `txnId`
  - `message`
  - `xToken`
  - `_raw`
- Sensitive handling:
  - encrypts OTP before calling ABDM
  - writes audit log entries

### `abdm-fetch-profile`

- Purpose: fetch ABHA profile using ABDM token
- Input:
  - `xToken`
  - `patientId`
  - `clinicId`
- Output:
  - normalized `profile`

## Security Notes

- All ABDM secrets are expected only in server-side environment variables
- The frontend should never call ABDM directly
- User-visible errors should not expose tokens, secrets, or full upstream payloads in production
