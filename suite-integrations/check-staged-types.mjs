// Typecheck a virtual overlay: target repositories and unrelated edits are untouched.
import ts from 'typescript';import fs from 'node:fs';import path from 'node:path';
import {folder,roots,nodeRoots} from './package-edit.mjs';
const entries=JSON.parse(fs.readFileSync(path.join(folder,'provisioning-manifest.json'),'utf8'));
const normalize=file=>path.resolve(file).toLowerCase();
const staged=new Map(entries.map(e=>[normalize(e.target),path.join(folder,e.staged)]));
let failed=false;
for(const component of process.argv.slice(2).length?process.argv.slice(2):['opd','growth','workforce']){
 const root=roots[component]||nodeRoots[component],configFile=['tsconfig.app.json','tsconfig.json'].map(n=>path.join(root,n)).find(p=>fs.existsSync(p));
 const config=ts.readConfigFile(configFile,ts.sys.readFile);if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
 const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root,{noEmit:true});
 function diagnostics(overlay){
  const host=ts.createCompilerHost(parsed.options),read=host.readFile,exists=host.fileExists;
  if(overlay){host.readFile=p=>read(staged.get(normalize(p))||p);host.fileExists=p=>staged.has(normalize(p))||exists(p);const dirExists=host.directoryExists;host.directoryExists=p=>[...staged.keys()].some(k=>k.startsWith(normalize(p)+path.sep))||!!dirExists?.(p);}
  const files=overlay?[...new Set([...parsed.fileNames,...entries.filter(e=>e.component===component&&e.relative.replaceAll('\\','/').startsWith('src/')&&/\.tsx?$/.test(e.target)).map(e=>e.target)])]:parsed.fileNames;
  return ts.getPreEmitDiagnostics(ts.createProgram(files,parsed.options,host));
 }
 const baseline=diagnostics(false),key=d=>[d.file?.fileName,d.code,ts.flattenDiagnosticMessageText(d.messageText,'\n')].join(':');
 const known=new Set(baseline.map(key)),all=diagnostics(true),newErrors=all.filter(d=>!known.has(key(d)));
 console.log(`${component}: ${baseline.length} baseline diagnostics; ${newErrors.length} new diagnostics in overlay.`);
 if(newErrors.length){failed=true;console.log(ts.formatDiagnosticsWithColorAndContext(newErrors,{getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));}
}
if(failed)process.exitCode=1;
