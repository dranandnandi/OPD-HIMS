import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// The production route code is compiled with only its DB import replaced by an
// isolated PostgreSQL instance. Never imports the live backend db.ts or .env.
const backend = process.env.SUITE_WHATSAPP_SOURCE || 'D:/app folder/Whatsapp new app multi user/whatsapp multi user bulk/NodeBackend';
const requireBackend = createRequire(pathToFileURL(path.join(backend, 'package.json')));
const express = requireBackend('express');
const esbuild = requireBackend('esbuild');
const { PgDialect } = await import(pathToFileURL(path.join(backend, 'node_modules/drizzle-orm/pg-core/index.js')));
const dialect = new PgDialect();
const token = 'bridge-test-only-credential-at-least-thirty-two-chars';
const source = '33333333-3333-4333-8333-333333333333';
const org = '22222222-2222-4222-8222-222222222222';
const user = '11111111-1111-4111-8111-111111111111';

test('Workforce bridge preserves existing users, isolates tenants and forwards only scoped session operations', async t => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users(id text PRIMARY KEY,username text UNIQUE NOT NULL,password text NOT NULL,email text UNIQUE,organization_id text NOT NULL,role text NOT NULL,created_at timestamptz,updated_at timestamptz)`);
  await db.query('INSERT INTO users(id,username,password,email,organization_id,role) VALUES ($1,$2,$3,$4,$5,$6)', [user, 'keep-existing', 'keep-hash', 'existing@example.com', org, 'admin']);
  const oldDb = globalThis.__suiteBridgeTestDb;
  let statements = 0;
  globalThis.__suiteBridgeTestDb = { execute: async statement => {
    statements++; const { sql, params } = dialect.sqlToQuery(statement); return (await db.query(sql, params)).rows;
  }, transaction: fn => db.transaction(tx => fn({ execute: async statement => {
    statements++; const { sql, params } = dialect.sqlToQuery(statement); return (await tx.query(sql, params)).rows;
  } })) };
  const built = await esbuild.build({
    stdin: { contents: "export * from './workforceBridge'; export * from './externalApiRoutes';", loader: 'ts',
      resolveDir: fileURLToPath(new URL('../staged/whatsapp/server/', import.meta.url)) },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'isolated-database', setup(build) {
      build.onResolve({ filter: /^\.\/db$/ }, () => ({ path: 'test-db', namespace: 'isolated' }));
      build.onLoad({ filter: /.*/, namespace: 'isolated' }, () => ({ contents: 'export const db = globalThis.__suiteBridgeTestDb;', loader: 'js' }));
      build.onResolve({ filter: /^\.\/(utils|services\/WhatsAppSessionManager|services\/ExternalBulkSendService)$/ }, args => ({ path: args.path, namespace: 'no-live-services' }));
      build.onLoad({ filter: /.*/, namespace: 'no-live-services' }, () => ({ contents: `
        export const log = () => {};
        export const sessionManager = new Proxy({}, { get() { throw new Error('Live session access is forbidden in this test'); } });
        export const externalBulkSendService = {};
        export const normalizeExternalPhone = value => value;
      `, loader: 'js' }));
      build.onResolve({ filter: /^(drizzle-orm|bcryptjs|multer|qrcode)$/ }, args => ({ path: pathToFileURL(args.path === 'drizzle-orm' ? path.join(backend, 'node_modules/drizzle-orm/index.js') : requireBackend.resolve(args.path)).href, external: true }));
    } }],
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const saved = { token: process.env.WORKFORCE_INTEGRATION_TOKEN, source: process.env.WORKFORCE_SOURCE_ID };
  process.env.WORKFORCE_INTEGRATION_TOKEN = token; process.env.WORKFORCE_SOURCE_ID = source;
  const app = express(); app.use(express.json()); module.registerWorkforceBridge(app);
  app.get('/api/users/:userId/whatsapp/qr', (req, res) => {
    const scope = module.getWorkforceScope(req);
    res.json({ success: true, data: { id: req.params.userId, session: req.query.sessionName, organization: scope?.organizationId, original: req.originalUrl } });
  });
  module.registerExternalApiRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await db.close();
    globalThis.__suiteBridgeTestDb = oldDb;
    if (saved.token === undefined) delete process.env.WORKFORCE_INTEGRATION_TOKEN; else process.env.WORKFORCE_INTEGRATION_TOKEN = saved.token;
    if (saved.source === undefined) delete process.env.WORKFORCE_SOURCE_ID; else process.env.WORKFORCE_SOURCE_ID = saved.source;
  });
  const url = `http://127.0.0.1:${server.address().port}/api/integrations/workforce`;
  const body = () => ({ source_id: source, organization_id: org, action: 'sync_admins', user_id: user, session_name: 'default', admins: [{ id: user, email: 'changed@example.com', role: 'super_admin' }] });
  const post = (value = body(), credential = token, origin) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}`, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(value) });

  await t.test('existing identities are reused without changing their credentials, role or tenant', async () => {
    assert.equal((await post()).status, 200);
    const row = (await db.query('SELECT * FROM users WHERE id=$1', [user])).rows[0];
    assert.equal(row.username, 'keep-existing'); assert.equal(row.password, 'keep-hash');
    assert.equal(row.email, 'existing@example.com'); assert.equal(row.role, 'admin'); assert.equal(row.organization_id, org);
  });
  await t.test('new external identities do not claim email or admin privilege, and retries do not duplicate', async () => {
    const next = '55555555-5555-4555-8555-555555555555';
    const payload = { ...body(), admins: [...body().admins, { id: next, email: 'existing@example.com', role: 'super_admin' }] };
    const results = await Promise.all([post(payload), post(payload)]);
    results.forEach(response => assert.equal(response.status, 200));
    const rows = (await db.query('SELECT * FROM users WHERE id=$1', [next])).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].email, null); assert.equal(rows[0].role, 'user');
    assert.ok(rows[0].password.startsWith('$2'));
  });
  await t.test('tenant conflict rolls back the entire batch and never moves an existing account', async () => {
    const outsider = '99999999-9999-4999-8999-999999999999'; const fresh = '00000000-0000-4000-8000-000000000000';
    await db.query("INSERT INTO users(id,username,password,organization_id,role) VALUES ($1,'other','hash','other-org','user')", [outsider]);
    const response = await post({ ...body(), admins: [...body().admins, { id: fresh }, { id: outsider }] });
    assert.equal(response.status, 409);
    assert.equal((await db.query('SELECT id FROM users WHERE id=$1', [fresh])).rows.length, 0);
    assert.equal((await db.query('SELECT organization_id FROM users WHERE id=$1', [outsider])).rows[0].organization_id, 'other-org');
  });
  await t.test('scope survives Express dispatch and uses only the selected session', async () => {
    const response = await post({ ...body(), action: 'qr', session_name: 'clinic_2' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.data.id, user); assert.equal(result.data.session, 'clinic_2'); assert.equal(result.data.organization, org);
  });
  await t.test('real external middleware checks ownership and does not accept the bridge token directly', async () => {
    const valid = await post({ ...body(), action: 'handshake' });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).data.userId, user);
    const foreign = '99999999-9999-4999-8999-999999999999';
    const denied = await post({ ...body(), action: 'handshake', user_id: foreign, admins: [{ id: foreign }] });
    assert.equal(denied.status, 403);
    const direct = await fetch(url.replace('/api/integrations/workforce', '/api/external/users/sync'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id: user }),
    });
    assert.equal(direct.status, 401);
  });
  await t.test('invalid credentials, browser calls, foreign source and arbitrary actions never query the database', async () => {
    const before = statements;
    assert.equal((await post(body(), 'wrong')).status, 401);
    assert.equal((await post(body(), token, 'https://browser.invalid')).status, 403);
    assert.equal((await post({ ...body(), source_id: user })).status, 403);
    assert.equal((await post({ ...body(), action: 'send_message', url: 'https://evil.invalid' })).status, 400);
    assert.equal(statements, before);
  });
});
