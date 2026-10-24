import { CONTRACT, INITIAL_ADMIN_EMAIL, isPlatformAdmin, parseCommand, SuiteError, validateAdapterResponse } from './suite-contract.ts';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function assert(condition: unknown, message = 'Assertion failed'): asserts condition { if (!condition) throw new Error(message); }
function rejects(fn: () => unknown) { let caught = false; try { fn(); } catch (e) { assert(e instanceof SuiteError); caught = true; } assert(caught, 'Expected rejection'); }

Deno.test('only the confirmed bootstrap account is accepted; UUID replaces email fallback', () => {
  assert(isPlatformAdmin({ id, email: INITIAL_ADMIN_EMAIL, email_confirmed_at: '2026-10-18' }));
  assert(!isPlatformAdmin({ id, email: INITIAL_ADMIN_EMAIL }));
  assert(!isPlatformAdmin({ id, email: 'clinic-admin@example.com', email_confirmed_at: '2026-10-18' }));
  assert(!isPlatformAdmin({ id, email: INITIAL_ADMIN_EMAIL, email_confirmed_at: '2026-10-18' }, other));
  assert(isPlatformAdmin({ id, email: 'changed@example.com', email_confirmed_at: '2026-10-18' }, id));
});
Deno.test('client cannot supply actor, override state, or invoke internal provisioning RPCs', () => {
  const parsed = parseCommand({ action: 'start_trial', request_id: id, organization_id: other, actor: other, trial_ends_at: '2099-01-01', status: 'active' });
  assert(JSON.stringify(parsed.payload) === JSON.stringify({ organization_id: other }));
  rejects(() => parseCommand({ action: 'suite_finish_job', request_id: id, organization_id: other }));
});
Deno.test('validates prices, durations, product scope and dates before any DB action', () => {
  rejects(() => parseCommand({ action: 'publish_price', request_id: id, plan_code: 'doctor_complete', interval: 'month', amount_minor: -1 }));
  rejects(() => parseCommand({ action: 'publish_price', request_id: id, plan_code: 'doctor_complete', interval: 'month', amount_minor: 999.5 }));
  rejects(() => parseCommand({ action: 'extend_trial', request_id: id, organization_id: other, days: 999, reason: 'test extension' }));
  rejects(() => parseCommand({ action: 'sync_product', organization_id: other, product_code: 'lims' }));
  rejects(() => parseCommand({ action: 'grant_access', request_id: id, organization_id: other, product_code: 'opd', ends_at: '2026-11-01T10:00', reason: 'manual exception' }));
});
Deno.test('adapter acknowledgement must bind tenant, organisation, product, version and all access checks', () => {
  const job = { organization_id: id, product_code: 'opd', version: 2, local_tenant_id: 'clinic-a' };
  const valid = { ...job, contract: CONTRACT, enforcement: { server: true, workers: true, expires_at: true, tenant_isolation: true } };
  assert(validateAdapterResponse(valid, job) === 'clinic-a');
  rejects(() => validateAdapterResponse({ ...valid, organization_id: other }, job));
  rejects(() => validateAdapterResponse({ ...valid, version: 1 }, job));
  rejects(() => validateAdapterResponse({ ...valid, local_tenant_id: 'clinic-b' }, job));
  rejects(() => validateAdapterResponse({ ...valid, enforcement: { server: true } }, job));
});
