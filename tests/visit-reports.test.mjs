import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PDFDocument } from 'pdf-lib';

async function loadModule(entry, mocks = false) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: mocks ? [{ name: 'report-dependencies', setup(builder) {
      builder.onResolve({ filter: /lib\/supabase$|\.\/profileService$/ }, args => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.endsWith('profileService')
        ? 'export async function getCurrentProfile() { return globalThis.reportProfile; }'
        : 'export const supabase = { from: (...args) => globalThis.reportDb.from(...args), storage: { from: (...args) => globalThis.reportDb.storage.from(...args) } };' }));
    } }] : [],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { composeReportPdf, fitReportImage } = await loadModule('src/utils/reportPdf.ts');
const { visitReportService, replaceReportAttachment } = await loadModule('src/services/visitReportService.ts', true);
const original = { id: 'report-1', url: 'https://storage.test/original.pdf', imageType: 'document', mimeType: 'application/pdf', label: 'CBC.pdf', uploadedAt: '2026-10-23' };
const neighbor = { ...original, id: 'report-2', url: 'https://storage.test/other.pdf' };

test('report pages fit without clipping for portrait, landscape and tall scans', () => {
  for (const [width, height] of [[595, 842], [842, 595], [500, 3000]]) {
    const fitted = fitReportImage(width, height, 540, 600);
    assert.ok(fitted.width <= 540 && fitted.height <= 600);
    assert.ok(Math.abs(fitted.width / fitted.height - width / height) < 0.00001);
  }
  assert.throws(() => fitReportImage(0, 100, 500, 500));
});

test('PDF composer retains every source page and rejects an empty report', async () => {
  const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSp8AAAAASUVORK5CYII=', 'base64'));
  const header = { bytes, width: 1600, height: 300 };
  async function* pages() {
    yield { bytes, width: 595, height: 842 };
    yield { bytes, width: 842, height: 595 };
  }
  const result = await composeReportPdf({ pages: pages(), header, title: 'Test patient - Example lab' });
  const pdf = await PDFDocument.load(result);
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getTitle(), 'Test patient - Example lab');
  for (const page of pdf.getPages()) assert.ok(Math.abs(page.getHeight() - 841.89) < 0.01);
  await assert.rejects(composeReportPdf({ pages: (async function* () {})(), header, title: 'Empty' }), /no pages/);
  await assert.rejects(composeReportPdf({ pages: pages(), header, topInset: 500, title: 'No room' }), /too little space/);
});

function database({ changed = false, uploadError = null } = {}) {
  const calls = { reads: [], writes: [], uploads: [], removes: [] };
  const existing = [original, neighbor];
  let update;
  const builder = kind => ({
    select() { return this; },
    eq(key, value) { calls[kind].push([key, value]); return this; },
    filter(key, op, value) { calls[kind].push([key, op, value]); return this; },
    async single() { return { data: { visit_images: existing }, error: null }; },
    async maybeSingle() { return { data: changed ? null : { id: 'visit-1' }, error: null }; },
  });
  globalThis.reportProfile = { id: 'collector-1', clinicId: 'clinic-1' };
  globalThis.reportDb = {
    from(table) { assert.equal(table, 'visits'); return {
      select() { return builder('reads'); },
      update(value) { update = value; return builder('writes'); },
    }; },
    storage: { from(bucket) { assert.equal(bucket, 'ocruploads'); return {
      async upload(path, blob, options) { calls.uploads.push({ path, blob, options }); return { error: uploadError }; },
      getPublicUrl(path) { return { data: { publicUrl: `https://storage.test/${path}` } }; },
      async remove(paths) { calls.removes.push(...paths); return { error: null }; },
    }; } },
  };
  return { calls, existing, get update() { return update; } };
}
const input = () => ({ visitId: 'visit-1', patientId: 'patient-1', attachment: original, pdf: new Blob(['%PDF-test'], { type: 'application/pdf' }), labName: 'Example Lab' });

test('saving replaces only the selected report, scopes the visit and preserves its original', async () => {
  const db = database();
  const result = await visitReportService.saveLetterheadReport(input());
  assert.equal(result[0].id, original.id);
  assert.equal(result[0].reportSource.url, original.url);
  assert.equal(result[0].performingLab, 'Example Lab');
  assert.equal(result[0].mimeType, 'application/pdf');
  assert.deepEqual(result[1], neighbor);
  for (const kind of ['reads', 'writes']) {
    assert.ok(db.calls[kind].some(([key, value]) => key === 'clinic_id' && value === 'clinic-1'));
    assert.ok(db.calls[kind].some(([key, value]) => key === 'patient_id' && value === 'patient-1'));
  }
  assert.ok(db.calls.writes.some(([key, op, value]) => key === 'visit_images' && op === 'eq' && value === JSON.stringify(db.existing)));
  assert.equal(db.calls.removes.length, 0);
  assert.deepEqual(Object.keys(db.update).sort(), ['updated_at', 'visit_images']);
});

test('a concurrent change rejects replacement and cleans up only the new upload', async () => {
  const db = database({ changed: true });
  await assert.rejects(visitReportService.saveLetterheadReport(input()), /changed while saving/);
  assert.deepEqual(db.calls.removes, [db.calls.uploads[0].path]);
  assert.ok(!db.calls.removes.includes(original.url));
});

test('stale or removed attachments and failed uploads never replace the saved report', async () => {
  assert.throws(() => replaceReportAttachment([neighbor], original, neighbor), /removed/);
  let db = database();
  await assert.rejects(visitReportService.saveLetterheadReport({ ...input(), attachment: { ...original, url: 'stale' } }), /changed/);
  assert.equal(db.calls.uploads.length, 0);
  db = database({ uploadError: { message: 'Storage unavailable' } });
  await assert.rejects(visitReportService.saveLetterheadReport(input()), /Storage unavailable/);
  assert.equal(db.update, undefined);
});
