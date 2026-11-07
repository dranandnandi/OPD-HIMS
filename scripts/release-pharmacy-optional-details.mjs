// Apply only the user-authorized H1 / NRx optional-details migration.
// Credentials remain in memory; no patient or supply records are read or written.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import pg from 'pg';

const file = '20261107090000_pharmacy_optional_controlled_sale_details.sql';
const version = '20261107090000';
const projectRef = (await readFile('supabase/.temp/project-ref', 'utf8')).trim();
if (projectRef !== 'kiezgfhonvwryxpubfvl') throw new Error('Unexpected linked project.');
const sql = await readFile(`supabase/migrations/${file}`, 'utf8');
const oldSql = await readFile('supabase/migrations/20261030091000_pharmacy_controlled_sale_register.sql', 'utf8');
const normalize = value => value.replaceAll('\r\n', '\n').trim();
const functionBody = value => normalize(value.match(/CREATE(?: OR REPLACE)? FUNCTION public\.record_pharmacy_controlled_supply\(\) RETURNS trigger[\s\S]*?AS \$\$([\s\S]*?)\$\$;/i)?.[1] ?? '');
const expected = functionBody(sql);
if (!expected) throw new Error('Migration function body is missing.');
const exported = spawnSync('supabase.exe', ['db', 'dump', '--linked', '--dry-run'], {
  encoding: 'utf8', windowsHide: true, timeout: 60000,
});
if (exported.status !== 0) throw new Error(`Supabase CLI could not initialize its database login (${exported.error?.code ?? exported.status}).`);
const connection = {};
for (const name of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
  const match = exported.stdout.match(new RegExp(`^\\s*(?:export\\s+)?${name}=(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s\\n]+))\\s*$`, 'm'));
  if (!match) throw new Error(`CLI did not provide ${name}.`);
  connection[name] = match[1] ?? match[2] ?? match[3];
  if (connection[name].includes('${') || connection[name].includes('$(')) throw new Error('Unresolved database connection value.');
}
if (!connection.PGHOST.endsWith('.supabase.com') || !connection.PGUSER.includes(projectRef)) throw new Error('Database target does not match the linked project.');
const response = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error('Could not download the Supabase CA certificate.');
const certificate = await response.text();
const authority = new X509Certificate(certificate);
if (!authority.ca || !authority.subject.includes('Supabase')) throw new Error('Unexpected database certificate authority.');
const client = new pg.Client({
  host: connection.PGHOST, port: Number(connection.PGPORT), user: connection.PGUSER,
  password: connection.PGPASSWORD, database: connection.PGDATABASE,
  ssl: { rejectUnauthorized: true, ca: [...rootCertificates, certificate] }, connectionTimeoutMillis: 15000,
});
const dir = 'output/pharmacy-optional-details-20261107';
await mkdir(dir, { recursive: true });
const inspect = async () => {
  const functionState = (await client.query(`SELECT p.prosrc,pg_get_functiondef(p.oid) definition,p.prosecdef security_definer,p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
    FROM pg_proc p WHERE p.oid=to_regprocedure('public.record_pharmacy_controlled_supply()')`)).rows[0];
  const triggers = (await client.query(`SELECT tgname,tgenabled,pg_get_triggerdef(oid) definition FROM pg_trigger
    WHERE tgrelid='public.pharmacy_dispensed_items'::regclass
      AND tgfoid=to_regprocedure('public.record_pharmacy_controlled_supply()') AND NOT tgisinternal`)).rows;
  return { functionState, triggers };
};
let inTransaction = false;
try {
  await client.connect();
  const membership = (await client.query("SELECT pg_has_role(current_user,'postgres','MEMBER') allowed")).rows[0];
  if (!membership.allowed) throw new Error('The CLI login lacks its granted migration role.');
  await client.query('SET ROLE postgres');
  await client.query('BEGIN'); inTransaction = true;
  await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
  const locked = (await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) locked', [`pharmacy-migration-${version}`])).rows[0].locked;
  if (!locked) throw new Error('This migration is already running.');
  const before = await inspect();
  if (!before.functionState || !before.triggers.length) throw new Error('The controlled-sale register prerequisite is missing.');
  const currentBody = normalize(before.functionState.prosrc);
  if (![functionBody(oldSql), expected].includes(currentBody)) {
    await writeFile(`${dir}/unexpected-function.sql`, before.functionState.definition);
    throw new Error('The live register function differs from both reviewed versions; inspect the saved definition.');
  }
  const existing = (await client.query('SELECT name,statements FROM supabase_migrations.schema_migrations WHERE version=$1', [version])).rows[0];
  if (existing && (existing.name !== 'pharmacy_optional_controlled_sale_details' || normalize(existing.statements?.join('\n') ?? '') !== normalize(sql))) {
    throw new Error('The migration version is already used by different SQL.');
  }
  if (!existing) {
    await writeFile(`${dir}/function-before.sql`, before.functionState.definition);
    const body = sql.replace(/^BEGIN;\s*$/gmi, '').replace(/^COMMIT;\s*$/gmi, '');
    await client.query(body);
    await client.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3::text[])', [version, 'pharmacy_optional_controlled_sale_details', [sql]]);
  }
  const after = await inspect();
  const checks = {
    functionMatchesMigration: normalize(after.functionState.prosrc) === expected,
    triggerEnabled: after.triggers.some(t => t.tgname === 'pharmacy_controlled_supply' && ['O', 'A'].includes(t.tgenabled)),
    securityDefiner: after.functionState.security_definer,
    searchPathPreserved: after.functionState.proconfig?.includes('search_path=public, pg_temp') === true,
    directExecuteRestricted: !after.functionState.anon_execute && !after.functionState.authenticated_execute,
  };
  if (Object.values(checks).some(value => value !== true)) throw new Error(`Migration verification failed: ${JSON.stringify(checks)}`);
  await client.query('COMMIT'); inTransaction = false;
  const recorded = (await client.query('SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1', [version])).rows[0];
  if (recorded?.name !== 'pharmacy_optional_controlled_sale_details') throw new Error('Committed migration history verification failed.');
  const audit = { projectRef, file, status: existing ? 'already_applied' : 'applied', sha256: createHash('sha256').update(sql).digest('hex'), verifiedAt: new Date().toISOString(), checks };
  await writeFile(`${dir}/database-release.json`, JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit, null, 2));
} catch (error) {
  if (inTransaction) await client.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ error: error.message, code: error.code ?? null }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
