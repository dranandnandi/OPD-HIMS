import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['suite-integrations/runtime/node-store.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {applyNodeSnapshot,checkNodeUser}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const schema=await readFile(new URL('../runtime/node-runtime.sql',import.meta.url),'utf8');
for(const modern of [true,false])test(`${modern?'modern':'legacy'} messaging provisioning and product isolation`,async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const old=randomUUID(),backend=randomUUID(),org=randomUUID(),member=randomUUID(),auth=randomUUID();
 await db.exec(modern?`CREATE TABLE users(id varchar PRIMARY KEY,username text UNIQUE,password text,email text,organization_id text,role text,created_at timestamptz,updated_at timestamptz);CREATE TABLE sessions(id uuid PRIMARY KEY,user_id varchar REFERENCES users(id),secret text);`:`CREATE TABLE users(id uuid PRIMARY KEY,username text UNIQUE,password_hash text,auth_id uuid,role text);CREATE TABLE sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),secret text);`);
 if(modern)await query('INSERT INTO users(id,username,password,organization_id,role) VALUES($1,$2,$3,$4,$5)',[old,'existing','unchanged',org,'user']);
 else await query('INSERT INTO users VALUES($1,$2,$3,$4,$5)',[old,'existing','unchanged',auth,'user']);
 await query('INSERT INTO sessions VALUES($1,$2,$3)',[randomUUID(),old,'keep-session']);
 if(modern)await db.exec('CREATE TABLE whatsapp_sessions(id uuid PRIMARY KEY,user_id varchar REFERENCES users(id),session_name text);');
 for(const statement of schema.split('-- ds-statement'))await db.exec(statement);
 const base={contract:'suite.access.v1',job_id:randomUUID(),organization_id:org,product_code:modern?'workforce':'opd',version:1,local_tenant_id:org,organization:{id:org,name:'Clinic',status:'active',plan_snapshot:{limits:{staff:5,employees:5,operators:5}}},members:[{id:member,auth_user_id:auth,name:'Owner',email:'owner@example.com',status:'active',role:'owner'}],trial:null,grants:[{starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+60000).toISOString()}],issued_at:new Date().toISOString(),refresh_by:new Date(Date.now()+120000).toISOString(),messaging_routes:[],provisioned_identities:[{member_id:member,local_user_id:modern?old:backend,local_auth_id:auth}]};
 const hash=async()=>{throw Error('Existing passwords must not be regenerated');};
 let first;
 await t.test('links the existing exact account, preserves password and session, and retries',async()=>{
  first=await applyNodeSnapshot(query,hash,base,modern,true);assert.equal(first.identities[0].local_user_id,old);
  assert.deepEqual(await applyNodeSnapshot(query,hash,base,modern,true),first);
  const users=await query('SELECT * FROM users');assert.equal(users.length,1);assert.equal(users[0][modern?'password':'password_hash'],'unchanged');assert.equal(users[0].role,'user');
  assert.equal((await query('SELECT secret FROM sessions'))[0].secret,'keep-session');
  assert.equal((await checkNodeUser(query,old,{product:base.product_code})).active,true);
 });
 await t.test('no implicit cross-product permission, expired access does not disconnect another product',async()=>{
  const other=modern?'whatsapp':'growth';await assert.rejects(checkNodeUser(query,old,{product:other}),/no active permission/);
  const second={...base,product_code:other,organization:{...base.organization,plan_snapshot:{limits:{staff:5,whatsapp_numbers:1}}},identity_links:[{member_id:member,local_user_id:old,local_auth_id:auth}]};
  await applyNodeSnapshot(query,hash,second,modern,!modern);
  await query('UPDATE ds_node_bindings SET access_until=now() WHERE product_code=$1',[base.product_code]);
  await assert.rejects(checkNodeUser(query,old,{product:base.product_code}),/inactive/);
  assert.equal((await checkNodeUser(query,old,{product:other})).active,true);
  assert.equal((await query('SELECT count(*) n FROM sessions'))[0].n,1);
 });
 await t.test('route, queue age, suspension and fresh mirror checked before dispatch',async()=>{
  const purpose=modern?'workforce.notifications':'opd.reminders';const route={id:randomUUID(),version:1,purpose,enabled:true,sender_user_id:old,session_name:'default'};
  const snapshot={...base,version:2,messaging_routes:[route]};await applyNodeSnapshot(query,hash,snapshot,modern,true);
  await checkNodeUser(query,old,{product:base.product_code,purpose,route:route.id,routeVersion:1},true);
  await assert.rejects(checkNodeUser(query,old,{product:base.product_code,purpose,route:randomUUID()},true),/route changed/);
  await assert.rejects(checkNodeUser(query,old,{product:base.product_code,purpose},true,'another'),/sender\/session/);
  await assert.rejects(checkNodeUser(query,old,{product:base.product_code,queuedAt:'garbage'},true),/invalid timestamp/);
  await assert.rejects(checkNodeUser(query,old,{product:base.product_code,queuedAt:'2020-01-01T00:00:00Z'},true),/predates/);
  await applyNodeSnapshot(query,hash,{...snapshot,version:3,organization:{...base.organization,status:'suspended'}},modern,true);
  await assert.rejects(checkNodeUser(query,old,{product:base.product_code}),/inactive/);
  await applyNodeSnapshot(query,hash,{...snapshot,version:4},modern,true);
  await query('UPDATE ds_node_bindings SET fresh_until=now() WHERE product_code=$1',[base.product_code]);
  await assert.rejects(checkNodeUser(query,old,{product:base.product_code}),/inactive/);
 });
 await t.test('stale versions, tenant reassignment, user reassignment and deletion are denied',async()=>{
  await assert.rejects(applyNodeSnapshot(query,hash,base,modern,true),/version cannot/);
  await assert.rejects(applyNodeSnapshot(query,hash,{...base,version:5,local_tenant_id:randomUUID()},modern,true),/another organisation|cannot be reassigned/);
  await assert.rejects(query('UPDATE users SET role=$1 WHERE id=$2',['super_admin',old]),/cannot be reassigned/);
  await assert.rejects(query('DELETE FROM users WHERE id=$1',[old]),/Suite Admin/);
 });
 await t.test('a restart never adds newly created accounts to the legacy allowlist',async()=>{
  const id=randomUUID();await query('INSERT INTO users(id,username) VALUES($1,$2)',[id,'later']);
  for(const statement of schema.split('-- ds-statement'))await db.exec(statement);
  await assert.rejects(checkNodeUser(query,id,{product:base.product_code}),/enrolment/);
 });
 if(modern)await t.test('phone-slot capacity is shared across operators and does not remove existing sessions',async()=>{
  await query('INSERT INTO whatsapp_sessions VALUES($1,$2,$3)',[randomUUID(),old,'default']);
  await assert.rejects(query('INSERT INTO whatsapp_sessions VALUES($1,$2,$3)',[randomUUID(),old,'extra']),/capacity exceeded/);
  assert.equal((await query('SELECT count(*) n FROM whatsapp_sessions'))[0].n,1);
 });
 if(modern)await t.test('existing slots reject invalid enrolment and downgrades atomically, but never block suspension',async()=>{
  const snapshot={...base,product_code:'whatsapp',version:8,identity_links:[{member_id:member,local_user_id:old,local_auth_id:auth}],organization:{...base.organization,plan_snapshot:{limits:{staff:5,whatsapp_numbers:0}}}};
  await assert.rejects(applyNodeSnapshot(query,hash,snapshot,true),/Existing WhatsApp.*capacity exceeded/);
  assert.equal((await query("SELECT version FROM ds_node_bindings WHERE product_code='whatsapp'"))[0].version,1);
  for(const capacity of [-1,1.5,2147483648,'3',null]){
   snapshot.organization.plan_snapshot.limits.whatsapp_numbers=capacity;
   await assert.rejects(applyNodeSnapshot(query,hash,snapshot,true),/capacity/);
  }
  snapshot.organization.status='suspended';snapshot.organization.plan_snapshot.limits.whatsapp_numbers=0;
  await applyNodeSnapshot(query,hash,snapshot,true);
  await assert.rejects(checkNodeUser(query,old,{product:'whatsapp'}),/inactive/);
  assert.equal((await query('SELECT count(*) n FROM whatsapp_sessions'))[0].n,1);
 });
});
