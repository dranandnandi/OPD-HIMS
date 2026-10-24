import{test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{randomUUID}from'node:crypto';import{PGlite}from'@electric-sql/pglite';
const runtime=await readFile(new URL('../runtime/supabase-runtime.sql',import.meta.url),'utf8');const provisioning=await readFile(new URL('../runtime/supabase-provisioning.sql',import.meta.url),'utf8');
const rpcGuard=await readFile(new URL('../runtime/supabase-rpc-guard.sql',import.meta.url),'utf8');
const capacitySql=await readFile(new URL('../runtime/supabase-capacity.sql',import.meta.url),'utf8');
for(const product of ['opd','growth','workforce'])test(`${product}: real provisioning, role protection, expiry and cross-tenant DB denial`,async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const foreignOrg=randomUUID(),foreignUser=randomUUID();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb DEFAULT '{}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
 if(product==='opd')await db.exec(`CREATE TABLE clinic_settings(id uuid PRIMARY KEY,clinic_name text);CREATE TABLE roles(id uuid PRIMARY KEY,name text,permissions text[]);CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),user_id uuid,auth_id uuid,clinic_id uuid REFERENCES clinic_settings(id),email text,name text,role_id uuid REFERENCES roles(id),role_name text,permissions text[],is_active boolean);CREATE TABLE records(id uuid PRIMARY KEY,clinic_id uuid REFERENCES clinic_settings(id),created_by uuid REFERENCES profiles(id),content text);INSERT INTO roles VALUES('${randomUUID()}','admin','{}'),('${randomUUID()}','receptionist','{}');`);
 else if(product==='workforce')await db.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY,name text,subscription_status text,trial_ends_at timestamptz);CREATE TABLE users(id uuid PRIMARY KEY,auth_id uuid UNIQUE REFERENCES auth.users(id),organization_id uuid REFERENCES organizations(id),name text,email text,whatsapp_number text,department text,role text,is_active boolean);CREATE TABLE records(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations(id),user_id uuid REFERENCES users(id),content text);`);
 else await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY,auth_id uuid UNIQUE REFERENCES auth.users(id),username text,password_hash text,name text,role text,clinic_name text,clinic_address text);CREATE TABLE records(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),content text);`);
 if(product==='opd')await db.query('INSERT INTO clinic_settings VALUES($1,$2)',[foreignOrg,'Foreign']);
 else if(product==='workforce')await db.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[foreignOrg,'Foreign']);
 else await db.query('INSERT INTO users(id,name) VALUES($1,$2)',[foreignUser,'Foreign']);
 if(product==='growth')await db.exec(`CREATE TABLE gmb_locations(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),status text);`);
 await db.exec(`CREATE TABLE record_items(id uuid PRIMARY KEY,record_id uuid REFERENCES records(id),content text);
 CREATE FUNCTION list_all_records() RETURNS SETOF records LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM records $$;
 CREATE FUNCTION count_all_records() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*) FROM records $$;
 CREATE FUNCTION echo_input(p_value text DEFAULT 'default') RETURNS text LANGUAGE sql AS $$ SELECT p_value $$;
 CREATE FUNCTION identity_of_caller() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT auth.uid() $$;
 CREATE VIEW record_report AS SELECT * FROM records;
 GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;`);
 await db.exec(runtime.replaceAll('__PRODUCT__',product));await db.exec(capacitySql);await db.exec(provisioning);await db.exec(rpcGuard);
 const rpc=async(name,args=[])=>(await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const actor=randomUUID(),org=randomUUID(),member=randomUUID(),local=product==='opd'?actor:member;
 await db.query('INSERT INTO auth.users VALUES($1,$2,now(),$3)',[actor,'owner@example.com',JSON.stringify({doctor_suite:{central_user_id:actor,organization_id:org}})]);
 const payload={contract:'suite.access.v1',organization_id:org,product_code:product,version:1,local_tenant_id:null,organization:{id:org,name:'Suite clinic',status:'active',plan_snapshot:{limits:{staff:5,google_profiles:1,doctors:1,locations:1}}},members:[{id:member,auth_user_id:actor,email:'owner@example.com',name:'Owner',role:'owner',status:'active'}],trial:null,grants:[{starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString()}],messaging_routes:[],issued_at:new Date().toISOString(),refresh_by:new Date(Date.now()+240000).toISOString()};
 const links=[{member_id:member,local_auth_id:actor,local_user_id:local}];
 await t.test('tenant and member provision atomically and retry preserves IDs',async()=>{
  const result=await rpc('ds_runtime_apply',[JSON.stringify(payload),JSON.stringify(links)]);assert.equal(result.local_tenant_id,org);assert.equal(result.identities[0].local_user_id,local);
  assert.deepEqual(await rpc('ds_runtime_apply',[JSON.stringify(payload),JSON.stringify(links)]),result);
  assert.equal((await rpc('ds_runtime_user_status',[actor])).allowed,true);
 });
 if(product!=='workforce')await t.test('legacy writer checkpoints require exact active identities and are service-only',async()=>{
  const writer='https://source.invalid/.netlify/functions/sync-user';
  assert.equal(await rpc('ds_legacy_sync_checkpoint',[local,actor,writer,false]),false);
  await assert.rejects(rpc('ds_legacy_sync_checkpoint',[local,randomUUID(),writer,true]),/Verified source identity/);
  assert.equal(await rpc('ds_legacy_sync_checkpoint',[local,actor,writer,true]),true);
  assert.equal(await rpc('ds_legacy_sync_checkpoint',[local,actor,writer,false]),true);
  assert.equal(await rpc('ds_legacy_sync_checkpoint',[local,actor,'https://different.invalid',false]),false);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(rpc('ds_legacy_sync_checkpoint',[local,actor,writer,true]),/permission denied/);
  await assert.rejects(db.query('SELECT * FROM ds_legacy_sync_receipts'),/permission denied/);
  await db.exec('RESET ROLE');
 });
 const record=randomUUID(),child=randomUUID(),foreignRecord=randomUUID();
 if(product==='opd')await db.query('INSERT INTO records VALUES($1,$2,$3,$4)',[record,org,local,'own']);
 else if(product==='workforce')await db.query('INSERT INTO records VALUES($1,$2,$3,$4)',[record,org,local,'own']);
 else await db.query('INSERT INTO records VALUES($1,$2,$3)',[record,local,'own']);
 await db.query('INSERT INTO record_items VALUES($1,$2,$3)',[child,record,'child']);
 if(product==='opd')await db.query('INSERT INTO records(id,clinic_id,content) VALUES($1,$2,$3)',[foreignRecord,foreignOrg,'foreign']);
 else if(product==='workforce')await db.query('INSERT INTO records(id,organization_id,content) VALUES($1,$2,$3)',[foreignRecord,foreignOrg,'foreign']);
 else await db.query('INSERT INTO records(id,user_id,content) VALUES($1,$2,$3)',[foreignRecord,foreignUser,'foreign']);
 await t.test('authenticated users see only their own tenant, including FK child tables',async()=>{
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('SET ROLE authenticated');
  assert.equal((await db.query('SELECT * FROM records')).rows.length,1);assert.equal((await db.query('SELECT * FROM record_items')).rows.length,1);
  assert.equal((await db.query('SELECT * FROM record_report')).rows.length,1);
  assert.equal((await rpc('count_all_records')),1);assert.equal((await db.query('SELECT * FROM list_all_records()')).rows.length,1);
  assert.equal(await rpc('echo_input'),'default');assert.equal(await rpc('identity_of_caller'),actor);
  await assert.rejects(db.query('SELECT * FROM ds_private.list_all_records()'),/permission denied/);
  assert.equal((await rpc('ds_client_status')).allowed,true);
  const table=product==='opd'?'profiles':'users';
  await assert.rejects(db.query(`UPDATE ${table} SET ${product==='opd'?'role_name':'role'}=$1 WHERE id=$2`,['super_admin',local]),/Manage suite identity/);
  await db.exec('RESET ROLE');
 });
 await t.test('resource limits reject over-capacity writes and invalid downgrades atomically',async()=>{
  const before=await rpc('ds_runtime_user_status',[actor]);
  await assert.rejects(rpc('ds_runtime_apply',[JSON.stringify({...payload,version:2,organization:{...payload.organization,plan_snapshot:{limits:{staff:0,employees:0,locations:1}}}}),JSON.stringify(links)]),/capacity exceeded/);
  assert.deepEqual(await rpc('ds_runtime_user_status',[actor]),before);
  for(const invalid of [-1,0.5,2147483648,'5',null])await assert.rejects(rpc('ds_runtime_apply',[JSON.stringify({...payload,version:2,organization:{...payload.organization,plan_snapshot:{limits:{...payload.organization.plan_snapshot.limits,staff:invalid}}}}),JSON.stringify(links)]),/capacity/);
  if(product==='opd'){
   // Existing clinical roles are retained during onboarding, then reviewed.
   await db.exec("SELECT set_config('ds.provisioning','on',false)");
   await db.query("UPDATE profiles SET role_name='doctor' WHERE id=$1",[local]);
   await db.exec("SELECT set_config('ds.provisioning','off',false)");
   await rpc('ds_capacity_review',[org]);
   await assert.rejects(rpc('ds_runtime_apply',[JSON.stringify({...payload,version:2,organization:{...payload.organization,plan_snapshot:{limits:{...payload.organization.plan_snapshot.limits,doctors:0}}}}),JSON.stringify(links)]),/doctors capacity exceeded/);
   assert.equal((await db.query('SELECT role_name FROM profiles WHERE id=$1',[local])).rows[0].role_name,'doctor');
  }
  if(product==='growth'){
   const first=randomUUID(),second=randomUUID();await db.query('INSERT INTO gmb_locations VALUES($1,$2,$3)',[first,local,'connected']);
   await assert.rejects(db.query('INSERT INTO gmb_locations VALUES($1,$2,$3)',[second,local,'connected']),/capacity exceeded/);
   await db.query('INSERT INTO gmb_locations VALUES($1,$2,$3)',[second,local,'disabled']);
   await assert.rejects(db.query("UPDATE gmb_locations SET status='connected' WHERE id=$1",[second]),/capacity exceeded/);
   await db.query("UPDATE gmb_locations SET status='disabled' WHERE id=$1",[first]);await db.query("UPDATE gmb_locations SET status='connected' WHERE id=$1",[second]);
  }
  await rpc('ds_runtime_apply',[JSON.stringify({...payload,organization:{...payload.organization,status:'suspended',plan_snapshot:{limits:{staff:0,employees:0,doctors:0,google_profiles:0,locations:0}}}}),JSON.stringify(links)]);
  assert.equal((await rpc('ds_runtime_user_status',[actor])).allowed,false);
  await rpc('ds_runtime_apply',[JSON.stringify(payload),JSON.stringify(links)]);
  assert.equal((await rpc('ds_runtime_user_status',[actor])).allowed,true);
 });
 await t.test('expired access denies browser reads and privileged worker writes',async()=>{
  await db.query("UPDATE ds_runtime_bindings SET access_until=now()-interval '1 second' WHERE organization_id=$1",[org]);
  await db.exec('SET ROLE authenticated');assert.equal((await db.query('SELECT * FROM records')).rows.length,0);assert.equal((await rpc('ds_client_status')).allowed,false);await db.exec('RESET ROLE');
  await assert.rejects(rpc('list_all_records'),/access is inactive/);
  await assert.rejects(db.query('UPDATE records SET content=$1 WHERE id=$2',['worker-write',record]),/Suite access expired/);
  await assert.rejects(rpc('ds_runtime_assert',[org]),/Suite access expired/);
 });
 await t.test('refresh restores only the same tenant; stale or conflicting identities are rejected',async()=>{
  const next={...payload,version:2};await rpc('ds_runtime_apply',[JSON.stringify(next),JSON.stringify(links)]);
  assert.equal((await rpc('ds_runtime_user_status',[actor])).allowed,true);
  await assert.rejects(rpc('ds_runtime_apply',[JSON.stringify(payload),JSON.stringify(links)]),/Stale/);
  await assert.rejects(rpc('ds_runtime_apply',[JSON.stringify({...next,local_tenant_id:foreignOrg}),JSON.stringify(links)]),/mapping changed/);
  await assert.rejects(rpc('ds_runtime_apply',[JSON.stringify(next),JSON.stringify([{...links[0],local_user_id:foreignUser}])]),/cannot be silently reassigned/);
  await db.query("UPDATE ds_runtime_bindings SET fresh_until=now()-interval '1 second' WHERE organization_id=$1",[org]);
  assert.equal((await rpc('ds_runtime_user_status',[actor])).allowed,false);
 });
});
