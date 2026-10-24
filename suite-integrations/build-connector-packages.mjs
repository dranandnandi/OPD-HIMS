import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(folder, 'connector-manifest.json'))) throw new Error('Connector package already prepared. Review/restage changed files deliberately; do not overwrite its snapshot.');
const root = path.dirname(folder);
const core = fs.readFileSync(path.join(root, 'supabase/functions/_shared/suite-connector-core.ts'), 'utf8');
const projects = {
  growth: 'D:/app/gmb review system/project',
  workforce: 'D:/task manager android app/project',
  whatsapp: 'D:/app folder/Whatsapp new app multi user/whatsapp multi user bulk/NodeBackend',
  legacy_whatsapp: 'D:/app folder/WHATSAPP-PERSISTENT-multi-users-master/NodeBackend',
};
const changes = [];
function stage(component, relative, content) {
  const target = path.join(projects[component], relative);
  const beforeHash = fs.existsSync(target) ? crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') : null;
  const staged = path.join(folder, 'staged', component, relative);
  fs.mkdirSync(path.dirname(staged), { recursive: true }); fs.writeFileSync(staged, content);
  changes.push({ component, relative, target, staged: path.relative(folder, staged), beforeHash,
    afterHash: crypto.createHash('sha256').update(content).digest('hex') });
}
for (const component of ['growth', 'workforce']) {
  const columns = component === 'growth' ? 'id,auth_id' : 'id,auth_id,organization_id';
  stage(component, 'supabase/functions/_shared/suite-connector-core.ts', core);
  stage(component, 'supabase/functions/suite-connector/index.ts', `import { createClient } from 'npm:@supabase/supabase-js@2.51.0';
import { handleConnector } from '../_shared/suite-connector-core.ts';
export function handleSuiteConnector(req: Request): Promise<Response> {
  const client = () => createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false, autoRefreshToken: false } });
  return handleConnector(req, { component: '${component}', token: Deno.env.get('SUITE_CONNECTOR_TOKEN'), instanceId: Deno.env.get('SUITE_INSTANCE_ID'), environment: Deno.env.get('SUITE_ENVIRONMENT') }, {
    async health() { const { error } = await client().from('users').select('${columns}').limit(1); if (error) throw error; },
    async identity(id) {
      const { data, error } = await client().from('users').select('${columns}').eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? { local_user_id: String(data.id), local_auth_id: data.auth_id, local_tenant_id: ${component === 'growth' ? 'String(data.id)' : 'data.organization_id'} } : null;
    },
  });
}
if (import.meta.main) Deno.serve(handleSuiteConnector);
`);
  const config = path.join(projects[component], 'supabase/config.toml');
  const previous = fs.existsSync(config) ? fs.readFileSync(config, 'utf8') : '';
  if (/\[functions\.suite-connector\]/.test(previous)) throw new Error('Connector config already exists; review it instead of regenerating.');
  stage(component, 'supabase/config.toml', previous + '\n[functions.suite-connector]\n# Server-only credential checked by the handler.\nverify_jwt = false\n');
}
for (const component of ['whatsapp', 'legacy_whatsapp']) {
  const columns = component === 'whatsapp' ? 'id, organization_id' : 'id, auth_id';
  stage(component, 'server/suiteConnectorCore.ts', core);
  stage(component, 'server/suiteConnector.ts', `import type { Express } from 'express';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { handleConnector } from './suiteConnectorCore';

export function registerSuiteConnector(app: Express): void {
  app.post('/api/suite/connector', async (req, res) => {
    try {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (typeof req.headers.authorization === 'string') headers.set('Authorization', req.headers.authorization);
      if (req.headers.origin !== undefined) headers.set('Origin', String(req.headers.origin));
      const response = await handleConnector(new Request('https://suite.internal/connector', { method: 'POST', headers, body: JSON.stringify(req.body ?? null) }), {
        component: '${component}', token: process.env.SUITE_CONNECTOR_TOKEN,
        instanceId: process.env.SUITE_INSTANCE_ID, environment: process.env.SUITE_ENVIRONMENT,
      }, {
        async health() { await db.execute(sql\`SELECT ${columns} FROM users LIMIT 1\`); },
        async identity(id) {
          const result = await db.execute(sql\`SELECT ${columns} FROM users WHERE id::text = \${id} LIMIT 1\`);
          const rows = ${component === 'whatsapp' ? 'result' : 'Array.isArray(result) ? result : result.rows'};
          const row = rows[0];
          return row ? { local_user_id: String(row.id), local_auth_id: ${component === 'whatsapp' ? 'null' : 'row.auth_id'}, local_tenant_id: ${component === 'whatsapp' ? 'row.organization_id == null ? null : String(row.organization_id)' : 'String(row.id)'} } : null;
        },
      });
      res.status(response.status).set('Cache-Control', 'no-store').type('json').send(await response.text());
    } catch { res.status(503).set('Cache-Control', 'no-store').json({ error: 'Connector unavailable.' }); }
  });
}
`);
  const index = fs.readFileSync(path.join(projects[component], 'server/index.ts'), 'utf8');
  const anchor = 'app.use(express.urlencoded({ extended: false }));';
  if (!index.includes(anchor) || index.includes('registerSuiteConnector')) throw new Error('Server registration has changed; review before patching.');
  stage(component, 'server/index.ts', `import { registerSuiteConnector } from './suiteConnector';\n` + index.replace(anchor, anchor + '\nregisterSuiteConnector(app);'));
}
fs.writeFileSync(path.join(folder, 'connector-manifest.json'), JSON.stringify(changes, null, 2) + '\n');
console.log(`Prepared ${changes.length} connector files. No external project has been modified.`);
