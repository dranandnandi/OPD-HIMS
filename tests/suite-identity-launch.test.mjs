import{test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{randomUUID,createHash}from'node:crypto';import{PGlite}from'@electric-sql/pglite';
test('approved product identities and single-use customer launches',async t=>{
 const db=new PGlite();t.after(()=>db.close());const actor=randomUUID(),owner=randomUUID(),stranger=randomUUID();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 await db.query('INSERT INTO auth.users VALUES($1,$2,now()),($3,$4,now())',[owner,'owner@example.com',stranger,'stranger@example.com']);
 for(const file of ['20261018120000_suite_platform.sql','20261019120000_suite_operations.sql','20261019160000_suite_invitations.sql','20261020100000_suite_runtime_refresh.sql','20261020110000_suite_resolve_access.sql','20261020130000_suite_identity_launch.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 const rpc=async(name,args)=>(await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;
 const mutate=(action,input)=>rpc('suite_mutate',[actor,randomUUID(),action,JSON.stringify(input)]);
 const org=(await mutate('create_organization',{name:'Linked clinic',owner_name:'Owner',owner_email:'owner@example.com',plan_code:'doctor_complete'})).organization_id;
 let detail=await rpc('suite_detail',[org]);const member=detail.members[0].id;const instance=randomUUID(),workforce=randomUUID();
 await rpc('suite_record_connection',['opd',instance,'production',actor]);await rpc('suite_record_connection',['workforce',workforce,'production',actor]);
 for(const product of ['opd','workforce'])await mutate('link_tenant',{organization_id:org,product_code:product,local_tenant_id:org+'-'+product,reason:'Verified tenant ownership'});
 detail=await rpc('suite_detail',[org]);const command={organization_id:org,product_code:'opd',member_id:member,local_user_id:owner,reason:'Explicitly approved verified account'};
 const input={...command,command,local_auth_id:owner,local_tenant_id:org+'-opd',binding_version:detail.bindings.find(b=>b.product_code==='opd').version,instance_id:instance};
 await t.test('identity proof is scoped and immutable, with durable request receipts',async()=>{
  await assert.rejects(rpc('suite_link_product_identity',[actor,randomUUID(),JSON.stringify({...input,local_tenant_id:'foreign'})]),/mapping changed/);
  await assert.rejects(rpc('suite_link_product_identity',[actor,randomUUID(),JSON.stringify({...input,local_auth_id:stranger})]),/must match/);
  const request=randomUUID();const result=await rpc('suite_link_product_identity',[actor,request,JSON.stringify(input)]);
  assert.deepEqual(await rpc('suite_link_product_identity',[actor,request,JSON.stringify({...input,binding_version:999})]),result);
  await assert.rejects(rpc('suite_link_product_identity',[actor,request,JSON.stringify({...input,command:{...command,local_user_id:stranger}})]),/different operation/);
  assert.equal((await rpc('suite_identity_detail',[org])).length,1);
 });
 const token=()=>createHash('sha256').update(randomUUID()).digest('hex');
 const createLaunch=hash=>rpc('suite_create_launch',[owner,org,'opd',hash]);
 await t.test('customers see only their memberships and pending setup cannot launch',async()=>{
  assert.deepEqual(await rpc('suite_member_apps',[stranger]),[]);
  const apps=await rpc('suite_member_apps',[owner]);assert.equal(apps.length,4);assert.equal(apps.find(a=>a.product_code==='opd').identity_linked,true);assert.equal(apps.find(a=>a.product_code==='opd').allowed,false);
  await assert.rejects(createLaunch(token()),/access is unavailable/);
  await assert.rejects(rpc('suite_create_launch',[stranger,org,'opd',token()]),/membership required/);
 });
 const sync=async()=>{for(const p of ['opd','growth','whatsapp','workforce']){const job=await rpc('suite_claim_job',[org,p]);if(job)await rpc('suite_finish_job',[job.job_id,job.lease_id,actor,job.local_tenant_id||org+'-'+p,null]);}};
 await mutate('grant_access',{organization_id:org,product_code:'opd',ends_at:new Date(Date.now()+86400000).toISOString(),reason:'Manual administrator approval'});await sync();
 await t.test('tickets are one-use and bound to product, instance and current access',async()=>{
  const hash=token();await createLaunch(hash);
  await assert.rejects(rpc('suite_redeem_launch',['workforce',hash,workforce]),/Invalid launch ticket/);
  await assert.rejects(rpc('suite_redeem_launch',['opd',hash,workforce]),/identity mismatch/);
  const result=await rpc('suite_redeem_launch',['opd',hash,instance]);assert.equal(result.local_auth_id,owner);assert.equal(result.local_tenant_id,org+'-opd');
  await assert.rejects(rpc('suite_redeem_launch',['opd',hash,instance]),/Invalid launch ticket/);
  const suspended=token();await createLaunch(suspended);await mutate('set_status',{organization_id:org,status:'suspended',reason:'Stop organisation access'});
  await assert.rejects(rpc('suite_redeem_launch',['opd',suspended,instance]),/access is unavailable/);
  await mutate('set_status',{organization_id:org,status:'active',reason:'Restore organisation access'});await sync();
 });
 await t.test('new launches invalidate outstanding links and expiry cannot be replayed',async()=>{
  const first=token(),second=token();await createLaunch(first);await createLaunch(second);
  await assert.rejects(rpc('suite_redeem_launch',['opd',first,instance]),/Invalid launch ticket/);
  await db.query('UPDATE suite_launch_tickets SET expires_at=now() WHERE token_hash=$1',[second]);
  await assert.rejects(rpc('suite_redeem_launch',['opd',second,instance]),/Invalid launch ticket/);
 });
 await t.test('browser roles cannot read identity/ticket tables or execute privileged RPCs',async()=>{
  for(const role of ['anon','authenticated']){
   for(const name of ['suite_product_identities','suite_launch_tickets'])assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,name])).rows[0].allowed,false);
   const rows=(await db.query("SELECT oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('suite_link_product_identity','suite_identity_detail','suite_member_apps','suite_create_launch','suite_redeem_launch')")).rows;
   for(const row of rows)assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,row.signature])).rows[0].allowed,false);
  }
 });
});
