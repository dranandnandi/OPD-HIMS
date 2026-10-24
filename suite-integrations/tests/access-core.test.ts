import { accessDeadline, activeMembers, handleAdapter, parseSnapshot, type Snapshot } from '../runtime/access-core.ts';

const org='11111111-1111-4111-8111-111111111111';
const user='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333';
const token='test-only-adapter-key-at-least-thirty-two-characters';
function assert(value: unknown): asserts value { if(!value)throw new Error('Assertion failed'); }
function rejects(fn:()=>unknown){let failed=false;try{fn();}catch{failed=true;}assert(failed);}
const clock=Date.parse('2026-10-20T10:00:00Z');
const snapshot=(now=clock):Snapshot=>({contract:'suite.access.v1',job_id:id,organization_id:org,product_code:'opd',version:1,local_tenant_id:'clinic',
  organization:{id:org,name:'Clinic',status:'active',plan_snapshot:{limits:{staff:5}}},
  members:[{id,user:undefined,auth_user_id:user,email:'owner@example.com',name:'Owner',role:'owner',status:'active'} as Snapshot['members'][number]],
  trial:{starts_at:new Date(now-3600000).toISOString(),ends_at:new Date(now+3600000).toISOString()},
  grants:[],messaging_routes:[],issued_at:new Date(now).toISOString(),refresh_by:new Date(now+300000).toISOString()});

Deno.test('product snapshot rejects mismatched product/org, stale freshness and malformed lists',()=>{
  const s=snapshot();assert(parseSnapshot(s,'opd',clock).version===1);
  rejects(()=>parseSnapshot(s,'workforce',clock));
  rejects(()=>parseSnapshot({...s,organization:{...s.organization,id:user}},'opd',clock));
  rejects(()=>parseSnapshot({...s,version:0},'opd',clock));
  rejects(()=>parseSnapshot({...s,issued_at:new Date(clock+31000).toISOString()},'opd',clock));
  rejects(()=>parseSnapshot({...s,refresh_by:new Date(clock).toISOString()},'opd',clock));
  rejects(()=>parseSnapshot({...s,refresh_by:new Date(clock+300001).toISOString()},'opd',clock));
  rejects(()=>parseSnapshot({...s,grants:[{starts_at:'invalid',ends_at:'invalid'}]},'opd',clock));
  rejects(()=>parseSnapshot({...s,members:[...s.members,{...s.members[0],id:org}]},'opd',clock));
});
Deno.test('expiry is exclusive, suspension overrides grants, revoked and future grants cannot activate access',()=>{
  const s=snapshot();assert(accessDeadline(s,clock)===s.trial!.ends_at);
  assert(accessDeadline(s,clock+3600000)===null);
  const future={starts_at:new Date(clock+1000).toISOString(),ends_at:new Date(clock+7200000).toISOString()};
  assert(accessDeadline({...s,trial:null,grants:[future]},clock)===null);
  assert(accessDeadline({...s,trial:null,grants:[{...future,starts_at:new Date(clock-1000).toISOString(),revoked_at:new Date(clock-1).toISOString()}]},clock)===null);
  assert(accessDeadline({...s,organization:{...s.organization,status:'suspended'}},clock)===null);
});
Deno.test('member capacity excludes billing and requires a verified product owner',()=>{
  const s=snapshot();assert(activeMembers(s).length===1);
  rejects(()=>activeMembers({...s,members:[]}));
  rejects(()=>activeMembers({...s,organization:{...s.organization,plan_snapshot:{limits:{}}}}));
  assert(activeMembers({...s,members:[...s.members,{...s.members[0],id:org,role:'billing'}]}).length===1);
  rejects(()=>activeMembers({...s,organization:{...s.organization,plan_snapshot:{limits:{staff:1}}},members:[...s.members,{...s.members[0],id:org,auth_user_id:id,role:'member'}]}));
});
Deno.test('adapter authenticates and pins deployment before writes; input cannot override its product',async()=>{
  let writes=0;
  const store={apply:async(s:Snapshot)=>{writes++;return{local_tenant_id:s.local_tenant_id!,version:s.version,enforcement:{server:false,workers:false,expires_at:true,tenant_isolation:false}};}};
  const config={product:'opd' as const,token,instance:id,environment:'production'};
  const request=(body:unknown,key=token,origin?:string)=>new Request('https://product.invalid/adapter',{method:'POST',headers:{Authorization:`Bearer ${key}`,...origin?{Origin:origin}:{}},body:JSON.stringify(body)});
  const s={...snapshot(Date.now()),target_instance_id:id,environment:'production'};
  assert((await handleAdapter(request(s,'wrong'),config,store)).status===401);
  assert((await handleAdapter(request(s,token,'https://browser.invalid'),config,store)).status===403);
  assert((await handleAdapter(request({...s,target_instance_id:org}),config,store)).status===409);
  assert((await handleAdapter(request({...s,product_code:'growth'}),config,store)).status===400);
  assert(writes===0);
  const response=await handleAdapter(request(s),config,store);const result=await response.json();
  assert(response.status===200 && result.enforcement.server===false && Number(writes)===1);
  // Partial enforcement is reported as such, never silently converted to ready.
});
Deno.test('adapter refuses tenant/version conflict and never returns internal storage errors',async()=>{
  const body={...snapshot(Date.now()),target_instance_id:id,environment:'production'};
  const req=()=>new Request('https://product.invalid/adapter',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  const config={product:'opd' as const,token,instance:id,environment:'production'};
  const response=await handleAdapter(req(),config,{apply:async()=>({local_tenant_id:'foreign',version:2,enforcement:{server:true,workers:true,expires_at:true,tenant_isolation:true}})});
  assert(response.status===409);
  const broken=await handleAdapter(req(),config,{apply:()=>{throw new Error('database-password-secret');}});
  assert(broken.status===503 && !(await broken.text()).includes('database-password-secret'));
});
