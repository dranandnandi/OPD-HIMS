import {editPackage} from './package-edit.mjs';
const pkg=editPackage();
for(const product of ['opd','growth']){
 const file='netlify/functions/_shared/whatsappClient.ts';
 pkg.put(product,file,pkg.read(product,file).replaceAll('runtimeFetch','messagingFetch'));
}
{
 const file='netlify/functions/_shared/autoSender.ts';let source=pkg.read('opd',file);
 source=source.replace('import { withSuiteClient }','import { withSuiteClient, withTenant, assertDispatch }');
 source=source.replace('export interface QueueRow {','export interface QueueRow {\n  created_at: string;');
 source=source.replace('  const { row, sessionAuthId } = params;',`  const { row, sessionAuthId } = params;
  return withTenant(row.clinic_id,async()=>{
  if(process.env.SUITE_RUNTIME_ENABLED==='true'&&!row.created_at)throw new Error('Queued message has no creation time.');
  await assertDispatch(row.clinic_id,'opd.reminders',row.created_at);`);
 // The function is at the end of the file; demand the expected exact closing.
 if(!source.trimEnd().endsWith('  });\n}'))throw Error('Queue helper changed; inspect its closing scope');
 source=source.trimEnd().slice(0,-1)+'  },row.created_at);\n}\n';pkg.put('opd',file,source);
}
{
 const file='supabase/functions/_shared/gmb-sync-core.ts';let source=pkg.read('growth',file);
 source=`import {withUser} from './suite-runtime-guard.ts';\n`+source;
 source=source.replace('): Promise<SyncStats> {','): Promise<SyncStats> {\n  return withUser(location.user_id,async()=>{');
 source=source.replace('  return stats;\n}','  return stats;\n  });\n}');pkg.put('growth',file,source);
}
for(const name of ['send-whatsapp','process-whatsapp-queue','batch-whatsapp','send-whatsapp-batch']){
 const file=`supabase/functions/${name}/index.ts`;let source=pkg.read('workforce',file);
 source=source.replaceAll('runtimeFetch','messagingFetch');pkg.put('workforce',file,source);
}
// Database coverage alone cannot establish send/bot/API coverage.
for(const product of ['opd','growth','workforce']){
 const file='supabase/functions/suite-adapter/index.ts';let source=pkg.read(product,file);
 source=source.replace('workers:checks.database_ready===true&&checks.rpc_ready===true','workers:false');
 pkg.put(product,file,source);
}
pkg.save();console.log('Staged product worker checks. Readiness remains blocked until full host coverage is validated.');
