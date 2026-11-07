import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import pg from 'pg';

const ref=(await readFile('supabase/.temp/project-ref','utf8')).trim();
if(ref!=='kiezgfhonvwryxpubfvl') throw new Error('Unexpected project');
const result=spawnSync('supabase.exe',['db','dump','--linked','--dry-run'],{encoding:'utf8',windowsHide:true,timeout:60000});
if(result.status!==0) throw new Error('Cannot initialize read-only database session: '+JSON.stringify({status:result.status,code:result.error?.code,detail:(result.stderr||'').replace(/postgres(?:ql)?:\/\/\S+/g,'[connection redacted]').slice(0,1100)}));
const vars={};
for(const n of ['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE']) {
 const m=result.stdout.match(new RegExp(`^\\s*(?:export\\s+)?${n}=(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s\\n]+))\\s*$`,'m'));
 if(!m) throw new Error(`Missing ${n}`); vars[n]=m[1]??m[2]??m[3];
 if(vars[n].includes('${')||vars[n].includes('$(')) throw new Error('Unresolved connection value');
}
if(!vars.PGHOST.endsWith('.supabase.com')||!vars.PGUSER.includes(ref)) throw new Error('Target mismatch');
const resp=await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt',{signal:AbortSignal.timeout(20000)});
if(!resp.ok) throw new Error('Cannot obtain database CA');
const cert=await resp.text();const ca=new X509Certificate(cert);
if(!ca.ca||!ca.subject.includes('Supabase')) throw new Error('CA mismatch');
const client=new pg.Client({host:vars.PGHOST,port:+vars.PGPORT,user:vars.PGUSER,password:vars.PGPASSWORD,database:vars.PGDATABASE,ssl:{rejectUnauthorized:true,ca:[...rootCertificates,cert]},connectionTimeoutMillis:20000});
try {
 await client.connect();
 if(!(await client.query("SELECT pg_has_role(current_user,'postgres','MEMBER') ok")).rows[0].ok) throw new Error('Expected database access unavailable');
 await client.query('SET ROLE postgres');
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout='45s'");
 const clinic=(await client.query("SELECT id,clinic_name FROM public.clinic_settings WHERE id='238307be-362b-4fff-bb9a-3f2f9ff44519'")).rows[0];
 if(clinic?.clinic_name!=='Meditrust Clinics') throw new Error('Clinic mismatch');
 const queries=JSON.parse(await readFile(process.argv[2],'utf8'));const data={clinic,extractedAt:new Date().toISOString(),results:{}};
 for(const [name,sql] of Object.entries(queries)) {
  data.results[name]=(await client.query(sql)).rows;
  console.log(name+': '+data.results[name].length+' rows');
 }
 await mkdir('outputs/meditrust-october-2026',{recursive:true});
 await writeFile(process.argv[3],JSON.stringify(data,null,2));
 await client.query('ROLLBACK');
} finally {await client.end();}
