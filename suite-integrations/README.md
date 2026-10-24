# Local suite connection and Workforce messaging changes

Prepared 19 October 2026. The user requested **local changes only**. Nothing in this increment has been deployed; no live SQL, secrets, users, messages or sessions were changed. Earlier central admin deployment is recorded in `../suite-admin/MEMORY.md`.

The subsequent [operations and invitation increment](../docs/SUITE_OPERATIONS_HANDOFF.md) adds two central migrations, payment controls, a verified messaging registry, a delivery worker and invitation acceptance. Those additions are also local only. Task?s organisation bootstrap repair is installed locally and recorded in `operations-manifest.json`.

## What is prepared

- Suite Admin has a Connections screen for OPD, Growth, Task, modern WhatsApp and the legacy OPD/GMB messaging service. It checks a pinned service identity, environment, challenge and database read. It does not provision tenants or mark trial enforcement ready.
- OPD/Growth/Task have a `suite-connector` Edge Function. Both Node backends have `POST /api/suite/connector`. All are authenticated, server-only and read-only; exact local ID lookup preserves existing identities.
- Task's WhatsApp connection screen now calls its own authenticated `workforce-whatsapp` Edge Function. The function derives the caller's active administrator role, organisation and permitted sender list from Task's database. Browser-supplied organisation/admin lists are ignored.
- Modern WhatsApp has `POST /api/integrations/workforce` with a separate server credential and pinned Task source UUID. Existing same-organisation users retain their IDs, credentials, roles and sessions. A cross-organisation ID collision rejects and rolls back the entire sync. New external identities receive a minimal `user` role, an unknown random password and no claimed login email.
- The facade supports admin sync, handshake, connection, QR, status and disconnect. It cannot send arbitrary messages or choose arbitrary upstream routes. Existing Task notification workers and OPD/GMB user provisioning remain unchanged.

These changes are installed in the local product source folders listed below. `staged/` contains review snapshots and manifests record SHA-256 hashes. `apply-packages.mjs` validates every source/target before copying. The generation scripts are preparation utilities, not deployment commands; do not rerun them over the completed staging snapshot. If a target changes, review its diff and restage deliberately instead of bypassing the hash guard.

## Source folders and server settings

| Service | Source folder | Where settings belong |
|---|---|---|
| Suite Admin UI | `C:\app folders\OPD management\project\suite-admin` | Existing `.env.local`: only the two public `VITE_SUITE_*` values |
| Central admin API and OPD connector | `C:\app folders\OPD management\project\supabase` | OPD Supabase secrets: `suite-admin/server.env.example` plus `env/connector.env.example` |
| Growth/GMB connector | `D:\app\gmb review system\project\supabase` | Growth Supabase secrets: `env/connector.env.example` |
| Task connector and WhatsApp facade | `D:\task manager android app\project\supabase` | Task Supabase secrets: `env/connector.env.example` and `env/workforce-edge.env.example` |
| Modern WhatsApp Node server | `D:\app folder\Whatsapp new app multi user\whatsapp multi user bulk\NodeBackend` | Node runtime: `env/connector.env.example` and `env/whatsapp-workforce.env.example` |
| Legacy OPD/GMB WhatsApp Node server | `D:\app folder\WHATSAPP-PERSISTENT-multi-users-master\NodeBackend` | Node runtime: `env/connector.env.example` |

Templates contain names only, not generated or deployed secrets. Central connector tokens must match their destination's own `SUITE_CONNECTOR_TOKEN`; use a different token/instance UUID for each service. `SUITE_ENVIRONMENT` must agree. The Task bridge has an additional dedicated token/source UUID pair and is independent of read-only connectors. A central database service-role key does not grant access to other projects and must not be copied into their browser environments.

## Later deployment sequence (not executed)

1. Verify the actual project references, Node deployments, per-organisation notification routes and optional upstream proxy settings. Local URL defaults alone do not establish the live topology.
2. Configure and deploy the modern Node bridge first, then Task's `workforce-whatsapp` Edge Function and its server secrets. Allow only the actual Task web/mobile origins. Deploy the Task frontend only after these services work; publishing it alone would break the existing connection screen.
3. Deploy the three `suite-connector` Edge Functions and both Node connectors with separate credentials. Set their matching central `SUITE_*_CONNECTOR_*` and `SUITE_*_INSTANCE_ID` values. Supabase connector URLs end in `/functions/v1/suite-connector`; Node connector URLs end in `/api/suite/connector`.
4. Apply the two reviewed central migrations listed in the operations handoff, deploy its four central functions, then build/publish Suite Admin to its own Netlify site. Check each service under Connections. Checks do not create accounts and should leave provisioning/trial readiness unchanged. The connector-only increment originally required no migration; current operations code requires the new migrations. Do not rerun `20261018120000_suite_platform.sql` on the initialised central database.
5. Test Task with an existing organisation administrator: verify sync preserves backend user ID/role/credentials, handshake/status finds the expected sender, and inactive/non-admin/foreign-organisation requests fail. Test actual QR/disconnect only on an agreed test session; these are operational actions, not read-only checks.
6. Migrate remaining old API-key consumers and coordinate credential rotation. Older API-key routes are retained for compatibility; this new facade does not revoke already-published credentials or secure all old routes automatically.

Rollback Task frontend and server changes as a coordinated release. Keep a working Task facade while any released client depends on it. The new endpoints remain closed when their secrets are unset. No live authentication, rollout or secret configuration is required to review these local files.

## Local verification

Run from the OPD repository using installed dependencies and Deno:

```powershell
npm.cmd run test:suite
npm.cmd run test:suite:contracts
npm.cmd run test:suite:workforce
npm.cmd run test:suite:bridge
npm.cmd run build:suite-admin
```

The bridge tests use local Express and isolated PGlite, including the actual external-route ownership middleware. Live database/session imports are replaced and live session access throws. The tests use the modern Node project's installed packages; set `SUITE_WHATSAPP_SOURCE` if its folder changes.

Validated after the operations increment: central SQL (26 tests including parents), Deno contracts/handlers/connectors/operations/invitations (14), Task facade/parser (2), and Node bridge (6 scenarios plus parent). Task Manager's full TypeScript check passes. Both Node server entry points compile through esbuild with external packages, without executing either server or writing deployment output. Modern WhatsApp's full TypeScript check reports 81 diagnostics outside the new connector/bridge modules; a clean whole-project typecheck is not established. Legacy WhatsApp has no installed TypeScript dependencies, so its full project typecheck is unavailable. These are local results, not production end-to-end evidence.

## Still required for the complete bundle

The central messaging registry, manual payments, invitation acceptance and retry worker are implemented locally in the operations increment. Actual product provisioning adapters, per-product access enforcement, worker/bot expiry checks, shared dependency reconciliation, capacity checks and product login handoffs remain unfinished. Central seven-day trial logic exists, but these connectors do not enable automatic deactivation across the four live apps. Follow `../docs/SUITE_MESSAGING_INTEGRATION_PLAN.md` before adding those adapters.
