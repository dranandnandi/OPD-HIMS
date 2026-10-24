import fs from'node:fs';import path from'node:path';import{editPackage,folder,nodeRoots}from'./package-edit.mjs';
const pkg=editPackage();
for(const product of ['opd','growth']){
 pkg.put(product,'supabase/functions/_shared/suite-legacy-sync.ts',fs.readFileSync(path.join(folder,'runtime/legacy-sync.ts'),'utf8').replace("'./access-core.ts'","'./suite-runtime-core.ts'"));
 const file='supabase/functions/suite-adapter/index.ts';let source=pkg.read(product,file);
 if(!source.includes('ensureLegacyUsers')){
  source="import{ensureLegacyUsers}from'../_shared/suite-legacy-sync.ts';\n"+source;
  source=source.replace("const coverage=await client.rpc('ds_runtime_coverage');",`await ensureLegacyUsers('${product}',result.identities,{url:Deno.env.get('SUITE_LEGACY_USER_SYNC_URL'),token:Deno.env.get('SUITE_LEGACY_USER_SYNC_TOKEN')});const coverage=await client.rpc('ds_runtime_coverage');`);
 }
 source=source.replace('import{ensureLegacyUsers}', 'import{ensureLegacyUsers,legacyCheckpoint}');
 source=source.replace("token:Deno.env.get('SUITE_LEGACY_USER_SYNC_TOKEN')}","token:Deno.env.get('SUITE_LEGACY_USER_SYNC_TOKEN'),checkpoint:legacyCheckpoint(client)}");
 pkg.put(product,file,source);
}
for(const component of Object.keys(nodeRoots))pkg.put(component,'server/suiteNodeSchema.ts','export const nodeSchema='+JSON.stringify(fs.readFileSync(path.join(folder,'runtime/node-runtime.sql'),'utf8'))+';\n');
pkg.save();console.log('Staged source writer ordering and backend identity receipts.');
