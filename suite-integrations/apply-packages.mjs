// Reviewable local file installer. Does not deploy, run SQL, or alter secrets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const manifest = process.argv[2] || 'connector-manifest.json';
const checkOnly=process.argv[3]==='--check';
if(process.argv.length>4||process.argv[3]&&!checkOnly)throw new Error('Usage: node apply-packages.mjs [manifest] [--check]');
if (!/^[a-z-]+-manifest\.json$/.test(manifest)) throw new Error('Invalid manifest name');
const entries = JSON.parse(fs.readFileSync(path.join(folder, manifest), 'utf8'));
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const allowedRoots = [
  path.dirname(folder),
  'D:/app/gmb review system/project', 'D:/task manager android app/project',
  'D:/app folder/Whatsapp new app multi user/whatsapp multi user bulk/NodeBackend',
  'D:/app folder/WHATSAPP-PERSISTENT-multi-users-master/NodeBackend',
].map(p => path.resolve(p).toLowerCase() + path.sep);
const changedTargets=[];
for (const entry of entries) {
  const target = path.resolve(entry.target);
  if (!allowedRoots.some(root => target.toLowerCase().startsWith(root))) throw new Error('Target outside approved project roots');
  const source = path.resolve(folder, entry.staged);
  if (!source.startsWith(path.join(folder, 'staged') + path.sep) || hash(source) !== entry.afterHash) throw new Error('Staged source has changed');
  const current = hash(target);
  if (current !== entry.beforeHash && current !== entry.afterHash) changedTargets.push(`${entry.component}/${entry.relative}`);
}
if(changedTargets.length)throw new Error('Targets changed since review (nothing installed):\n'+changedTargets.join('\n'));
if(checkOnly){console.log(`Verified ${entries.length} staged files and target hashes. No files installed.`);process.exit(0);}
for (const entry of entries) {
  if (hash(entry.target) === entry.afterHash) continue;
  fs.mkdirSync(path.dirname(entry.target), { recursive: true });
  fs.copyFileSync(path.join(folder, entry.staged), entry.target);
  console.log(`Updated ${entry.component}/${entry.relative}`);
}
