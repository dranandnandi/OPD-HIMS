# Supabase Migration Runbook — Sydney → Mumbai

**Source:** `nxbzrpmlnlvknmutyher` (ap-southeast-2, Sydney)
**Target:** `kiezgfhonvwryxpubfvl` (ap-south-1, Mumbai)

Written 2026-08-21. Driven by ABDM's requirement that callback servers be
India-based, and by the data-residency question that follows from it (see
`m2-prerequisites.md`).

**Confirmed before writing:** the Phase 0 ABDM migration
(`20260820000000_abdm_phase0_hardening.sql`) has already been applied to the
**old** database, so the schema dump carries it across.

**Do everything once, against the new project.** Do not deploy functions or
rebuild the frontend against Sydney first — the region-pinning change and the 13
ABDM functions are steps 7–10 below, and doing them twice is throwaway work. The
old project only needs to stay alive **read-only** to serve historic PDF links.

Order at a glance:

```
1  freeze writes, pause the 2 scheduled Netlify functions
2  dump old DB
3  restore to Mumbai
4  copy storage buckets
5  rewrite stored URLs
6  confirm both ABDM migrations are present on Mumbai
7  supabase link --project-ref kiezgfhonvwryxpubfvl
8  deploy the 13 ABDM functions
9  set secrets
10 update Netlify env, trigger rebuild
11 verify
12 unfreeze
```

---

## 0. Does keeping the old DB avoid downtime?

**No.** These are two separate concerns and it is worth being clear about them:

| Concern | Solved by keeping the old DB? |
|---|---|
| Old WhatsApp/PDF links keep resolving | ✅ Yes — that is exactly what it is for |
| Writes made after the dump are not lost | ❌ **No** |

The dump is a point-in-time snapshot. Any visit, bill, prescription or payment
written to the old database **after** the dump starts will simply not exist in
Mumbai. Keeping the old project running does not merge them back — it just means
the old copy still answers.

So you need a **write freeze** between the dump and the cutover. Everything else
(storage copy, URL rewrite, verification) can happen while frozen.

**Plan for a window when the clinic is closed.** Your database is modest, so
expect roughly 30–60 minutes end to end. Tell reception the system is
unavailable rather than relying on nobody happening to use it — a single bill
saved mid-migration is silently lost.

---

## 1. Freeze

- Announce the window. Confirm nobody is mid-consultation.
- Pause the two scheduled Netlify functions so they do not write during the
  copy: `queue-auto-reminders` (hourly) and `process-whatsapp-queue` (every 5
  min). Either disable the schedules in `netlify.toml` and deploy, or pause the
  site's scheduled functions in the Netlify UI.

That second point is easy to forget — those two run on a timer and will happily
write to the old database while you are copying it.

---

## 2. Database

```bash
mkdir supabase-migrate && cd supabase-migrate
supabase login

export OLD_DB_URL="postgresql://postgres.nxbzrpmlnlvknmutyher:<OLD_PW>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"
export NEW_DB_URL="postgresql://postgres.kiezgfhonvwryxpubfvl:<NEW_PW>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
```

Note the regions differ — `ap-southeast-2` for old, `ap-south-1` for new. Take
the exact strings from each project's **Connect** dialog rather than
hand-editing.

```bash
supabase db dump --db-url "$OLD_DB_URL" -f roles.sql  --role-only
supabase db dump --db-url "$OLD_DB_URL" -f schema.sql

# Exclude the transient ABDM tables' ROWS. Schema still comes from schema.sql.
# _abdm_session and abdm_flow_sessions hold live ABDM tokens with minute-level
# TTLs; copying them moves expired credentials for no benefit.
supabase db dump --db-url "$OLD_DB_URL" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" \
  -x "storage.vector_indexes" \
  -x "public._abdm_session" \
  -x "public.abdm_flow_sessions" \
  -x "public.abdm_rate_limit"
```

Restore:

```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$NEW_DB_URL"
```

`session_replication_role = replica` suppresses triggers and FK checks during
load — without it, rows arriving before their parents fail.

---

## 3. Storage

Buckets in use, from the code:

- `pdfs` — generated bills, prescriptions, IPD documents
- `ocruploads` — OCR images, IPD reports
- `patient-documents` — the patient upload portal

**Check the dashboard for any others** (the waiting-sequence upload function
writes to a bucket too). Copy every bucket, and recreate each one's
public/private setting on the target — a private bucket recreated as public is a
data exposure, and the copy script does not always carry this across.

Use Supabase's official storage migration script with:

```
OLD_PROJECT_URL=https://nxbzrpmlnlvknmutyher.supabase.co
NEW_PROJECT_URL=https://kiezgfhonvwryxpubfvl.supabase.co
```

---

## 4. Rewrite stored absolute URLs ⚠️

**Do not skip this.** Several columns store full Storage URLs containing the old
project ref. After migration they still resolve to Sydney, and they break the
day you delete the old project.

### First, find every one of them

Rather than trusting a hand-written list, let Postgres find them. Run on the
**new** database:

```sql
SELECT c.table_name, c.column_name
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.data_type IN ('text','character varying')
  AND EXISTS (
    SELECT 1 FROM (
      SELECT to_jsonb(t) AS row_json
      FROM public.dummy t LIMIT 0
    ) x WHERE false
  );
```

That skeleton is awkward in plain SQL, so use this instead — it generates the
UPDATE statements for you:

```sql
SELECT format(
  'UPDATE public.%I SET %I = replace(%I, %L, %L) WHERE %I LIKE %L;',
  table_name, column_name, column_name,
  'nxbzrpmlnlvknmutyher', 'kiezgfhonvwryxpubfvl',
  column_name, '%nxbzrpmlnlvknmutyher%'
)
FROM information_schema.columns
WHERE table_schema = 'public'
  AND data_type IN ('text', 'character varying')
ORDER BY table_name, column_name;
```

Run that, then execute only the statements that actually match rows. Columns
known to hold Storage URLs, as a cross-check:

| Column | Where |
|---|---|
| `permanent_url`, `temp_url` | `document_links` |
| `pdf_url` | bills, LIMS outbound orders, IPD documents |
| `print_pdf_url` | bills / visits |
| `file_url` | IPD treatment-plan diet reports |
| `invoice_file_url` | pharmacy inward receipts |
| `case_image_url` | base patient/visit schema |

If the generated list contains a column not on this table, look at it before
running — it may be a third-party URL that must not be rewritten.

### Links already sent are unfixable

PDF links already sitting in patients' WhatsApp history point at the old
project and cannot be rewritten. **Keep the old project alive read-only for
several weeks**, then accept the breakage or re-send. Budget for that rather
than being surprised.

---

## 4b. Confirm both ABDM migrations are present

Two migrations must exist on the new database. The first was applied to the old
DB before the dump, so it should arrive with `schema.sql`. The second was written
after that, so check it explicitly:

```sql
-- Phase 0 tables
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('_abdm_session','abdm_rate_limit',
                    'abha_consent_artefacts','abdm_flow_sessions');
-- expect 4 rows

-- Region column (20260821000000_abdm_audit_region.sql)
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'abdm_audit_log'
  AND column_name = 'region';
-- expect 1 row; if empty, run that migration now
```

## 4c. ⚠️ Policies outside `public` — the gap that actually bit us

`--schema=public` does **not** carry `storage` RLS policies. On 2026-08-21 the
migration completed with 210/210 public policies matching, and uploads still
failed with *"new row violates row-level security policy"* — because
`storage.objects` had RLS **enabled with zero policies**, which denies everything.

The verification missed it too: the check was `WHERE schemaname='public'`, the
same scope as the migration. It confirmed what had been done rather than what
was needed.

**Always compare every schema:**

```sql
select schemaname, count(*) from pg_policies group by 1 order by 1;
-- source and target must match for public, storage AND cron
```

Regenerate storage policies from the source and apply to the target:

```sql
select format(
  'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
  policyname, schemaname, tablename,
  case when permissive='PERMISSIVE' then 'PERMISSIVE' else 'RESTRICTIVE' end,
  cmd, array_to_string(roles, ', '),
  coalesce(' USING (' || qual || ')', ''),
  coalesce(' WITH CHECK (' || with_check || ')', ''))
from pg_policies where schemaname='storage' order by tablename, policyname;
```

Then diff the policy **bodies** (`qual` / `with_check`), not just the names — a
policy with the right name and the wrong predicate is worse than a missing one.

## 4d. Hardcoded project refs outside the codebase

The `/r/*` rule that serves every stable PDF link already sent over WhatsApp
contains the project ref in a literal URL:

```
/r/*  ->  https://<project>.supabase.co/functions/v1/doc-link/:splat  (302)
```

Netlify processes neither `netlify.toml` nor `public/_redirects` through Vite,
so no environment variable can fix it — it must be edited by hand, and nothing
type-checks or build-fails if you forget.

**Corrected 2026-08-25.** This section originally named `public/_redirects` as
the only home for the rule. It was not: a duplicate lived in `netlify.toml`, and
**netlify.toml redirects are applied before `_redirects`**, so that copy wins.
The two drifted — `_redirects` was repointed to Mumbai on 2026-08-21 while
`netlify.toml` still said Sydney — and the next git-based deploy would have sent
every stable PDF link back to the old project with no error anywhere to explain
it. The rule now lives **only in `netlify.toml`**; `_redirects` carries a comment
saying so. Check that one file, not two.

Also grep the source for `import.meta.env.VITE_SUPABASE_URL`. Eighteen call
sites were hand-building edge-function URLs from the raw env var, which bypassed
the fallback switch entirely — flipping it would have pointed the database
client at one project and every function call at the other. All now import
`supabaseUrl` from `src/lib/supabaseClient`.

## 5. Edge Functions

**Deploy from this repo — do not `supabase functions download`.** The repo is
ahead of production and is the source of truth; downloading would risk
overwriting your local ABDM source with older deployed copies.

```bash
cd "C:/app folders/OPD management/project"
supabase link --project-ref kiezgfhonvwryxpubfvl
```

The 13 ABDM functions:

```bash
npx supabase functions deploy \
  abdm-request-otp abdm-verify-otp \
  abha-login-request-otp abha-login-verify abha-login-verify-user \
  abha-search abha-link-patient \
  abha-enrol-mobile-request-otp abha-enrol-mobile-verify \
  abha-address-suggestions abha-address-create \
  abha-get-card abha-unlink-patient
```

Then the rest, **named explicitly**. A bare `functions deploy` ships all 51,
including uncommitted work in `generate-ipd-pdf` and `generate-pdf-from-html`.

`supabase/config.toml` carries the `verify_jwt = false` settings for
`verify-prescription` and `doc-link` — it deploys with the functions, so those
stay correct. Everything else defaults to `verify_jwt = true`, which is what the
ABDM functions need.

Do **not** deploy the four retired functions (`abdm-encrypt`,
`abdm-get-public-key`, `abdm-session`, `abdm-fetch-profile`). They are gone from
the repo; the migration is a clean opportunity to ensure they never exist on the
new project at all.

---

## 6. Secrets

None of these migrate. Set on the target:

```bash
npx supabase secrets set --project-ref kiezgfhonvwryxpubfvl \
  ABDM_CLIENT_ID=... \
  ABDM_CLIENT_SECRET=... \
  ABDM_ENV=sandbox \
  ABDM_ALLOWED_ORIGINS=https://<your-netlify-domain> \
  DOC_LINK_BASE=...
```

Plus whatever else `supabase secrets list --project-ref nxbzrpmlnlvknmutyher`
shows — WhatsApp, Gemini, PDF service keys.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically into
edge functions; do not set those by hand.

---

## 7. Netlify

**The anon key changes** — it is derived from the new project's JWT secret.

Site environment variables:
- `VITE_SUPABASE_URL` → `https://kiezgfhonvwryxpubfvl.supabase.co`
- `VITE_SUPABASE_ANON_KEY` → the new project's anon key
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` → used by all 16 Netlify
  functions in `netlify/functions/`, including the two scheduled ones

Then **trigger a fresh deploy**. `VITE_` variables are baked in at build time,
so changing them in the UI does nothing until the site rebuilds.

Update your local `.env` to match.

---

## 8. Also check

- **Auth providers** — Google/Apple client IDs and redirect URLs
- **SMTP + email templates**
- **Realtime publications** — if any table is subscribed to
- **Database webhooks**
- **Users must log in again.** Accounts and password hashes migrate, but the
  JWT secret differs so existing sessions are invalid. Warn staff.

---

## 9. Verification

Run against **both** databases and compare.

```sql
-- Row counts per table
SELECT table_name,
       (xpath('/row/c/text()',
         query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name),
                      false, true, '')))[1]::text::bigint AS rows
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- RLS policy count (must match — a missing policy is a data leak)
SELECT schemaname, tablename, count(*) FROM pg_policies
WHERE schemaname = 'public' GROUP BY 1,2 ORDER BY 2;

-- Tables with RLS enabled
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
ORDER BY 1;

-- Functions
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' ORDER BY 1;

-- No old refs left anywhere
SELECT count(*) FROM document_links WHERE permanent_url LIKE '%nxbzrpmlnlvknmutyher%';
-- expect 0

-- Auth users
SELECT count(*) FROM auth.users;
```

The three transient ABDM tables will legitimately show 0 rows on the new side —
that is the `-x` exclusions working, not a failure.

Then, in the app:

1. Log in — expect to be asked for credentials again.
2. Open a patient, open a visit, view a generated PDF.
3. Generate a **new** PDF and confirm the link works.
4. Open an **old** document link and confirm the rewrite worked.
5. Send a WhatsApp message.
6. Run one ABHA mobile-OTP verification end to end.
7. Confirm `abdm_audit_log` gets a row from it.

---

## 10. Unfreeze

Re-enable the two scheduled Netlify functions. Watch the WhatsApp queue drain.

---

## 11. Afterwards

- Keep the old project **alive and read-only** for several weeks for old links.
- Do not delete it until you have gone a full billing cycle without complaints.
- Re-point anything else that references the old ref — CI, scripts, bookmarks.
- Update `m2-prerequisites.md`: with the database in Mumbai, the residency
  question narrows considerably. The HIP bridge still cannot be a Supabase Edge
  Function, because **Fidelius does not run on Deno** — that constraint is
  unchanged by this migration.
