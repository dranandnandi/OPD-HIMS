// Explicit maintenance for the clinic requested by the user; read-only unless --apply.
// The linked-project CLI supplies credentials in memory. Never log or persist keys.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const plan = JSON.parse(await readFile(new URL('../supabase/seed/meditrust_generic_name_sources_20261030.json', import.meta.url), 'utf8'));
const apply = process.argv.includes('--apply');
const ref = (await readFile(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8')).trim();
const cli = spawnSync(process.platform === 'win32' ? 'supabase.exe' : 'supabase', ['projects','api-keys','--project-ref',ref,'--output','json'], { encoding:'utf8',timeout:30000,windowsHide:true });
if (cli.status !== 0) throw new Error(`Cannot access the linked Supabase project through its CLI session: ${cli.error?.code || ''} ${(cli.stderr || '').slice(0,300)}`);
const key = JSON.parse(cli.stdout).find(k => k.name === 'service_role')?.api_key;
if (!key) throw new Error('Linked project maintenance credential is unavailable.');
const base = `https://${ref}.supabase.co/rest/v1/`;
const headers = { apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
async function request(path, options={}) {
  const response = await fetch(base+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(30000)});
  if (!response.ok) {
    const detail=await response.json().catch(()=>({}));
    throw new Error(`Clinic maintenance request failed: HTTP ${response.status} ${detail.code || ''} ${detail.message || ''}`);
  }
  return response.status === 204 ? null : response.json();
}
const facility = await request(`clinic_settings?id=eq.${plan.clinicId}&select=id,clinic_name,drug_license_number`);
if (facility.length !== 1 || facility[0].clinic_name !== plan.clinicName || facility[0].drug_license_number !== plan.drugLicence) throw new Error('Clinic identity or licence does not match the reviewed plan.');
const medicines=[];
for(let offset=0;;offset+=500) {
  const page=await request(`medicines_master?clinic_id=eq.${plan.clinicId}&is_active=eq.true&select=*&order=name,id&offset=${offset}&limit=500`);
  medicines.push(...page); if(page.length<500) break;
}
const label = value => (value || '').trim().replace(/\s+/g,' ').toLowerCase();
const rules=new Map();
for(const group of plan.groups) for(const name of group.names) {
  if(rules.has(label(name))) throw new Error(`Duplicate rule for ${name}`);
  if(!group.source.startsWith('https://') || !group.generic.trim()) throw new Error('Each change needs a composition and evidence URL.');
  rules.set(label(name),group);
}
const changes=[],remaining=[];
for(const medicine of medicines) {
  const old=medicine.generic_name || '';
  // Distinct compositions are preserved except for separately reviewed,
  // exact before-value corrections with manufacturer evidence.
  const correction=(plan.reviewedCorrections || []).find(c=>c.id===medicine.id && c.name===medicine.name && c.previousGeneric===medicine.generic_name);
  if(old.trim() && label(old)!==label(medicine.name) && !correction) continue;
  const group=correction || rules.get(label(medicine.name));
  if(!group) {remaining.push({id:medicine.id,name:medicine.name,generic:medicine.generic_name,manufacturer:medicine.manufacturer});continue;}
  changes.push({id:medicine.id,name:medicine.name,previousGeneric:medicine.generic_name,generic:group.generic,source:group.source,note:group.note || '',snapshot:medicine,status:'planned'});
}
const outputDir=resolve('output/meditrust-pharmacy-20261030'); await mkdir(outputDir,{recursive:true});
const auditPath=resolve(outputDir,'generic-name-maintenance.json');
// Preserve the first before-image across retries. No patient records are read.
let audit;
try { audit=JSON.parse(await readFile(auditPath,'utf8')); }
catch(error) { if(error.code!=='ENOENT') throw error; audit={clinic:facility[0],sourceCheckedOn:plan.sourceCheckedOn,changes:[],remaining:[]}; }
if(audit.clinic?.id!==plan.clinicId) throw new Error('The existing audit belongs to another clinic.');
for(const change of changes) if(!audit.changes.some(c=>c.id===change.id)) audit.changes.push(change);
audit.remaining=remaining; await writeFile(auditPath,JSON.stringify(audit,null,2));
if(apply) {
  for(const change of changes) {
    const saved=audit.changes.find(c=>c.id===change.id);
    const params=new URLSearchParams({id:`eq.${change.id}`,clinic_id:`eq.${plan.clinicId}`,is_active:'eq.true'});
    // Some imported catalogues predate updated_at. Compare every identity
    // field, and compare the timestamp too when the installation has one.
    for(const field of ['name','strength','manufacturer','dosage_form','updated_at']) {
      if(change.snapshot[field] !== undefined) params.set(field,change.snapshot[field] === null ? 'is.null' : `eq.${change.snapshot[field]}`);
    }
    params.set('generic_name',change.previousGeneric === null ? 'is.null' : `eq.${change.previousGeneric}`);
    params.set('select','id,generic_name');
    const rows=await request(`medicines_master?${params}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({generic_name:change.generic})});
    saved.status=rows.length===1 && rows[0].generic_name===change.generic ? 'saved' : 'changed_since_review';
    if(saved.previousGeneric!==change.previousGeneric) {
      (saved.reviewedCorrections ||= []).push({previousGeneric:change.previousGeneric,generic:change.generic,source:change.source,note:change.note,at:new Date().toISOString(),status:saved.status});
    }
    saved.appliedAt=new Date().toISOString();
    await writeFile(auditPath,JSON.stringify(audit,null,2));
  }
}
if(process.argv.includes('--catalogue-review')) {
  const reviewed=[];
  for(let offset=0;;offset+=500) {
    const page=await request(`medicines_master?clinic_id=eq.${plan.clinicId}&is_active=eq.true&select=id,name,generic_name,strength,manufacturer,dosage_form,current_stock&order=name,id&offset=${offset}&limit=500`);
    reviewed.push(...page); if(page.length<500) break;
  }
  await writeFile(resolve(outputDir,'catalogue-review.json'),JSON.stringify({clinic:facility[0],checkedAt:new Date().toISOString(),medicines:reviewed},null,2));
}
console.log(JSON.stringify({clinic:facility[0].clinic_name,activeProducts:medicines.length,mode:apply?'apply':'preview',plannedThisRun:changes.length,saved:audit.changes.filter(c=>c.status==='saved').length,remaining:remaining.length,auditPath,...(process.argv.includes('--verbose') ? {changes:changes.map(c=>({name:c.name,generic:c.generic,note:c.note}))} : {})},null,2));
