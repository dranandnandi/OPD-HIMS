# Suite Admin implementation and deployment

**19 October operations update (local only):** manual payments/admin activation, grant revocation, verified messaging registry, retry worker and invitation acceptance are implemented. See [the operations handoff](SUITE_OPERATIONS_HANDOFF.md) for exact scope, unapplied migrations and later rollout. This supersedes older descriptions below of these components as proposed. Product provisioning adapters and enforcement inside the four apps remain unfinished.

## Current deliverable — 19 October 2026

The control-plane implementation uses the OPD Supabase project and a separate frontend build. The initial admin/frontend deployment is recorded in `suite-admin/MEMORY.md`. The 19 October connector and Task messaging changes are local only at the user's request; no live migration, function deployment or secret update was performed for this increment.

New local additions: a separate Connections screen, authenticated read-only connectors for the four products plus legacy messaging, and a Task-authenticated WhatsApp facade with organisation-scoped backend routes. See `suite-integrations/README.md` in the OPD repository for source folders, secret templates, rollout order and validation limits. This increment requires no SQL migration and does not implement provisioning/trial enforcement adapters.

Implemented:

- Separate responsive Suite Admin frontend under `suite-admin/`, with its own login storage and build output; no clinical PWA registration or cached admin responses.
- Server-verified access for the confirmed OPD login `ajpriyadarshi@gmail.com`. A configured `PLATFORM_SUPER_ADMIN_USER_ID` replaces this initial email check. Clinic `admin` / `super_admin` role strings do not authorise this service.
- Four products, four standalone plans and the complete bundle. Monthly/annual INR price versions are append-only through the API; prices start unset.
- Central organisation creation with a plan snapshot, owner membership and four/product-specific provisioning jobs, committed atomically.
- Central membership directory, linking to existing verified OPD Auth identities, disable/restore with last-owner protection.
- Exact 168-hour trials, audited extensions, organisation suspension/reactivation, dated manual access grants and audit history.
- Idempotent mutations, leased/versioned product jobs, tenant mapping uniqueness, retries and stale-response protection.
- A per-product authenticated access-state endpoint for product servers to refresh local access mirrors. No browser may call it.
- PostgreSQL integration tests and Deno validation/HTTP-handler tests.

**This is not yet a connected four-app release.** The individual apps do not currently implement the new adapter contract or enforce central access. A tenant mapping alone stays `linked`; missing adapters are shown as unavailable. The API refuses to start a trial until all adapters acknowledge provisioning and enforcement. No existing clinical data or app RLS policy is changed by the platform migration.

Still required for a customer-facing launch:

Messaging-specific prerequisite: extend the current product-only bindings with verified backend instances, shared dependency jobs and purpose-specific messaging access before connecting adapters. Workforce already syncs users into the multi-user WhatsApp backend; OPD/Growth use legacy integration, and Workforce notification routes require reconciliation. Follow [the messaging integration plan](SUITE_MESSAGING_INTEGRATION_PLAN.md).

1. Implement and deploy each product adapter and its server/RLS/worker access checks. Include the Growth RLS repair and Workforce tenant-fallback repair identified in the design review.
2. Provision new customer identities/local profiles safely, and add customer invitation acceptance/password setup. This version links existing verified central identities; adding a pending person does not send an email or create a login.
3. Add product-specific role assignment and capacity enforcement. Seeded limits describe proposed plans; they are not enforced in existing apps today.
4. Implement shared customer login/account linking. Reusing OPD Auth for the admin does not make other apps share its sessions.
5. Implement checkout, verified payment processing, paid subscriptions, renewals, bundle upgrades and grant revocation. Manual grants in this release are explicit dated exceptions, not evidence of payment. Organisation suspension can deny all grants.
6. Add automated outbox delivery/reconciliation. This release exposes manual per-product Sync with durable retry state; adapters must independently refresh access state within the specified deadline.

## Files and separation

| Area | Location |
|---|---|
| Admin frontend | `suite-admin/src/App.tsx`, `api.ts`, `styles.css` |
| Independent frontend package/build | `suite-admin/package.json`, `vite.config.ts` → `suite-admin/dist/` |
| Central schema and transactional RPCs | `supabase/migrations/20261018120000_suite_platform.sql` |
| Admin endpoint | `supabase/functions/suite-admin/index.ts` |
| Product access endpoint | `supabase/functions/suite-product-access/index.ts` |
| Shared validation and initial administrator | `supabase/functions/_shared/suite-contract.ts` |
| SQL tests | `tests/suite-platform.test.mjs` |
| Handler/contract tests | `supabase/functions/_shared/suite-*.test.ts` |

The current platform deployment contains one instance of each product (one target database per product). Multiple deployments/regions per product are not supported by these initial bindings. Add an explicit app-instance key before connecting a second deployment of the same product; never repoint an existing adapter URL to an unrelated database.

## Local development

Install the admin's own dependencies. This folder can also be copied into a separate repository; it has no dependency on the OPD frontend package:

```powershell
cd suite-admin
npm.cmd ci
Copy-Item .env.example .env.local
# Set the public connection values in .env.local before starting.
npm.cmd run dev
```

The admin dev server uses port 5175. Its browser configuration reads these values from `suite-admin/.env.local` or its own deployment environment:

```dotenv
VITE_SUITE_SUPABASE_URL=https://YOUR-OPD-PROJECT.supabase.co
VITE_SUITE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-OR-ANON-KEY
```

There is no fallback to the OPD frontend environment or clinical fallback database flag. No secret/service-role key belongs in any `VITE_*` variable. See `suite-admin/README.md` for standalone deployment settings. From the repository root, `npm run dev:suite-admin` and `npm run build:suite-admin` delegate to this independent package after its dependencies have been installed.

To use local/staging data, point the frontend and functions at that environment and apply the migration there first. Without the migration/functions, the login screen builds but the admin dashboard will report that the platform service is unavailable. Use the authorised account's existing password; there is no baked-in password or browser-side privilege bypass.

## Verification

Run these from the repository root after installing both root and admin dependencies:

```powershell
npm.cmd run test:suite
npm.cmd run test:suite:contracts
npm.cmd run build:suite-admin
deno check --no-lock supabase/functions/suite-admin/index.ts supabase/functions/suite-product-access/index.ts
npx.cmd eslint suite-admin/src supabase/functions/_shared/suite-contract.ts supabase/functions/_shared/suite-contract.test.ts supabase/functions/_shared/suite-http.test.ts supabase/functions/suite-admin/index.ts supabase/functions/suite-product-access/index.ts
```

`test:suite` uses PGlite, an isolated PostgreSQL runtime, with mock Auth users and roles. It does not load `.env` or connect to Supabase. The HTTP tests intercept every network request and restore their temporary environment values. The Deno tests need only environment access, not network permission at runtime.

The initial checks passed: 13 PostgreSQL scenarios plus their parent test, 4 validation tests and 1 handler test. The admin build and existing OPD production build passed. Browser visual verification remains outstanding because no browser was available in the implementation session.

The standalone packaging was also verified with a clean `npm ci` and production build in a temporary folder outside the OPD workspace, using placeholder public connection values. TypeScript passed and the output included the SPA redirects and response headers. This confirms the frontend can build without OPD's dependencies or configuration; it does not verify a live backend deployment.

## Deployment sequence

1. Confirm the intended OPD project and staging environment. Apply **only** the reviewed `20261018120000_suite_platform.sql` migration in staging first. Do not blindly push all pending repository migrations: the working tree contains unrelated clinical changes.
2. Resolve the verified admin account's Auth UUID in the intended project and set `PLATFORM_SUPER_ADMIN_USER_ID`. Once set, the original email no longer provides an alternative admin login. Verify the UUID before enabling the UI.
3. Configure function secrets using Supabase secret management. Do not commit a real secret file. Required settings are documented in `suite-admin/server.env.example`.
4. Deploy the two functions to that specific project. Both have gateway JWT checking disabled intentionally: `suite-admin` calls Auth `getUser` and applies the allowlist itself; `suite-product-access` verifies a dedicated machine credential. Neither trusts decoded JWT claims or a client-supplied admin role.
5. Build and deploy the admin frontend as a **separate site**. In the same repository, set Netlify base directory and package directory to `suite-admin`. Build command: `npm run build`; publish directory relative to base: `dist`. If copying this folder into its own repository, leave base/package empty. The included `suite-admin/netlify.toml` supplies the standalone build settings. Set the two `VITE_SUITE_*` public variables in this new site's build environment. The clinical site's root Netlify configuration remains unchanged.
6. Set `SUITE_ADMIN_ALLOWED_ORIGINS` to exact admin origin(s), including `http://127.0.0.1:5175` / `http://localhost:5175` only for local development. No wildcard origin is used. Verify successful sign-in for the one admin and denied access for an ordinary clinic account.
7. Install and test product adapters in staging. Configure a product URL/token only when its endpoint implements the contract below; never point these secrets at old generic user-creation APIs.
8. Pilot a test organisation through create → provision → activate → expire → extend/suspend → reconcile. Verify raw SQL/API access, storage and queued jobs as well as the UI before migrating any existing customer.

No whole-database credentials for other products are required by this initial central implementation. It holds a scoped adapter credential for each product; each adapter uses its own server credentials internally. If implementing direct-database provisioning later, put credentials only in the server environment and preserve the same authority boundaries.

## Product adapter contract

Central admin sends `POST` to the configured HTTPS adapter URL. Redirects are rejected. Credentials come only from server secrets; the browser cannot submit a destination URL or token.

Headers:

```text
Authorization: Bearer <this-product-adapter-token>
Content-Type: application/json
Idempotency-Key: <suite-job-id>
```

The request contains `contract`, `organization_id`, `product_code`, `version`, `local_tenant_id`, the organisation/plan snapshot, membership identities, trial dates, manual grants, `issued_at` and `refresh_by`. Treat central UUIDs as mapping identifiers, not replacements for existing local primary keys.

The adapter must:

1. Verify its machine credential, expected product and contract before any side effect.
2. Map `(central organization ID, product)` to a stable local tenant. For an existing local ID, verify its expected ownership and migration authorisation. Do not merge by matching clinic names or unverified emails.
3. Provision idempotently and keep its own durable receipt. A lost response, retry, newer central job or expired central lease must never create another tenant. Idempotency applies to the stable organisation mapping as well as the job ID.
4. Apply versions monotonically. A stale delivery cannot restore a disabled membership, overwrite a new expiry or undo a suspension.
5. Preserve passwords, existing clinical records and WhatsApp session ownership. Do not delete users to resolve duplicate emails. A pending central member has no authorised login; product-specific permission mapping must be explicit.
6. Store grant source records and compute access from server time. Suspension overrides grants; the product trial is valid only before its deadline. An unstarted trial and an empty grant list permit no operational writes.
7. Enforce access in all protected database/API/storage/background-work paths, including service-role handlers. Preserve explicitly allowed post-expiry read/export and renewal paths. The provisioning endpoint itself must remain callable after product access expires.
8. Independently refresh its mirror through `suite-product-access` before `refresh_by`; never extend known commercial deadlines during an outage. If the mirror becomes stale, fail closed for new protected mutations and show a service-availability error. Scope user requests using active memberships, not just an organisation-level `allowed` flag.
9. Acknowledge readiness only after the actual tenant and access checks are in place. An echo/stub implementation must not return enforcement flags as true.

Successful response (the IDs and version must match the request):

```json
{
  "contract": "suite.access.v1",
  "organization_id": "central-organisation-uuid",
  "product_code": "opd",
  "version": 2,
  "local_tenant_id": "existing-or-new-local-tenant-id",
  "enforcement": {
    "server": true,
    "workers": true,
    "expires_at": true,
    "tenant_isolation": true
  }
}
```

A failure leaves the organisation intact and its binding `failed` with a safe error message. A retry reuses the job ID with a new lease. An acknowledgement for an old version is recorded but cannot mark the newer binding ready. Adapter-side stable mapping handles recovery if the tenant was created before a response was lost.

## Access mirror refresh

Each product server receives a **different** random `SUITE_<PRODUCT>_ACCESS_TOKEN` (at least 32 characters); it is separate from the token authorising central provisioning into that product. Call:

```text
POST https://YOUR-OPD-PROJECT.supabase.co/functions/v1/suite-product-access
Authorization: Bearer <this-product-access-token>
Content-Type: application/json

{"organization_id":"central-organisation-uuid","local_tenant_id":"local-id"}
```

The credential selects the product. A payload cannot change it. A mismatched tenant/org binding returns 404. The response includes `allowed`, `access_until`, central status/version, plan snapshot, memberships and `refresh_by`. No active grant gives `allowed: false` and `access_until: null`. An access change queues a new version and temporarily makes the binding pending until acknowledged. This endpoint is read-only and never creates a membership or local tenant.

## Operational boundaries

- The browser accesses suite data only through the admin function. All new tables have RLS enabled and no `anon`/`authenticated` privileges; all suite RPCs are service-role-only.
- Audit entries and provisioning jobs commit in the same transaction as an admin mutation. Mutations include a request UUID; retries with the same payload return the original result. Reusing that UUID with a different actor/action/payload is rejected.
- No automatic trial purging or patient deletion exists here. No payment capture or email sending occurs in the initial release.
- Manual grants currently expire by their timestamp; immediate broad denial uses audited organisation suspension. Per-grant revocation is a next-stage operation.
- Central price history is preserved. The old OPD/Growth pricing and payment flows have not been redirected to this platform.
- A rollback can remove the admin frontend/functions while leaving additive suite tables intact. Existing clinical applications do not depend on these tables yet. Once product enforcement is installed, rollback requires an explicit access-state reconciliation instead of dropping tables.
