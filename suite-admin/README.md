# Doctor Suite Admin

Current implementation backlog and user release steps: [20 October status](docs/SUITE_PENDING_STATUS.md). The complete four-app implementation is still unfinished.

Independent React admin app for the doctors' product bundle. This folder has its own dependencies, lockfile, environment configuration and Netlify configuration. You can copy it into its own Git repository without the OPD frontend. Exclude `node_modules`, `dist`, `.netlify` and real environment files when copying.

For continued development, read [project memory](MEMORY.md), [agent instructions](AGENTS.md), and the [documentation bundle](docs/README.md). The bundle includes the suite plans and archived instructions for the connected products; backend source remains in the OPD repository.

## Run locally

Use Node.js 22. From this folder:

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
# Fill in .env.local with your central OPD Supabase public connection values.
npm.cmd run dev
```

Open `http://localhost:5175`. To build: `npm.cmd run build`. Output: `dist/`.

## Deploy as a separate Netlify site

| Setting | Same repository as OPD | This folder copied into a new repository |
|---|---|---|
| Base directory | `suite-admin` | Leave empty |
| Package directory | `suite-admin` | Leave empty |
| Build command | `npm run build` | `npm run build` |
| Publish directory (relative to base) | `dist` | `dist` |
| Node version | `22` | `22` |

The included `netlify.toml` supplies the build command, publish directory and Node version. Set base/package in the new site's settings when using the OPD repository, so Netlify selects this folder's configuration. See [Netlify's monorepo configuration](https://docs.netlify.com/build/configure-builds/monorepos/).

Set these two variables in the new Netlify site's build environment before deploying:

```dotenv
VITE_SUITE_SUPABASE_URL=https://YOUR-OPD-PROJECT.supabase.co
VITE_SUITE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-OR-ANON-KEY
```

These values are embedded in the browser build. Use only a publishable/anon key here. Service-role keys and product adapter credentials belong in Supabase function secrets. Rebuild after changing browser variables. This app does not read the parent OPD `.env` or use its fallback database.

The included `public/_redirects` handles SPA routes; `public/_headers` sets admin response headers. Both are copied into `dist` by the build.

## Central backend required

Netlify hosts this frontend. The backend continues to run in the central OPD Supabase project; deploying this folder does not install database tables or Edge Functions.

Backend source remains in the OPD repository:

- `supabase/migrations/20261018120000_suite_platform.sql`
- `supabase/functions/suite-admin/`
- `supabase/functions/suite-product-access/`
- Shared `suite-contract.ts` in `supabase/functions/_shared/`
- Full setup and adapter contract: `docs/SUITE_ADMIN_IMPLEMENTATION.md`

For a fresh backend, apply the reviewed suite migration and deploy the functions to the intended project. The existing central deployment is already initialised; do not rerun its non-idempotent migration. See `MEMORY.md` for deployment evidence. Set `PLATFORM_SUPER_ADMIN_USER_ID` to the verified Auth UUID of `ajpriyadarshi@gmail.com`. The server initially permits that confirmed email when the UUID is unset; setting the UUID makes it the sole identity check.

Add your new Netlify site's exact origin (for example `https://your-suite-admin.netlify.app`, without a trailing slash) to the Supabase function secret `SUITE_ADMIN_ALLOWED_ORIGINS`. `server.env.example` lists server settings; it is documentation, not a frontend environment file. Sign in with that existing OPD account's password.

The current implementation includes organisations, membership records, plan/price management, seven-day trials, manual payment records and dated plan activation, grant revocation, invitation acceptance, suspension and audit history. The initial frontend is deployed at `https://doctor-suite-admin.netlify.app`. The new Connections screen and Task messaging changes are local only as of 19 October 2026. See [the integration handoff](docs/LOCAL_INTEGRATION_HANDOFF.md) for server settings and later deployment order. The new operations, invitations, messaging registry and delivery worker are also local only. See [the operations handoff](docs/SUITE_OPERATIONS_HANDOFF.md) for the two new unapplied migrations, new functions, server settings and verification. Product adapters, product-side enforcement and shared product login handoffs are still required to connect all four live products. Online payment is deferred by the user. Trial activation stays blocked until adapters confirm real enforcement.
