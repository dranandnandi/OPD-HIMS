// Filtered installer: the same guard rules as apply-packages.mjs, but for ONE
// component of provisioning-manifest.json. Usage: node apply-component.mjs workforce|growth
// Does not deploy, run SQL or alter secrets. Refuses if any staged file or any
// target changed since the package was reviewed.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const component = process.argv[2];
const roots = { workforce: 'D:/task manager android app/project', growth: 'D:/app/gmb review system/project' };
if (!roots[component]) throw new Error('component must be workforce or growth');
const root = path.resolve(roots[component]).toLowerCase() + path.sep;
const entries = JSON.parse(fs.readFileSync(path.join(folder, 'provisioning-manifest.json'), 'utf8')).filter(e => e.component === component);
const hash = f => fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : null;
for (const e of entries) {
  const target = path.resolve(e.target);
  if (!target.toLowerCase().startsWith(root)) throw new Error('Target outside component root: ' + e.relative);
  const source = path.resolve(folder, e.staged);
  if (!source.startsWith(path.join(folder, 'staged') + path.sep) || hash(source) !== e.afterHash) throw new Error('Staged source changed: ' + e.relative);
  const cur = hash(target);
  if (cur !== e.beforeHash && cur !== e.afterHash) throw new Error('Target changed since review: ' + e.relative);
}
let updated = 0, skipped = 0;
for (const e of entries) {
  if (hash(e.target) === e.afterHash) { skipped++; continue; }
  fs.mkdirSync(path.dirname(e.target), { recursive: true });
  fs.copyFileSync(path.join(folder, e.staged), e.target);
  updated++;
}
console.log(`${component}: ${entries.length} entries, ${updated} written, ${skipped} already current`);
