import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
import {editPackage,folder,nodeRoots} from './package-edit.mjs';
const pkg=editPackage(),runtime=file=>fs.readFileSync(path.join(folder,'runtime',file),'utf8');
for(const component of Object.keys(nodeRoots)){
 const modern=component==='whatsapp',root=nodeRoots[component],read=file=>fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
 pkg.put(component,'server/suiteAccessCore.ts',runtime('access-core.ts'));
 pkg.put(component,'server/suiteNodeStore.ts',runtime('node-store.ts').replace("'./access-core'","'./suiteAccessCore'"));
 pkg.put(component,'server/suiteNodeSchema.ts','export const nodeSchema='+JSON.stringify(runtime('node-runtime.sql'))+';\n');
 pkg.put(component,'server/suiteNodeRuntime.ts',runtime('node-host.ts').replace('__MODERN__',String(modern)));
 let index=read('server/index.ts');
 if(index.includes('registerSuiteRuntime'))throw Error('Node host is already integrated; review it before rebuilding.');
 index=`import {registerSuiteRuntime,initializeSuiteRuntime} from './suiteNodeRuntime';\n`+index;
 index=index.replace('registerSuiteConnector(app);','registerSuiteConnector(app);\nregisterSuiteRuntime(app);');
 index=modern?index.replace('    campaignService.startScheduler();','    await initializeSuiteRuntime();\n    campaignService.startScheduler();'):index.replace('    const server = await registerRoutes(app);','    await initializeSuiteRuntime();\n    const server = await registerRoutes(app);');
 pkg.put(component,'server/index.ts',index);
 const methods=modern?{
  'server/services/WhatsAppSessionManager.ts':['sendTextMessage','sendMediaMessage'],
  'server/services/CloudApiSession.ts':['sendTextMessage','sendMediaMessage','sendTemplateMessage'],
  'server/services/ExternalWhatsAppProxy.ts':['sendTextMessage','sendMediaMessage','sendMessageWithButtons'],
 }:{'server/services/MultiUserWhatsAppService.ts':['sendMessageFromUser','sendDocumentFromUser']};
 for(const[file,names]of Object.entries(methods)){
  let source=read(file);const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),edits=[];const found=new Set();
  function visit(node){if(ts.isMethodDeclaration(node)&&names.includes(node.name.getText(ast))&&node.body){const user=modern?'this.userId':'userId',session=file.includes('ExternalWhatsAppProxy')||!modern?"'default'":'this.sessionName';edits.push([node.body.getStart(ast)+1,`\n    await assertSuiteSend(${user},${session});`]);found.add(node.name.getText(ast));}ts.forEachChild(node,visit);}visit(ast);
  if(found.size!==names.length)throw Error('Send method inventory changed: '+file);
  for(const[position,text]of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,position)+text+source.slice(position);
  pkg.put(component,file,"import {assertSuiteSend} from '../suiteNodeRuntime';\n"+source);
 }
 if(modern){
  let auth=read('server/authMiddleware.ts');
  auth="import {authorizeSuiteUser,withSuiteScope} from './suiteNodeRuntime';\n"+auth;
  auth=auth.replaceAll('export function requireAuth(','export async function requireAuth(').replaceAll('export function requireSuperAdmin(','export async function requireSuperAdmin(').replace('export function optionalAuth(','export async function optionalAuth(').replaceAll('): void {','): Promise<void> {');
  auth=auth.replaceAll('const payload = authService.verifyToken(token);','const payload = await authorizeSuiteUser(authService.verifyToken(token));');
  auth=auth.replace('req.auth = authService.verifyToken(authHeader.slice(7));','req.auth = await authorizeSuiteUser(authService.verifyToken(authHeader.slice(7)));');
  auth=auth.replaceAll('    next();',"    withSuiteScope({product:'whatsapp',trustedCaller:true},()=>next());");
  pkg.put(component,'server/authMiddleware.ts',auth);
  let hr=read('server/services/HRChatbotService.ts');
  const ast=ts.createSourceFile('hr.ts',hr,ts.ScriptTarget.Latest,true);let position;
  function visit(node){if(ts.isConstructorDeclaration(node)&&node.body&&node.parameters.some(p=>p.name.getText(ast)==='whatsappService'))position=node.body.getStart(ast)+1;ts.forEachChild(node,visit);}visit(ast);
  if(position===undefined)throw Error('HR service constructor changed');
  hr=hr.slice(0,position)+'\n    this.whatsappService=workforceSession(this.whatsappService);'+hr.slice(position);
  pkg.put(component,'server/services/HRChatbotService.ts',"import {workforceSession} from '../suiteNodeRuntime';\n"+hr);
  let main=read('client/src/main.tsx');main="import SuiteEntry from './SuiteEntry';\n"+main.replace('<App />',"location.pathname==='/suite-entry'?<SuiteEntry/>:<App />");pkg.put(component,'client/src/main.tsx',main);
  pkg.put(component,'client/src/SuiteEntry.tsx',`import {useEffect,useRef,useState} from 'react';
const ticket=new URLSearchParams(location.hash.slice(1)).get('ticket');
if(location.pathname==='/suite-entry')history.replaceState(null,'','/suite-entry');
export default function SuiteEntry(){
 const started=useRef(false),[error,setError]=useState('');
 useEffect(()=>{if(started.current)return;started.current=true;
 void(async()=>{
  if(!ticket||!/^[a-f0-9]{64}$/.test(ticket))throw Error('Open a fresh product link from Doctor Suite.');
  const response=await fetch('/api/suite/entry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});
  const data=await response.json();if(!response.ok||typeof data.token!=='string'||!data.user?.id)throw Error('This login link expired or product access is inactive.');
  localStorage.setItem('wa_auth_token',data.token);localStorage.setItem('wa_auth_user',JSON.stringify(data.user));location.replace('/');
 })().catch(e=>setError(e instanceof Error?e.message:'Sign-in unavailable.'));
 },[]);
 return <main style={{maxWidth:520,margin:'15vh auto',padding:24,fontFamily:'system-ui'}}><h1>Opening WhatsApp</h1><p role={error?'alert':'status'}>{error||'Verifying your account and current access...'}</p></main>;
}
`);
 }
}
pkg.save();console.log('Staged Node adapters, login handoff, exact identity/dispatch checks. Full API/bot coverage is still required before readiness.');
