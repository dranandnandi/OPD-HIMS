// Release only this thread's atomic visit-save migration. Credentials stay in
// memory; inspection reads schema metadata, never patient records.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import pg from 'pg';

const file = '20261107110000_atomic_visit_save.sql';
const version = '20261107110000';
const name = 'atomic_visit_save';
const signature = 'public.save_visit_with_details(uuid,jsonb,jsonb,uuid,timestamp with time zone)';
const projectRef = (await readFile('supabase/.temp/project-ref', 'utf8')).trim();
if (projectRef !== 'kiezgfhonvwryxpubfvl') throw new Error('Unexpected linked project.');
const env = await readFile('.env', 'utf8');
const setting = key => env.match(new RegExp(`^${key}\\s*=\\s*["']?([^\\s"']+)`, 'm'))?.[1];
const fallback = setting('VITE_SUPABASE_USE_FALLBACK') === 'true';
const activeUrl = setting(fallback ? 'VITE_SUPABASE_URL_FALLBACK' : 'VITE_SUPABASE_URL');
const activeKey = setting(fallback ? 'VITE_SUPABASE_ANON_KEY_FALLBACK' : 'VITE_SUPABASE_ANON_KEY');
const keyProject = activeKey ? JSON.parse(Buffer.from(activeKey.split('.')[1], 'base64url').toString()).ref : null;
if (!activeUrl || ![`${projectRef}.supabase.co`, 'clinic.anprohealthtech.com'].includes(new URL(activeUrl).hostname)
  || keyProject !== projectRef) throw new Error('Frontend database does not match linked project.');

const sql = await readFile(`supabase/migrations/${file}`, 'utf8');
const normalize = value => value.replaceAll('\r\n', '\n').trim();
const expectedBody = normalize(sql.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1] ?? '');
if (!expectedBody) throw new Error('Migration function body is missing.');
const exported = spawnSync('supabase.exe', ['db', 'dump', '--linked', '--dry-run'], {
  encoding: 'utf8', windowsHide: true, timeout: 60000,
});
if (exported.status !== 0) throw new Error(`Supabase CLI could not initialize its database login (${exported.error?.code ?? exported.status}).`);
const connection = {};
for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
  const match = exported.stdout.match(new RegExp(`^\\s*(?:export\\s+)?${key}=(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s\\n]+))\\s*$`, 'm'));
  if (!match) throw new Error(`CLI did not provide ${key}.`);
  connection[key] = match[1] ?? match[2] ?? match[3];
  if (/\$\{|\$\(/.test(connection[key])) throw new Error('Unresolved database connection value.');
}
if (!connection.PGHOST.endsWith('.supabase.com') || !connection.PGUSER.includes(projectRef)) throw new Error('Database target mismatch.');
const response = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error('Could not download the published Supabase CA certificate.');
const ca = await response.text();
const certificate = new X509Certificate(ca);
if (!certificate.ca || !certificate.subject.includes('Supabase')) throw new Error('Unexpected database CA.');
const client = new pg.Client({ host: connection.PGHOST, port: Number(connection.PGPORT), user: connection.PGUSER,
  password: connection.PGPASSWORD, database: connection.PGDATABASE,
  ssl: { rejectUnauthorized: true, ca: [...rootCertificates, ca] }, connectionTimeoutMillis: 15000 });

const requiredColumns = {
  clinic_settings: ['id'], profiles: ['id', 'clinic_id'], patients: ['id', 'clinic_id'],
  appointments: ['id', 'clinic_id', 'patient_id'],
  visits: ['id', 'clinic_id', 'patient_id', 'doctor_id', 'appointment_id', 'visit_type', 'date', 'chief_complaint',
    'vitals', 'advice', 'advice_language', 'advice_regional', 'follow_up_date', 'physical_examination',
    'doctor_notes', 'case_image_url', 'visit_images', 'pdf_url', 'print_pdf_url', 'compact_print_pdf_url', 'updated_at'],
  symptoms: ['visit_id', 'clinic_id', 'name', 'severity', 'duration', 'notes'],
  diagnoses: ['visit_id', 'clinic_id', 'name', 'icd10_code', 'is_primary', 'notes'],
  prescriptions: ['visit_id', 'clinic_id', 'medicine', 'dosage', 'frequency', 'duration', 'instructions', 'quantity', 'refills', 'route'],
  tests_ordered: ['id', 'visit_id', 'clinic_id', 'test_id', 'testName', 'test_type', 'instructions', 'urgency', 'status', 'ordered_date', 'expected_date'],
  test_results: ['id', 'visit_id', 'clinic_id', 'test_ordered_id', 'result', 'normal_range', 'is_abnormal', 'result_date', 'report_url'],
};
const inspect = async () => ({
  history: (await client.query('SELECT name,statements FROM supabase_migrations.schema_migrations WHERE version=$1', [version])).rows[0] ?? null,
  functionState: (await client.query(`SELECT p.prosrc,p.prosecdef security_definer,p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
    FROM pg_proc p WHERE p.oid=to_regprocedure($1)`, [signature])).rows[0] ?? null,
  receiptTable: (await client.query("SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.visit_save_receipts')")).rows[0] ?? null,
  receiptPolicies: (await client.query("SELECT policyname,cmd,roles,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='visit_save_receipts'")).rows,
});
const verify = async () => {
  const state = await inspect();
  const grants = state.receiptTable ? (await client.query(`SELECT
    has_table_privilege('authenticated','public.visit_save_receipts','SELECT') can_select,
    has_table_privilege('authenticated','public.visit_save_receipts','INSERT') can_insert,
    has_table_privilege('authenticated','public.visit_save_receipts','UPDATE') can_update,
    has_table_privilege('authenticated','public.visit_save_receipts','DELETE') can_delete,
    has_table_privilege('anon','public.visit_save_receipts','SELECT') anon_select,
    has_table_privilege('anon','public.visit_save_receipts','INSERT') anon_insert`)).rows[0] : {};
  const checks = {
    migrationRecorded: state.history?.name === name && normalize(state.history.statements?.join('\n') ?? '') === normalize(sql),
    functionMatchesMigration: state.functionState !== null && normalize(state.functionState.prosrc) === expectedBody,
    securityInvoker: state.functionState?.security_definer === false,
    searchPathRestricted: state.functionState?.proconfig?.includes('search_path=public, pg_temp') === true,
    authenticatedExecute: state.functionState?.authenticated_execute === true,
    anonymousExecuteDenied: state.functionState?.anon_execute === false,
    receiptsRlsEnabled: state.receiptTable?.relrowsecurity === true,
    receiptsClinicPolicy: state.receiptPolicies.some(p => p.policyname === 'visit_save_receipts_clinic'
      && p.cmd === 'ALL' && p.roles.includes('authenticated') && /clinic_id/.test(p.qual) && /auth.uid\(\)/.test(p.with_check)),
    receiptsReadableAndInsertable: grants.can_select === true && grants.can_insert === true,
    receiptsMutationRestricted: grants.can_update === false && grants.can_delete === false,
    receiptsAnonymousAccessDenied: grants.anon_select === false && grants.anon_insert === false,
  };
  if (Object.values(checks).some(value => !value)) throw new Error(`Verification failed: ${JSON.stringify(checks)}`);
  return checks;
};
let inTransaction = false;
try {
  await client.connect();
  const membership = (await client.query("SELECT pg_has_role(current_user,'postgres','MEMBER') allowed")).rows[0];
  if (!membership.allowed) throw new Error('CLI login lacks its granted migration role.');
  await client.query('SET ROLE postgres');
  const columns = (await client.query('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])', ['public', Object.keys(requiredColumns)])).rows;
  const missing = Object.entries(requiredColumns).flatMap(([table, required]) => required
    .filter(column => !columns.some(c => c.table_name === table && c.column_name === column)).map(column => `${table}.${column}`));
  if (missing.length) throw new Error(`Migration prerequisites missing: ${missing.join(', ')}`);
  const before = await inspect();
  if (before.history && (before.history.name !== name || normalize(before.history.statements?.join('\n') ?? '') !== normalize(sql)))
    throw new Error('Migration version is already used by different SQL.');
  if (!before.history && (before.functionState || before.receiptTable)) throw new Error('Partial schema exists without migration history; inspect before proceeding.');
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ projectRef, mode: 'read-only preflight', prerequisiteColumnsVerified: columns.length,
      migrationAlreadyRecorded: Boolean(before.history), functionExists: Boolean(before.functionState), receiptTableExists: Boolean(before.receiptTable) }, null, 2));
  } else {
    await client.query('BEGIN'); inTransaction = true;
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
    const locked = (await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) locked', [`visit-save-migration-${version}`])).rows[0].locked;
    if (!locked) throw new Error('This migration is already running.');
    const existing = (await client.query('SELECT name,statements FROM supabase_migrations.schema_migrations WHERE version=$1', [version])).rows[0];
    if (existing && (existing.name !== name || normalize(existing.statements?.join('\n') ?? '') !== normalize(sql))) throw new Error('Migration history changed since preflight.');
    if (!existing) {
      const body = sql.replace(/^BEGIN;\s*$/gmi, '').replace(/^COMMIT;\s*$/gmi, '');
      await client.query(body);
      await client.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3::text[])', [version, name, [sql]]);
    }
    const checks = await verify();
    // Exercise the authentication guard with no patient IDs or clinical writes.
    await client.query('SAVEPOINT auth_guard_check');
    let authGuardRejected = false;
    try {
      await client.query('SET LOCAL ROLE authenticated');
      await client.query("SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true)");
      await client.query('SELECT public.save_visit_with_details(NULL,$1,$2,gen_random_uuid(),NULL)', [{}, {}]);
    } catch (error) {
      if (error.message !== 'User not assigned to a clinic') throw error;
      authGuardRejected = true;
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT auth_guard_check');
      await client.query('RELEASE SAVEPOINT auth_guard_check');
    }
    if (!authGuardRejected) throw new Error('Authentication guard did not reject an unassigned caller.');
    checks.authGuardRejected = true;
    await client.query("SELECT pg_notify('pgrst','reload schema')");
    await client.query('COMMIT'); inTransaction = false;
    const committedChecks = await verify();
    const audit = { projectRef, file, status: existing ? 'already_applied' : 'applied',
      sha256: createHash('sha256').update(sql).digest('hex'), verifiedAt: new Date().toISOString(),
      checks: { ...committedChecks, authGuardRejected: checks.authGuardRejected },
      scope: 'Only atomic_visit_save; no clinical records changed' };
    await mkdir('output/visit-save-20261107', { recursive: true });
    await writeFile('output/visit-save-20261107/database-release.json', JSON.stringify(audit, null, 2));
    console.log(JSON.stringify(audit, null, 2));
  }
} catch (error) {
  if (inTransaction) await client.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ error: error.message, code: error.code ?? null }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
