import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
test('actual provisioning receipts are scoped to the current job lease',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 const owner=randomUUID(),actor=randomUUID(),instance=randomUUID();
 await db.query('INSERT INTO auth.users VALUES($1,$2,now())',[owner,'owner@example.com']);
 for(const name of ['20261018120000_suite_platform.sql','20261019120000_suite_operations.sql','20261019160000_suite_invitations.sql','20261020100000_suite_runtime_refresh.sql','20261020110000_suite_resolve_access.sql','20261020130000_suite_identity_launch.sql','20261020150000_suite_provisioning_receipts.sql','20261022100000_suite_dependency_receipts.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const rpc=async(name,args=[])=>(await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const org=(await rpc('suite_mutate',[actor,randomUUID(),'create_organization',JSON.stringify({name:'Receipt clinic',owner_name:'Owner',owner_email:'owner@example.com',plan_code:'doctor_complete'})])).organization_id;
 await rpc('suite_record_connection',['opd',instance,'production',actor]);
 const job=await rpc('suite_claim_job',[org,'opd']);const member=job.members.find(m=>m.role==='owner');const tenant=randomUUID();
 const identities=[{member_id:member.id,local_user_id:owner,local_auth_id:owner}];
 const receipt=(values=identities,lease=job.lease_id,target=tenant)=>rpc('suite_note_provisioning',[job.job_id,lease,actor,instance,target,JSON.stringify(values)]);
 await t.test('wrong lease and incomplete identity sets cannot record readiness',async()=>{
  assert.equal(await receipt(identities,randomUUID()),false);
  await assert.rejects(receipt([]),/every active/);
  await assert.rejects(receipt([{...identities[0],local_auth_id:randomUUID()}]),/identity mismatch/);
  assert.equal((await rpc('suite_identity_detail',[org])).length,0);
 });
 await t.test('retries preserve exact IDs without duplicate audit entries',async()=>{
  assert.equal(await receipt(),true);assert.equal(await receipt(),true);
  assert.equal((await rpc('suite_identity_detail',[org]))[0].local_user_id,owner);
  assert.equal((await db.query("SELECT count(*) n FROM suite_audit WHERE action='provision_product_identities' AND organization_id=$1",[org])).rows[0].n,1);
  await assert.rejects(receipt([{...identities[0],local_user_id:randomUUID()}]),/silently reassigned/);
  await assert.rejects(receipt(identities,job.lease_id,randomUUID()),/linked tenant/);
 });
 await t.test('dependency receipts bind the real source, backend instance, account and lease',async()=>{
  const backend=randomUUID(),backendUser=randomUUID();await rpc('suite_record_connection',['legacy_whatsapp',backend,'production',actor]);
  const entries=[{member_id:member.id,source_user_id:owner,local_user_id:backendUser}];
  const note=(items=entries,lease=job.lease_id,host=backend)=>rpc('suite_note_dependency',[job.job_id,lease,actor,host,JSON.stringify(items)]);
  assert.equal(await note(entries,randomUUID()),false);
  await assert.rejects(note(entries,job.lease_id,instance),/not registered/);
  await assert.rejects(note([{...entries[0],source_user_id:randomUUID()}]),/source identity mismatch/);
  await assert.rejects(note([]),/every active/);
  await assert.rejects(note([entries[0],entries[0]]),/Duplicate/);
  assert.equal(await note(),true);assert.equal(await note(),true);
  await assert.rejects(note([{...entries[0],local_user_id:randomUUID()}]),/silently reassigned/);
  assert.equal((await db.query("SELECT count(*) n FROM suite_audit WHERE action='provision_dependency_identities' AND organization_id=$1",[org])).rows[0].n,1);
  for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,'suite_note_dependency(uuid,uuid,uuid,uuid,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 });
 await t.test('the receipt does not mark the binding ready; completion still requires its lease',async()=>{
  const state=(await db.query("SELECT state FROM suite_bindings WHERE organization_id=$1 AND product_code='opd'",[org])).rows[0].state;
  assert.notEqual(state,'ready');
  assert.equal(await rpc('suite_finish_job',[job.job_id,job.lease_id,actor,tenant,null]),true);
  assert.equal(await receipt(),false);
  await db.query("UPDATE suite_jobs SET updated_at=now()-interval '4 minutes' WHERE id=$1",[job.job_id]);
  const refreshed=await rpc('suite_claim_job',[org,'opd']);assert.equal(refreshed.identity_links[0].local_user_id,owner);assert.equal(refreshed.product_links[0].local_user_id,owner);assert.equal(refreshed.bindings.length,4);
 });
 await t.test('browser roles cannot issue provisioning receipts',async()=>{
  for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,'suite_note_provisioning(uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 });
});
