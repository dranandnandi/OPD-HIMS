import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
const backend=process.env.SUITE_WHATSAPP_SOURCE||'D:/app folder/Whatsapp new app multi user/whatsapp multi user bulk/NodeBackend';
const requireBackend=createRequire(pathToFileURL(path.join(backend,'package.json')));
const esbuild=requireBackend('esbuild');
test('modern backend runtime pins HR tool actor and checks Workforce access independently of WhatsApp',async()=>{
 const built=await esbuild.build({entryPoints:[fileURLToPath(new URL('../staged/runtime/whatsapp/server/suiteRuntimeAccess.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
 const runtime=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
 const admin={userId:'registered-task-user',organizationId:'registered-task-org'};
 assert.deepEqual(runtime.workforceToolScope({},admin),admin);
 assert.deepEqual(runtime.workforceToolScope({...admin,title:'Task'},admin),admin);
 assert.throws(()=>runtime.workforceToolScope({organizationId:'foreign-org'},admin),/does not match/);
 assert.throws(()=>runtime.workforceToolScope({userId:'foreign-user'},admin),/does not match/);
 const vars={SUITE_ACCESS_ENABLED:'true',SUITE_ACCESS_URL:'https://central.invalid/functions/v1/suite-product-access',SUITE_WORKFORCE_ACCESS_TOKEN:'workforce-test-token-at-least-thirty-two-chars',SUITE_ALLOW_UNMANAGED:'false'};
 const old=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));const oldFetch=globalThis.fetch;
 let allowed=true,calls=0;
 try{
  Object.assign(process.env,vars);
  globalThis.fetch=async(_url,init)=>{calls++;assert.equal(init.headers.Authorization,`Bearer ${vars.SUITE_WORKFORCE_ACCESS_TOKEN}`);assert.equal(JSON.parse(init.body).local_tenant_id,admin.organizationId);const now=Date.now();
   return Response.json({contract:'suite.access.v1',product_code:'workforce',local_tenant_id:admin.organizationId,managed:true,allowed,issued_at:new Date(now).toISOString(),refresh_by:new Date(now+300000).toISOString(),access_until:new Date(now+3600000).toISOString()});};
  await runtime.requireWorkforceAccess(admin.organizationId);
  allowed=false;await assert.rejects(runtime.requireWorkforceAccess(admin.organizationId),/expired|suspended/);
  assert.equal(calls,2);
 }finally{globalThis.fetch=oldFetch;for(const[k,v]of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;}
});
test('actual HR message handler stops before AI/tools and sends no fallback when access is denied',async()=>{
 const built=await esbuild.build({entryPoints:[fileURLToPath(new URL('../staged/runtime/whatsapp/server/services/HRChatbotService.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'no-live-ai',setup(build){
  build.onResolve({filter:/^@anthropic-ai\/sdk$/},()=>({path:'fake-ai',namespace:'isolated'}));
  build.onLoad({filter:/.*/,namespace:'isolated'},()=>({contents:'export default class Anthropic {}',loader:'js'}));
 }}]});
 const {HRChatbotService}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
 const vars={SUITE_ACCESS_ENABLED:'true',SUITE_ACCESS_URL:'https://central.invalid/access',SUITE_WORKFORCE_ACCESS_TOKEN:'workforce-test-token-at-least-thirty-two-chars',ANTHROPIC_API_KEY:'isolated-test-not-a-real-key'};
 const old=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));const oldFetch=globalThis.fetch;
 const admin={userId:'task-user',organizationId:'task-org',phoneNumber:'test-phone',chatbotActive:'true'};
 let sends=0,tools=0,ai=0,allowed=false;
 try{
  Object.assign(process.env,vars);
  globalThis.fetch=async()=>{const now=Date.now();return Response.json({contract:'suite.access.v1',managed:true,product_code:'workforce',local_tenant_id:admin.organizationId,allowed,issued_at:new Date(now).toISOString(),refresh_by:new Date(now+300000).toISOString(),access_until:new Date(now+3600000).toISOString()});};
  const service=new HRChatbotService({getHRAdmin:async()=>admin,createSystemLog:async()=>{},createMessage:async()=>{},updateHRAdmin:async()=>{}},{sendTextMessage:async()=>{sends++;}});
  service.processWithClaude=async()=>{ai++;allowed=false;return 'Response prepared just before suspension';};
  service.callDOFunction=async()=>{tools++;return {success:true};};
  await service.processHRMessage(admin.phoneNumber,'Hello');assert.equal(ai,0);assert.equal(sends,0);
  allowed=true;
  await assert.rejects(service.executeTool('create_task',{organizationId:'foreign'},admin),/does not match/);assert.equal(tools,0);
  await service.processHRMessage(admin.phoneNumber,'Hello again');assert.equal(ai,1);assert.equal(sends,0);
  await service.sendWelcomeMessage(admin);assert.equal(sends,0);
 }finally{globalThis.fetch=oldFetch;for(const[k,v]of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;}
});
