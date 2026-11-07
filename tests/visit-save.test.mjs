import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

async function loadModule(entry, mockService = false) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: mockService ? [{ name: 'visit-dependencies', setup(builder) {
      builder.onResolve({ filter: /lib\/supabase$|\.\/profileService$|\.\/limsService$/ }, args => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
        args.path.endsWith('profileService') ? 'export async function getCurrentProfile() { return {clinicId:"clinic"}; }' :
        args.path.endsWith('limsService') ? 'export const limsService = {};' :
        'export const supabase = { rpc: (...args) => globalThis.visitDb.rpc(...args), from: (...args) => globalThis.visitDb.from(...args) };' }));
    } }] : [],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { buildVisitSavePayload, assertVisitDetailsLoaded } = await loadModule('src/utils/visitSave.ts');
const { visitService } = await loadModule('src/services/visitService.ts', true);
const testInput = (overrides = {}) => ({ id: randomUUID(), testName: ' CBC ', testType: 'lab', urgency: 'routine', status: 'ordered', orderedDate: new Date('2026-11-07T10:00:00Z'), ...overrides });

test('manual and edit payloads use the real testName column and preserve IDs and dates', () => {
  const input = testInput({ instructions: 'Fasting', expectedDate: new Date('2026-11-08T10:00:00Z') });
  const payload = buildVisitSavePayload({ testsOrdered: [input] });
  assert.deepEqual(payload.details.tests_ordered[0], { id: input.id, test_id: null, testName: 'CBC', test_type: 'lab',
    instructions: 'Fasting', urgency: 'routine', status: 'ordered', ordered_date: '2026-11-07T10:00:00.000Z', expected_date: '2026-11-08T10:00:00.000Z' });
  assert.equal('test_name' in payload.details.tests_ordered[0], false);
  assert.deepEqual(buildVisitSavePayload({ doctorId: null }).details, {});
  assert.deepEqual(buildVisitSavePayload({ testsOrdered: [] }).details, { tests_ordered: [] });
  assert.throws(() => buildVisitSavePayload({ testsOrdered: [testInput({ testName: ' ' })] }), /test 1/);
  assert.throws(() => assertVisitDetailsLoaded([{ error: { message: 'Network unavailable' } }]), /Network unavailable/);
});

test('create and edit propagate RPC failures and never perform separate destructive writes', async () => {
  const calls = [];
  globalThis.visitDb = {
    async rpc(name, args) { calls.push({ name, args }); return { error: { message: 'Invalid test type' } }; },
    from() { assert.fail('failed RPC must not fall back to individual writes or reload'); },
  };
  const input = { testsOrdered: [testInput()], prescriptions: [], testResults: [] };
  const options = { requestId: randomUUID(), expectedUpdatedAt: '2026-11-07T10:00:00.123456Z' };
  await assert.rejects(visitService.addVisit(input, options), /Invalid test type/);
  await assert.rejects(visitService.updateVisit('visit', input, options), /Invalid test type/);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.p_details.tests_ordered, calls[1].args.p_details.tests_ordered);
  assert.equal(calls[1].args.p_expected_updated_at, options.expectedUpdatedAt);
  assert.equal(calls[0].args.p_request_id, options.requestId);
});

test('a failed tests SELECT rejects getVisit instead of returning editable empty tests', async () => {
  globalThis.visitDb = { from(table) { return {
    select() { return this; }, eq() { return this; },
    single() { return Promise.resolve({ data: { id: 'visit', patients: null, profiles: null }, error: null }); },
    then(resolve) { return Promise.resolve(table === 'tests_ordered'
      ? { data: null, error: { message: 'Test read failed' } } : { data: [], error: null }).then(resolve); },
  }; } };
  await assert.rejects(visitService.getVisit('visit'), /Test read failed/);
});

// Minimal real PostgreSQL schema with the same types, constraints and RLS
// boundaries used by the save function. No production records are touched.
async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT current_setting('request.jwt.claim.sub', true)::uuid $$;
    CREATE TABLE clinic_settings(id uuid PRIMARY KEY);
    CREATE TABLE profiles(id uuid PRIMARY KEY, clinic_id uuid REFERENCES clinic_settings);
    CREATE TABLE patients(id uuid PRIMARY KEY, clinic_id uuid REFERENCES clinic_settings);
    CREATE TABLE appointments(id uuid PRIMARY KEY, clinic_id uuid, patient_id uuid);
    CREATE TABLE visits(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid REFERENCES clinic_settings,
      patient_id uuid NOT NULL REFERENCES patients, doctor_id uuid REFERENCES profiles,
      appointment_id uuid REFERENCES appointments, visit_type text, date timestamptz DEFAULT now(),
      chief_complaint text, vitals jsonb, advice text[], advice_language text, advice_regional text,
      follow_up_date timestamptz, physical_examination jsonb, doctor_notes text, case_image_url text, visit_images jsonb,
      pdf_url text, print_pdf_url text, compact_print_pdf_url text,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TYPE test_type_enum AS ENUM ('lab','radiology','procedure','other');
    CREATE TYPE test_urgency_enum AS ENUM ('routine','urgent','stat');
    CREATE TYPE test_status_enum AS ENUM ('ordered','sample_collected','in_progress','completed','cancelled');
    CREATE TABLE symptoms(id uuid DEFAULT gen_random_uuid(), visit_id uuid REFERENCES visits,
      clinic_id uuid, name text NOT NULL, severity text, duration text, notes text);
    CREATE TABLE diagnoses(id uuid DEFAULT gen_random_uuid(), visit_id uuid REFERENCES visits,
      clinic_id uuid, name text NOT NULL, icd10_code text, is_primary boolean, notes text);
    CREATE TABLE prescriptions(id uuid DEFAULT gen_random_uuid(), visit_id uuid REFERENCES visits,
      clinic_id uuid, medicine text NOT NULL, dosage text, frequency text, duration text, instructions text,
      quantity integer, refills integer, route text);
    CREATE TABLE tests_ordered(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visit_id uuid NOT NULL REFERENCES visits,
      clinic_id uuid, test_id uuid, "testName" text NOT NULL, test_type test_type_enum, instructions text,
      urgency test_urgency_enum, status test_status_enum, ordered_date timestamptz, expected_date timestamptz,
      created_at timestamptz DEFAULT now());
    CREATE TABLE test_results(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visit_id uuid REFERENCES visits,
      clinic_id uuid, test_ordered_id uuid NOT NULL REFERENCES tests_ordered,
      result text, normal_range text, is_abnormal boolean, result_date timestamptz, report_url text);
  `);
  // Match Supabase's permissive object defaults so explicit revokes are tested.
  await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;`);
  await db.exec(await readFile('supabase/migrations/20261107110000_atomic_visit_save.sql', 'utf8'));
  assert.deepEqual((await db.query(`SELECT
    has_function_privilege('anon','public.save_visit_with_details(uuid,jsonb,jsonb,uuid,timestamptz)','EXECUTE') anon_execute,
    has_table_privilege('anon','public.visit_save_receipts','SELECT') anon_receipts,
    has_table_privilege('authenticated','public.visit_save_receipts','DELETE') can_delete_receipts`)).rows[0],
    { anon_execute: false, anon_receipts: false, can_delete_receipts: false });
  for (const table of ['visits', 'patients', 'appointments', 'symptoms', 'diagnoses', 'prescriptions', 'tests_ordered', 'test_results']) {
    await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY clinic_scope ON ${table} TO authenticated
      USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id=auth.uid()))
      WITH CHECK (clinic_id IN (SELECT clinic_id FROM profiles WHERE id=auth.uid()));`);
  }
  const clinic = randomUUID(), user = randomUUID(), patient = randomUUID();
  const foreignClinic = randomUUID(), foreignPatient = randomUUID();
  await db.query('INSERT INTO clinic_settings VALUES ($1),($2)', [clinic, foreignClinic]);
  await db.query('INSERT INTO profiles VALUES ($1,$2)', [user, clinic]);
  await db.query('INSERT INTO patients VALUES ($1,$2),($3,$4)', [patient, clinic, foreignPatient, foreignClinic]);
  await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON clinic_settings,profiles,patients,appointments,visits,symptoms,diagnoses,prescriptions,tests_ordered,test_results TO authenticated;
    SET ROLE authenticated;`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
  const save = async ({ id = null, main = { patient_id: patient }, details = {}, requestId = randomUUID(), version = null } = {}) =>
    (await db.query('SELECT save_visit_with_details($1,$2,$3,$4,$5) AS id', [id, main, details, requestId, version])).rows[0].id;
  return { db, save, patient, foreignPatient, clinic };
}

test('atomic visit persistence, retries, result links, conflicts and tenant boundaries', async t => {
  const { db, save, patient, foreignPatient, clinic } = await database();
  t.after(() => db.close());
  const first = buildVisitSavePayload({ testsOrdered: [testInput()] }).details.tests_ordered[0];
  const second = { ...first, id: randomUUID(), testName: 'Chest X-ray', test_type: 'radiology' };
  const main = { patient_id: patient, chief_complaint: 'Original complaint' };
  const details = { tests_ordered: [first], symptoms: [{ name: 'Fever', severity: 'mild' }],
    diagnoses: [{ name: 'Viral illness' }], prescriptions: [{ medicine: 'Example', quantity: 2 }] };
  const requestId = randomUUID();
  const id = await save({ main, details, requestId });
  assert.equal(await save({ main, details, requestId }), id);
  assert.equal((await db.query('SELECT count(*) FROM visits')).rows[0].count, 1);
  assert.equal((await db.query('SELECT "testName" FROM tests_ordered')).rows[0].testName, 'CBC');
  await db.query("UPDATE visits SET pdf_url='display.pdf',print_pdf_url='print.pdf',compact_print_pdf_url='compact.pdf' WHERE id=$1", [id]);
  await assert.rejects(save({ main: { ...main, chief_complaint: 'Different' }, details, requestId }), /different data/);

  // Wrong column and enum errors roll back parent and all already-written children.
  for (const invalid of [{ test_name: 'CBC' }, { ...first, test_type: 'unknown' }]) {
    await assert.rejects(save({ main, details: { ...details, tests_ordered: [invalid] } }));
    assert.equal((await db.query('SELECT count(*) FROM visits')).rows[0].count, 1);
  }
  await assert.rejects(save({ id, main: { chief_complaint: 'Must roll back' },
    details: { symptoms: [], tests_ordered: [{ ...first, status: 'invalid' }] } }));
  assert.equal((await db.query('SELECT chief_complaint FROM visits WHERE id=$1', [id])).rows[0].chief_complaint, main.chief_complaint);
  assert.equal((await db.query('SELECT count(*) FROM symptoms')).rows[0].count, 1);
  assert.equal((await db.query('SELECT pdf_url FROM visits WHERE id=$1', [id])).rows[0].pdf_url, 'display.pdf');

  await db.query('INSERT INTO test_results(visit_id,clinic_id,test_ordered_id,result) VALUES($1,$2,$3,$4)', [id, clinic, first.id, 'Normal']);
  const masterId = randomUUID();
  await db.query('UPDATE tests_ordered SET test_id=$1 WHERE id=$2', [masterId, first.id]);
  const version = (await db.query('SELECT updated_at::text AS version FROM visits WHERE id=$1', [id])).rows[0].version;
  const editRequest = randomUUID();
  first.test_id = masterId;
  const edit = { id, main: { chief_complaint: 'Edited' }, details: { tests_ordered: [{ ...first, instructions: 'Updated instructions' }, second] }, version, requestId: editRequest };
  await save(edit);
  await save(edit); // A retry succeeds even though its original version is now stale.
  assert.deepEqual((await db.query('SELECT pdf_url,print_pdf_url,compact_print_pdf_url FROM visits WHERE id=$1', [id])).rows[0],
    { pdf_url: null, print_pdf_url: null, compact_print_pdf_url: null });
  const rows = (await db.query('SELECT * FROM tests_ordered ORDER BY "testName"')).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, first.id);
  assert.equal(rows[0].test_id, masterId);
  assert.equal(rows[0].instructions, 'Updated instructions');
  assert.equal((await db.query('SELECT count(*) FROM test_results')).rows[0].count, 1);
  await assert.rejects(save({ id, main: { chief_complaint: 'Stale' }, version }), /changed since/);
  await assert.rejects(save({ id, details: { tests_ordered: [] } }), /saved results cannot be removed/);
  assert.equal((await db.query('SELECT count(*) FROM tests_ordered')).rows[0].count, 2);
  await save({ id, main: { doctor_notes: 'Partial update' } });
  assert.equal((await db.query('SELECT count(*) FROM tests_ordered')).rows[0].count, 2);
  await save({ id, details: { tests_ordered: [first] } });
  assert.equal((await db.query('SELECT count(*) FROM tests_ordered')).rows[0].count, 1);

  const otherVisit = await save();
  await assert.rejects(save({ id: otherVisit, details: { tests_ordered: [first] } }), /does not belong/);
  await assert.rejects(save({ main: { patient_id: foreignPatient } }), /Patient not found/);
  await db.exec('RESET ROLE');
  const foreignVisit = randomUUID();
  await db.query('INSERT INTO visits(id,patient_id,clinic_id) SELECT $1,id,clinic_id FROM patients WHERE id=$2', [foreignVisit, foreignPatient]);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(save({ id: foreignVisit }), /not found or access denied/);
});

test('a silently denied test deletion is detected and the whole edit rolls back', async t => {
  const { db, save } = await database(); t.after(() => db.close());
  const details = buildVisitSavePayload({ testsOrdered: [testInput()] }).details;
  const id = await save({ details });
  await db.exec(`RESET ROLE;
    CREATE POLICY deny_test_delete ON tests_ordered AS RESTRICTIVE FOR DELETE TO authenticated USING(false);
    SET ROLE authenticated;`);
  await assert.rejects(save({ id, main: { doctor_notes: 'Must roll back' }, details: { tests_ordered: [] } }), /Could not save all tests/);
  assert.equal((await db.query('SELECT doctor_notes FROM visits WHERE id=$1', [id])).rows[0].doctor_notes, null);
  assert.equal((await db.query('SELECT count(*) FROM tests_ordered')).rows[0].count, 1);
});

test('a changed retry from an already committed new-visit form cannot create a duplicate', async t => {
  const { db, save, patient } = await database(); t.after(() => db.close());
  const target = randomUUID();
  const first = { id: target, patient_id: patient, chief_complaint: 'First save' };
  const requestId = randomUUID();
  assert.equal(await save({ main: first, requestId }), target);
  assert.equal(await save({ main: first, requestId }), target);
  await assert.rejects(save({ main: { ...first, chief_complaint: 'Changed after response loss' } }), /already saved/);
  assert.equal((await db.query('SELECT count(*) FROM visits')).rows[0].count, 1);
});
