import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const path='output/meditrust-pharmacy-20261030/frontend-release.json';
const plan=JSON.parse(await readFile(path,'utf8'));
if(plan.siteId!=='834b9451-04b7-4103-a60f-7372a434979e' || !plan.domainAliases.includes('opdapp.anprohealthtech.com')) throw new Error('Unexpected frontend release target.');
async function api(method,data) {
  const cli=process.env.PHARMACY_NETLIFY_CLI;
  if(!cli) throw new Error('Set the Netlify CLI entrypoint.');
  const child=spawn(process.execPath,[cli,'api',method,'--data',JSON.stringify(data)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
  const timer=setTimeout(()=>child.kill(),120000);
  const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
  if(code!==0 || !out.trim()) throw new Error(`Netlify ${method} failed: ${err.slice(-1000)}`);
  return JSON.parse(out);
}
async function verify(origin) {
  const response=await fetch(`${origin}/pharmacy?release=${plan.draft.id}`,{signal:AbortSignal.timeout(30000),cache:'no-store'});
  if(!response.ok) throw new Error('Pharmacy route unavailable.');
  const html=await response.text();const script=html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  if(!script) throw new Error('App bundle not found.');
  const bundle=await fetch(new URL(script,origin),{signal:AbortSignal.timeout(30000)});
  const js=await bundle.text();
  // Primary uses the custom Supabase API hostname. The Sydney URL also remains
  // in the bundle as an explicitly disabled fallback; do not mistake it for the
  // active database or silently switch the production environment.
  let primaryKey;
  for(const token of js.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]) {
    try { const value=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
      if(value.ref==='kiezgfhonvwryxpubfvl' && value.role==='anon') primaryKey=token;
    } catch {}
  }
  const checks={route:response.status,bundle:bundle.status,
    customPrimaryHost:js.includes('https://clinic.anprohealthtech.com'),primaryKeyMatchesProject:!!primaryKey,
    fallbackDisabled:/["']false["']\.toLowerCase\(\)\s*===?\s*["']true["']/.test(js),
    prescriptionForm:js.includes('NRx / H1 prescription and supply details'),
    expiryIndicator:js.includes('Expiry not recorded'),register:js.includes('NRx / H1 Register'),merge:js.includes('Merge duplicate products')};
  if(!bundle.ok || Object.values(checks).some(v=>v===false)) throw new Error(`Frontend verification failed: ${JSON.stringify(checks)}`);
  const guarded=await fetch('https://clinic.anprohealthtech.com/rest/v1/rpc/pharmacy_controlled_sale_register',{
    method:'POST',headers:{apikey:primaryKey,Authorization:`Bearer ${primaryKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_from:'2026-10-01',p_to:'2026-10-30',p_kind:'all',p_page:0}),signal:AbortSignal.timeout(30000)});
  const reply=await guarded.json().catch(()=>({}));
  checks.customApiPermissionGuard=[401,403].includes(guarded.status) && reply.code==='42501';
  if(!checks.customApiPermissionGuard) throw new Error('Custom API did not return the expected register permission guard.');
  return {bundle:script,checks};
}
try {
  const checked=await verify(plan.draft.url);
  plan.draft={...plan.draft,...checked,verified:true};
  await writeFile(path,JSON.stringify(plan,null,2));
  console.log(JSON.stringify({draftVerified:true,checks:checked.checks}));
  if(process.argv.includes('--publish')) {
    const released=await api('restoreSiteDeploy',{site_id:plan.siteId,deploy_id:plan.draft.id});
    plan.production={id:released.id||plan.draft.id,publishedAt:new Date().toISOString(),verified:false};
    await writeFile(path,JSON.stringify(plan,null,2));
    const live=await verify('https://opdapp.anprohealthtech.com');
    if(live.bundle!==plan.draft.bundle) throw new Error('Production still serves a different app bundle.');
    plan.production={...plan.production,...live,verified:true,url:'https://opdapp.anprohealthtech.com/pharmacy'};
    await writeFile(path,JSON.stringify(plan,null,2));
    console.log(JSON.stringify({production:plan.production},null,2));
  }
} catch(error) { console.error(error.message);process.exitCode=1; }
