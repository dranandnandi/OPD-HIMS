// Explicit release of this session's pharmacy migrations only.
// Supabase CLI supplies an ephemeral database login in memory; never persist it.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import pg from 'pg';

const projectRef = (await readFile('supabase/.temp/project-ref','utf8')).trim();
if (projectRef !== 'kiezgfhonvwryxpubfvl') throw new Error('Unexpected linked project.');
const exported = spawnSync('supabase.exe',['db','dump','--linked','--dry-run'], {
  encoding:'utf8',windowsHide:true,timeout:60000,
});
if (exported.status !== 0) throw new Error('Supabase CLI could not initialize its database login.');
const connection = {};
for (const name of ['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE']) {
  const match = exported.stdout.match(new RegExp(`^\\s*(?:export\\s+)?${name}=(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s\\n]+))\\s*$`,'m'));
  if (!match) throw new Error(`CLI did not provide ${name}.`);
  connection[name] = match[1] ?? match[2] ?? match[3];
  if (connection[name].includes('${') || connection[name].includes('$(')) throw new Error('CLI connection has an unresolved value.');
}
if (!connection.PGHOST.endsWith('.supabase.com') || !connection.PGUSER.includes(projectRef)) throw new Error('Database target does not match the linked project.');
const certificateResponse=await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt',{signal:AbortSignal.timeout(20000)});
if(!certificateResponse.ok) throw new Error('Could not download the published Supabase CA certificate.');
const certificate=await certificateResponse.text();
const authority=new X509Certificate(certificate);
if(!authority.ca || !authority.subject.includes('Supabase')) throw new Error('Unexpected database certificate authority.');
const client = new pg.Client({host:connection.PGHOST,port:Number(connection.PGPORT),user:connection.PGUSER,
  password:connection.PGPASSWORD,database:connection.PGDATABASE,ssl:{rejectUnauthorized:true,ca:[...rootCertificates,certificate]},connectionTimeoutMillis:15000});
const schemaFiles = [
  '20261026160000_pharmacy_generic_name_reviews.sql',
  '20261026180000_pharmacy_generic_name_cleanup.sql',
  '20261026190000_pharmacy_generic_name_claude.sql',
  '20261030090000_pharmacy_catalogue_options.sql',
  '20261030091000_pharmacy_controlled_sale_register.sql',
  '20261030092000_pharmacy_product_merge.sql',
  '20261030093000_meditrust_drug_licence.sql',
];
const flagFile = '20261030094000_meditrust_controlled_medicine_flags.sql';
const outputPath = 'output/meditrust-pharmacy-20261030/database-release.json';
let audit;
try { audit=JSON.parse(await readFile(outputPath,'utf8')); }
catch(error) { if(error.code!=='ENOENT') throw error; audit={projectRef,applied:[]}; }
if(audit.projectRef!==projectRef) throw new Error('Release audit belongs to another database.');
try {
  await client.connect();
  const membership=(await client.query(`SELECT current_user login_role,
    pg_has_role(current_user,'postgres','MEMBER') postgres_membership,
    (SELECT rolinherit FROM pg_roles WHERE rolname=current_user) inherits_memberships`)).rows[0];
  if(process.argv.includes('--inspect-login')) {
    console.log(JSON.stringify({projectRef,readOnlyLoginInspection:membership},null,2));
    await writeFile('output/meditrust-pharmacy-20261030/database-login-grants.json',JSON.stringify({projectRef,checkedAt:new Date().toISOString(),...membership},null,2));
    await client.end(); process.exit(0);
  }
  // Requires separate release review after inspecting the existing membership.
  if(process.argv.includes('--use-granted-migration-role')) {
    if(!membership.postgres_membership) throw new Error('The CLI login is not a member of the migration role.');
    await client.query('SET ROLE postgres');
  }
  if(process.argv.includes('--inspect-layouts')) {
    const columns=(await client.query(`SELECT table_name,column_name,data_type,is_nullable
      FROM information_schema.columns WHERE table_schema='public' AND
      (table_name='medicine_generic_name_reviews' OR
       (table_name='medicines_master' AND column_name IN ('updated_at','is_nrx','is_schedule_h1','merged_into','opening_pool_quantity','opening_pool_value')))
      ORDER BY table_name,ordinal_position`)).rows;
    const policy=(await client.query("SELECT policyname,cmd,roles,qual FROM pg_policies WHERE schemaname='public' AND tablename='medicine_generic_name_reviews'")).rows;
    console.log(JSON.stringify({columns,policy},null,2));
    await client.end(); process.exit(0);
  }
  const history=(await client.query('SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
  const installed=new Set(history.map(r=>r.version));
  if(!audit.before) {
    const fingerprint=(await client.query(`SELECT clinic_id,count(*)::integer products,
      md5(string_agg(id::text || ':' || coalesce(current_stock::text,'') || ':' || coalesce(generic_name,''),'|' ORDER BY id)) fingerprint
      FROM public.medicines_master GROUP BY clinic_id ORDER BY clinic_id`)).rows;
    audit.before={at:new Date().toISOString(),historyVersions:history.map(r=>r.version),medicineFingerprints:fingerprint};
    await writeFile(outputPath,JSON.stringify(audit,null,2));
  }
  if(process.argv.includes('--apply-schema') || process.argv.includes('--apply-flags')) {
    const files=process.argv.includes('--apply-flags') ? [flagFile] : schemaFiles;
    if(files.includes(flagFile) && !schemaFiles.every(f=>installed.has(f.split('_')[0]))) throw new Error('Apply the pharmacy schema migrations first.');
    if(files.includes(flagFile)) {
      const frontend=JSON.parse(await readFile('output/meditrust-pharmacy-20261030/frontend-release.json','utf8'));
      if(frontend.production?.verified!==true) throw new Error('Verify the published prescription-details frontend before activating medicine flags.');
      const plan=JSON.parse(await readFile('supabase/seed/meditrust_controlled_medicines_20261030.json','utf8'));
      const rows=(await client.query('SELECT id,name,generic_name,is_active FROM public.medicines_master WHERE clinic_id=$1 AND id=ANY($2::uuid[])',[plan.clinicId,plan.medicines.map(m=>m.id)])).rows;
      const mismatches=plan.medicines.filter(m=>!rows.some(r=>r.id===m.id && r.name===m.name && r.generic_name===m.generic && r.is_active));
      if(mismatches.length) throw new Error(`Medicine identities changed since review: ${mismatches.map(m=>m.name).join(', ')}`);
    }
    for(const file of files) {
      const [version,...parts]=file.replace(/\.sql$/,'').split('_');
      if(installed.has(version)) { console.log(`Already applied: ${file}`); continue; }
      const sql=await readFile(`supabase/migrations/${file}`,'utf8');
      // Keep migration history and DDL atomic. Commit the enum migration before
      // subsequent migrations use new enum labels. Do not repair older history.
      const body=sql.replace(/^BEGIN;\s*$/gmi,'').replace(/^COMMIT;\s*$/gmi,'');
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
        const results=await client.query(body);
        audit.lastEffect=(Array.isArray(results)?results:[results]).filter(r=>r.command==='UPDATE').map(r=>({command:r.command,rows:r.rowCount}));
        await client.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3::text[])',[version,parts.join('_'),[sql]]);
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; }
      installed.add(version);
      audit.applied.push({file,sha256:createHash('sha256').update(sql).digest('hex'),at:new Date().toISOString(),effects:audit.lastEffect});
      await writeFile(outputPath,JSON.stringify(audit,null,2));
      console.log(`Applied: ${file}`);
    }
  }
  const check=(await client.query(`SELECT to_regclass('public.medicine_generic_name_reviews') IS NOT NULL generic_reviews,
    to_regclass('public.pharmacy_controlled_sales') IS NOT NULL controlled_register,
    to_regclass('public.pharmacy_product_merges') IS NOT NULL product_merges,
    to_regprocedure('public.merge_pharmacy_products(uuid,uuid,text)') IS NOT NULL merge_rpc`)).rows[0];
  const fingerprints=(await client.query(`SELECT clinic_id,count(*)::integer products,
    md5(string_agg(id::text || ':' || coalesce(current_stock::text,'') || ':' || coalesce(generic_name,''),'|' ORDER BY id)) fingerprint
    FROM public.medicines_master GROUP BY clinic_id ORDER BY clinic_id`)).rows;
  const flags=check.controlled_register ? (await client.query(`SELECT clinic_id,count(*) FILTER(WHERE is_nrx)::integer nrx,
    count(*) FILTER(WHERE is_schedule_h1)::integer h1 FROM public.medicines_master WHERE is_active GROUP BY clinic_id ORDER BY clinic_id`)).rows : [];
  audit.verified={at:new Date().toISOString(),schema:check,medicineFingerprints:fingerprints,flags,
    appliedVersions:[...installed].filter(v=>[...schemaFiles,flagFile].some(f=>f.startsWith(v+'_')))};
  await writeFile(outputPath,JSON.stringify(audit,null,2));
  console.log(JSON.stringify({projectRef,schema:check,appliedThisSession:audit.applied.length,flags},null,2));
} catch(error) {
  console.error(JSON.stringify({error:error.message,code:error.code || null}));process.exitCode=1;
} finally { await client.end().catch(()=>{}); }
