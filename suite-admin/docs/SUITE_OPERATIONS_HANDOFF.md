# Suite operations: local handoff, 19 October 2026

The user chose **manual payment and admin activation** and **local changes only**. Everything described below is prepared in source; no new migration, function, secret, scheduler, frontend release or customer invitation was deployed or sent during this increment.

## Implemented

- Record INR payments received outside the app, with receipt/reference, reason and expiry. A transaction creates a dated grant for each product in the organisation's selected plan. Duplicate requests are idempotent; receipt references are unique per organisation. Payment does not bypass suspension, tenant verification or product readiness. Access expires at the selected instant; renewal is another payment record.
- Void an incorrect payment record and revoke only its grants, or revoke an individual grant. Independent grants and trials remain effective. Voiding does not refund money. No checkout provider is needed for this workflow.
- Register pinned backend instances and verify exact existing product/sender identities. Map messaging purposes separately for OPD, Growth, Workforce notifications, Workforce HR bot and WhatsApp campaigns. One shared backend account can serve multiple products in the same suite organisation. Disabling one purpose does not disconnect a shared session. Mapping verifies account identity, not phone connectivity or actual session ownership; operational verification is still required.
- Central `suite-product-access` can check an exact messaging route/version/backend/sender/session using a scoped product token. Existing sends and bots do not call this check yet.
- `suite-worker` delivers up to four due product jobs per request with leases, bounded retry backoff, stale-version protection and the same enforcement acknowledgement required by manual sync. It skips products without configured adapters. No scheduler has been installed and no adapters were fabricated.
- Pending members can receive a manually shared invitation link. `/join` uses a separate customer session; the `suite-member` function checks the actual verified Auth user and the database matches the invited email. Reissuing invalidates unused older links. Links expire after 168 hours; acceptance is idempotent and queues setup without starting a trial or granting Suite Admin access. Usable tokens are not stored in the database. Invite creation sends no email; customer signup uses the project's existing Auth email-verification flow.
- Task Manager no longer assigns a missing profile to the first organisation or creates a default organisation in its login bootstrap. It requires an active profile linked to the actual authenticated user and an explicit organisation. Missing access shows a retry/sign-out screen. This is a targeted frontend repair, not a claim that all existing Task RLS policies were audited.

## Files and later deployment order

The standalone UI remains `C:\app folders\OPD management\project\suite-admin`. Central backend source remains under the parent repository's `supabase` folder. The source snapshots and hash-guarded installation record for Task's organisation repair are in `suite-integrations/staged/workforce` and `suite-integrations/operations-manifest.json`; those two files were installed locally in `D:\task manager android app\project`.

When a release is authorised:

1. Verify the target central project and migration history. The original `20261018120000_suite_platform.sql` was already applied historically and must not be rerun. Review/apply only these new central migrations, in order:
   - `20261019120000_suite_operations.sql`
   - `20261019160000_suite_invitations.sql`
   These migrations have not been applied here. Do not run an unrestricted database push: this repository also contains unrelated pending clinical/pharmacy migrations.
2. Follow `suite-integrations/README.md` for the product connectors and Task/modern-WhatsApp facade rollout. Preserve the legacy OPD/GMB users, existing session IDs, and separately configured Task notification routes.
3. Set central server settings from `suite-admin/server.env.example`. Existing public frontend variables stay as they are. Generate independent server-only `SUITE_WORKER_TOKEN` and `SUITE_INVITE_SIGNING_KEY` values of at least 32 characters. Set `SUITE_MEMBER_PORTAL_URL` to the exact HTTPS `/join` URL and the member origin allowlist. Never copy these secrets into Netlify browser variables. Signing-key rotation changes retried invitation URLs; create replacement invitations deliberately after rotation.
4. Deploy central `suite-admin`, `suite-product-access`, `suite-worker` and `suite-member`, with the checked-in function configuration. Configure Supabase Auth's allowed redirect URL `https://doctor-suite-admin.netlify.app/join` and verify the existing signup/confirmation/email delivery policy. New Auth signup may run existing OPD profile/messaging triggers; review those existing side effects before inviting new production customers. Customer signup does not itself grant product access.
5. Build/publish Suite Admin to its own Netlify site. Build output includes `/join` via the existing SPA redirect. Do not publish to the parent OPD site. Check sign-in, connection identity and invitation flows using an agreed test organisation.
6. Configure a trusted server scheduler to POST `{}` to the central `/functions/v1/suite-worker` once per minute, with `Authorization: Bearer <SUITE_WORKER_TOKEN>` and no Origin header. Keep its token in the scheduler's secret store. Inspect response counts: delivery failures appear in `failed` and job/audit records even when the batch HTTP response is 200. Scheduling alone cannot provision products that have no adapter.

## Verification

Local checks: 26 SQL tests including parent tests (baseline lifecycle, operations and invitations), 14 Deno contract/HTTP tests, all four central handler type checks, and the Suite Admin production build pass. Task's full TypeScript check passed after the organisation repair. Tests use isolated databases and mocked network boundaries; they do not establish live rollout or four-app end-to-end enforcement. Browser visual verification of the new screens has not been performed.

Run from the OPD repository:

```powershell
npm.cmd run test:suite
npm.cmd run test:suite:contracts
npm.cmd run build:suite-admin
```

Later smoke tests should cover wrong-email/expired/reissued invitation links; manual payment replay and voiding; cross-organisation sender rejection; Task missing/inactive profile rejection; and preserving another product's shared session when one purpose expires. Before release, test the actual four product servers, outbound queues and inbound bots at trial/payment expiry and suspension.

## Remaining implementation

The four actual product provisioning adapters, product-side server/RLS/worker/bot enforcement, capacity limits, shared dependency provisioning/reconciliation and product login handoffs are still unfinished. Customer invitation acceptance links central membership only; it is not SSO across the four existing authentication systems. The route registry does not switch live message workers, and the queue worker does not replace those adapters. Online checkout is deliberately deferred by the user's manual-payment choice. Approved catalogue prices are still a business input.

The admin can record commercial intent and manage central access, but the bundle must not be sold as centrally trial-enforced until the remaining product enforcement is implemented, deployed and tested.
