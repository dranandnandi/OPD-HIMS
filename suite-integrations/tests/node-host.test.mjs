import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import path from 'node:path';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';import {build} from 'esbuild';
import {loadTransports} from './isolated-transports.mjs';
const backend='D:/app folder/Whatsapp new app multi user/whatsapp multi user bulk/NodeBackend',requireBackend=createRequire(pathToFileURL(path.join(backend,'package.json')));
const express=requireBackend('express'),orm=requireBackend('drizzle-orm'),jwt=requireBackend('jsonwebtoken'),bcrypt=requireBackend('bcryptjs');
const {PgDialect}=await import(pathToFileURL(path.join(backend,'node_modules/drizzle-orm/pg-core/index.js')));const dialect=new PgDialect();
test('actual Node host scopes HTTP, notifications, JWT roles and WebSocket frames',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE users(id varchar PRIMARY KEY,username text UNIQUE,password text,email text,organization_id text,role text,created_at timestamptz,updated_at timestamptz);CREATE TABLE sessions(id uuid PRIMARY KEY,user_id varchar REFERENCES users(id),secret text);CREATE TABLE hims_patients(phone_number text PRIMARY KEY,organization_id text);CREATE TABLE hr_admins(phone_number text PRIMARY KEY,organization_id text);`);
 const owner=randomUUID(),member=randomUUID(),org=randomUUID(),auth=randomUUID(),instance=randomUUID(),route=randomUUID();
 await db.query('INSERT INTO users(id,username,password,organization_id,role) VALUES($1,$2,$3,$4,$5)',[owner,'existing','keep-password',org,'admin']);
 await db.query('INSERT INTO sessions VALUES($1,$2,$3)',[randomUUID(),owner,'preserved-phone-session']);
 globalThis.__suiteHostModules={sql:orm.sql,jwt,bcrypt,db:{execute:async query=>{const parsed=dialect.sqlToQuery(query);return(await db.query(parsed.sql,parsed.params)).rows;}}};
 t.after(()=>delete globalThis.__suiteHostModules);
 const bundle=await build({entryPoints:['suite-integrations/staged/provisioning/whatsapp/server/suiteNodeRuntime.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'no-live-services',setup(builder){
  builder.onResolve({filter:/^(?:drizzle-orm|bcryptjs|jsonwebtoken|\.\/db)$/},args=>({path:args.path,namespace:'isolated'}));
  builder.onLoad({filter:/.*/,namespace:'isolated'},args=>({contents:args.path==='drizzle-orm'?'export const sql=globalThis.__suiteHostModules.sql;':args.path==='./db'?'export const db=globalThis.__suiteHostModules.db;':`export default globalThis.__suiteHostModules.${args.path==='bcryptjs'?'bcrypt':'jwt'};`,loader:'js'}));
 }}]});
 const runtime=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const variables={SUITE_RUNTIME_ENABLED:'true',SUITE_INSTANCE_ID:instance,JWT_SECRET:'test-only-jwt-secret-with-at-least-thirty-two-characters',SUITE_WORKFORCE_CALLER_TOKEN:'test-only-workforce-caller-at-least-thirty-two-characters'};
 const previous=Object.fromEntries(Object.keys(variables).map(k=>[k,process.env[k]]));Object.assign(process.env,variables);t.after(()=>{for(const[k,v]of Object.entries(previous))v===undefined?delete process.env[k]:process.env[k]=v;});
 await runtime.initializeSuiteRuntime();
 const snapshot=product=>({contract:'suite.access.v1',job_id:randomUUID(),organization_id:org,product_code:product,local_tenant_id:org,version:1,organization:{id:org,name:'Clinic',status:'active',plan_snapshot:{limits:{staff:5,whatsapp_numbers:1}}},members:[{id:member,auth_user_id:auth,email:'owner@example.com',name:'Owner',role:'owner',status:'active'}],trial:null,grants:[{starts_at:new Date(Date.now()-10000).toISOString(),ends_at:new Date(Date.now()+60000).toISOString()}],issued_at:new Date().toISOString(),refresh_by:new Date(Date.now()+120000).toISOString(),messaging_routes:[{id:route,version:1,enabled:true,purpose:product==='workforce'?'workforce.notifications':'whatsapp.campaigns',sender_user_id:owner,session_name:'approved',backend_instance_id:instance}]});
 for(const product of ['workforce','whatsapp'])await db.query('SELECT ds_node_apply($1,$2,true)',[JSON.stringify(snapshot(product)),JSON.stringify([{member_id:member,source_user_id:owner,backend_user_id:owner}])]);
 const app=express();app.use(express.json());runtime.registerSuiteRuntime(app);
 let sends=0;
 app.post('/api/send-notification',async(req,res)=>{try{const sender=await runtime.suiteNotificationSender(req.body.organizationId);await runtime.assertSuiteSend(sender.userId,sender.sessionName);sends++;res.json(sender);}catch(e){res.status(403).json({error:e.message});}});
 app.get('/api/protected',(req,res)=>res.json(req.auth));
 app.get('/api/hims-patients/:phone/conversation',(_req,res)=>res.json({protected:true}));
 app.get('/api/hr-admins',(req,res)=>res.json({organizationId:req.query.organizationId}));
 app.get('/api/users/:id/whatsapp/status',(_req,res)=>res.json({ok:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port;
 const headers={'Content-Type':'application/json','X-Suite-Product':'workforce','X-Suite-Organization':org,'X-Suite-Product-Token':variables.SUITE_WORKFORCE_CALLER_TOKEN,'X-Suite-Route':route,'X-Suite-Route-Version':'1','X-Suite-Purpose':'workforce.notifications'};
 const send=async(extra={},body={organizationId:org})=>fetch(url+'/api/send-notification',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 await t.test('private product calls use only their exact organisation, route, sender and session',async()=>{
  let response=await send();assert.equal(response.status,200);assert.equal((await response.json()).userId,owner);assert.equal(sends,1);
  for(const patch of [{'X-Suite-Product-Token':'wrong'},{Origin:'https://browser.invalid'},{'X-Suite-Organization':randomUUID()},{'X-Suite-Route':randomUUID()},{'X-Suite-Route-Version':'2'}]){response=await send(patch);assert.ok(response.status>=400);await response.text();}
  assert.equal(sends,1);
  const forbidden=await fetch(url+'/api/protected',{headers});assert.equal(forbidden.status,403);await forbidden.text();
 });
 const token=jwt.sign({userId:owner,username:'stale',organizationId:'stale',role:'super_admin'},variables.JWT_SECRET);
 await t.test('actual database membership replaces stale JWT privileges; API-key fallbacks cannot claim enrolled users',async()=>{
  const response=await fetch(url+'/api/protected',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);const user=await response.json();assert.equal(user.role,'admin');assert.equal(user.organizationId,org);
  const unauthenticated=await fetch(url+`/api/users/${owner}/whatsapp/status`,{headers:{'X-API-Key':'old-shared-key'}});assert.equal(unauthenticated.status,403);await unauthenticated.text();
 });
 await t.test('cross-clinic records, user overrides and shared configuration are denied before handlers',async()=>{
  await db.query('INSERT INTO hims_patients VALUES($1,$2)',['foreign-phone',randomUUID()]);
  for(const route of ['/api/hims-patients/foreign-phone/conversation','/api/protected?organizationId=foreign','/api/protected?userId=foreign','/api/hr-chatbot/config']){const denied=await fetch(url+route,{headers:{Authorization:'Bearer '+token}});assert.equal(denied.status,403,route);await denied.text();}
  const scoped=await fetch(url+'/api/hr-admins',{headers:{Authorization:'Bearer '+token}});assert.equal((await scoped.json()).organizationId,org);
 });
 await t.test('WhatsApp expiry blocks API and socket frames while an active Workforce sender keeps its phone session',async()=>{
  const socket={auth:{userId:owner,username:'owner',organizationId:org,role:'super_admin'},readyState:1,OPEN:1,send:()=>{throw Error('Expired frame must not be sent');},close(){this.closed=true;}};
  await db.query("UPDATE ds_node_bindings SET access_until=now() WHERE product_code='whatsapp'");
  const denied=await fetch(url+'/api/protected',{headers:{Authorization:'Bearer '+token}});assert.equal(denied.status,403);await denied.text();
  await runtime.deliverSuiteFrame(socket,'private',owner,org);assert.equal(socket.closed,true);
  const stillActive=await send();assert.equal(stillActive.status,200);await stillActive.text();assert.equal(sends,2);
  assert.equal((await db.query('SELECT secret FROM sessions')).rows[0].secret,'preserved-phone-session');
 });
 await t.test('actual legacy text/document transports reject revoked OPD work without disconnecting a shared Growth account',async()=>{
  const activate=()=>db.query("UPDATE ds_node_bindings SET access_until=now()+interval '1 minute' WHERE product_code='opd'");
  const revoke=()=>db.query("UPDATE ds_node_bindings SET access_until=now() WHERE product_code='opd'");
  for(const product of ['opd','growth']){
   const value=snapshot(product);value.messaging_routes=['default','approved'].map(session=>({id:randomUUID(),version:1,enabled:true,purpose:product==='opd'?'opd.reminders':'growth.review_requests',sender_user_id:owner,session_name:session,backend_instance_id:instance}));
   await db.query('INSERT INTO ds_node_bindings(organization_id,product_code,local_tenant_id,version,snapshot,access_until,active_since,fresh_until,issued_at) VALUES($1::uuid,$2,$1::uuid::text,1,$3,now()+interval \'1 minute\',now(),now()+interval \'2 minutes\',now())',[org,product,JSON.stringify(value)]);
   await db.query('INSERT INTO ds_node_members VALUES($1,$2,$3,$4,$5,$5,$6,true)',[org,product,member,auth,owner,'owner']);
  }
  let checks=0,expireDuringCheck=false,sends=0;
  const guard=async(user,session)=>{if(expireDuringCheck&&++checks===2)await revoke();return runtime.assertSuiteSend(user,session);};
  const {MultiUserWhatsAppService,MultiWhatsAppService}=await loadTransports(guard,undefined,true);
  const socket={sendMessage:async()=>{sends++;return{key:{id:'fake'}};}};
  const perUser=Object.create(MultiUserWhatsAppService.prototype);
  perUser.userSessionsByUser=new Map([[owner,{socket,isConnected:true,sessionId:'preserved'}]]);
  const perSession=Object.create(MultiWhatsAppService.prototype);
  Object.assign(perSession,{sessions:new Map([['approved',{userId:owner,socket,isAuthenticated:true}]]),checkRateLimit:revoke,updateRateLimit:()=>{},formatPhoneNumber:()=> '919999999999',emit:()=>{}});
  const asOpd=work=>runtime.withSuiteScope({product:'opd',purpose:'opd.reminders',trustedCaller:true},work);
  const originalError=console.error;console.error=()=>{};
  try{
   for(const send of [()=>perUser.sendMessageFromUser(owner,'919999999999','test'),()=>perUser.sendDocumentFromUser(owner,'919999999999','https://test.invalid/report.pdf')]){
    await activate();checks=0;expireDuringCheck=true;const result=await asOpd(send);assert.equal(result.success,false);assert.match(result.error,/inactive/);
   }
   expireDuringCheck=false;
   await activate();await assert.rejects(asOpd(()=>perSession.sendMessage('approved','919999999999','test')),/inactive/);
   await activate();await assert.rejects(asOpd(()=>perSession.sendMediaMessage('approved','919999999999',import.meta.filename)),/inactive/);
   assert.equal(sends,0);
   // Same backend account remains usable through the independently active product.
   const result=await runtime.withSuiteScope({product:'growth',purpose:'growth.review_requests',trustedCaller:true},()=>perUser.sendDocumentFromUser(owner,'919999999999','https://test.invalid/report.pdf'));
   assert.equal(result.success,true);assert.equal(sends,1);
  }finally{console.error=originalError;}
  assert.equal((await db.query('SELECT secret FROM sessions')).rows[0].secret,'preserved-phone-session');
 });
 await t.test('Workforce bridge uses approved administrators and its own active product after WhatsApp expires',async()=>{
  const scope={organizationId:org,userId:owner,sessionName:'approved',action:'status',admins:[{id:owner}]};
  assert.equal((await runtime.authorizeWorkforceBridge(scope)).userId,owner);
  await assert.rejects(runtime.authorizeWorkforceBridge({...scope,organizationId:randomUUID()}),/organisation/);
  await assert.rejects(runtime.authorizeWorkforceBridge({...scope,admins:[{id:owner},{id:randomUUID()}],action:'sync_admins'}),/membership/);
  await assert.rejects(runtime.authorizeWorkforceBridge({...scope,sessionName:'unapproved'}),/route/);
  await db.query("UPDATE ds_node_members SET role='member' WHERE product_code='workforce'");
  await assert.rejects(runtime.authorizeWorkforceBridge(scope),/membership/);
  await db.query("UPDATE ds_node_members SET role='owner' WHERE product_code='workforce'");
 });
 await t.test('a suspended Workforce mirror stops the final send without altering the session',async()=>{
  await db.query("UPDATE ds_node_bindings SET access_until=now() WHERE product_code='workforce'");const response=await send();assert.equal(response.status,403);await response.text();assert.equal(sends,2);
 });
 await t.test('actual Baileys and Cloud methods recheck revocation after asynchronous recipient/media preparation',async()=>{
  const {ManagedBaileysSession,CloudApiSession,ExternalWhatsAppProxy}=await loadTransports(runtime.assertSuiteSend,runtime.assertSuiteProxy);
  const activate=()=>db.query("UPDATE ds_node_bindings SET access_until=now()+interval '1 minute' WHERE product_code='whatsapp'");
  const revoke=()=>db.query("UPDATE ds_node_bindings SET access_until=now() WHERE product_code='whatsapp'");
  let physicalSends=0;
  const baileys=Object.create(ManagedBaileysSession.prototype);
  Object.assign(baileys,{userId:owner,sessionName:'approved',status:{},requireSocket:async()=>({sendMessage:async()=>{physicalSends++;return{key:{id:'fake'}};}}),resolveOutgoingJid:async()=>{await revoke();return'919999999999@s.whatsapp.net';},rememberBackendSentMessageId:()=>{},rememberSentMessage:()=>{},throwIfImmediatelyRejected:async()=>{},emit:()=>{}});
  await activate();await assert.rejects(baileys.sendTextMessage('919999999999','test'),/inactive/);
  await activate();await assert.rejects(baileys.sendMediaMessage('919999999999',import.meta.filename),/inactive/);
  assert.equal(physicalSends,0);
  const cloud=new CloudApiSession({userId:owner,sessionName:'approved',phoneNumberId:'test',accessToken:'test-only'});
  cloud.warnIfOutsideWindow=()=>{};cloud.uploadMedia=async()=>{await revoke();return'mocked-upload';};
  const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{physicalSends++;return Response.json({messages:[{id:'fake'}]});};
  try{
   await activate();await assert.rejects(cloud.sendMediaMessage('919999999999',import.meta.filename),/inactive/);
   assert.equal(physicalSends,0);
   // Positive control: the intact methods still send exactly once when active.
   await activate();await cloud.sendTextMessage('919999999999','test');assert.equal(physicalSends,1);
   baileys.resolveOutgoingJid=async()=> '919999999999@s.whatsapp.net';
   await baileys.sendTextMessage('919999999999','test');assert.equal(physicalSends,2);
   const proxy=new ExternalWhatsAppProxy(undefined,owner,'https://unverified.invalid');
   await assert.rejects(proxy.request('POST','/api/external/sessions/disconnect',{userId:owner}),/verified upstream/);
   await assert.rejects(proxy.request('GET',`/api/users/${owner}/whatsapp/status`),/verified upstream/);
   assert.equal(physicalSends,2,'Unverified proxy must never receive credentials or phone commands');
  }finally{globalThis.fetch=previousFetch;}
  assert.equal((await db.query('SELECT secret FROM sessions')).rows[0].secret,'preserved-phone-session');
 });
});
