import { requireTenantAccess } from '../runtime/tenant-access.ts';
function assert(v:unknown):asserts v {if(!v)throw new Error('Assertion failed');}
async function rejected(work:()=>Promise<unknown>){let failed=false;try{await work();}catch{failed=true;}assert(failed);}
const settings={enabled:'true',url:'https://central.invalid/functions/v1/suite-product-access',token:'test-only-access-token-at-least-thirty-two-chars'};
const state=()=>{const now=Date.now();return {contract:'suite.access.v1',managed:true,product_code:'workforce',local_tenant_id:'task-org',allowed:true,issued_at:new Date(now).toISOString(),refresh_by:new Date(now+300000).toISOString(),access_until:new Date(now+3600000).toISOString()};};
Deno.test('dispatch verifies product/tenant, current permission and freshness on every call',async()=>{
 const old=globalThis.fetch;let value=state(),calls=0;
 globalThis.fetch=(async(_url,init)=>{const options=init as RequestInit;calls++;assert(options.redirect==='error');assert(JSON.parse(String(options.body)).local_tenant_id==='task-org');return Response.json(value);})as typeof fetch;
 try{
  await requireTenantAccess('workforce','task-org',settings);
  value={...state(),allowed:false};await rejected(()=>requireTenantAccess('workforce','task-org',settings));
  value={...state(),local_tenant_id:'foreign'};await rejected(()=>requireTenantAccess('workforce','task-org',settings));
  value={...state(),product_code:'whatsapp'};await rejected(()=>requireTenantAccess('workforce','task-org',settings));
  value={...state(),refresh_by:new Date(Date.now()-1000).toISOString()};await rejected(()=>requireTenantAccess('workforce','task-org',settings));
  value={...state(),access_until:new Date(Date.now()-1000).toISOString()};await rejected(()=>requireTenantAccess('workforce','task-org',settings));
  assert(calls===6);
 }finally{globalThis.fetch=old;}
});
Deno.test('dispatch denies unknown tenants by default, needs explicit legacy allowance, and fails closed on outage',async()=>{
 const old=globalThis.fetch;
 try{
  globalThis.fetch=(async()=>Response.json({...state(),managed:false,allowed:false}))as typeof fetch;
  await rejected(()=>requireTenantAccess('workforce','task-org',settings));
  await requireTenantAccess('workforce','task-org',{...settings,allowUnmanaged:'true'});
  globalThis.fetch=(async()=>{throw new Error('network-secret');})as typeof fetch;
  await rejected(()=>requireTenantAccess('workforce','task-org',settings));
  await rejected(()=>requireTenantAccess('workforce','task-org',{...settings,token:undefined}));
  await rejected(()=>requireTenantAccess('workforce','task-org',{...settings,url:'http://central.invalid'}));
  // Legacy mode alone skips network, and must never be advertised as enforcement.
  await requireTenantAccess('workforce','task-org',{enabled:'false'});
 }finally{globalThis.fetch=old;}
});
