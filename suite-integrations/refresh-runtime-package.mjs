import fs from 'node:fs';
import path from 'node:path';
import {editPackage,folder,roots} from './package-edit.mjs';
const pkg=editPackage(),read=name=>fs.readFileSync(path.join(folder,'runtime',name),'utf8').replaceAll('\r\n','\n');
for(const product of Object.keys(roots)){
 pkg.put(product,'supabase/functions/_shared/notification-context.ts',read('notification-context.ts').replace("'./access-core.ts'","'./suite-runtime-core.ts'"));
 for(const[from,to]of [['access-core.ts','core'],['supabase-store.ts','store'],['supabase-guard.ts','guard'],['supabase-entry.ts','entry']])pkg.put(product,`supabase/functions/_shared/suite-runtime-${to}.ts`,read(from).replaceAll("'./access-core.ts'","'./suite-runtime-core.ts'"));
 if(product!=='workforce'){
  pkg.put(product,'netlify/functions/_shared/notification-context.ts',read('notification-context.ts').replace("'./access-core.ts'","'./suite-runtime-core'"));
  pkg.put(product,'netlify/functions/_shared/suite-runtime-core.ts',read('access-core.ts'));
  pkg.put(product,'netlify/functions/_shared/suite-runtime-guard.ts',read('supabase-guard.ts').replace("'npm:@supabase/supabase-js@2.51.0'","'@supabase/supabase-js'").replace("'./access-core.ts'","'./suite-runtime-core'"));
 }
 for(const name of ['SuiteEntry.tsx','SuiteBoundary.tsx'])pkg.put(product,'src/suite/'+name,read(name));
 const body=sql=>sql.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
 pkg.put(product,'supabase/migrations/20261020140000_suite_product_runtime.sql','BEGIN;\n'+['supabase-runtime.sql','supabase-capacity.sql','supabase-provisioning.sql','supabase-rpc-guard.sql'].map(name=>body(read(name).replaceAll('__PRODUCT__',product))).join('\n')+'\nCOMMIT;\n');
}
pkg.save();console.log('Refreshed shared runtime files; preserved target hashes.');
