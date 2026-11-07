// Apply only this thread's visit classification migration; never log credentials.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import pg from 'pg';

const file = '20261107091500_visit_types.sql';
const version = '20261107091500';
const expectedProject = 'kiezgfhonvwryxpubfvl';
const projectRef = (await readFile('supabase/.temp/project-ref', 'utf8')).trim();
if (projectRef !== expectedProject) throw new Error('Unexpected linked project.');
const env = await readFile('.env', 'utf8');
const setting = name => env.match(new RegExp(`^${name}\\s*=\\s*["']?([^\\s"']+)`, 'm'))?.[1];
const activeUrl = setting('VITE_SUPABASE_USE_FALLBACK') === 'true'
  ? setting('VITE_SUPABASE_URL_FALLBACK') : setting('VITE_SUPABASE_URL');
const activeKey = setting('VITE_SUPABASE_USE_FALLBACK') === 'true'
  ? setting('VITE_SUPABASE_ANON_KEY_FALLBACK') : setting('VITE_SUPABASE_ANON_KEY');
const keyProject = activeKey ? JSON.parse(Buffer.from(activeKey.split('.')[1], 'base64url').toString()).ref : null;
const allowedHosts = [`${projectRef}.supabase.co`, 'clinic.anprohealthtech.com'];
if (!activeUrl || !allowedHosts.includes(new URL(activeUrl).hostname) || keyProject !== projectRef) throw new Error('Frontend database does not match linked project.');

const exported = spawnSync('supabase.exe', ['db', 'dump', '--linked', '--dry-run'], {
  encoding: 'utf8', windowsHide: true, timeout: 60000,
});
if (exported.status !== 0) throw new Error('Supabase CLI could not initialize its database login.');
const connection = {};
for (const name of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
  const match = exported.stdout.match(new RegExp(`^\\s*(?:export\\s+)?${name}=(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s\\n]+))\\s*$`, 'm'));
  if (!match) throw new Error(`CLI did not provide ${name}.`);
  connection[name] = match[1] ?? match[2] ?? match[3];
  if (/\$\{|\$\(/.test(connection[name])) throw new Error('Unresolved database connection value.');
}
if (!connection.PGHOST.endsWith('.supabase.com') || !connection.PGUSER.includes(projectRef)) throw new Error('Database target mismatch.');
const caResponse = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { signal: AbortSignal.timeout(20000) });
if (!caResponse.ok) throw new Error('Could not download the published Supabase CA certificate.');
const ca = await caResponse.text();
const certificate = new X509Certificate(ca);
if (!certificate.ca || !certificate.subject.includes('Supabase')) throw new Error('Unexpected database CA.');
const client = new pg.Client({
  host: connection.PGHOST, port: Number(connection.PGPORT), user: connection.PGUSER,
  password: connection.PGPASSWORD, database: connection.PGDATABASE,
  ssl: { rejectUnauthorized: true, ca: [...rootCertificates, ca] }, connectionTimeoutMillis: 15000,
});
const inspect = async () => ({
  history: (await client.query('SELECT version,name FROM supabase_migrations.schema_migrations WHERE version=$1', [version])).rows,
  columns: (await client.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='visits' AND column_name='visit_type'")).rows,
  constraints: (await client.query("SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.visits'::regclass AND conname='visits_visit_type_check'")).rows,
  triggers: (await client.query("SELECT tgname,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='public.visits'::regclass AND NOT tgisinternal ORDER BY tgname")).rows,
  index: (await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='visits' AND indexname='visits_clinic_type_date_idx'")).rows,
});
try {
  await client.connect();
  const role = (await client.query("SELECT pg_has_role(current_user,'postgres','MEMBER') allowed")).rows[0];
  if (!role.allowed) throw new Error('CLI login is not a member of the migration role.');
  await client.query('SET ROLE postgres');
  const before = await inspect();
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ projectRef, mode: 'read-only preflight', ...before }, null, 2));
  } else {
    const sql = await readFile(`supabase/migrations/${file}`, 'utf8');
    const body = sql.replace(/^BEGIN;\s*$/gmi, '').replace(/^COMMIT;\s*$/gmi, '');
    await client.query('BEGIN');
    let effects = [];
    let baseline;
    try {
      await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('release-visit-types-20261107091500'))");
      const history = (await client.query('SELECT name,statements FROM supabase_migrations.schema_migrations WHERE version=$1', [version])).rows[0];
      if (history && history.name !== 'visit_types') throw new Error('Migration version belongs to a different change.');
      if (!history) {
        if (before.columns.length || before.constraints.length || before.index.length) throw new Error('Visit type schema exists without migration history; inspect before proceeding.');
        baseline = (await client.query(`SELECT count(*)::integer total,
          md5(string_agg(md5((to_jsonb(v)-'visit_type'-'updated_at')::text),'' ORDER BY id)) clinical_fingerprint
          FROM public.visits v`)).rows[0];
        const result = await client.query(body);
        effects = (Array.isArray(result) ? result : [result]).filter(item => item.command === 'UPDATE').map(item => ({ command: item.command, rows: item.rowCount }));
        await client.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3::text[])', [version, 'visit_types', [sql]]);
        const after = (await client.query(`SELECT count(*)::integer total,
          md5(string_agg(md5((to_jsonb(v)-'visit_type'-'updated_at')::text),'' ORDER BY id)) clinical_fingerprint
          FROM public.visits v`)).rows[0];
        if (baseline.total !== after.total || baseline.clinical_fingerprint !== after.clinical_fingerprint) throw new Error('Clinical visit data changed unexpectedly; rolling back.');
      }
      const schema = await inspect();
      if (schema.columns.length !== 1 || schema.constraints.length !== 1 || schema.index.length !== 1 || !schema.triggers.some(t => t.tgname === 'visits_prefill_visit_type')) throw new Error('Visit type schema verification failed.');
      const counts = (await client.query("SELECT coalesce(visit_type,'unclassified') visit_type,count(*)::integer visits FROM public.visits GROUP BY visit_type ORDER BY visit_type")).rows;
      const mapping = (await client.query("SELECT classify_visit_appointment_type('Follow_Up') follow_up,classify_visit_appointment_type('Emergency') emergency,classify_visit_appointment_type('Consultation') new,classify_visit_appointment_type('Procedure') unknown")).rows[0];
      if (mapping.follow_up !== 'follow_up' || mapping.emergency !== 'emergency' || mapping.new !== 'new' || mapping.unknown !== null) throw new Error('Visit type mapping verification failed.');
      await client.query('COMMIT');
      const audit = { projectRef, migration: file, sha256: createHash('sha256').update(sql).digest('hex'), applied: !history, alreadyApplied: Boolean(history), checkedAt: new Date().toISOString(), effects, counts, mapping, schema };
      await mkdir('output/visit-types-20261107', { recursive: true });
      await writeFile('output/visit-types-20261107/database-release.json', JSON.stringify(audit, null, 2));
      console.log(JSON.stringify(audit, null, 2));
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.message, code: error.code ?? null }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
