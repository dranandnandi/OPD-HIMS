import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['supabase/functions/_shared/generic-name-lookup.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { parseGenericNameResult, genericNameLookupHandler } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const url = 'https://www.1mg.com/drugs/akurit-3-tablet-151117';
const ingredients = [{ name: 'Rifampicin', strength: '150 mg' }, { name: 'Isoniazid', strength: '75 mg' }, { name: 'Ethambutol', strength: '275 mg' }];
const result = { status: 'matched', complete: true, productName: 'Akurit-3 Tablet', manufacturer: 'Lupin Ltd', dosageForm: 'tablet', pack: '10 tablets', ingredients, sourceUrls: [url], notes: 'The stored 3 mg appears to be a brand-number transcription; verify the pack.' };
const content = (data = result) => [
  { type: 'text', text: 'Searching for the exact product.' },
  { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url, title: 'Akurit-3 Tablet' }] },
  { type: 'text', text: JSON.stringify(data), citations: [{ type: 'web_search_result_location', url, title: 'Akurit-3 Tablet', cited_text: 'Rifampicin (150mg)+ Isoniazid (75mg)+ Ethambutol (275mg)' }] },
];

test('Claude composition retains all three ingredients with source evidence and flags erroneous stored strength', () => {
  const found = parseGenericNameResult(content());
  assert.equal(found.candidates[0].genericName, 'Rifampicin + Isoniazid + Ethambutol');
  assert.equal(found.candidates[0].ingredients.length, 3);
  assert.match(found.candidates[0].composition, /Ethambutol \(275 mg\)/);
  assert.equal(found.candidates[0].sources[0].url, url);
  assert.match(found.candidates[0].notes, /3 mg/);
});

test('memory-only, incomplete, fabricated-source, unsubstantiated strength and failed web results cannot become suggestions', () => {
  assert.throws(() => parseGenericNameResult([{ type: 'text', text: JSON.stringify(result) }]), /did not search/);
  assert.throws(() => parseGenericNameResult(content({ ...result, ingredients: ingredients.slice(0, 2) })), /more ingredients/);
  assert.throws(() => parseGenericNameResult(content({ ...result, sourceUrls: ['https://www.1mg.com/drugs/invented'] })), /retrieved source citations/);
  assert.throws(() => parseGenericNameResult(content({ ...result, productName: 'Akurit 4 Tablet' })), /does not identify/);
  assert.throws(() => parseGenericNameResult(content({ ...result, ingredients: [{ name: 'Rifampicin', strength: '3 mg' }] })), /missing from the cited evidence/);
  assert.throws(() => parseGenericNameResult(content({ ...result, ingredients: [{ name: 'Ethambutol', strength: '75 mg' }] })), /more ingredients|missing from the cited evidence/);
  assert.throws(() => parseGenericNameResult(content({ ...result, ingredients: [{ name: 'Rifampicin', strength: '75 mg' }, { name: 'Isoniazid', strength: '150 mg' }, ingredients[2]] })), /missing from the cited evidence/, 'strengths must belong to their respective ingredients');
  assert.throws(() => parseGenericNameResult([{ type: 'web_search_tool_result', content: { error_code: 'unavailable' } }]), /Web search failed/);
  assert.deepEqual(parseGenericNameResult(content({ status: 'ambiguous', complete: false, ingredients: [], notes: 'Product identity is unclear' })).candidates, []);
});

test('authenticated Claude lookup uses server-side SKU data, web search and cached metadata; failure never writes generic names', async () => {
  const id = randomUUID(); const userId = randomUUID(); const clinic = randomUUID();
  let cached = false; let paidCalls = 0; let writes = 0; let sent;
  let permissions = ['modules_assigned', 'pharmacy']; let inClinic = true; let truncated = false;
  const medicine = { id, name: 'AKURIT 3MG TAB', brand_name: 'AKURIT 3', generic_name: 'AKURIT 3MG TAB', dosage_form: 'other', strength: '3mg', manufacturer: 'LUPIN' };
  const snapshot = Object.fromEntries(['name', 'brand_name', 'strength', 'dosage_form', 'manufacturer', 'generic_name'].map(key => [key, medicine[key]]));
  const env = key => ({ SUPABASE_URL: 'https://clinic.invalid', SUPABASE_ANON_KEY: 'test-only', ANTHROPIC_API_KEY: 'test-only' })[key];
  const fakeFetch = async (input, init) => {
    const endpoint = String(input);
    if (endpoint.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (endpoint.includes('/profiles?')) return Response.json([{ clinic_id: clinic, role_name: 'pharmacist', permissions }]);
    if (endpoint.includes('/medicines_master?')) return Response.json(inClinic ? [medicine] : []);
    if (endpoint.includes('/medicine_generic_name_reviews?')) return Response.json(cached ? [{ medicine_id: id, input_snapshot: snapshot, source_version: 'claude-sonnet-5-5:web-v1', status: 'pending' }] : []);
    if (endpoint === 'https://api.anthropic.com/v1/messages') {
      paidCalls++; sent = JSON.parse(init.body);
      assert.equal(init.headers['x-api-key'], 'test-only');
      return Response.json({ stop_reason: truncated ? 'max_tokens' : 'end_turn', content: content() });
    }
    if (endpoint.endsWith('/rpc/pharmacy_generic_name_review')) {
      writes++; const body = JSON.parse(init.body);
      assert.equal(body.p_action, 'lookup', 'only suggestion metadata can be written');
      assert.equal(body.p_rows[0].candidates[0].ingredients.length, 3);
      assert.equal(body.p_rows[0].input_snapshot.name, medicine.name);
      return Response.json([{ medicine_id: id, result: 'recorded', source_version: 'claude-sonnet-5-5:web-v1' }]);
    }
    throw new Error('Unexpected endpoint: ' + endpoint);
  };
  const request = (headers = { Authorization: 'Bearer test-only' }, ids = [id]) => new Request('https://app.invalid/lookup', { method: 'POST', headers, body: JSON.stringify({ medicineIds: ids, name: 'Untrusted override ignored' }) });
  let response = await genericNameLookupHandler(request(), env, fakeFetch);
  assert.equal(response.status, 200); assert.equal((await response.json()).lookedUp, 1);
  assert.equal(sent.model, 'claude-sonnet-5-5');
  assert.equal(sent.tools[0].name, 'web_search');
  assert.ok(sent.tools[0].allowed_domains.includes('1mg.com'));
  assert.match(sent.messages[0].content, /AKURIT 3MG TAB/);
  assert.doesNotMatch(sent.messages[0].content, /Untrusted override/);
  assert.equal(writes, 1);
  cached = true;
  response = await genericNameLookupHandler(request(), env, fakeFetch);
  assert.equal((await response.json()).cached, true); assert.equal(paidCalls, 1, 'completed lookup does not call Claude again');
  cached = false; truncated = true;
  response = await genericNameLookupHandler(request(), env, fakeFetch);
  assert.equal((await response.json()).errors.length, 1); assert.equal(writes, 1, 'truncated answer is not persisted');
  const paidBefore = paidCalls;
  assert.equal((await genericNameLookupHandler(request({}), env, fakeFetch)).status, 401);
  assert.equal((await genericNameLookupHandler(request(undefined, Array(11).fill(id)), env, fakeFetch)).status, 400);
  inClinic = false;
  assert.equal((await genericNameLookupHandler(request(), env, fakeFetch)).status, 409);
  inClinic = true; permissions = ['modules_assigned', 'opd_billing'];
  assert.equal((await genericNameLookupHandler(request(), env, fakeFetch)).status, 403);
  assert.equal(paidCalls, paidBefore, 'unauthorised, oversized and cross-clinic requests never spend API tokens');
});
