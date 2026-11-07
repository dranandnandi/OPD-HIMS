import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Pin the source: a new upstream commit must be deliberately reviewed.
const revision = '7c06a889dc949d3b6a9be28c448f4aa1e7a2848f';
const repository = 'https://github.com/junioralive/Indian-Medicine-Dataset';
const raw = `https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/${revision}`;
const root = fileURLToPath(new URL('../public/medicine-reference/', import.meta.url));
const folder = `${root}/${revision}`;
try {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
  if (manifest.version === revision) {
    const cachedLicense = await readFile(`${root}/LICENSE.txt`, 'utf8');
    if (!cachedLicense.includes('Copyright (c) 2024 JuniorAlive')) throw new Error('Missing source licence');
    // Check every cached shard: a partial previous run must not produce a broken build.
    for (const key of manifest.shards) {
      const bytes = await readFile(`${folder}/${key}.json`);
      if (createHash('sha256').update(bytes).digest('hex') !== manifest.hashes[key]) throw new Error('Incomplete cache');
    }
    console.log(`Medicine reference ready: ${manifest.recordCount} records (${revision.slice(0, 7)})`);
    process.exit(0);
  }
} catch { /* First build or incomplete cache: rebuild from the pinned source. */ }

async function download(path) {
  const response = await fetch(`${raw}/${path}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Medicine reference download failed (${response.status}): ${path}`);
  return response.text();
}
const [json, license] = await Promise.all([download('DATA/indian_medicine_data.json'), download('LICENSE')]);
const data = JSON.parse(json);
if (!Array.isArray(data) || data.length < 100000) throw new Error('Unexpected medicine reference format');
const shards = new Map();
let recordCount = 0;
for (const row of data) {
  const name = String(row.name ?? '').trim();
  const composition = [row.short_composition1, row.short_composition2]
    .map(value => String(value ?? '').trim()).filter(value => value && !/^(null|nan|n\/a|not available|none)$/i.test(value)).join(' + ');
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 2);
  if (key.length !== 2 || !composition || String(row.Is_discontinued).toLowerCase() === 'true' || row.type !== 'allopathy') continue;
  const records = shards.get(key) ?? [];
  records.push({ id: String(row.id), name, manufacturer: String(row.manufacturer_name ?? ''), pack: String(row.pack_size_label ?? ''), composition });
  shards.set(key, records);
  recordCount++;
}
await mkdir(folder, { recursive: true });
const hashes = {};
for (const [key, records] of shards) {
  const content = JSON.stringify(records);
  await writeFile(`${folder}/${key}.json`, content);
  hashes[key] = createHash('sha256').update(content).digest('hex');
}
await writeFile(`${root}/LICENSE.txt`, license);
await writeFile(`${root}/manifest.json`, JSON.stringify({
  version: revision, source: 'Indian Medicine Dataset (community reference)', sourceUrl: repository,
  snapshotDate: '2026-06-27', recordCount, sourceSha256: createHash('sha256').update(json).digest('hex'),
  shards: [...shards.keys()].sort(), hashes,
}));
console.log(`Prepared ${recordCount} active allopathic medicine records in ${shards.size} small lookup files.`);
