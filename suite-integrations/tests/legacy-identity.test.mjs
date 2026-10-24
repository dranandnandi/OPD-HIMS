import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';import {build} from 'esbuild';
const bundle=await build({entryPoints:['suite-integrations/runtime/legacy-identity.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {ensureLegacyIdentity}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('OPD and Growth share exact, non-destructive legacy account reconciliation',async t=>{
 const db=new PGlite();t.after(()=>db.close());const connection={query:(sql,args=[])=>db.query(sql,args)};
 await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY,auth_id uuid,username text UNIQUE,password_hash text,name text,role text,clinic_name text,clinic_address text,contact_phone text,contact_email text,contact_whatsapp text,whatsapp_integration_available boolean,max_sessions integer,created_at timestamptz,updated_at timestamptz);CREATE TABLE sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),session text);`);
 const auth=randomUUID(),id=randomUUID();
 await db.query('INSERT INTO users(id,auth_id,username,password_hash,name,role) VALUES($1,$2,$3,$4,$5,$6)',[id,auth,'shared@example.com','keep-password','Existing','admin']);
 await db.query('INSERT INTO sessions VALUES($1,$2,$3)',[randomUUID(),id,'keep-session']);
 await t.test('exact Auth match returns the original account unchanged',async()=>{
  const before=(await db.query('SELECT * FROM users')).rows;
  const result=await ensureLegacyIdentity(connection,{authId:auth,preferredId:randomUUID(),username:'new-name@example.com',name:'New display name'});
  assert.equal(result.id,id);assert.deepEqual((await db.query('SELECT * FROM users')).rows,before);
  assert.equal((await db.query('SELECT session FROM sessions')).rows[0].session,'keep-session');
 });
 await t.test('email collision creates a distinct account without claiming the old one',async()=>{
  const profile={authId:randomUUID(),preferredId:randomUUID(),username:'shared@example.com',name:'New member'};
  const created=await ensureLegacyIdentity(connection,profile);assert.equal(created.id,profile.preferredId);assert.equal(created.auth_id,profile.authId);assert.equal(created.role,'user');assert.equal(created.username,profile.username+'-'+profile.authId);
  assert.deepEqual(await ensureLegacyIdentity(connection,profile),created);
 });
 await t.test('ID conflicts and ambiguous Auth records roll back without modifying rows',async()=>{
  await assert.rejects(ensureLegacyIdentity(connection,{authId:randomUUID(),preferredId:id,username:'other@example.com',name:'Other'}),/Explicit reconciliation/);
  await db.query('INSERT INTO users(id,auth_id,username) VALUES($1,$2,$3)',[randomUUID(),auth,'duplicate']);
  await assert.rejects(ensureLegacyIdentity(connection,{authId:auth,username:'name',name:'Name'}),/ambiguous/);
  assert.equal((await db.query('SELECT password_hash FROM users WHERE id=$1',[id])).rows[0].password_hash,'keep-password');
 });
});
