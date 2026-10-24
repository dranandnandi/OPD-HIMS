# Suite Admin project instructions

These instructions apply to this standalone frontend and its documentation. Read `MEMORY.md`, `README.md` and `docs/SUITE_MESSAGING_INTEGRATION_PLAN.md` before continuing suite integration work.

## Scope and architecture

- This folder is an independent React/TypeScript/Vite app with its own package lock, environment, Netlify config and `dist` output. Preserve independent builds; do not import the OPD frontend, inherit its PostCSS configuration or read its parent environment automatically.
- The intended central backend is the OPD Supabase project. Backend migration/functions/tests currently live in the OPD repository, outside this folder. Documentation copies do not make this a complete backend checkout.
- The bundle contains OPD, Growth/GMB, WhatsApp multi-user, and Workforce/Task Manager. LIMS is a lifecycle reference only and is excluded from this bundle.
- Suite access is verified server-side. The initial confirmed admin email is `ajpriyadarshi@gmail.com`; a configured `PLATFORM_SUPER_ADMIN_USER_ID` replaces the email check. Product admin roles never grant Suite Super Admin access.
- Preserve existing product databases, tenant IDs, identities and messaging sessions during initial integration. Do not assume a shared email means two local users can be merged.
- Model messaging backends separately from sellable products. OPD/Growth use legacy messaging integration; Workforce shares the multi-user WhatsApp service but its notifications have separately configurable routes. Verify deployed routes and upstream proxy settings before changing them.
- Preserve per-product access on shared resources. One product expiring must not disable another active product's backend account/session. Check trial and suspension on servers/workers, including inbound bot actions.

## Configuration and changes

- Browser variables are only `VITE_SUITE_SUPABASE_URL` and `VITE_SUITE_SUPABASE_PUBLISHABLE_KEY`. `.env.local` is local and Git-ignored. Never put service-role, DB, adapter or WhatsApp machine credentials in browser configuration or documentation.
- Keep credential values out of logs and responses. Use server secrets and scope adapters to verified organisation/user mappings.
- Product adapters and shared messaging coordination are unfinished. Do not claim a tenant is ready, or acknowledge enforcement, using a stub adapter. Existing trials require real readiness acknowledgement.
- Preserve unrelated working-tree changes. The OPD repository contains other clinical migrations and edits; do not blindly apply all pending migrations as part of Suite Admin setup.
- Use additive, reviewed migrations. The initial suite migration is not idempotent and must not be reapplied to an already-initialised database. Track what was actually applied; never infer deployment from local files.
- Follow the user's current authorisation. Keep setup/status documentation explicit about local implementation versus live deployment. Consult the deployment evidence in `MEMORY.md`; the user's loaded admin dashboard does not establish that product adapters or trial enforcement are deployed.

## Verification and documentation

- Frontend: Node.js 22, `npm ci`, `npm run build` (includes TypeScript). Use `npm run dev` on port 5175 for local work.
- Backend changes: run the suite PostgreSQL tests, Deno contracts/HTTP tests and handler type checks from the OPD repository as described in `docs/SUITE_ADMIN_IMPLEMENTATION.md`.
- Use tests for identity collisions, tenant isolation, stale versions, expiry boundaries, shared-service grants and retried provisioning when implementing adapters.
- Keep `MEMORY.md` current with completed work, validation and unresolved tasks. Distinguish proposed schemas/flows from implemented ones.
- `docs/reference/` contains archived instructions for other repositories. They are reference material, not active Suite Admin build/deploy commands. Their old live-state claims and security assessments need verification against current source/deployment.
- The copied suite design documents are snapshots from the OPD repository. When a design changes, update this standalone handoff and the canonical repository documents deliberately; they do not synchronise automatically.
