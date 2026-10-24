import fs from'node:fs';import path from'node:path';import{build}from'esbuild';import{folder,nodeRoots}from'./package-edit.mjs';
const entries=JSON.parse(fs.readFileSync(path.join(folder,'provisioning-manifest.json'),'utf8'));
for(const[component,root]of Object.entries(nodeRoots)){
 const overlay=new Map(entries.filter(e=>e.component===component).map(e=>[path.resolve(e.target).toLowerCase(),path.join(folder,e.staged)]));
 await build({entryPoints:[path.join(root,'server/index.ts')],bundle:true,write:false,platform:'node',format:'esm',packages:'external',logLevel:'silent',alias:{'@shared':path.join(root,'shared')},plugins:[{name:'staged-source',setup(builder){
  builder.onResolve({filter:/^[.]/},args=>{const raw=path.resolve(args.resolveDir,args.path);const found=[raw,raw+'.ts',raw+'.tsx',path.join(raw,'index.ts')].find(p=>overlay.has(p.toLowerCase()));if(found)return{path:found};});
  builder.onLoad({filter:/\.[cm]?[jt]sx?$/},args=>{const file=overlay.get(args.path.toLowerCase());if(file)return{contents:fs.readFileSync(file,'utf8'),loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:path.dirname(args.path)};});
 }}]});console.log(component+': staged server compiles without executing it.');
}
