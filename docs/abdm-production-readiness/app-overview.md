# App Overview

## Product

OPD Management application for clinic operations including patient registration, appointments, visits, billing, pharmacy, and ABDM ABHA linking.

## ABDM Module In Scope

Current ABDM capability implemented in this project:

1. Request Aadhaar-linked OTP from ABDM
2. Verify OTP and complete Aadhaar enrolment flow
3. Fetch ABHA profile
4. Persist ABHA link to patient record after explicit consent

## High-Level Components

- Frontend: React web application
- Backend: Supabase Edge Functions
- Database: Supabase Postgres
- External Integration: ABDM sandbox APIs

## Sensitive Data Handled

- Aadhaar number
- OTP
- ABDM transaction IDs
- ABDM access/session tokens
- Patient identifying information

## Intended Security Posture

- Aadhaar is used transiently for ABDM requests and should not be stored in the application database
- OTP is transient and should not be stored
- ABDM secrets remain server-side only
- ABHA linking requires explicit patient consent capture

## Known Next Step For Production

- Replace sandbox configuration with production configuration only after NHA approval and Safe-to-Host certification
