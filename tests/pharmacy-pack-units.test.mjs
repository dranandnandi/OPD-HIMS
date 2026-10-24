import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, applyMigration, n } from './helpers/pharmacy-baseline.mjs';

/**
 * Runs migration 20261019130000 (stocked unit vs dispense unit) verbatim
 * against real PostgreSQL semantics, on the pre-migration schema in
 * tests/helpers/pharmacy-baseline.mjs.
 */
test('pharmacy pack units: migration applies and a half strip sells as half a strip', async t => {
  const { db, clinic, user: pharmacist } = await freshDb();
  t.after(() => db.close());

  // A SKU that already holds whole-unit stock before the migration runs, so the
  // type change has to carry existing data over.
  const med = randomUUID();
  await db.query(
    `INSERT INTO public.medicines_master (id, name, dosage_form, category, current_stock, reorder_level, clinic_id, gst_rate)
     VALUES ($1, 'Paracetamol 500', 'tablet', 'analgesic', 3, 2, $2, 12)`, [med, clinic]);
  const batch = randomUUID();
  await db.query(
    `INSERT INTO public.medicine_batches (id, clinic_id, medicine_id, batch_number, mrp, purchase_rate, quantity)
     VALUES ($1, $2, $3, 'B1', 100, 70, 3)`, [batch, clinic, med]);

  // An old sale, from before pack sizes existed.
  await db.query(
    `INSERT INTO public.pharmacy_dispensed_items (medicine_id, quantity, dispensed_by, selling_price_at_dispense, clinic_id)
     VALUES ($1, 1, $2, 100, $3)`, [med, pharmacist, clinic]);

  await applyMigration(db, '20261019130000_pharmacy_pack_dispense_units.sql');

  await t.test('existing rows survive and are backfilled as whole packs', async () => {
    const { rows } = await db.query(
      `SELECT quantity, billed_quantity, pack_size, total_selling_price
         FROM public.pharmacy_dispensed_items`);
    assert.equal(rows.length, 1);
    assert.equal(n(rows[0].quantity), 1);
    assert.equal(n(rows[0].billed_quantity), 1, 'billed quantity is backfilled from quantity');
    assert.equal(n(rows[0].pack_size), 1);
    assert.equal(n(rows[0].total_selling_price), 100, 'generated line value still follows the billed pair');
    // The pre-migration sale consumed one of the three units in stock.
    const stock = await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med]);
    assert.equal(n(stock.rows[0].current_stock), 2);
  });

  await db.query(
    `UPDATE public.medicines_master
        SET pack_size = 10, stock_unit = 'Strip', dispense_unit = 'Tablet'
      WHERE id = $1`, [med]);

  await t.test('5 tablets out of a strip of 10 take 0.5 off stock and bill 50.00', async () => {
    // What the counter writes: 5 tablets at MRP/10 = 10.00 each, GST backed out
    // of the 50.00 (12% inclusive -> 44.64 taxable + 2.68 + 2.68).
    await db.query(
      `INSERT INTO public.pharmacy_dispensed_items
         (medicine_id, quantity, pack_size, billed_quantity, billed_unit,
          dispensed_by, selling_price_at_dispense, mrp, batch_id, gst_rate,
          taxable_amount, cgst_amount, sgst_amount, clinic_id)
       VALUES ($1, 0.5, 10, 5, 'Tablet', $2, 10, 100, $3, 12, 44.64, 2.68, 2.68, $4)`,
      [med, pharmacist, batch, clinic]);

    const row = (await db.query(
      `SELECT quantity, billed_quantity, billed_unit, total_selling_price
         FROM public.pharmacy_dispensed_items WHERE billed_unit = 'Tablet'`)).rows[0];
    assert.equal(n(row.quantity), 0.5, 'stock moves by half a strip');
    assert.equal(n(row.billed_quantity), 5);
    assert.equal(n(row.total_selling_price), 50, '5 tablets at 10.00 is 50.00');

    // The pool started at 3 and the pre-migration sale took 1 without naming a
    // batch, so the pool and the batch legitimately differ here.
    const stock = await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med]);
    assert.equal(n(stock.rows[0].current_stock), 1.5, 'the pool keeps the broken strip');
    const b = await db.query('SELECT quantity FROM public.medicine_batches WHERE id = $1', [batch]);
    assert.equal(n(b.rows[0].quantity), 2.5, 'the batch keeps the broken strip');
  });

  await t.test('the movement log records the fraction instead of rounding it', async () => {
    const { rows } = await db.query(
      `SELECT quantity_change, new_stock_level FROM public.stock_movement_log
        WHERE reference_type = 'dispensed_item' ORDER BY movement_date DESC LIMIT 1`);
    assert.equal(n(rows[0].quantity_change), -0.5);
    assert.equal(n(rows[0].new_stock_level), 1.5);
  });

  await t.test('a part pack cannot be returned to the supplier beyond what is held', async () => {
    const note = randomUUID();
    await db.query(
      `INSERT INTO public.pharmacy_debit_notes (id, clinic_id, debit_note_number, created_by)
       VALUES ($1, $2, 'DN/1', $3)`, [note, clinic, pharmacist]);
    await assert.rejects(
      db.query(
        `INSERT INTO public.pharmacy_debit_note_items
           (clinic_id, debit_note_id, medicine_id, batch_id, quantity, unit_rate)
         VALUES ($1, $2, $3, $4, 2, 70)`, [clinic, note, med, batch]),
      /Insufficient stock to return/,
      'returning 2 strips when 1.5 are left must fail, not silently round'
    );
  });

  await t.test('write_off_batch zeroes a broken strip without rounding the pool', async () => {
    const { rows } = await db.query('SELECT public.write_off_batch($1, $2) AS qty', [batch, 'Expired']);
    assert.equal(n(rows[0].qty), 2.5, 'the write-off returns the fractional quantity');
    const stock = await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med]);
    assert.equal(n(stock.rows[0].current_stock), 0);
  });

  await t.test('reports return fractional quantities with their unit labels', async () => {
    await db.query('INSERT INTO public.patients (id, name) VALUES ($1, $2)', [randomUUID(), 'Walk-in']);
    const bill = randomUUID();
    await db.query(
      `INSERT INTO public.bills (id, bill_number, bill_type, status, clinic_id, total_amount, taxable_amount)
       VALUES ($1, 'PH/26-27/00001', 'pharmacy', 'paid', $2, 50, 44.64)`, [bill, clinic]);
    await db.query(
      `INSERT INTO public.bill_items
         (bill_id, clinic_id, item_type, item_name, quantity, pack_size, billed_quantity, billed_unit,
          unit_price, amount, total_price, medicine_id, hsn_code, gst_rate, mrp,
          taxable_amount, cgst_amount, sgst_amount)
       VALUES ($1, $2, 'medicine', 'Paracetamol 500', 0.5, 10, 5, 'Tablet',
               10, 50, 50, $3, '3004', 12, 100, 44.64, 2.68, 2.68)`, [bill, clinic, med]);
    // Point the line at the batch so the cost side of the margin resolves.
    await db.query('UPDATE public.bill_items SET batch_id = $1 WHERE bill_id = $2', [batch, bill]);

    const hsn = await db.query('SELECT * FROM public.gst_hsn_summary($1, $2, $3)',
      [clinic, '2026-01-01', '2030-12-31']);
    assert.equal(n(hsn.rows[0].quantity), 0.5, 'HSN summary counts half a strip as 0.5');
    assert.equal(n(hsn.rows[0].taxable_amount), 44.64);

    const byMed = await db.query('SELECT * FROM public.pharmacy_sales_by_medicine($1, $2, $3)',
      [clinic, '2026-01-01', '2030-12-31']);
    assert.equal(n(byMed.rows[0].quantity), 0.5);
    assert.equal(byMed.rows[0].stock_unit, 'Strip');
    assert.equal(byMed.rows[0].dispense_unit, 'Tablet');
    assert.equal(n(byMed.rows[0].pack_size), 10);
    assert.equal(n(byMed.rows[0].sales_amount), 50);
    assert.equal(n(byMed.rows[0].cost_amount), 35, 'cost is the purchase rate per strip times 0.5');

    const byUser = await db.query('SELECT * FROM public.pharmacy_sales_by_user($1, $2, $3)',
      [clinic, '2026-01-01', '2030-12-31']);
    assert.equal(n(byUser.rows[0].quantity), 1.5, 'one whole strip plus the half strip');

    // Stock is back to zero after the write-off, so valuation and dead stock
    // have nothing to show; both must still execute with the new return types.
    await db.query('UPDATE public.medicines_master SET current_stock = 2.5 WHERE id = $1', [med]);
    const val = await db.query('SELECT * FROM public.pharmacy_stock_valuation($1)', [clinic]);
    assert.equal(n(val.rows[0].total_quantity), 2.5);
    assert.equal(val.rows[0].stock_unit, 'Strip');
    assert.equal(n(val.rows[0].pooled_quantity), 2.5, 'the batch is empty, so it is all pooled stock');
    const dead = await db.query('SELECT * FROM public.pharmacy_dead_stock($1, $2)', [clinic, 0]);
    assert.ok(dead.rows.length >= 0);
    const expired = await db.query('SELECT * FROM public.pharmacy_expired_stock($1)', [clinic]);
    assert.equal(expired.rows.length, 0);
  });

  await t.test('a purchase line teaches the master a pack size it does not have', async () => {
    const other = randomUUID();
    await db.query(
      `INSERT INTO public.medicines_master (id, name, dosage_form, category, current_stock, clinic_id)
       VALUES ($1, 'Amoxycillin 250', 'capsule', 'antibiotic', 0, $2)`, [other, clinic]);
    const receipt = randomUUID();
    await db.query(
      `INSERT INTO public.pharmacy_inward_receipts (id, invoice_number, clinic_id) VALUES ($1, 'INV-1', $2)`,
      [receipt, clinic]);
    await db.query(
      `INSERT INTO public.pharmacy_inward_items
         (receipt_id, medicine_id, quantity, pack_size, unit_cost_price, hsn_code, gst_rate, clinic_id)
       VALUES ($1, $2, 5, 15, 40, '3004', 5, $3)`, [receipt, other, clinic]);

    const row = (await db.query(
      'SELECT pack_size, hsn_code, gst_rate FROM public.medicines_master WHERE id = $1', [other])).rows[0];
    assert.equal(n(row.pack_size), 15);
    assert.equal(row.hsn_code, '3004');
    assert.equal(n(row.gst_rate), 5);

    // A second purchase quoting a different pack must not overwrite it.
    await db.query(
      `INSERT INTO public.pharmacy_inward_items
         (receipt_id, medicine_id, quantity, pack_size, unit_cost_price, clinic_id)
       VALUES ($1, $2, 1, 10, 40, $3)`, [receipt, other, clinic]);
    const after = (await db.query(
      'SELECT pack_size FROM public.medicines_master WHERE id = $1', [other])).rows[0];
    assert.equal(n(after.pack_size), 15, 'a pack size already on file is left alone');
  });

  await t.test('pack size must be positive', async () => {
    await assert.rejects(
      db.query('UPDATE public.medicines_master SET pack_size = 0 WHERE id = $1', [med]),
      /pack_size/);
  });
});
