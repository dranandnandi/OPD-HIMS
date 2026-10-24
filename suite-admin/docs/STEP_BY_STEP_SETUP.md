# Doctor Suite setup and completion guide

Prepared 20 October 2026 from the current local source. These are instructions; no deployment was performed while preparing this guide.

You can release the central administration features separately. Connecting all four products and enforcing automatic expiry still requires the engineering work in step 8. Configuration alone cannot complete those features.

## 1. Confirm targets and authenticate

The central OPD Supabase project previously used is `kiezgfhonvwryxpubfvl`, with custom domain `https://clinic.anprohealthtech.com`. Verify it in the dashboard before changing anything. The Suite Admin site is `https://doctor-suite-admin.netlify.app`.

Record Growth and Task Supabase project references, both WhatsApp backend deployment names/hosts, each frontend URL, Task organisation-specific notification endpoints and any upstream WhatsApp proxy. Preserve existing databases and sessions.

For CLI deployment, sign in locally with `supabase login` and `netlify login`. DigitalOcean CLI deployment also requires `doctl auth init`; alternatively use its dashboard and your existing build/deployment process. Keep access tokens out of chat.

## 2. Apply the central catch-up SQL (one file)

Checked on 20 October 2026: the central database already contains `20261018120000` **and an earlier draft** of `20261019120000_suite_operations.sql` (its instances/messaging tables and `suite_operate` exist, but `suite_manual_payments`, `suite_access_grants.payment_id` and `suite_messaging_access` do not). Running the four migration files individually would therefore fail on the first `CREATE TABLE`.

Instead, open the SQL Editor of the verified central project and run **`APPLY_CENTRAL_SQL_2026-10-20.sql`** (this folder) once. It is idempotent, touches only `suite_*` objects, adds exactly what is missing, replaces every suite function with the reviewed version and includes the invitations, runtime-refresh and resolve-access migrations. It was verified against fresh, complete and simulated-draft schemas locally. Expect "Success. No rows returned".

Do not rerun `20261018120000_suite_platform.sql`. Do not use an unrestricted `supabase db push`: unrelated pending pharmacy/clinical migrations exist in this repository, and the CLI migration history does not reflect what was applied through the SQL Editor. The canonical per-file sequence (for fresh installs and the test harness) remains `20261019120000`, `20261019160000`, `20261020100000`, `20261020110000`.

## 3. Set central Edge Function secrets

Use the central project's Edge Function secrets settings. The full name list is `../server.env.example`. Set the following first:

| Name | Value |
|---|---|
| `PLATFORM_SUPER_ADMIN_USER_ID` | `e96b05fd-d7eb-439c-883f-c3ac813a4a63`, after confirming it is the intended existing account |
| `SUITE_ADMIN_ALLOWED_ORIGINS` | `https://doctor-suite-admin.netlify.app` plus any required existing local origins |
| `SUITE_ENVIRONMENT` | `production` |
| `SUITE_MEMBER_PORTAL_URL` | `https://doctor-suite-admin.netlify.app/join` |
| `SUITE_MEMBER_ALLOWED_ORIGINS` | `https://doctor-suite-admin.netlify.app` plus any required existing local origins |
| `SUITE_INVITE_SIGNING_KEY` | An independent random secret of at least 32 characters |
| `SUITE_WORKER_TOKEN` | Another independent random secret of at least 32 characters |

Supabase supplies its own function `SUPABASE_URL` and service-role setting. Do not put server secrets in browser `VITE_*` variables. Do not upload the example template with empty values over existing secrets. Add only values deliberately configured for this release. Leave product adapter URL/token settings unset until step 8 is complete.

In Authentication URL configuration, add `https://doctor-suite-admin.netlify.app/join` to allowed redirect URLs. Preserve the existing OPD Site URL. Verify signup/email confirmation and SMTP delivery before inviting new customers; existing OPD Auth triggers may create profiles or sync messaging users.

## 4. Deploy only the central suite functions

From PowerShell:

```powershell
Set-Location 'C:\app folders\OPD management\project'
supabase functions deploy suite-admin --project-ref kiezgfhonvwryxpubfvl
supabase functions deploy suite-member --project-ref kiezgfhonvwryxpubfvl
supabase functions deploy suite-product-access --project-ref kiezgfhonvwryxpubfvl
supabase functions deploy suite-worker --project-ref kiezgfhonvwryxpubfvl
```

Use the checked-in function configuration and handler authentication. Do not bulk-deploy unrelated functions. A deployed worker with no product adapters configured processes zero products; this is expected.

## 5. Publish the separate admin frontend

Its folder is `C:\app folders\OPD management\project\suite-admin`.

Keep the existing `.env.local` values `VITE_SUITE_SUPABASE_URL` and `VITE_SUITE_SUPABASE_PUBLISHABLE_KEY`; there are only two browser connection variables. Confirm the same public values are in the correct Netlify site's build environment. Do not copy other projects' server credentials here.

```powershell
Set-Location 'C:\app folders\OPD management\project\suite-admin'
npm.cmd run build
netlify deploy --prod --no-build --dir dist --site 46d03ebb-6133-49ed-82fb-ccc7165921b1
```

Confirm that site ID still belongs to `doctor-suite-admin` before executing the deploy command. The explicit site prevents accidentally targeting the parent OPD site. Alternatively upload this folder's built `dist` to the existing Doctor Suite Admin site through Netlify's deployment UI.

## 6. Test central administration

Sign in as `ajpriyadarshi@gmail.com`. Create one clearly named test organisation, choose its plan and verify it survives refresh. A different account must not access Suite Admin.

Test an invitation with its intended verified email, then test a wrong email or reissued link. Test recording a manual payment, checking the access-grant rows and voiding that test record. These operations record central intent; pending product setup still prevents access. Invite creation sends no email automatically: copy/share the link yourself when ready.

Do not force trial readiness. With no real adapters, 0/4 configured integrations and pending products remain expected even when all connector checks succeed.

## 7. Release connectors and the Task/WhatsApp bridge

Use the existing local source folders and their existing deployment pipelines. New source files have already been installed locally; do not rerun preparation generators over them.

For each of OPD, Growth, Task, modern WhatsApp and legacy WhatsApp, configure a separate connector token, a stable instance UUID and `SUITE_ENVIRONMENT=production`. The three names are listed in `../../suite-integrations/env/connector.env.example`. Tokens need at least 32 random characters; UUIDs identify deployments and must stay stable across redeploys.

For each component, add the matching central values from `../server.env.example`: `SUITE_<COMPONENT>_CONNECTOR_URL`, `SUITE_<COMPONENT>_CONNECTOR_TOKEN` and `SUITE_<COMPONENT>_INSTANCE_ID`. Component names are `OPD`, `GROWTH`, `WORKFORCE`, `WHATSAPP`, `LEGACY_WHATSAPP`. Supabase connector URLs end in `/functions/v1/suite-connector`; Node URLs end in `/api/suite/connector`.

Coordinate the Task bridge release in this order:

1. Configure the modern WhatsApp backend using `../../suite-integrations/env/whatsapp-workforce.env.example`, then deploy that backend through its existing pipeline.
2. Configure Task Supabase using `../../suite-integrations/env/workforce-edge.env.example`. The bridge token and source UUID must match the modern backend. Use the verified modern backend host, not Task's separate notification host.
3. From `D:\task manager android app\project`, deploy `workforce-whatsapp` and `suite-connector` to the verified Task project with explicit `--project-ref` arguments. Only then release the Task frontend.
4. From Growth's own folder, deploy its `suite-connector` to the verified Growth project. Deploy OPD's connector from the parent OPD folder to the central project. Deploy the legacy Node connector through that backend's own pipeline.
5. Run all five checks on the admin Connections page. Verify the expected instance and environment. Checks do not provision users, reconnect phones or establish enforcement readiness.

Keep existing Node database/session/provider settings. Do not copy the central service-role key into other products. Older API-key consumers require a coordinated migration and rotation; the new Task facade alone does not remove all older credentials.

The new HR runtime access flag should remain off until its coordinated access-enforcement release is ready and tested. Enabling it against pending suite bindings can stop those HR accounts. Its settings are documented in `../../suite-integrations/env/runtime-access.env.example`.

## 8. Complete the remaining engineering before a full bundle release

The coding agent/developer must still:

1. Implement the actual tenant/user provisioning store for every product using `../../suite-integrations/runtime/access-core.ts`. Register real adapter endpoints. Handle existing users and identity collisions explicitly and make retries safe.
2. Add product database policies and privileged API checks. Enforce local roles, membership and the relevant plan limits. Shared validation alone does not cover existing product operations.
3. Integrate access checks into all remaining queues, campaigns, notification workers and inbound bots. Check again immediately before dispatch/tool execution. Expiry of one product must not disconnect a session shared by another active product.
4. Complete messaging dependency provisioning/reconciliation, verified sender/session routing and customer product login handoffs.
5. Test the actual integrations locally, then in staging. A product may acknowledge readiness only when server, workers, expiry and tenant isolation are really implemented. Existing HR bot checks and read-only connectors are insufficient for a four-product acknowledgement.

The current local test commands, from the OPD root, are:

```powershell
npm.cmd run test:suite
npm.cmd run test:suite:contracts
npm.cmd run test:suite:runtime
npm.cmd run test:suite:runtime-node
npm.cmd run test:suite:workforce
npm.cmd run test:suite:bridge
npm.cmd run build:suite-admin
```

Once real adapters exist, configure the central product adapter HTTPS URLs and tokens, their matching instance UUIDs/environment, and per-product access tokens on the correct servers. No real adapter endpoint paths are supplied here because those endpoints are still unfinished.

## 9. Schedule delivery and verify lifecycle enforcement

Install a trusted server scheduler to POST `{}` every minute to `https://clinic.anprohealthtech.com/functions/v1/suite-worker`, with `Authorization: Bearer <SUITE_WORKER_TOKEN>` and no Origin header. Keep its credential in the scheduler's secret store. Inspect per-batch failure counts and job/audit state; HTTP 200 alone does not mean every product succeeded.

Verify provisioning and reconciliation, then start the seven-day trial only after all selected products are ready and the owner is verified. Test expiry, suspension, renewal, member disable, foreign-tenant access and a stopped/unavailable backend. Check both product API access and background sends/tools. Confirm one expired product does not stop another active product sharing a WhatsApp session.

## 10. Start manual commercial activation

Set the approved prices under Plans & pricing. After receiving money outside the app, open the organisation, record the amount/reference/reason, select its paid-access expiry and save. Verify the selected products synchronise successfully. Renew by recording another payment. Voiding a payment record revokes its grants and does not issue a refund.

Customer onboarding should begin only after step 9 passes for the completed integrations.

## Official command/configuration references

- [Supabase function deployment](https://supabase.com/docs/guides/functions/deploy)
- [Supabase function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Netlify deploy command and flags](https://cli.netlify.com/commands/deploy/)
