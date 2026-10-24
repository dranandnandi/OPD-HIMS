import{deliverProduct}from'./suite-delivery.ts';
function assert(value:unknown,message='Assertion failed'):asserts value{if(!value)throw Error(message);}
Deno.test('product and dependency provisioning complete in order; a retry preserves the verified source identity',async()=>{
 const org='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',instance='33333333-3333-4333-8333-333333333333';
 const settings={SUITE_ENVIRONMENT:'staging',SUITE_OPD_ADAPTER_URL:'https://opd.invalid/adapter',SUITE_OPD_ADAPTER_TOKEN:'product-credential-at-least-thirty-two-chars',SUITE_OPD_INSTANCE_ID:instance,SUITE_LEGACY_WHATSAPP_INSTANCE_ID:actor,SUITE_LEGACY_WHATSAPP_DEPENDENCY_URL:'https://legacy.invalid/api/suite/dependency',SUITE_OPD_DEPENDENCY_TOKEN:'dependency-credential-at-least-thirty-two-chars'};
 const old=Object.fromEntries(Object.keys(settings).map(k=>[k,Deno.env.get(k)])),oldFetch=globalThis.fetch;
 Object.entries(settings).forEach(([k,v])=>Deno.env.set(k,v));
 const job={contract:'suite.access.v1',job_id:org,lease_id:actor,organization_id:org,product_code:'opd',version:1,local_tenant_id:null};
 const identities=[{member_id:actor,local_user_id:actor,local_auth_id:actor}];const enforcement={server:true,workers:true,expires_at:true,tenant_isolation:true};
 let fail=true;const order:string[]=[];
 const rpc=async(name:string,args:Record<string,unknown>)=>{order.push(name);if(name==='suite_claim_job')return job;if(name==='suite_finish_job'){order.push(args.p_error?'failed':'ready');return true;}return true;};
 globalThis.fetch=(async(input,init)=>{
  const target=String(input);assert(init?.redirect==='error');const body=JSON.parse(String(init?.body));
  if(target===settings.SUITE_OPD_ADAPTER_URL){order.push('product');return Response.json({...job,local_tenant_id:'clinic',identities,enforcement});}
  assert(target===settings.SUITE_LEGACY_WHATSAPP_DEPENDENCY_URL);order.push('dependency');
  assert(new Headers(init?.headers).get('Authorization')==='Bearer '+settings.SUITE_OPD_DEPENDENCY_TOKEN);
  assert(body.provisioned_identities[0].local_auth_id===actor&&body.local_tenant_id==='clinic'&&body.target_instance_id===actor);
  if(fail)return Response.json({error:'Temporary failure'},{status:503});
  return Response.json({...job,local_tenant_id:'clinic',identities:[{member_id:actor,source_user_id:actor,local_user_id:'backend-user'}],enforcement});
 })as typeof fetch;
 try{
  let rejected=false;try{await deliverProduct(rpc,actor,org,'opd');}catch{rejected=true;}assert(rejected);assert(!order.includes('ready'));assert(order.indexOf('suite_note_provisioning')<order.indexOf('dependency'));
  fail=false;order.length=0;await deliverProduct(rpc,actor,org,'opd');assert(order.join(',')==='suite_claim_job,product,suite_note_provisioning,dependency,suite_note_dependency,suite_finish_job,ready');
 }finally{globalThis.fetch=oldFetch;for(const[k,v]of Object.entries(old))v===undefined?Deno.env.delete(k):Deno.env.set(k,v);}
});
