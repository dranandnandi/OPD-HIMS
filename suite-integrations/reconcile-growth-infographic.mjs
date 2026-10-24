// Rebase only Suite wrappers onto the latest independently edited source.
// No target file is written. Capture its exact hash for the later reviewed install.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import ts from 'typescript';
import {editPackage,roots} from './package-edit.mjs';
const relative='supabase/functions/generate-pathology-infographic/index.ts';
const target=path.join(roots.growth,relative),bytes=fs.readFileSync(target);
let source=bytes.toString('utf8').replaceAll('\r\n','\n');
if(source.includes('suite-runtime-guard'))throw Error('Source already instrumented; review before rebasing again.');
const ast=ts.createSourceFile(target,source,ts.ScriptTarget.Latest,true),edits=[];let served=0,clients=0,fetches=0;
for(const node of ast.statements){
 if(!ts.isImportDeclaration(node)||!node.moduleSpecifier.text.includes('supabase-js'))continue;
 const bindings=node.importClause?.namedBindings;
 if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements){
  if(item.name.text!=='createClient'||item.propertyName)throw Error('Supabase import changed; review required.');
  edits.push([item.getStart(ast),item.end,'createClient as dsBase_createClient']);clients++;
 }
 edits.push([node.end,node.end,'\nconst createClient=withSuiteClient(dsBase_createClient);\n']);
}
function visit(node){
 if(ts.isCallExpression(node)){
  if(node.expression.getText(ast)==='Deno.serve'){
   const argument=node.arguments.at(-1);if(!argument)throw Error('Missing HTTP callback');
   edits.push([argument.getStart(ast),argument.getStart(ast),'guardEdge('],[argument.end,argument.end,", 'growth', 'generate-pathology-infographic')"]);served++;
  }
  if(ts.isIdentifier(node.expression)&&node.expression.text==='fetch'){edits.push([node.expression.getStart(ast),node.expression.end,'runtimeFetch']);fetches++;}
 }
 ts.forEachChild(node,visit);
}visit(ast);
if(served!==1||clients!==1||fetches<1)throw Error('Expected source boundaries changed; review required.');
for(const[start,end,text]of edits.sort((a,b)=>b[0]-a[0]||b[1]-a[1]))source=source.slice(0,start)+text+source.slice(end);
source="import {withSuiteClient,guardEdge,runtimeFetch} from '../_shared/suite-runtime-guard.ts';\n"+source;
const pkg=editPackage();pkg.put('growth',relative,source);
pkg.entries.find(e=>e.component==='growth'&&e.relative.replaceAll('\\','/')===relative).beforeHash=crypto.createHash('sha256').update(bytes).digest('hex');
pkg.save();console.log(`Rebased Suite wrappers on current Growth source (${fetches} fetch boundaries); target unchanged.`);
