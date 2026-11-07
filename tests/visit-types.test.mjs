import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

async function loadModule(entry, mocked = false) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: mocked ? [{ name: 'visit-mocks', setup(builder) {
      builder.onResolve({ filter: /lib\/supabase$|\.\/profileService$|\.\/limsService$/ }, args => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
        args.path.endsWith('profileService') ? 'export async function getCurrentProfile() { return { clinicId: "clinic-1" }; }'
          : args.path.endsWith('limsService') ? 'export const limsService = {};'
          : 'export const supabase = { from: (...args) => globalThis.visitTypeDb.from(...args), rpc: (...args) => globalThis.visitTypeDb.rpc(...args) };',
      }));
    } }] : [],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { visitTypeFromAppointment, summarizeVisitTypes, visitMatchesDateRange } = await loadModule('src/utils/visitTypes.ts');
const { visitService } = await loadModule('src/services/visitService.ts', true);

const mappings = [
  ['Consultation', 'new'], ['New Visit', 'new'], ['new_consultation', 'new'],
  ['Follow_Up', 'follow_up'], ['Follow-up', 'follow_up'], ['Follow up visit', 'follow_up'],
  ['Emergency', 'emergency'], ['Emergency Visit', 'emergency'],
  ['Procedure', null], ['Home Visit', null], ['Routine_Checkup', null], ['', null], [null, null],
];
const configured = [{ id: 'followup', label: 'Review consultation' }, { id: 'custom', label: 'Procedure', feeType: 'emergency' }];

test('appointment prefills recognize clinical categories and stable IDs without using prices', () => {
  for (const [value, expected] of mappings) assert.equal(visitTypeFromAppointment(value), expected, String(value));
  assert.equal(visitTypeFromAppointment('Review consultation', configured), 'follow_up');
  assert.equal(visitTypeFromAppointment('Procedure', configured), null);
});

test('MIS counts reconcile unknown history, without guessing from previous visits or follow-up dates', () => {
  const counts = summarizeVisitTypes([
    { visitType: 'new', followUpDate: new Date() }, { visitType: 'follow_up' },
    { visitType: 'emergency' }, { visitType: null }, {},
  ]);
  assert.deepEqual(counts, { new: 1, follow_up: 1, emergency: 1, unclassified: 2 });
  assert.equal(Object.values(counts).reduce((a, b) => a + b), 5);
});

test('date filter includes the entire local end day and excludes adjacent days', () => {
  for (const time of ['00:00:00', '14:30:00', '23:59:59.999']) {
    assert.ok(visitMatchesDateRange(new Date(`2026-11-07T${time}`), '2026-11-07', '2026-11-07'));
  }
  assert.equal(visitMatchesDateRange(new Date('2026-11-08T00:00:00'), '', '2026-11-07'), false);
  assert.equal(visitMatchesDateRange(new Date('2026-11-06T23:59:59'), '2026-11-07', ''), false);
});

test('migration backfills only supported linked evidence and protects explicit encounter types', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    CREATE TABLE clinic_settings(id text PRIMARY KEY, appointment_types jsonb);
    CREATE TABLE appointments(id text PRIMARY KEY, clinic_id text, patient_id text, appointment_type text);
    CREATE TABLE visits(id text PRIMARY KEY, clinic_id text, patient_id text, appointment_id text, date timestamptz);
    INSERT INTO clinic_settings VALUES ('c1', '[{"id":"followup","label":"Review consultation"}]'), ('c2', '[]');
    INSERT INTO appointments VALUES ('a1','c1','p1','Follow_Up'), ('a2','c1','p1','Emergency'),
      ('a3','c1','p1','Consultation'), ('a4','c1','p1','Procedure'), ('a5','c2','p1','Emergency'),
      ('a6','c1','p2','Follow-up'), ('a7','c1','p1','Review consultation');
    INSERT INTO visits(id,clinic_id,patient_id,appointment_id) VALUES
      ('v1','c1','p1','a1'), ('v2','c1','p1','a2'), ('v3','c1','p1','a3'),
      ('v4','c1','p1','a4'), ('v5','c1','p1','a5'), ('v6','c1','p1','a6'),
      ('v7','c1','p1',null), ('v8','c1','p1','a7');
  `);
  await db.exec(await readFile('supabase/migrations/20261107091500_visit_types.sql', 'utf8'));
  const rows = (await db.query('SELECT visit_type FROM visits ORDER BY id')).rows;
  assert.deepEqual(rows.map(row => row.visit_type), ['follow_up', 'emergency', 'new', null, null, null, null, 'follow_up']);
  for (const [value, expected] of mappings) {
    assert.equal((await db.query('SELECT classify_visit_appointment_type($1) AS type', [value])).rows[0].type, expected);
  }
  await db.exec(`INSERT INTO visits(id,clinic_id,patient_id,appointment_id,visit_type) VALUES
    ('auto','c1','p1','a1',null), ('override','c1','p1','a1','emergency'),
    ('cross-clinic','c1','p1','a5',null), ('cross-patient','c1','p1','a6',null);`);
  assert.equal((await db.query("SELECT visit_type FROM visits WHERE id='auto'")).rows[0].visit_type, 'follow_up');
  assert.equal((await db.query("SELECT visit_type FROM visits WHERE id='override'")).rows[0].visit_type, 'emergency');
  assert.deepEqual((await db.query("SELECT visit_type FROM visits WHERE id LIKE 'cross-%'")).rows, [{ visit_type: null }, { visit_type: null }]);
  await db.exec("UPDATE appointments SET appointment_type='Emergency' WHERE id='a1'");
  assert.equal((await db.query("SELECT visit_type FROM visits WHERE id='auto'")).rows[0].visit_type, 'follow_up');
  await assert.rejects(db.exec("UPDATE visits SET visit_type='invalid' WHERE id='auto'"), /visits_visit_type_check/);
});

const visitRow = (index, type = null) => ({
  id: `v-${index}`, clinic_id: 'clinic-1', patient_id: 'patient-1', doctor_id: null,
  date: '2026-11-07T10:00:00Z', created_at: '2026-11-07T10:00:00Z', updated_at: '2026-11-07T10:00:00Z',
  visit_type: type, patients: null, profiles: null,
});

function mockDb(rows, failPage = false, related = {}) {
  const calls = [], writes = [];
  globalThis.visitTypeDb = {
    async rpc(name, args) {
      assert.equal(name, 'save_visit_with_details');
      writes.push(args.p_visit);
      return { data: 'v-0', error: null };
    },
    from(table) {
    let filters = [], range = [0, 999], operation = 'select';
    const query = {
      select() { return this; }, order() { return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      in(key, value) { filters.push([key, value]); return this; },
      range(from, to) { range = [from, to]; return this; },
      insert(value) { operation = 'insert'; writes.push({ table, value }); return this; },
      update(value) { operation = 'update'; writes.push({ table, value }); return this; },
      async single() { return { data: rows[0], error: null }; },
      then(resolve, reject) {
        calls.push({ table, range, filters });
        const source = table === 'visits' ? rows : (related[table] ?? []).filter(row => filters.find(([key]) => key === 'visit_id')[1].includes(row.visit_id));
        const data = source.slice(range[0], range[1] + 1);
        return Promise.resolve({ data, error: failPage && operation === 'select' && table === 'visits' && range[0] === 500 ? new Error('network') : null }).then(resolve, reject);
      },
    };
    return query;
  } };
  return { calls, writes };
}

test('visit register loads beyond row limits, maps types, and remains scoped to clinic and visible patients', async () => {
  const db = mockDb(Array.from({ length: 1001 }, (_, index) => visitRow(index, index % 2 ? 'follow_up' : null)));
  const visits = await visitService.getAllVisits();
  assert.equal(visits.length, 1001);
  assert.equal(visits[0].visitType, null);
  assert.equal(visits[1].visitType, 'follow_up');
  const reads = db.calls.filter(call => call.table === 'visits');
  assert.deepEqual(reads.map(call => call.range), [[0, 499], [500, 999], [1000, 1499]]);
  for (const call of reads) assert.deepEqual(call.filters, [['clinic_id', 'clinic-1'], ['patients.is_hidden', false]]);
  for (const call of db.calls.filter(call => call.table !== 'visits')) assert.ok(call.filters[0][1].length <= 100);
  // A second-page failure must reject instead of exporting partial totals.
  mockDb(Array.from({ length: 1001 }, (_, index) => visitRow(index)), true);
  await assert.rejects(visitService.getAllVisits(), /complete visit data/);
});

test('related visit data is also paginated instead of truncating large clinical histories', async () => {
  const symptoms = Array.from({ length: 1001 }, (_, index) => ({ id: `s-${index}`, visit_id: 'v-0', name: `Symptom ${index}`, created_at: '2026-11-07T10:00:00Z' }));
  const db = mockDb([visitRow(0, 'follow_up')], false, { symptoms });
  const visits = await visitService.getAllVisits();
  assert.equal(visits[0].symptoms.length, 1001);
  assert.deepEqual(db.calls.filter(call => call.table === 'symptoms').map(call => call.range), [[0, 499], [500, 999], [1000, 1499]]);
});

test('visit creation and partial edits persist classification without changing it during unrelated updates', async () => {
  const db = mockDb([visitRow(0, 'emergency')]);
  const originalGetVisit = visitService.getVisit;
  visitService.getVisit = async () => ({ id: 'v-0', testsOrdered: [] });
  try {
    await visitService.addVisit({ patientId: 'patient-1', doctorId: null, visitType: 'emergency', date: new Date(), vitals: {}, advice: [], symptoms: [], diagnoses: [], prescriptions: [], testsOrdered: [], testResults: [] });
    assert.equal(db.writes[0].visit_type, 'emergency');
    await visitService.updateVisit('v-0', { visitType: 'follow_up' });
    assert.equal(db.writes[1].visit_type, 'follow_up');
    await visitService.updateVisit('v-0', { doctorNotes: 'Update notes' });
    assert.equal(Object.hasOwn(db.writes[2], 'visit_type'), false);
  } finally {
    visitService.getVisit = originalGetVisit;
  }
});
