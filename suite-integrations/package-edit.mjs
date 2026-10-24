// Explicitly edit the uninstalled package, preserving its original target hashes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const folder=path.dirname(fileURLToPath(import.meta.url));
export const roots={opd:path.dirname(folder),growth:'D:/app/gmb review system/project',workforce:'D:/task manager android app/project'};
export const nodeRoots={whatsapp:'D:/app folder/Whatsapp new app multi user/whatsapp multi user bulk/NodeBackend',legacy_whatsapp:'D:/app folder/WHATSAPP-PERSISTENT-multi-users-master/NodeBackend'};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function editPackage(){
 const file=path.join(folder,'provisioning-manifest.json');
 const entries=JSON.parse(fs.readFileSync(file,'utf8'));
 return {
  entries,
  read(component,relative){const entry=entries.find(e=>e.component===component&&e.relative.replaceAll('\\','/')===relative);return fs.readFileSync(entry?path.join(folder,entry.staged):path.join(roots[component]||nodeRoots[component],relative),'utf8').replaceAll('\r\n','\n');},
  put(component,relative,content){
   let entry=entries.find(e=>e.component===component&&e.relative.replaceAll('\\','/')===relative);
   if(!entry){const target=path.join(roots[component]||nodeRoots[component],relative);entry={component,relative,target,staged:path.join('staged/provisioning',component,relative),beforeHash:fs.existsSync(target)?hash(fs.readFileSync(target)):null};entries.push(entry);}
   const source=path.join(folder,entry.staged);fs.mkdirSync(path.dirname(source),{recursive:true});fs.writeFileSync(source,content);entry.afterHash=hash(fs.readFileSync(source));
  },
  save(){fs.writeFileSync(file,JSON.stringify(entries,null,2)+'\n');}
 };
}
