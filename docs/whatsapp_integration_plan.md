# WhatsApp Integration Plan

This document captures the concrete steps to replicate the existing LIMS WhatsApp stack inside the OPD Management app. The goal is to reuse the same DigitalOcean backend, Netlify proxy functions, and React client layer so we can send appointments, bills, and EMR PDFs to patients over WhatsApp.

## 1. Backend Contract (DigitalOcean Service)
- Base URL: `https://lionfish-app-nmodi.ondigitalocean.app`
- Auth header: `X-API-Key: whatsapp-lims-secure-api-key-2024`
- Core endpoints (all already implemented server-side):
  - `/api/users/{userId}/whatsapp/connect`, `/api/whatsapp/status`, `/api/whatsapp/disconnect`
  - `/api/external/messages/send`, `/api/external/reports/send`, `/api/external/reports/send-url`
  - `/api/whatsapp/sync-user` and related report helpers
- Optional WebSocket URL: `wss://lionfish-app-nmodi.ondigitalocean.app/ws`

## 2. Proxy Layer (Netlify Functions)
- ✅ Implemented in `netlify/functions/`:
  - `whatsapp-connect`, `whatsapp-disconnect`, `whatsapp-status`, `whatsapp-qr`
  - `whatsapp-send-message`, `whatsapp-send-document`, `whatsapp-send-file-url`
  - `whatsapp-send-report`, `whatsapp-send-report-url`, `whatsapp-sync-user`, `whatsapp-proxy`
- All handlers share `netlify/functions/_shared/whatsappClient.ts` for CORS, env lookups, and DigitalOcean forwarding.
- Each function:
  1. Validates lab context/user input.
  2. Proxies the payload to the DigitalOcean endpoint with `X-API-Key`.
  3. Normalizes success/error responses for the React client.
- Store the API key and base URL in Netlify environment variables so no secrets live in source.

## 3. Frontend Client Layer
- Port `src/utils/whatsappAPI.ts` + helpers from the LIMS app.
- Key responsibilities:
  - Maintain `WhatsAppAPI` class with methods for connection management, text/document/report sending, and user sync.
  - Provide phone formatting/validation utilities.
  - Support multiple invocation modes via `VITE_WHATSAPP_API_MODE` (we will default to `netlify-functions`).
- Integrate with existing modules:
  - **Appointments**: add "Send WhatsApp Reminder" button inside appointment detail/drawer.
  - **Billing**: from `BillingDashboard` or `BillModal`, allow sending invoice PDFs or payment links.
  - **EMR/Visits**: expose EMR or prescription export via WhatsApp.

## 4. UI Components
- Create pages/components inspired by the LIMS set under `src/components/WhatsApp/`:
  - `WhatsAppDashboard` (connection + QR display)
  - `WhatsAppMessaging` (ad-hoc send UI)
  - `MessageHistory` (list of sent items, optionally backed by Supabase)
  - `WhatsAppUserSyncManager` and `WhatsAppConnectionManager`
  - `WhatsAppSendModal` / `WhatsAppSendButton` for contextual triggers
- Add a route (e.g., `/whatsapp`) for administration plus quick-send entry points in appointment/billing/EMR flows.

## 5. Environment & Configuration
Add the following to `.env` / Netlify settings:
```
VITE_WHATSAPP_API_BASE_URL=https://lionfish-app-nmodi.ondigitalocean.app
VITE_WHATSAPP_API_MODE=netlify-functions
VITE_WHATSAPP_WS_ENABLED=true
VITE_WHATSAPP_WS_URL=wss://lionfish-app-nmodi.ondigitalocean.app/ws
VITE_WHATSAPP_WS_DEBUG=false
WHATSAPP_API_BASE_URL=https://lionfish-app-nmodi.ondigitalocean.app (Netlify env only)
WHATSAPP_API_KEY=whatsapp-lims-secure-api-key-2024 (Netlify env only)
```
Ensure `.netlify/state.json` reflects the linked site (`beautiful-caramel-ebc094`).

## 6. Data Model Updates
- Apply the same user sync columns from the LIMS migration (if not already present) to track WhatsApp metadata inside Supabase.
- Optionally add a `whatsapp_messages` table to log outgoing notifications for auditing.

## 7. Testing & Monitoring
- Unit-test the `WhatsAppAPI` client with mocked fetch responses.
- Add integration tests for key Netlify functions (using Netlify CLI or Vitest + fetch mocking).
- Document how to tail function logs via `netlify functions:log whatsapp-send-message`.

## 8. Rollout Steps
1. Copy proxy functions + client utilities into this repo.
2. Configure env vars locally, then in Netlify dashboard.
3. Build UI entry points for appointments, billing, EMR workflows.
4. QA end-to-end by scanning the WhatsApp QR, sending sample messages, and verifying audit logs.
5. Update README + PAYMENT_SYSTEM_README with usage instructions.

Following this plan lets us reuse the battle-tested LIMS infrastructure without touching the DigitalOcean backend.
