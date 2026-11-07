import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { freshDb } from './helpers/pharmacy-baseline.mjs';

const bundled = await build({ entryPoints: ['src/utils/genericNameMatching.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { matchGenericNames, lookupInput, compositionGenericName, genericNameReviewReason, genericLabelKey, hasVerifiedGenericName } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const record = (id, name, composition) => ({ id, name, composition, manufacturer: 'Sample manufacturer', pack: '10 tablets' });
const reference = [
  record('1', 'Dolo 650 Tablet', 'Paracetamol (650mg)'),
  record('2', 'Dolo 500 Tablet', 'Paracetamol (500mg)'),
  record('3', 'Dolo 650 Capsule', 'Paracetamol (650mg)'),
  record('4', 'Nexpro 40 Tablet', 'Esomeprazole (40mg)'),
  record('5', 'Nexpro RD 40 Capsule SR', 'Domperidone (30mg) + Esomeprazole (40mg)'),
  record('6', 'Metformin 500 Tablet SR', 'Metformin (500mg)'),
  record('7', 'Metformin 500 Tablet', 'Metformin (500mg)'),
];

test('catalogue matching respects known strengths, form, release and named combination variants', () => {
  assert.deepEqual(matchGenericNames(lookupInput({ name: 'DOLO650', dosageForm: 'tablet' }), reference).map(r => r.id), ['1']);
  assert.deepEqual(matchGenericNames(lookupInput({ name: 'NEXPRO RD 40', dosageForm: 'capsule' }), reference).map(r => r.id), ['5']);
  assert.deepEqual(matchGenericNames(lookupInput({ name: 'Metformin 500 SR' }), reference).map(r => r.id), ['6']);
  assert.equal(matchGenericNames(lookupInput({ name: 'Dolo 650', strength: '500mg' }), reference).length, 0);
  assert.equal(matchGenericNames(lookupInput({ name: 'Dolo', strength: '50mg' }), [record('x', 'Dolo 150 Tablet', 'Paracetamol (150mg)')]).length, 0, '50 must not match the substring in 150');
  assert.equal(matchGenericNames(lookupInput({ name: 'Dolo', strength: '650mcg' }), reference).length, 0, 'micrograms must not match milligrams');
  assert.equal(matchGenericNames(lookupInput({ name: 'Unknown medicine' }), reference).length, 0);
});

test('bare brand returns candidate variants without inventing composition or omitting combination ingredients', () => {
  const candidates = matchGenericNames(lookupInput({ name: 'Dolo' }), reference);
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every(r => r.genericName === 'Paracetamol'));
  assert.equal(compositionGenericName('Amoxycillin (500mg) + Clavulanic Acid (125mg)'), 'Amoxycillin + Clavulanic Acid');
  assert.equal(compositionGenericName('Diclofenac (as sodium) (50mg)'), 'Diclofenac (as sodium)');
});

test('generic fields copied from product or brand labels are eligible for pharmacist cleanup', () => {
  assert.equal(genericNameReviewReason({ name: 'ACIVIR 400 DT', brandName: 'ACIVIR 400 DT', genericName: 'acivir 400 dt' }), 'brand_copy');
  assert.equal(genericNameReviewReason({ name: 'AKILOS 100MG TAB', brandName: 'AKILOS', genericName: 'Akilos 100 mg' }), 'brand_copy');
  assert.equal(genericNameReviewReason({ name: 'Dolo 650', brandName: 'Dolo', genericName: 'DOLO' }), 'brand_copy');
  assert.equal(genericNameReviewReason({ name: 'ACIVIR 400 DT', genericName: 'Aciclovir' }), undefined);
  assert.equal(genericNameReviewReason({ name: 'Dolo 650', genericName: 'Paracetamol' }), undefined);
  assert.equal(genericNameReviewReason({ name: 'Dolo', genericName: '  ' }), 'missing');
  assert.deepEqual(matchGenericNames(lookupInput({ name: 'ACIVIR 400 DT', brandName: 'ACIVIR 400 DT' }), [record('acivir', 'Acivir 400 DT Tablet', 'Aciclovir (400mg)')]).map(r => r.id), ['acivir'], 'same release suffix in name and brand must not be counted twice');
});

test('verified generic save is tenant scoped, limited to ten, preserves filled names and remembers attempts', async t => {
  const { db, clinic, user } = await freshDb(); t.after(() => db.close());
  await db.exec(`ALTER TABLE profiles ADD COLUMN role_name text, ADD COLUMN permissions text[];
    UPDATE profiles SET role_name='pharmacist',permissions=ARRAY['modules_assigned','pharmacy'];
    GRANT SELECT ON medicines_master,clinic_settings TO authenticated;`);
  await db.exec(await readFile('supabase/migrations/20261026160000_pharmacy_generic_name_reviews.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261026180000_pharmacy_generic_name_cleanup.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261026190000_pharmacy_generic_name_claude.sql', 'utf8'));
  const id = randomUUID();
  await db.query('INSERT INTO medicines_master(id,clinic_id,name,dosage_form) VALUES($1,$2,$3,$4)', [id, clinic, 'Dolo 650', 'tablet']);
  const input = lookupInput({ name: 'Dolo 650', dosageForm: 'tablet' });
  const candidates = matchGenericNames(input, reference);
  const row = { medicine_id: id, input_snapshot: input, candidates, source_version: 'test-snapshot', source_url: 'https://github.com/junioralive/Indian-Medicine-Dataset' };
  const invoke = async (action, rows) => (await db.query('SELECT pharmacy_generic_name_review($1,$2::jsonb) result', [action, JSON.stringify(rows)])).rows[0].result;
  const name = async () => (await db.query('SELECT generic_name FROM medicines_master WHERE id=$1', [id])).rows[0].generic_name;
  const review = async () => (await db.query('SELECT * FROM medicine_generic_name_reviews WHERE medicine_id=$1', [id])).rows[0];

  await db.exec('SET ROLE authenticated');
  await invoke('lookup', [row]);
  assert.equal(await name(), null, 'a suggestion never fills the master before review');
  assert.equal((await review()).status, 'pending');
  await invoke('lookup', [{ ...row, candidates: [] }]);
  assert.equal((await review()).candidates.length, candidates.length, 'same SKU is looked up once');
  const sourced = { ...row, source_version: 'claude-sonnet-5-5:web-v1' };
  await invoke('lookup', [sourced]);
  assert.equal((await review()).source_version, sourced.source_version, 'legacy catalogue can be replaced by web-backed lookup once');
  await invoke('lookup', [{ ...sourced, candidates: [] }]);
  assert.equal((await review()).candidates.length, candidates.length, 'a completed Claude lookup is cached');
  await assert.rejects(invoke('save', [{ ...row, generic_name: 'Paracetamol' }]), /verification is required/);
  const saved = await invoke('save', [{ ...row, verified: true, generic_name: 'Paracetamol', selected_source_id: '1' }]);
  assert.equal(saved[0].result, 'saved');
  assert.equal(await name(), 'Paracetamol');
  assert.equal((await review()).verified_by, user);
  assert.ok((await review()).verified_at);
  const repeated = await invoke('save', [{ ...row, verified: true, generic_name: 'Wrong replacement' }]);
  assert.equal(repeated[0].result, 'already_filled');
  assert.equal(await name(), 'Paracetamol');

  await db.exec('RESET ROLE');
  await db.query('UPDATE medicines_master SET generic_name=NULL,name=$2 WHERE id=$1', [id, 'Dolo 500']);
  await db.exec('SET ROLE authenticated');
  assert.equal((await invoke('save', [{ ...row, verified: true, generic_name: 'Stale suggestion' }]))[0].result, 'changed');
  const newRow = { ...row, input_snapshot: lookupInput({ name: 'Dolo 500', dosageForm: 'tablet' }), candidates: [] };
  await invoke('lookup', [newRow]);
  assert.equal((await review()).status, 'no_match');
  await invoke('lookup', [{ ...newRow, candidates }]);
  assert.equal((await review()).status, 'no_match', 'unmatched SKU is not repeatedly fetched');
  await invoke('save', [{ ...newRow, verified: true, generic_name: 'Manually checked molecule', selected_source_id: null }]);
  assert.equal(await name(), 'Manually checked molecule');
  assert.equal((await review()).selected_source_id, null);

  await assert.rejects(invoke('lookup', Array(11).fill(row)), /1 and 10/);
  await assert.rejects(invoke('lookup', [row, row]), /Duplicate/);
  await assert.rejects(invoke('lookup', null), /Expected a list/);
  await assert.rejects(db.query('UPDATE medicine_generic_name_reviews SET verified_by=NULL'), /permission denied/);

  await db.exec('RESET ROLE');
  const otherClinic = randomUUID(); const otherMed = randomUUID();
  await db.query('INSERT INTO clinic_settings(id) VALUES($1)', [otherClinic]);
  await db.query('INSERT INTO medicines_master(id,clinic_id,name) VALUES($1,$2,$3)', [otherMed, otherClinic, 'Other clinic SKU']);
  await db.query("SELECT set_config('test.clinic_ids',$1,false)", [clinic]);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(invoke('lookup', [{ ...row, medicine_id: otherMed }]), /outside your clinic/);

  await db.exec('RESET ROLE');
  await db.query("UPDATE profiles SET permissions=ARRAY['modules_assigned','opd_billing'] WHERE id=$1", [user]);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(invoke('lookup', [row]), /access is required/);
});

test('enum dosage forms reproduce the original 400 and the forward migration safely cleans brand copies', async t => {
  const { db, clinic, user } = await freshDb(); t.after(() => db.close());
  await db.exec(`ALTER TABLE profiles ADD COLUMN role_name text, ADD COLUMN permissions text[];
    UPDATE profiles SET role_name='pharmacist',permissions=ARRAY['modules_assigned','pharmacy'];
    GRANT SELECT ON medicines_master,clinic_settings TO authenticated;
    CREATE TYPE dosage_form_enum AS ENUM ('tablet','capsule','other');
    ALTER TABLE medicines_master ALTER COLUMN dosage_form TYPE dosage_form_enum USING dosage_form::dosage_form_enum;`);
  await db.exec(await readFile('supabase/migrations/20261026160000_pharmacy_generic_name_reviews.sql', 'utf8'));
  const id = randomUUID();
  await db.query('INSERT INTO medicines_master(id,clinic_id,name,brand_name,dosage_form) VALUES($1,$2,$3,$3,$4)', [id, clinic, 'ACIVIR 400 DT', 'other']);
  const baseInput = lookupInput({ name: 'ACIVIR 400 DT', brandName: 'ACIVIR 400 DT', dosageForm: 'other' });
  const candidates = matchGenericNames(baseInput, [record('acivir', 'Acivir 400 DT Tablet', 'Aciclovir (400mg)')]);
  const row = { medicine_id: id, input_snapshot: baseInput, candidates, source_version: 'test', source_url: 'https://github.com/junioralive/Indian-Medicine-Dataset' };
  const invoke = async (action, rows) => (await db.query('SELECT pharmacy_generic_name_review($1,$2::jsonb) result', [action, JSON.stringify(rows)])).rows[0].result;
  await db.exec('SET ROLE authenticated');
  await assert.rejects(invoke('lookup', [row]), error => error.code === '22P02' && /dosage_form_enum/.test(error.message), 'old RPC coalesces the enum with an invalid empty enum label');
  await db.exec('RESET ROLE');
  await db.exec(await readFile('supabase/migrations/20261026180000_pharmacy_generic_name_cleanup.sql', 'utf8'));

  // The new RPC also accepts the old app's five-field snapshot for empty names.
  const oldInput = { ...baseInput }; delete oldInput.generic_name;
  await db.exec('SET ROLE authenticated');
  assert.equal((await invoke('lookup', [{ ...row, input_snapshot: oldInput }]))[0].result, 'recorded');
  await db.exec('RESET ROLE');
  await db.query('UPDATE medicines_master SET generic_name=$2 WHERE id=$1', [id, 'ACIVIR 400 DT']);
  const copiedInput = { ...baseInput, generic_name: 'ACIVIR 400 DT' };
  const copied = { ...row, input_snapshot: copiedInput };
  await db.exec('SET ROLE authenticated');
  await invoke('lookup', [copied]);
  let med = (await db.query('SELECT generic_name FROM medicines_master WHERE id=$1', [id])).rows[0];
  assert.equal(med.generic_name, 'ACIVIR 400 DT', 'lookup leaves the old value intact until approval');
  await assert.rejects(invoke('save', [{ ...copied, generic_name: 'Aciclovir' }]), /verification is required/);

  // Even another brand-like edit made mid-review must not be overwritten.
  await db.exec('RESET ROLE');
  await db.query('UPDATE medicines_master SET generic_name=$2 WHERE id=$1', [id, 'acivir400dt']);
  await db.exec('SET ROLE authenticated');
  assert.equal((await invoke('save', [{ ...copied, verified: true, generic_name: 'Aciclovir' }]))[0].result, 'changed');
  const latest = { ...row, input_snapshot: { ...baseInput, generic_name: 'acivir400dt' } };
  await invoke('lookup', [latest]);
  assert.equal((await invoke('save', [{ ...latest, verified: true, generic_name: 'Aciclovir', selected_source_id: 'acivir' }]))[0].result, 'saved');
  med = (await db.query('SELECT generic_name FROM medicines_master WHERE id=$1', [id])).rows[0];
  assert.equal(med.generic_name, 'Aciclovir');
  const audit = (await db.query('SELECT * FROM medicine_generic_name_reviews WHERE medicine_id=$1', [id])).rows[0];
  assert.equal(audit.previous_generic_name, 'acivir400dt');
  assert.equal(audit.verified_by, user);
  assert.equal((await invoke('save', [{ ...latest, verified: true, generic_name: 'Wrong replacement' }]))[0].result, 'already_filled');

  // A genuine generic product may have the same trade and generic labels.
  const pureGeneric = { name: 'Paracetamol', genericName: 'Paracetamol' };
  const verified = { ...audit, input_snapshot: lookupInput({ name: 'Paracetamol' }), generic_name: 'Paracetamol' };
  assert.equal(hasVerifiedGenericName(pureGeneric, verified), true);
  assert.equal(hasVerifiedGenericName({ ...pureGeneric, genericName: 'Other' }, verified), false);
  for (const label of ['AKILOS100MG TAB', 'Acivir-400 DT', 'Paracetamol 500 tablet', 'Cápsule']) {
    const key = (await db.query('SELECT pharmacy_generic_label_key($1) AS key', [label])).rows[0].key;
    assert.equal(key, genericLabelKey(label), 'browser and SQL eligibility normalization agree');
  }
});
