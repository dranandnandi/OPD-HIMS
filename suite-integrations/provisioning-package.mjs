// Source preparation only. Never imports an app's .env or executes its server.
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{fileURLToPath}from'node:url';import ts from'typescript';
const here=path.dirname(fileURLToPath(import.meta.url)),workspace=path.dirname(here);
const manifest=path.join(here,'provisioning-manifest.json');if(fs.existsSync(manifest))throw Error('Provisioning package exists; restage changes deliberately instead of regenerating it.');
const roots={opd:workspace,growth:'D:/app/gmb review system/project',workforce:'D:/task manager android app/project'};
const entries=[],inventory={};const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
function stage(component,relative,content){const target=path.join(roots[component],relative),staged=path.join('staged/provisioning',component,relative),source=path.join(here,staged);fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,content);entries.push({component,relative,target,staged,beforeHash:fs.existsSync(target)?hash(fs.readFileSync(target)):null,afterHash:hash(fs.readFileSync(source))});}
function files(dir){if(!fs.existsSync(dir))return[];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):/\.(ts|js)$/.test(e.name)?[path.join(dir,e.name)]:[]);}
function instrument(file,product,kind,scheduled=false){
 let source=read(file);const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),edits=[],names=new Set(),declarations=[];let wrapped=0,transport=0,lastImport=0;
 const helper=path.posix.relative(path.posix.dirname(path.relative(roots[product],file).replaceAll('\\','/')),kind==='edge'?'supabase/functions/_shared/suite-runtime-guard.ts':'netlify/functions/_shared/suite-runtime-guard').replace(/^([^\.])/,'./$1');
 for(const statement of ast.statements)if(ts.isImportDeclaration(statement)){
  lastImport=statement.end;
  if(statement.moduleSpecifier.text.includes('supabase-js')&&statement.importClause?.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings))for(const specifier of statement.importClause.namedBindings.elements){
   if((specifier.propertyName?.text||specifier.name.text)==='createClient'&&!specifier.isTypeOnly){const local=specifier.name.text,base='dsBase_'+local;edits.push([specifier.getStart(ast),specifier.end,`createClient as ${base}`]);names.add('withSuiteClient');declarations.push(`const ${local}=withSuiteClient(${base});`);transport++;}
  }
 }
 function visit(node){
  if(ts.isCallExpression(node)){
   if(kind==='edge'&&(node.expression.getText(ast)==='serve'||node.expression.getText(ast)==='Deno.serve')){
    const argument=node.arguments.at(-1);if(!argument)throw Error('Serve callback missing');
    const name=path.basename(path.dirname(file));names.add('guardEdge');edits.push([argument.getStart(ast),argument.getStart(ast),`guardEdge(`]);edits.push([argument.end,argument.end,`, '${product}', '${name}')`]);wrapped++;
   }
   if(ts.isIdentifier(node.expression)&&node.expression.text==='fetch'){names.add('runtimeFetch');edits.push([node.expression.getStart(ast),node.expression.end,'runtimeFetch']);transport++;}
  }
  if(kind==='netlify'&&ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handler'&&node.initializer){names.add('guardNetlify');edits.push([node.initializer.getStart(ast),node.initializer.getStart(ast),'guardNetlify(']);edits.push([node.initializer.end,node.initializer.end,`, '${product}', '${path.basename(file,path.extname(file))}', ${scheduled})`]);wrapped++;}
  if(ts.isStringLiteral(node)&&/^postgres(?:ql)?:\/\//.test(node.text)){
   const parent=node.parent;const prefix=ts.isBinaryExpression(parent)?parent.left.getText(ast):'';const envName=prefix.match(/process\.env\.([A-Z0-9_]+)/)?.[1]||prefix.match(/Deno\.env\.get\(['"]([A-Z0-9_]+)['"]\)/)?.[1]||(/userLookup|sync-user-to-whatsapp-db/.test(file)?'WHATSAPP_DB_CONNECTION_STRING':null);
   if(!envName)throw Error('A database fallback needs explicit server env review: '+path.basename(file));names.add('requiredRuntimeEnv');edits.push([node.getStart(ast),node.end,`requiredRuntimeEnv('${envName}')`]);
  }
  ts.forEachChild(node,visit);
 }visit(ast);
 if(!edits.length)return null;
 if(declarations.length)edits.push([lastImport,lastImport,'\n'+declarations.join('\n')+'\n']);
 for(const[start,end,value]of edits.sort((a,b)=>b[0]-a[0]||b[1]-a[1]))source=source.slice(0,start)+value+source.slice(end);
 source=`import { ${[...names].join(', ')} } from '${helper}';\n`+source;
 return{source,wrapped,transport};
}
const runtime=read(path.join(here,'runtime/supabase-runtime.sql')),provision=read(path.join(here,'runtime/supabase-provisioning.sql')),rpcGuard=read(path.join(here,'runtime/supabase-rpc-guard.sql'));
const body=sql=>sql.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
for(const[product,root]of Object.entries(roots)){
 const common='supabase/functions/_shared/';
 for(const[from,to]of [['access-core.ts','suite-runtime-core.ts'],['supabase-store.ts','suite-runtime-store.ts'],['supabase-guard.ts','suite-runtime-guard.ts'],['supabase-entry.ts','suite-runtime-entry.ts']])stage(product,common+to,read(path.join(here,'runtime',from)).replaceAll("'./access-core.ts'","'./suite-runtime-core.ts'"));
 stage(product,'supabase/migrations/20261020140000_suite_product_runtime.sql','BEGIN;\n'+[runtime.replaceAll('__PRODUCT__',product),provision,rpcGuard].map(body).join('\n')+'\nCOMMIT;\n');
 stage(product,'supabase/functions/suite-entry/index.ts',`import{productEntry}from'../_shared/suite-runtime-entry.ts';\nexport const handleSuiteEntry=productEntry('${product}');\nif(import.meta.main)Deno.serve(handleSuiteEntry);\n`);
 stage(product,'supabase/functions/suite-adapter/index.ts',`import{createClient}from'npm:@supabase/supabase-js@2.51.0';
import{handleAdapter,AccessError,record}from'../_shared/suite-runtime-core.ts';
import{applySupabaseSnapshot}from'../_shared/suite-runtime-store.ts';
import{RUNTIME_REVISION}from'../_shared/suite-runtime-guard.ts';
export async function handleSuiteAdapter(req:Request){return handleAdapter(req,{product:'${product}',token:Deno.env.get('SUITE_ADAPTER_TOKEN'),instance:Deno.env.get('SUITE_INSTANCE_ID'),environment:Deno.env.get('SUITE_ENVIRONMENT')},{async apply(snapshot){
 if(Deno.env.get('SUITE_RUNTIME_ENABLED')!=='true'||RUNTIME_REVISION!=='suite.runtime.v1')throw new AccessError('Product runtime is not enabled.',503);
 const client=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
 const result=await applySupabaseSnapshot(client,snapshot,'${product}');const coverage=await client.rpc('ds_runtime_coverage');
 if(coverage.error)throw new AccessError('Product schema coverage is unavailable.',503);const checks=record(coverage.data);
 return{local_tenant_id:String(result.local_tenant_id),version:Number(result.version),identities:result.identities,enforcement:{server:checks.database_ready===true&&checks.rpc_ready===true,workers:checks.database_ready===true&&checks.rpc_ready===true,expires_at:true,tenant_isolation:checks.database_ready===true&&checks.rpc_ready===true}};
 }});}
if(import.meta.main)Deno.serve(handleSuiteAdapter);
`);
 let config=read(path.join(root,'supabase/config.toml'));for(const name of ['suite-adapter','suite-entry'])if(!config.includes(`[functions.${name}]`))config+=`\n[functions.${name}]\n# Scoped adapter credential / one-use customer ticket validated inside the handler.\nverify_jwt = false\n`;stage(product,'supabase/config.toml',config);
 const recordInventory={edge:[],netlify:[],scheduled:[]};
 const publicNames=new Set(product==='opd'?['suite-admin','suite-member','suite-product-access','suite-worker','suite-connector','suite-entry','suite-adapter','doc-link','verify-prescription','patient-upload','public-booking']:['suite-connector','suite-entry','suite-adapter']);
 for(const file of files(path.join(root,'supabase/functions'))){const relative=path.relative(root,file),name=path.basename(path.dirname(file));if(path.basename(file).startsWith('suite-')||publicNames.has(name)||file.endsWith('.test.ts'))continue;
  const changed=instrument(file,product,'edge');if(!changed)continue;stage(product,relative,changed.source);if(path.basename(file)==='index.ts'){if(!changed.wrapped)throw Error('HTTP entry point not wrapped: '+relative);recordInventory.edge.push(name);}
 }
 const netlifyDir=path.join(root,'netlify/functions');if(fs.existsSync(netlifyDir)){
  stage(product,'netlify/functions/_shared/suite-runtime-core.ts',read(path.join(here,'runtime/access-core.ts')));
  stage(product,'netlify/functions/_shared/suite-runtime-guard.ts',read(path.join(here,'runtime/supabase-guard.ts')).replace("'npm:@supabase/supabase-js@2.51.0'","'@supabase/supabase-js'").replace("'./access-core.ts'","'./suite-runtime-core'"));
  const toml=fs.existsSync(path.join(root,'netlify.toml'))?read(path.join(root,'netlify.toml')):'';
  for(const file of files(netlifyDir)){if(path.basename(file).startsWith('suite-')||file.endsWith('.test.ts'))continue;const name=path.basename(file,path.extname(file));const scheduled=toml.includes(`[functions."${name}"]`)&&toml.slice(toml.indexOf(`[functions."${name}"]`)).split(/\n\[/)[0].includes('schedule');
   const changed=instrument(file,product,'netlify',scheduled);if(!changed)continue;stage(product,path.relative(root,file),changed.source);if(path.dirname(file)===netlifyDir){if(!changed.wrapped)throw Error('Netlify handler not wrapped: '+name);recordInventory.netlify.push(name);if(scheduled)recordInventory.scheduled.push(name);}
  }
 }
 inventory[product]=recordInventory;
 for(const name of ['SuiteEntry.tsx','SuiteBoundary.tsx'])stage(product,'src/suite/'+name,read(path.join(here,'runtime',name)));
}
fs.writeFileSync(path.join(here,'provisioning-inventory.json'),JSON.stringify(inventory,null,2)+'\n');
fs.writeFileSync(manifest,JSON.stringify(entries,null,2)+'\n');console.log(`Prepared ${entries.length} source files and entry-point inventory. Nothing installed or deployed.`);
