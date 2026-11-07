import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';

async function load(entry, plugins = []) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', plugins });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { visitService } = await load('src/services/visitService.ts', [{
  name: 'visit-dependencies', setup(builder) {
    builder.onResolve({ filter: /lib\/supabase$|\.\/profileService$|\.\/limsService$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
      args.path.endsWith('profileService') ? 'export async function getCurrentProfile() { return { clinicId: "clinic-1" }; }' :
      args.path.endsWith('limsService') ? 'export const limsService = {};' :
      'export const supabase = { from: (...args) => globalThis.visitPdfDb.from(...args) };',
    }));
  },
}]);
const { prepareCompactVisitLanguage } = await load('supabase/functions/_shared/compactVisitLanguage.ts');

test('loading a visit preserves every stored PDF variant', async () => {
  let row = {
    id: 'visit-1', patient_id: 'patient-1', date: '2026-10-30', created_at: '2026-10-30', updated_at: '2026-10-30',
    pdf_url: 'https://test/display.pdf', print_pdf_url: 'https://test/print.pdf', compact_print_pdf_url: 'https://test/compact.pdf',
    pdf_generated_at: '2026-10-30T10:00:00Z', print_pdf_generated_at: '2026-10-30T11:00:00Z',
  };
  globalThis.visitPdfDb = { from(table) {
    const builder = {
      select() { return this; }, eq() { return this; },
      async single() { return { data: row, error: null }; },
      then(resolve) { return Promise.resolve({ data: table === 'visits' ? row : [], error: null }).then(resolve); },
    };
    return builder;
  } };
  const loaded = await visitService.getVisit('visit-1');
  for (const key of ['pdf_url', 'print_pdf_url', 'compact_print_pdf_url']) assert.equal(loaded[key], row[key]);
  assert.equal(loaded.pdf_generated_at.toISOString(), new Date(row.pdf_generated_at).toISOString());
  assert.equal(loaded.print_pdf_generated_at.toISOString(), new Date(row.print_pdf_generated_at).toISOString());
});

const modalSource = await readFile('src/components/Visits/VisitDetailsModal.tsx', 'utf8');
// Run the actual click handlers in isolation so cached clicks cannot call the generator.
for (const [handler, field, flag] of [
  ['handleExportPDF', 'pdf_url', 'setExportingPDF'],
  ['handleGeneratePrintPdf', 'print_pdf_url', 'setGeneratingPrintPdf'],
  ['handleGenerateCompactPrintPdf', 'compact_print_pdf_url', 'setGeneratingCompactPdf'],
]) {
  test(`${handler} reuses the existing PDF in the tab claimed by the click`, async () => {
    const start = modalSource.indexOf(`  const ${handler} = async () => {`);
    const end = modalSource.indexOf('\n  };', start) + 5;
    assert.ok(start >= 0 && end > start);
    const script = await transform(`${modalSource.slice(start, end)}\nreturn ${handler}();`, { loader: 'tsx' });
    const navigations = [];
    const flags = [];
    const latest = { id: 'visit-1', [field]: `https://test/${field}.pdf` };
    let loaded;
    const invoke = new Function('visit', 'visitId', 'visitService', 'setVisit', 'claimTab', flag, 'window', 'alert', script.code);
    await invoke({ id: 'visit-1' }, 'visit-1', { getVisit: async () => latest }, value => { loaded = value; },
      () => ({ closed: false, location: { replace: url => navigations.push(url) } }),
      value => flags.push(value), { open() { assert.fail('Should reuse the claimed tab'); } },
      message => assert.fail(message));
    assert.equal(loaded, latest);
    assert.deepEqual(navigations, [latest[field]]);
    assert.deepEqual(flags, [true, false]);
  });
}

const visit = {
  adviceLanguage: 'gujarati', chiefComplaint: 'Fever', diagnoses: [{ name: 'Viral fever' }], advice: ['Drink water'],
  adviceRegional: 'આરામ કરો',
  prescriptions: [
    { medicine: 'Example', dosage: '500 mg', frequency: 'BD', duration: '3 days', instructions: 'After food' },
    { medicine: 'Example', dosage: '250 mg', frequency: 'HS', duration: '2 days', instructions: '' },
  ],
};
const translated = {
  advice: ['પાણી પીવો', 'આરામ કરો'],
  prescriptions: [
    { index: 1, frequency: 'રાત્રે', duration: '૨ દિવસ', instructions: '' },
    { index: 0, frequency: 'દિવસમાં બે વાર', duration: '૩ દિવસ', instructions: 'જમ્યા પછી' },
  ],
};

test('compact translation changes only prescription directions and advice, matching repeated medicines by index', async t => {
  let prompt;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(translated) }] } }] });
  });
  const result = await prepareCompactVisitLanguage(visit, 'test-key');
  assert.equal(result.code, 'gu');
  assert.equal(result.font, 'Noto Sans Gujarati');
  assert.deepEqual(result.advice, translated.advice);
  assert.equal(result.prescriptions[0].frequency, 'દિવસમાં બે વાર');
  assert.equal(result.prescriptions[1].frequency, 'રાત્રે');
  assert.equal(result.prescriptions[0].instructions, 'જમ્યા પછી');
  for (let i = 0; i < 2; i++) {
    assert.equal(result.prescriptions[i].medicine, visit.prescriptions[i].medicine);
    assert.equal(result.prescriptions[i].dosage, visit.prescriptions[i].dosage);
  }
  assert.ok(!prompt.includes('Fever') && !prompt.includes('Viral fever'));
  assert.equal(visit.advice[0], 'Drink water');
});

test('English skips translation and regional advice survives missing credentials or service failure', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
  t.mock.method(console, 'error', () => {});
  const english = await prepareCompactVisitLanguage({ ...visit, adviceLanguage: 'english' }, 'test-key');
  assert.deepEqual(english.advice, visit.advice);
  assert.equal(fetchMock.mock.callCount(), 0);
  const noKey = await prepareCompactVisitLanguage(visit);
  assert.deepEqual(noKey.advice, [...visit.advice, visit.adviceRegional]);
  assert.equal(fetchMock.mock.callCount(), 0);
  const offline = await prepareCompactVisitLanguage(visit, 'test-key');
  assert.deepEqual(offline, noKey);
});

test('partial translations retain all directions and snake_case advice fields work', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"advice":[],"prescriptions":[{"index":0,"frequency":"બે વાર","duration":null}]}' }] } }] }));
  const result = await prepareCompactVisitLanguage({
    ...visit, adviceLanguage: undefined, adviceRegional: undefined, advice_language: 'gujarati', advice_regional: 'આરામ કરો',
  }, 'test-key');
  assert.deepEqual(result.advice, ['Drink water', 'આરામ કરો']);
  assert.equal(result.prescriptions[0].frequency, 'બે વાર');
  assert.equal(result.prescriptions[0].duration, '3 days');
  assert.equal(result.prescriptions[0].instructions, 'After food');
  assert.deepEqual(result.prescriptions[1], visit.prescriptions[1]);
});

test('the compact HTML template renders regional directions and advice while clinical sections stay in English', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(translated) }] } }],
  }));
  const source = await readFile('supabase/functions/generate-pdf-from-html/index.ts', 'utf8');
  const marker = "} else if (type === 'visit' && compactVersion) {";
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf("} else if (type === 'visit') {", start);
  assert.ok(start >= marker.length && end > start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const render = new AsyncFunction('data', 'prepareCompactVisitLanguage', 'Deno', 'extractImpressionDetails',
    'formatDoctorName', 'buildQrHtml', 'escapeHtml',
    `let filename; let htmlContent; ${source.slice(start, end)}\nreturn htmlContent;`);
  const html = await render({
    visit: { ...visit, date: '2026-10-30' }, patient: { name: 'Patient' }, doctor: { name: 'Doctor' }, clinicSettings: {},
  }, prepareCompactVisitLanguage, { env: { get: () => 'test-key' } }, () => ({ impressionItems: [] }),
  name => name, () => '', value => String(value).replace(/</g, '&lt;'));
  assert.match(html, /Chief Complaint/);
  assert.match(html, /Fever/);
  assert.match(html, /Viral fever/);
  assert.match(html, /Noto\+Sans\+Gujarati/);
  assert.match(html, /lang="gu"/);
  assert.match(html, /દિવસમાં બે વાર/);
  assert.match(html, /જમ્યા પછી/);
  assert.match(html, /પાણી પીવો/);
  assert.match(html, /500 mg/);
  assert.ok(!html.includes('Drink water') && !html.includes('After food'));
});
