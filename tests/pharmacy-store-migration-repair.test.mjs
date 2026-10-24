import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, applyMigration, n } from './helpers/pharmacy-baseline.mjs';

async function setup(t) {
  const ctx = await freshDb();
  const { db, clinic } = ctx;
  t.after(() => db.close());
  await applyMigration(db, '20261019130000_pharmacy_pack_dispense_units.sql');
  await applyMigration(db, '20261019150000_ipd_dispense_stock_fixes.sql');
  // Reproduce the live database: stock support exists, indent tables do not.
  await db.exec(`DROP TABLE store_indent_items; DROP TABLE store_indents;
    CREATE PUBLICATION supabase_realtime;
    ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon;
    ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon;`);
  await applyMigration(db, '20260903000000_store_indents.sql');
  await applyMigration(db, '20261022130000_store_indent_compatibility_and_ipd_guard.sql');
  const store = randomUUID(), medicine = randomUUID();
  await db.query('INSERT INTO ipd_stores (id, clinic_id, name) VALUES ($1,$2,$3)', [store, clinic, 'Ward']);
  await db.query('INSERT INTO medicines_master (id, clinic_id, name, current_stock) VALUES ($1,$2,$3,2.5)', [medicine, clinic, 'Medicine']);
  await db.query("SELECT set_config('test.clinic_ids', $1, false)", [clinic]);
  const create = async (items = [{ medicine_id: medicine, quantity: 2 }]) =>
    (await db.query('SELECT create_store_indent($1,$2,$3::jsonb) id', [clinic, store, JSON.stringify(items)])).rows[0].id;
  const line = async id => (await db.query('SELECT id FROM store_indent_items WHERE indent_id=$1', [id])).rows[0].id;
  const dispatch = (id, lines) => db.query('SELECT dispatch_store_indent($1,$2::jsonb)', [id, JSON.stringify(lines)]);
  return { ...ctx, store, medicine, create, line, dispatch };
}

test('late indent installation preserves fractional stock through partial dispatch and receipt', async t => {
  const { db, clinic, user, medicine, create, line, dispatch } = await setup(t);
  const id = await create(), item = await line(id);
  await db.query('SELECT mark_store_indents_seen($1)', [clinic]);
  await dispatch(id, [{ item_id: item, quantity: 1 }]);
  assert.equal((await db.query('SELECT status FROM store_indents WHERE id=$1', [id])).rows[0].status, 'partial');
  await dispatch(id, [{ item_id: item, quantity: 1 }]);
  assert.equal(n((await db.query('SELECT current_stock FROM medicines_master WHERE id=$1', [medicine])).rows[0].current_stock), 0.5);
  assert.equal(n((await db.query('SELECT quantity FROM store_stock')).rows[0].quantity), 2);
  await db.query('SELECT receive_store_indent($1)', [id]);
  const header = (await db.query('SELECT * FROM store_indents WHERE id=$1', [id])).rows[0];
  assert.equal(header.status, 'received');
  assert.equal(header.requested_by, user);
  assert.equal(header.dispatched_by, user);
  assert.equal(header.received_by, user);
  await assert.rejects(dispatch(id, [{ item_id: item, quantity: 1 }]), /already received/);
});

test('failed dispatch rolls back every stock movement and cancellation moves no stock', async t => {
  const { db, clinic, medicine, create, dispatch } = await setup(t);
  const other = randomUUID();
  await db.query('INSERT INTO medicines_master (id,clinic_id,name,current_stock) VALUES ($1,$2,$3,0)', [other, clinic, 'Out of stock']);
  const id = await create([{ medicine_id: medicine, quantity: 1 }, { medicine_id: other, quantity: 1 }]);
  const items = (await db.query('SELECT id,medicine_id FROM store_indent_items WHERE indent_id=$1', [id])).rows;
  const lines = [medicine, other].map(m => ({ item_id: items.find(i => i.medicine_id === m).id, quantity: 1 }));
  await assert.rejects(dispatch(id, lines), /Insufficient main pharmacy stock/);
  assert.equal(n((await db.query('SELECT current_stock FROM medicines_master WHERE id=$1', [medicine])).rows[0].current_stock), 2.5);
  assert.equal((await db.query('SELECT * FROM store_stock')).rows.length, 0);
  assert.equal((await db.query('SELECT * FROM stock_movement_log')).rows.length, 0);
  await db.query('SELECT cancel_store_indent($1)', [id]);
  assert.equal((await db.query('SELECT status FROM store_indents WHERE id=$1', [id])).rows[0].status, 'cancelled');
});

test('new indent RPCs reject other clinics and anonymous access, and cannot forge audit actors', async t => {
  const { db, clinic, user, store, medicine, create, line, dispatch } = await setup(t);
  const id = await create(), item = await line(id), otherClinic = randomUUID(), otherStore = randomUUID(), otherMedicine = randomUUID();
  await db.query('INSERT INTO clinic_settings (id) VALUES ($1)', [otherClinic]);
  await db.query('INSERT INTO ipd_stores (id,clinic_id) VALUES ($1,$2)', [otherStore, otherClinic]);
  await db.query('INSERT INTO medicines_master (id,clinic_id,name) VALUES ($1,$2,$3)', [otherMedicine, otherClinic, 'Other medicine']);
  await assert.rejects(db.query('SELECT create_store_indent($1,$2,$3::jsonb)', [clinic, otherStore, JSON.stringify([{ medicine_id: medicine, quantity: 1 }])]), /Store does not belong/);
  await assert.rejects(create([{ medicine_id: otherMedicine, quantity: 1 }]), /Medicine does not belong/);
  await db.query("SELECT set_config('test.clinic_ids',$1,false)", [otherClinic]);
  await assert.rejects(create(), /Not allowed/);
  await assert.rejects(dispatch(id, [{ item_id: item, quantity: 1 }]), /Not allowed/);
  await assert.rejects(db.query('SELECT cancel_store_indent($1)', [id]), /Only an indent/);
  await assert.rejects(db.query('SELECT receive_store_indent($1)', [id]), /Only a dispatched/);
  await db.query('SELECT mark_store_indents_seen($1)', [clinic]);
  assert.equal((await db.query('SELECT pharmacy_seen_at FROM store_indents WHERE id=$1', [id])).rows[0].pharmacy_seen_at, null);
  await db.query("SELECT set_config('test.clinic_ids',$1,false)", [clinic]);
  await db.query('SELECT cancel_store_indent($1,NULL,$2)', [id, randomUUID()]);
  assert.equal((await db.query('SELECT cancelled_by FROM store_indents WHERE id=$1', [id])).rows[0].cancelled_by, user);
  const acl = (await db.query(`SELECT proname,
    has_function_privilege('anon', oid, 'EXECUTE') anon,
    has_function_privilege('authenticated', oid, 'EXECUTE') signed_in
    FROM pg_proc WHERE proname IN ('create_store_indent','dispatch_store_indent','receive_store_indent','cancel_store_indent','mark_store_indents_seen')`)).rows;
  assert.equal(acl.length, 5);
  assert.ok(acl.every(r => !r.anon && r.signed_in));
  assert.equal((await db.query("SELECT has_table_privilege('anon','store_indents','SELECT') allowed")).rows[0].allowed, false);
  await db.exec('SET ROLE anon');
  await assert.rejects(db.query('SELECT create_store_indent($1,$2,$3::jsonb)', [clinic, store, '[]']), /permission denied/);
  await db.exec('RESET ROLE');
});

test('repaired batch trigger skips IPD doses while counter sales still consume fractional stock', async t => {
  const { db, clinic, user, medicine } = await setup(t);
  const batch = randomUUID();
  await db.query('INSERT INTO medicine_batches (id,clinic_id,medicine_id,batch_number,quantity) VALUES ($1,$2,$3,$4,2.5)', [batch, clinic, medicine, 'B1']);
  const insert = admission => db.query(`INSERT INTO pharmacy_dispensed_items
    (clinic_id,medicine_id,batch_id,quantity,admission_id,dispensed_by,selling_price_at_dispense)
    VALUES ($1,$2,$3,0.5,$4,$5,10)`, [clinic, medicine, batch, admission, user]);
  await insert(randomUUID());
  assert.equal(n((await db.query('SELECT quantity FROM medicine_batches WHERE id=$1', [batch])).rows[0].quantity), 2.5);
  await insert(null);
  assert.equal(n((await db.query('SELECT quantity FROM medicine_batches WHERE id=$1', [batch])).rows[0].quantity), 2);
  assert.equal(n((await db.query('SELECT current_stock FROM medicines_master WHERE id=$1', [medicine])).rows[0].current_stock), 2);
});
