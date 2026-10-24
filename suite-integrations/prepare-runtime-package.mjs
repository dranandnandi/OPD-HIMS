// Stage only; installation uses apply-packages.mjs and its normal hash guard.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const folder=path.dirname(fileURLToPath(import.meta.url));
const manifest=path.join(folder,'runtime-manifest.json');
if(fs.existsSync(manifest))throw new Error('Runtime package already prepared; review and restage changes deliberately.');
const root='D:/app folder/Whatsapp new app multi user/whatsapp multi user bulk/NodeBackend';
const entries=[];
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function stage(relative,content){
 const target=path.join(root,relative),staged=path.join('staged/runtime/whatsapp',relative),source=path.join(folder,staged);
 const before=fs.existsSync(target)?fs.readFileSync(target):null;
 fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,content);
 entries.push({component:'whatsapp',relative,target,staged,beforeHash:before?hash(before):null,afterHash:hash(fs.readFileSync(source))});
}
const core=fs.readFileSync(path.join(folder,'runtime/access-core.ts'),'utf8');
stage('server/suiteAccessCore.ts',core);
stage('server/suiteTenantAccess.ts',fs.readFileSync(path.join(folder,'runtime/tenant-access.ts'),'utf8').replace("'./access-core.ts'","'./suiteAccessCore'"));
stage('server/suiteRuntimeAccess.ts',`import { requireTenantAccess } from './suiteTenantAccess';
export async function requireWorkforceAccess(organizationId: string) {
 return requireTenantAccess('workforce',organizationId,{
  enabled:process.env.SUITE_ACCESS_ENABLED,url:process.env.SUITE_ACCESS_URL,
  token:process.env.SUITE_WORKFORCE_ACCESS_TOKEN,allowUnmanaged:process.env.SUITE_ALLOW_UNMANAGED,
 });
}
// An LLM tool may select task data, never its authenticated actor or tenant.
export function workforceToolScope(input: Record<string,unknown>, admin: {userId:string;organizationId:string}) {
 if(input.userId!==undefined && input.userId!==admin.userId || input.organizationId!==undefined && input.organizationId!==admin.organizationId) {
  throw new Error('The requested actor or organisation does not match this HR account.');
 }
 return {userId:admin.userId,organizationId:admin.organizationId};
}
`);
let hr=fs.readFileSync(path.join(root,'server/services/HRChatbotService.ts'),'utf8').replaceAll('\r\n','\n');
function replaceOne(before,after){if(!hr.includes(before))throw new Error('HR source anchor changed');hr=hr.replace(before,after);}
replaceOne('import Anthropic from "@anthropic-ai/sdk";',`import { AccessError } from '../suiteAccessCore';\nimport { requireWorkforceAccess, workforceToolScope } from '../suiteRuntimeAccess';\nimport Anthropic from "@anthropic-ai/sdk";`);
replaceOne('const userId = toolInput.userId || hrAdmin.userId;','const { userId, organizationId } = workforceToolScope(toolInput, hrAdmin);');
replaceOne('    const organizationId = toolInput.organizationId || hrAdmin.organizationId;','');
replaceOne('      switch (toolName) {','      await requireWorkforceAccess(hrAdmin.organizationId);\n      switch (toolName) {');
const gate='      // Check if chatbot is active for this admin';
replaceOne(gate,'      await requireWorkforceAccess(hrAdmin.organizationId);\n\n'+gate);
replaceOne('      await this.whatsappService.sendTextMessage(sendTo, botResponse);','      await requireWorkforceAccess(hrAdmin.organizationId);\n      await this.whatsappService.sendTextMessage(sendTo, botResponse);');
replaceOne('      await this.whatsappService.sendTextMessage(hrAdmin.phoneNumber, welcomeMessage);','      await requireWorkforceAccess(hrAdmin.organizationId);\n      await this.whatsappService.sendTextMessage(hrAdmin.phoneNumber, welcomeMessage);');
replaceOne('      // Send fallback message','      if (error instanceof AccessError) return;\n\n      // Send fallback message');
replaceOne('      // Send fallback message\n      try {','      // Send fallback message\n      try {\n        const registered = await this.storage.getHRAdmin(phoneNumber);\n        if (!registered) return;\n        await requireWorkforceAccess(registered.organizationId);');
stage('server/services/HRChatbotService.ts',hr);
fs.writeFileSync(manifest,JSON.stringify(entries,null,2)+'\n');
console.log(`Prepared ${entries.length} reviewed runtime files; no deployment or installation performed.`);
