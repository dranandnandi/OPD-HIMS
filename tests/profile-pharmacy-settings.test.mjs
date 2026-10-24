import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Execute the real Edge Function handler with its auth/database boundaries stubbed.
const fixture = { handler: null, row: null, selection: '', authenticated: true };
globalThis.__pharmacyProfileTest = fixture;
globalThis.Deno = { env: { get: () => 'test-only' } };
fixture.client = {
  auth: { getUser: async () => ({ data: { user: fixture.authenticated ? { id: 'staff-a' } : null }, error: null }) },
  from(table) {
    assert.equal(table, 'profiles');
    return {
      select(selection) { fixture.selection = selection; return this; },
      eq(column, value) { assert.equal(column, 'id'); assert.equal(value, 'staff-a'); return this; },
      async maybeSingle() { return { data: fixture.row, error: null }; },
    };
  },
};
const bundled = await build({
  entryPoints: ['supabase/functions/fetch-user-profile/index.ts'], bundle: true,
  write: false, platform: 'node', format: 'esm',
  drop: ['console'],
  plugins: [{ name: 'edge-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(https:|npm:)/ }, args => ({ path: args.path, namespace: 'edge-mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'edge-mock' }, args => ({
      contents: args.path.startsWith('https:')
        ? 'export const serve = handler => { globalThis.__pharmacyProfileTest.handler = handler; };'
        : 'export const createClient = () => globalThis.__pharmacyProfileTest.client;',
      loader: 'js',
    }));
  } }],
});
await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

async function request() {
  return fixture.handler(new Request('http://localhost/fetch-user-profile', {
    method: 'POST', headers: { Authorization: 'Bearer test-token' },
    // The request must not determine whose profile is returned.
    body: JSON.stringify({ userId: 'another-user' }),
  }));
}

test('profile endpoint selects and returns the saved pharmacy GST settings', async () => {
  fixture.row = { id: 'staff-a', clinic_settings: {
    id: 'clinic-a', gstin: '24AAMCB8446Q1ZW', gst_state_code: '24',
    drug_license_number: 'GJ-ADR-272601', pharmacy_gst_scheme: 'regular',
    pharmacy_prices_include_gst: false, pharmacy_invoice_prefix: 'RX',
  } };
  const response = await request();
  assert.equal(response.status, 200);
  const { profile } = await response.json();
  const fields = {
    gstin: 'gstin', gstStateCode: 'gst_state_code', drugLicenseNumber: 'drug_license_number',
    pharmacyGstScheme: 'pharmacy_gst_scheme', pharmacyPricesIncludeGst: 'pharmacy_prices_include_gst',
    pharmacyInvoicePrefix: 'pharmacy_invoice_prefix',
  };
  for (const [output, column] of Object.entries(fields)) {
    assert.match(fixture.selection, new RegExp(`\\b${column}\\b`), `query must select ${column}`);
    assert.equal(profile.clinic[output], fixture.row.clinic_settings[column]);
  }
  assert.equal(profile.clinic.pharmacyPricesIncludeGst, false, 'explicit tax-exclusive setting is preserved');
});

test('older clinics retain defaults without inventing a GST registration', async () => {
  fixture.row = { id: 'staff-a', clinic_settings: { id: 'clinic-a' } };
  const { profile } = await (await request()).json();
  assert.equal(profile.clinic.gstin, undefined);
  assert.equal(profile.clinic.pharmacyGstScheme, 'regular');
  assert.equal(profile.clinic.pharmacyPricesIncludeGst, true);
  assert.equal(profile.clinic.pharmacyInvoicePrefix, 'PH');
});

test('unauthenticated requests cannot read pharmacy settings', async () => {
  fixture.authenticated = false;
  fixture.selection = '';
  const response = await request();
  assert.equal((await response.json()).success, false);
  assert.equal(fixture.selection, '');
});
