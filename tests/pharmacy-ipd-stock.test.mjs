import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, applyMigration, n } from './helpers/pharmacy-baseline.mjs';

/**
 * Migration 20261019150000: the fallout fixes around IPD stock. Everything
 * here runs the real migrations verbatim against real PostgreSQL semantics.
 */
async function ctx() {
  const { db, clinic, user } = await freshDb();
  await applyMigration(db, '20261019130000_pharmacy_pack_dispense_units.sql');
  await applyMigration(db, '20261019140000_pharmacy_purchase_corrections.sql');
  await applyMigration(db, '20261019150000_ipd_dispense_stock_fixes.sql');
  return { db, clinic, user };
}

async function seedMedicine(db, clinic, { stock = 10, packSize = 10 } = {}) {
  const med = randomUUID();
  await db.query(
    `INSERT INTO public.medicines_master
       (id, name, dosage_form, category, current_stock, pack_size, stock_unit, dispense_unit, clinic_id)
     VALUES ($1, 'Pantoprazole 40', 'tablet', 'gastrointestinal', $2, $3, 'Strip', 'Tablet', $4)`,
    [med, stock, packSize, clinic]);
  return med;
}

test('IPD rows no longer move the main pool twice', async t => {
  const { db, clinic, user } = await ctx();
  t.after(() => db.close());
  const med = await seedMedicine(db, clinic, { stock: 10 });

  await t.test('an admission-linked row leaves the pool alone (the caller already moved it)', async () => {
    // The eMAR path deducts the pool itself before inserting its row; here only
    // the insert happens, so an unchanged pool proves the trigger stepped back.
    await db.query(
      `INSERT INTO public.pharmacy_dispensed_items
         (medicine_id, quantity, pack_size, billed_quantity, billed_unit,
          admission_id, dispensed_by, selling_price_at_dispense, clinic_id)
       VALUES ($1, 0.1, 10, 1, 'Tablet', $2, $3, 10, $4)`,
      [med, randomUUID(), user, clinic]);
    const stock = (await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0];
    assert.equal(n(stock.current_stock), 10, 'the trigger must not deduct an IPD dose a second time');
    const moves = await db.query(`SELECT count(*)::int AS c FROM public.stock_movement_log WHERE reference_type = 'dispensed_item'`);
    assert.equal(moves.rows[0].c, 0, 'and it logs no movement for it');
  });

  await t.test('a counter row still moves the pool exactly once', async () => {
    await db.query(
      `INSERT INTO public.pharmacy_dispensed_items
         (medicine_id, quantity, pack_size, billed_quantity, billed_unit,
          dispensed_by, selling_price_at_dispense, clinic_id)
       VALUES ($1, 0.5, 10, 5, 'Tablet', $2, 10, $3)`, [med, user, clinic]);
    const stock = (await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0];
    assert.equal(n(stock.current_stock), 9.5);
  });
});

test('ward stores hold fractions once a pack is broken for a dose', async t => {
  const { db, clinic, user } = await ctx();
  t.after(() => db.close());
  const med = await seedMedicine(db, clinic, { stock: 10 });
  const store = randomUUID();
  await db.query('INSERT INTO public.ipd_stores (id, clinic_id, name) VALUES ($1, $2, $3)', [store, clinic, 'Ward A']);
  await db.query(
    'INSERT INTO public.store_stock (clinic_id, store_id, medicine_id, quantity) VALUES ($1, $2, $3, 2)',
    [clinic, store, med]);

  await t.test('one tablet off a ward strip consumes 0.1 of it', async () => {
    const { rows } = await db.query(
      'SELECT public.consume_from_store($1, $2, $3, $4, $5, $6, $7) AS id',
      [clinic, store, med, 0.1, randomUUID(), user, 'eMAR: Pantoprazole 40 (1 Tablet)']);
    assert.ok(rows[0].id);
    const st = (await db.query('SELECT quantity FROM public.store_stock WHERE store_id = $1 AND medicine_id = $2', [store, med])).rows[0];
    assert.equal(n(st.quantity), 1.9);
    // The ward issue must not touch the main pool at all.
    const pool = (await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0];
    assert.equal(n(pool.current_stock), 10);
  });

  await t.test('a consumption beyond what the shelf holds is refused', async () => {
    await assert.rejects(
      db.query('SELECT public.consume_from_store($1, $2, $3, $4)', [clinic, store, med, 5]),
      /Insufficient store stock \(available 1\.9\)/);
    await assert.rejects(
      db.query('SELECT public.consume_from_store($1, $2, $3, $4)', [clinic, store, med, 0]),
      /must be more than zero/);
  });
});

test('the 2025 integer-typed helpers survive fractional stock', async t => {
  const { db, clinic } = await ctx();
  t.after(() => db.close());
  const med = await seedMedicine(db, clinic, { stock: 10 });
  await db.query(
    `UPDATE public.medicines_master
        SET current_stock = 1.5, reorder_level = 2, expiry_date = CURRENT_DATE + 10
      WHERE id = $1`, [med]);

  await t.test('get_low_stock_medicines returns the fraction instead of erroring', async () => {
    const { rows } = await db.query('SELECT * FROM public.get_low_stock_medicines()');
    assert.equal(rows.length, 1);
    assert.equal(n(rows[0].current_stock), 1.5);
    assert.equal(n(rows[0].stock_difference), -0.5);
  });

  await t.test('get_expiring_medicines does too', async () => {
    const { rows } = await db.query('SELECT * FROM public.get_expiring_medicines(30)');
    assert.equal(rows.length, 1);
    assert.equal(n(rows[0].current_stock), 1.5);
  });
});

test('a correction never clobbers a configured master pack size', async t => {
  const { db, clinic, user } = await ctx();
  t.after(() => db.close());

  // The master is configured as a strip of 10; the purchase line carries no
  // pack size at all (a pre-pack-size entry).
  const med = await seedMedicine(db, clinic, { stock: 0, packSize: 10 });
  const receipt = randomUUID();
  await db.query(
    `INSERT INTO public.pharmacy_inward_receipts (id, invoice_number, uploaded_by, clinic_id)
     VALUES ($1, 'INV-9', $2, $3)`, [receipt, user, clinic]);
  const item = randomUUID();
  await db.query(
    `INSERT INTO public.pharmacy_inward_items
       (id, receipt_id, medicine_id, quantity, unit_cost_price, gst_rate,
        discount_percent, taxable_amount, cgst_amount, sgst_amount, line_total, clinic_id)
     VALUES ($1, $2, $3, 5, 100, 12, 10, 450, 27, 27, 504, $4)`, [item, receipt, med, clinic]);

  await t.test('correcting an unrelated field leaves pack size 10 alone', async () => {
    await db.query('SELECT public.correct_inward_item($1, $2::jsonb, $3)',
      [item, JSON.stringify({ hsn_code: '3004' }), 'HSN was blank']);
    const m = (await db.query('SELECT pack_size FROM public.medicines_master WHERE id = $1', [med])).rows[0];
    assert.equal(n(m.pack_size), 10, 'the line had no pack size to teach, so the master keeps its own');
  });

  await t.test('the receipt discount follows a corrected discount', async () => {
    // 5 x 100 with 10% off: gross 500, taxable 450, discount 50.
    await db.query('SELECT public.resync_inward_receipt_totals($1)', [receipt]);
    let head = (await db.query('SELECT discount_amount FROM public.pharmacy_inward_receipts WHERE id = $1', [receipt])).rows[0];
    assert.equal(n(head.discount_amount), 50);

    // Discount corrected away: taxable rises to 500, discount falls to 0.
    await db.query('SELECT public.correct_inward_item($1, $2::jsonb, $3)',
      [item, JSON.stringify({ discount_percent: 0, taxable_amount: 500, cgst_amount: 30, sgst_amount: 30, line_total: 560 }), 'no scheme discount on this invoice']);
    head = (await db.query('SELECT discount_amount, taxable_amount, grand_total FROM public.pharmacy_inward_receipts WHERE id = $1', [receipt])).rows[0];
    assert.equal(n(head.discount_amount), 0);
    assert.equal(n(head.taxable_amount), 500);
    assert.equal(n(head.grand_total), 560);
  });
});

test('a mis-read batch number is corrected everywhere it was copied', async t => {
  const { db, clinic, user } = await ctx();
  t.after(() => db.close());
  const med = await seedMedicine(db, clinic, { stock: 0 });

  // A purchase under the wrong number ("8I-204" read off a blurry invoice),
  // then a sale from that batch — both rows copy the number as text.
  const receipt = randomUUID();
  await db.query(
    `INSERT INTO public.pharmacy_inward_receipts (id, invoice_number, uploaded_by, clinic_id)
     VALUES ($1, 'INV-77', $2, $3)`, [receipt, user, clinic]);
  await db.query(
    `INSERT INTO public.pharmacy_inward_items
       (receipt_id, medicine_id, quantity, unit_cost_price, mrp, batch_number, gst_rate,
        taxable_amount, cgst_amount, sgst_amount, line_total, clinic_id)
     VALUES ($1, $2, 3, 70, 100, '8I-204', 12, 210, 12.6, 12.6, 235.2, $3)`, [receipt, med, clinic]);
  const batch = (await db.query(
    `SELECT id FROM public.medicine_batches WHERE medicine_id = $1 AND batch_number = '8I-204'`, [med])).rows[0].id;

  const bill = randomUUID();
  await db.query(
    `INSERT INTO public.bills (id, bill_number, bill_type, status, clinic_id) VALUES ($1, 'PH/1', 'pharmacy', 'paid', $2)`,
    [bill, clinic]);
  await db.query(
    `INSERT INTO public.bill_items (bill_id, clinic_id, item_type, item_name, quantity, unit_price, batch_id, batch_number)
     VALUES ($1, $2, 'medicine', 'Pantoprazole 40', 1, 100, $3, '8I-204')`, [bill, clinic, batch]);
  await db.query(
    `INSERT INTO public.pharmacy_dispensed_items
       (medicine_id, quantity, billed_quantity, billed_unit, dispensed_by, selling_price_at_dispense,
        batch_id, batch_number, clinic_id)
     VALUES ($1, 1, 1, 'Strip', $2, 100, $3, '8I-204', $4)`, [med, user, batch, clinic]);

  await t.test('renaming fixes the batch and every linked row', async () => {
    await db.query('SELECT public.rename_medicine_batch($1, $2, $3)', [batch, 'BL-204', 'misread 8I for BL']);
    for (const table of ['medicine_batches', 'pharmacy_inward_items', 'pharmacy_dispensed_items', 'bill_items']) {
      const col = table === 'medicine_batches' ? 'id' : 'batch_id';
      const { rows } = await db.query(
        `SELECT batch_number FROM public.${table} WHERE ${col} = $1`, [batch]);
      assert.ok(rows.length >= 1, `${table} has the row`);
      assert.equal(rows[0].batch_number, 'BL-204', `${table} follows the rename`);
    }
    const note = await db.query(
      `SELECT remarks FROM public.stock_movement_log WHERE reference_type = 'batch_rename'`);
    assert.match(note.rows[0].remarks, /8I-204 renamed to BL-204: misread/);
  });

  await t.test('renaming onto an existing batch of the same medicine is refused', async () => {
    await db.query(
      `INSERT INTO public.medicine_batches (clinic_id, medicine_id, batch_number, quantity)
       VALUES ($1, $2, 'CL-999', 1)`, [clinic, med]);
    await assert.rejects(
      db.query('SELECT public.rename_medicine_batch($1, $2)', [batch, 'CL-999']),
      /already exists for this medicine/);
  });

  await t.test('a blank number is refused', async () => {
    await assert.rejects(
      db.query('SELECT public.rename_medicine_batch($1, $2)', [batch, '  ']),
      /cannot be blank/);
  });
});

test('the migrations apply on a database without the sub-store or IPD modules', async t => {
  // The live clinic is exactly this shape: no store_indents/store_stock (the
  // 2026-07/09 store migrations were never applied there) and, potentially, no
  // admission_id on dispensed items. The first live run failed on
  // dispatch_store_indent's %ROWTYPE of a missing table.
  const { db, clinic, user } = await freshDb();
  t.after(() => db.close());
  await db.exec(`
    DROP FUNCTION public.dispatch_store_indent(uuid, jsonb, uuid, text);
    DROP FUNCTION public.transfer_from_main(uuid, uuid, uuid, integer, uuid, text);
    DROP FUNCTION public.transfer_between_stores(uuid, uuid, uuid, uuid, integer, uuid, text);
    DROP FUNCTION public.consume_from_store(uuid, uuid, uuid, integer, uuid, uuid, text);
    DROP TABLE public.store_indent_items, public.store_indents,
               public.store_consumptions, public.store_transfers, public.store_stock,
               public.ipd_stores;
    ALTER TABLE public.pharmacy_dispensed_items DROP COLUMN admission_id;
  `);

  await applyMigration(db, '20261019130000_pharmacy_pack_dispense_units.sql');
  await applyMigration(db, '20261019140000_pharmacy_purchase_corrections.sql');
  await applyMigration(db, '20261019150000_ipd_dispense_stock_fixes.sql');

  await t.test('the skipped store functions stayed absent, the rest arrived', async () => {
    const fn = async (name) => (await db.query(
      `SELECT count(*)::int AS c FROM pg_proc WHERE proname = $1`, [name])).rows[0].c;
    assert.equal(await fn('dispatch_store_indent'), 0);
    assert.equal(await fn('consume_from_store'), 0);
    assert.equal(await fn('correct_inward_item'), 1);
    assert.equal(await fn('rename_medicine_batch'), 1);
    assert.equal(await fn('update_batch_pricing'), 1);
  });

  await t.test('a counter sale still works without the admission_id column', async () => {
    const med = await seedMedicine(db, clinic, { stock: 2 });
    await db.query(
      `INSERT INTO public.pharmacy_dispensed_items
         (medicine_id, quantity, pack_size, billed_quantity, billed_unit,
          dispensed_by, selling_price_at_dispense, clinic_id)
       VALUES ($1, 0.5, 10, 5, 'Tablet', $2, 10, $3)`, [med, user, clinic]);
    const stock = (await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0];
    assert.equal(n(stock.current_stock), 1.5, 'the jsonb admission guard must not break a plain dispense');
  });
});
