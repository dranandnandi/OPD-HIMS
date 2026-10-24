// Load actual transport classes without importing databases, environment files,
// sockets or application startup. Replace imports only; method bodies are intact.
import fs from 'node:fs';
import ts from 'typescript';
export async function loadTransports(assertSend,assertProxy,legacy=false){
 globalThis.__suiteTransportGuard=assertSend;
 globalThis.__suiteProxyGuard=assertProxy;
 const result={};
 for(const name of legacy?['MultiUserWhatsAppService','MultiWhatsAppService']:['WhatsAppSessionManager','CloudApiSession','ExternalWhatsAppProxy']){
  const file=`suite-integrations/staged/provisioning/${legacy?'legacy_whatsapp':'whatsapp'}/server/services/${name}.ts`;
  let source=fs.readFileSync(file,'utf8');
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),edits=[];
  for(const node of ast.statements){
   if(legacy&&ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>['multiUserWhatsAppService','multiWhatsAppService'].includes(d.name.getText(ast)))){edits.push([node.getStart(ast),node.end,'']);continue;}
   if(!ts.isImportDeclaration(node))continue;
   const spec=node.moduleSpecifier.text;
   if(['events','fs','path'].includes(spec))continue;
   let replacement='';
   if(spec==='../suiteNodeRuntime')replacement='const assertSuiteSend=globalThis.__suiteTransportGuard;const assertSuiteProxy=globalThis.__suiteProxyGuard;';
   else if(!node.importClause?.isTypeOnly){
    const names=[];if(node.importClause?.name)names.push(node.importClause.name.text);
    const bindings=node.importClause?.namedBindings;
    if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)if(!item.isTypeOnly)names.push(item.name.text);
    replacement=names.map(n=>`const ${n}=${n==='log'?'()=>{}':n==='storage'?'{createMessage:async()=>{},createSystemLog:async()=>{}}':`()=>{throw new Error('Unexpected transport dependency: ${n}');}`};`).join('\n');
   }
   edits.push([node.getStart(ast),node.end,replacement]);
  }
  for(const[start,end,value]of edits.reverse())source=source.slice(0,start)+value+source.slice(end);
  if(name==='WhatsAppSessionManager')source+='\nexport {ManagedBaileysSession};\n';
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText+`\n//# sourceURL=suite-isolated-${name}.mjs\n`;
  Object.assign(result,await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64')));
 }
 delete globalThis.__suiteTransportGuard;
 delete globalThis.__suiteProxyGuard;
 return result;
}
