import fs from'node:fs';import path from'node:path';import ts from'typescript';
import{editPackage,folder,nodeRoots}from'./package-edit.mjs';
const pkg=editPackage();
const host=fs.readFileSync(path.join(folder,'runtime/node-host.ts'),'utf8');
{
 const file='server/workforceBridge.ts';let source=pkg.read('whatsapp',file);
 if(!source.includes('authorizeWorkforceBridge')){
  source="import{authorizeWorkforceBridge}from'./suiteNodeRuntime';\n"+source;
  source=source.replace('const scope = parseWorkforceScope(req.body, source);','const scope = await authorizeWorkforceBridge(parseWorkforceScope(req.body, source));');
  pkg.put('whatsapp',file,source);
 }
}
for(const component of Object.keys(nodeRoots)){
 pkg.put(component,'server/suiteNodeRuntime.ts',host.replace('__MODERN__',String(component==='whatsapp')));
 pkg.put(component,'server/suiteNodeStore.ts',fs.readFileSync(path.join(folder,'runtime/node-store.ts'),'utf8').replace("'./access-core'","'./suiteAccessCore'"));
}
let routes=pkg.read('whatsapp','server/routes.ts');
if(!routes.includes('deliverSuiteFrame')){
 routes="import{authorizeSuiteUser,protectSuiteSocket,deliverSuiteFrame,suiteNotificationSender}from'./suiteNodeRuntime';\n"+routes;
 routes=routes.replace("const authenticateUpgrade = (req: import('http').IncomingMessage): AuthPayload | null => {","const authenticateUpgrade = async (req: import('http').IncomingMessage): Promise<AuthPayload | null> => {");
 routes=routes.replace('return authService.verifyToken(token);','return await authorizeSuiteUser(authService.verifyToken(token));');
 routes=routes.replace('verifyClient: (info, done) => {','verifyClient: async (info, done) => {').replace('const auth = authenticateUpgrade(info.req);','const auth = await authenticateUpgrade(info.req);');
 routes=routes.replace('ws.auth = (req as any).auth as AuthPayload | undefined;','ws.auth = (req as any).auth as AuthPayload | undefined;\n    protectSuiteSocket(ws);');
 routes=routes.replace('client.send(message);','void deliverSuiteFrame(client,message,owner,ownerOrg);');
 routes=routes.replace('    const orgAdmins = (await storage.getHRAdminsByOrganization(organizationId)) || [];',`    const approved=await suiteNotificationSender(organizationId);
    if(approved){
      if(preferredWhatsappUserId&&preferredWhatsappUserId!==approved.userId)throw Object.assign(new Error('Sender differs from the approved suite route'),{status:403});
      const session=await sessionManager.getSession(approved.userId,approved.sessionName);
      const status=session.getStatus();if(!status.isConnected)throw Object.assign(new Error('Approved session is not connected'),{status:503});
      return{admin:{userId:approved.userId,whatsappUserId:approved.userId},session};
    }
    const orgAdmins = (await storage.getHRAdminsByOrganization(organizationId)) || [];`);
 pkg.put('whatsapp','server/routes.ts',routes);
}
// Recheck immediately before the network send, after file/socket/JID awaits.
for(const[component,file,check]of [
 ['whatsapp','server/services/WhatsAppSessionManager.ts','await assertSuiteSend(this.userId,this.sessionName);'],
 ['legacy_whatsapp','server/services/MultiUserWhatsAppService.ts',"await assertSuiteSend(userId,'default');"],
 ['legacy_whatsapp','server/services/MultiWhatsAppService.ts','await assertSuiteSend(session.userId,sessionId);'],
]){
 let source=pkg.read(component,file);if(source.includes('// suite physical dispatch'))continue;
 if(!source.includes("import {assertSuiteSend}"))source="import {assertSuiteSend} from '../suiteNodeRuntime';\n"+source;
 source=source.replace(/(\s*)(const result = await (?:session|userSession)?\.?socket\.sendMessage\()/g,(_m,space,call)=>space+'// suite physical dispatch\n'+space+check+space+call);
 if(!source.includes('// suite physical dispatch'))throw Error('Physical send boundary changed: '+file);
 pkg.put(component,file,source);
}
{
 const file='server/services/CloudApiSession.ts';let source=pkg.read('whatsapp',file);
 if(!source.includes('// suite graph dispatch')){source=source.replace('    const response = await fetch(url, init);',"    // suite graph dispatch\n    if(method==='POST'&&pathname.endsWith('/messages'))await assertSuiteSend(this.userId,this.sessionName);\n    const response = await fetch(url, init);");pkg.put('whatsapp',file,source);}
}
{
 const file='server/services/ExternalWhatsAppProxy.ts';let source=pkg.read('whatsapp',file);
 if(!source.includes('// suite proxy dispatch'))source=source.replace('    const response = await fetch(url, options);',"    // suite proxy dispatch\n    if(/\\/(?:messages|reports)\\//.test(path))await assertSuiteSend(this.userId,'default');\n    const response = await fetch(url, options);");
 source=source.replace('.test(url.pathname))await assertSuiteSend','.test(path))await assertSuiteSend');pkg.put('whatsapp',file,source);
 if(!source.includes('await assertSuiteProxy(')){
  source=source.replace('import {assertSuiteSend}', 'import {assertSuiteSend,assertSuiteProxy}');
  source=source.replace('    const response = await fetch(url, options);',"    await assertSuiteProxy(this.userId);\n    const response = await fetch(url, options);");
  pkg.put('whatsapp',file,source);
 }
}
for(const[file,method,argument]of [
 ['server/services/ChatbotService.ts','processLeadMessage','this.tenantContext?.userId'],
 ['server/services/HIMSChatbotService.ts','processHIMSMessage','appUserId'],
]){
 let source=pkg.read('whatsapp',file);if(source.includes('assertSuiteActivity'))continue;
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let position;
 function visit(node){if(ts.isMethodDeclaration(node)&&node.name.getText(ast)===method&&node.body)position=node.body.getStart(ast)+1;ts.forEachChild(node,visit);}visit(ast);
 if(position===undefined)throw Error('Bot method changed: '+method);
 source=source.slice(0,position)+`\n    await assertSuiteActivity(${argument});`+source.slice(position);
 pkg.put('whatsapp',file,"import{assertSuiteActivity}from'../suiteNodeRuntime';\n"+source);
}
for(const file of ['server/services/ChatbotService.ts','server/services/HIMSChatbotService.ts']){
 let source=pkg.read('whatsapp',file);if(source.includes('this.whatsappService=whatsappSession('))continue;
 source=source.replace("import{assertSuiteActivity}","import{assertSuiteActivity,whatsappSession,assertSuitePatientOwner}");
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let position;
 function visit(node){if(ts.isConstructorDeclaration(node)&&node.body&&node.parameters.some(p=>p.name.getText(ast)==='whatsappService'))position=node.body.getStart(ast)+1;ts.forEachChild(node,visit);}visit(ast);
 if(position===undefined)throw Error('Bot constructor changed: '+file);
 source=source.slice(0,position)+'\n    this.whatsappService=whatsappSession(this.whatsappService);'+source.slice(position);
 if(file.includes('HIMSChatbot'))source=source.replace('await assertSuiteActivity(appUserId);','await assertSuiteActivity(appUserId);\n    await assertSuitePatientOwner(appUserId,phoneNumber);');
 pkg.put('whatsapp',file,source);
}
{
 const file='server/routes.ts';let source=pkg.read('whatsapp',file);
 source=source.replaceAll('storage.getConversationHistory(phoneNumber, limit)','storage.getConversationHistoryByTenant(getTenantFromRequest(req),phoneNumber,limit)');
 source=source.replace('const hrAdmins = await withRetry(() => storage.getHRAdmins({ limit, offset }));',`const hrAdmins = req.query.organizationId
        ? await withRetry(()=>storage.getHRAdminsByOrganization(String(req.query.organizationId)))
        : await withRetry(() => storage.getHRAdmins({ limit, offset }));`);
 pkg.put('whatsapp',file,source);
}
pkg.save();console.log('Staged exact notification sender, WebSocket refresh, bot entry checks and physical send rechecks.');
