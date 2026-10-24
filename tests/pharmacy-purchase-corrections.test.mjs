import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, applyMigration, n } from './helpers/pharmacy-baseline.mjs';

/** Dates come back from the driver as Date objects. */
const isoDate = d => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Correcting a saved purchase (migration 20261019140000) against real
 * PostgreSQL semantics. The scenario throughout is the one this exists for: an
 * AI-parsed supplier invoice was saved with the wrong numbers and has to be
 * put right afterwards, without disturbing anything that was already sold.
 */

/** A clinic with one medicine and one purchase of it, as the parser saved it. */
async function seedPurchase(db, { quantity = 10, free = 0, rate = 70, mrp = 100, gst = 18, hsn = '3004' } = {}) {
  const { db: _db, clinic, user } = { db, ...(await db.__ctx) };
  const med = randomUUID();
  await db.query(
    `INSERT INTO public.medicines_master (id, name, dosage_form, category, current_stock, clinic_id, gst_rate)
     VALUES ($1, 'Azithromycin 500', 'tablet', 'antibiotic', 0, $2, 12)`, [med, clinic]);

  const supplier = randomUUID();
  await db.query('INSERT INTO public.suppliers (id, name, clinic_id) VALUES ($1, $2, $3)',
    [supplier, 'Acme Distributors', clinic]);

  const receipt = randomUUID();
  await db.query(
    `INSERT INTO public.pharmacy_inward_receipts
       (id, supplier_id, invoice_number, supplier_invoice_date, uploaded_by, clinic_id, round_off)
     VALUES ($1, $2, 'ACME/1234', '2026-10-18', $3, $4, 0)`, [receipt, supplier, user, clinic]);

  // The parser's numbers: 10 strips at 70 ex-GST, GST read as 18% (it is 5%).
  const taxable = quantity * rate;
  const tax = taxable * (gst / 100);
  const item = randomUUID();
  await db.query(
    `INSERT INTO public.pharmacy_inward_items
       (id, receipt_id, medicine_id, quantity, free_quantity, pack_size, unit_cost_price, mrp,
        batch_number, expiry_date, hsn_code, gst_rate,
        taxable_amount, cgst_amount, sgst_amount, igst_amount, line_total, clinic_id)
     VALUES ($1, $2, $3, $4, $5, 10, $6, $7, 'AZ-77', '2028-06-30', $8, $9,
             $10, $11, $12, 0, $13, $14)`,
    [item, receipt, med, quantity, free, rate, mrp, hsn, gst,
     taxable, tax / 2, tax / 2, taxable + tax, clinic]);
  await db.query('SELECT public.resync_inward_receipt_totals($1)', [receipt]);

  const batch = (await db.query(
    'SELECT id FROM public.medicine_batches WHERE medicine_id = $1', [med])).rows[0].id;
  return { med, supplier, receipt, item, batch, clinic, user };
}

async function ctx() {
  const { db, clinic, user } = await freshDb();
  await applyMigration(db, '20261019130000_pharmacy_pack_dispense_units.sql');
  await applyMigration(db, '20261019140000_pharmacy_purchase_corrections.sql');
  db.__ctx = Promise.resolve({ clinic, user });
  return { db, clinic, user };
}

test('a mis-parsed purchase can be corrected after it was saved', async t => {
  const { db } = await ctx();
  t.after(() => db.close());
  const { med, receipt, item, batch } = await seedPurchase(db);

  await t.test('the parser left the master taxed at the wrong rate', async () => {
    const m = (await db.query('SELECT gst_rate, current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0];
    assert.equal(n(m.gst_rate), 18, 'the insert trigger pushed the wrong 18% onto the master');
    assert.equal(n(m.current_stock), 10);
  });

  await t.test('correcting the rate fixes the line, the receipt and the master', async () => {
    // 10 strips at 70, GST actually 5%: taxable 700, CGST 17.50, SGST 17.50.
    await db.query('SELECT public.correct_inward_item($1, $2::jsonb, $3)', [
      item,
      JSON.stringify({
        gst_rate: 5, hsn_code: '3003',
        taxable_amount: 700, cgst_amount: 17.5, sgst_amount: 17.5, igst_amount: 0,
        line_total: 735
      }),
      'GST mis-read by the parser; supplier invoice says 5%'
    ]);

    const line = (await db.query(
      'SELECT gst_rate, hsn_code, taxable_amount, cgst_amount, line_total FROM public.pharmacy_inward_items WHERE id = $1',
      [item])).rows[0];
    assert.equal(n(line.gst_rate), 5);
    assert.equal(line.hsn_code, '3003');
    assert.equal(n(line.cgst_amount), 17.5);
    assert.equal(n(line.line_total), 735);

    const head = (await db.query(
      'SELECT taxable_amount, cgst_amount, sgst_amount, grand_total, total_amount FROM public.pharmacy_inward_receipts WHERE id = $1',
      [receipt])).rows[0];
    assert.equal(n(head.taxable_amount), 700, 'the ITC in the inward register follows the line');
    assert.equal(n(head.cgst_amount), 17.5);
    assert.equal(n(head.grand_total), 735);
    assert.equal(n(head.total_amount), 735);

    const m = (await db.query(
      'SELECT gst_rate, hsn_code FROM public.medicines_master WHERE id = $1', [med])).rows[0];
    assert.equal(n(m.gst_rate), 5, 'the master is un-corrupted, so future sales are taxed right');
    assert.equal(m.hsn_code, '3003');
  });

  await t.test('a corrected rate and MRP reach the batch the stock sits in', async () => {
    await db.query('SELECT public.correct_inward_item($1, $2::jsonb, $3)', [
      item,
      JSON.stringify({ unit_cost_price: 64, mrp: 112.5, taxable_amount: 640, cgst_amount: 16, sgst_amount: 16, line_total: 672 }),
      'rate and MRP mis-read'
    ]);
    const b = (await db.query(
      'SELECT mrp, purchase_rate FROM public.medicine_batches WHERE id = $1', [batch])).rows[0];
    assert.equal(n(b.mrp), 112.5, 'the counter reads MRP from the batch, so it has to follow');
    assert.equal(n(b.purchase_rate), 64, 'margin on everything sold from this batch is now right');
  });

  await t.test('every correction is on the record', async () => {
    const { rows } = await db.query(
      `SELECT action, reason, before_row, after_row, corrected_by
         FROM public.pharmacy_inward_corrections
        WHERE item_id = $1 ORDER BY corrected_at`, [item]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].action, 'correct');
    assert.match(rows[0].reason, /mis-read/);
    assert.equal(n(rows[0].before_row.gst_rate), 18, 'the wrong value is kept, not erased');
    assert.equal(n(rows[0].after_row.gst_rate), 5);
    assert.ok(rows[0].corrected_by, 'the correction is attributed');
  });
});

test('correcting a quantity moves stock, and is refused when the goods are gone', async t => {
  const { db, clinic, user } = await ctx();
  t.after(() => db.close());
  const { med, item, batch, receipt } = await seedPurchase(db, { quantity: 10 });

  await t.test('raising the quantity adds the difference to stock and to the batch', async () => {
    await db.query('SELECT public.correct_inward_item($1, $2::jsonb, $3)', [
      item,
      JSON.stringify({ quantity: 12, taxable_amount: 840, cgst_amount: 21, sgst_amount: 21, line_total: 882 }),
      'invoice says 12 strips'
    ]);
    assert.equal(n((await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0].current_stock), 12);
    assert.equal(n((await db.query('SELECT quantity FROM public.medicine_batches WHERE id = $1', [batch])).rows[0].quantity), 12);
  });

  await t.test('the adjustment is logged as a movement, not applied silently', async () => {
    const { rows } = await db.query(
      `SELECT quantity_change, new_stock_level, remarks FROM public.stock_movement_log
        WHERE reference_type = 'inward_correction' ORDER BY movement_date DESC LIMIT 1`);
    assert.equal(n(rows[0].quantity_change), 2);
    assert.equal(n(rows[0].new_stock_level), 12);
    assert.match(rows[0].remarks, /12 strips/);
  });

  await t.test('lowering it below what is still on the shelf is refused', async () => {
    // Sell 9 strips, leaving 3 of the 12.
    await db.query(
      `INSERT INTO public.pharmacy_dispensed_items
         (medicine_id, quantity, billed_quantity, billed_unit, dispensed_by, selling_price_at_dispense, batch_id, clinic_id)
       VALUES ($1, 9, 9, 'Strip', $2, 100, $3, $4)`, [med, user, batch, clinic]);
    assert.equal(n((await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0].current_stock), 3);

    await assert.rejects(
      db.query('SELECT public.correct_inward_item($1, $2::jsonb, $3)',
        [item, JSON.stringify({ quantity: 2 }), 'typo']),
      /already been issued|only 3 left in it/,
      'the 10 strips it would remove have mostly been sold'
    );
    // Nothing moved.
    assert.equal(n((await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0].current_stock), 3);
    assert.equal(n((await db.query('SELECT quantity FROM public.pharmacy_inward_items WHERE id = $1', [item])).rows[0].quantity), 12);
  });

  await t.test('a quantity still covered by stock goes through', async () => {
    await db.query('SELECT public.correct_inward_item($1, $2::jsonb, $3)',
      [item, JSON.stringify({ quantity: 10, taxable_amount: 700, cgst_amount: 17.5, sgst_amount: 17.5, line_total: 735 }), 'back to 10']);
    assert.equal(n((await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0].current_stock), 1);
    const head = (await db.query('SELECT grand_total FROM public.pharmacy_inward_receipts WHERE id = $1', [receipt])).rows[0];
    assert.equal(n(head.grand_total), 735);
  });

  await t.test('a zero quantity is pushed towards removing the line instead', async () => {
    await assert.rejects(
      db.query('SELECT public.correct_inward_item($1, $2::jsonb, $3)',
        [item, JSON.stringify({ quantity: 0 }), 'nope']),
      /remove the line instead/);
  });

  await t.test('free quantity counts as received stock', async () => {
    await db.query('SELECT public.correct_inward_item($1, $2::jsonb, $3)',
      [item, JSON.stringify({ free_quantity: 2 }), 'scheme: 10 + 2 free']);
    assert.equal(n((await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0].current_stock), 3);
  });
});

test('a line the parser invented can be removed', async t => {
  const { db, clinic, user } = await ctx();
  t.after(() => db.close());
  const { med, item, receipt, batch } = await seedPurchase(db, { quantity: 4 });

  await t.test('removing it reverses the stock it brought in and empties the receipt', async () => {
    await db.query('SELECT public.delete_inward_item($1, $2)', [item, 'Line is not on the invoice at all']);
    assert.equal(n((await db.query('SELECT current_stock FROM public.medicines_master WHERE id = $1', [med])).rows[0].current_stock), 0);
    assert.equal(n((await db.query('SELECT quantity FROM public.medicine_batches WHERE id = $1', [batch])).rows[0].quantity), 0);
    assert.equal((await db.query('SELECT id FROM public.pharmacy_inward_items WHERE id = $1', [item])).rows.length, 0);

    const head = (await db.query(
      'SELECT taxable_amount, cgst_amount, grand_total FROM public.pharmacy_inward_receipts WHERE id = $1', [receipt])).rows[0];
    assert.equal(n(head.taxable_amount), 0, 'the ITC claimed for the invoice drops to nothing');
    assert.equal(n(head.grand_total), 0);
  });

  await t.test('the removal is kept, with the line it deleted', async () => {
    const { rows } = await db.query(
      `SELECT action, reason, before_row, after_row FROM public.pharmacy_inward_corrections WHERE item_id = $1`, [item]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'delete');
    assert.equal(rows[0].after_row, null);
    assert.equal(n(rows[0].before_row.quantity), 4, 'the deleted line is recoverable from the audit row');
  });

  await t.test('a line whose goods have been sold cannot be removed', async () => {
    const second = await seedPurchase(db, { quantity: 6 });
    await db.query(
      `INSERT INTO public.pharmacy_dispensed_items
         (medicine_id, quantity, billed_quantity, billed_unit, dispensed_by, selling_price_at_dispense, batch_id, clinic_id)
       VALUES ($1, 5, 5, 'Strip', $2, 100, $3, $4)`, [second.med, user, second.batch, clinic]);
    await assert.rejects(
      db.query('SELECT public.delete_inward_item($1, $2)', [second.item, 'oops']),
      /only 1 are left|only 1 of the 6/);
  });
});

test('stock already on the shelf can be re-priced', async t => {
  const { db } = await ctx();
  t.after(() => db.close());
  const { batch } = await seedPurchase(db, { mrp: 100 });

  await t.test('MRP and expiry can be corrected on the batch', async () => {
    await db.query('SELECT public.update_batch_pricing($1, $2, $3, $4)', [batch, 125.5, '2029-01-31', false]);
    const b = (await db.query('SELECT mrp, expiry_date, purchase_rate FROM public.medicine_batches WHERE id = $1', [batch])).rows[0];
    assert.equal(n(b.mrp), 125.5);
    assert.equal(isoDate(b.expiry_date), '2029-01-31');
    assert.equal(n(b.purchase_rate), 70, 'the cost side is untouched — it belongs to the purchase line');
  });

  await t.test('omitted fields are left alone', async () => {
    await db.query('SELECT public.update_batch_pricing($1, $2, $3, $4)', [batch, 130, null, false]);
    const b = (await db.query('SELECT mrp, expiry_date FROM public.medicine_batches WHERE id = $1', [batch])).rows[0];
    assert.equal(n(b.mrp), 130);
    assert.equal(isoDate(b.expiry_date), '2029-01-31', 'passing no expiry must not wipe it');
  });

  await t.test('an expiry can be cleared deliberately', async () => {
    await db.query('SELECT public.update_batch_pricing($1, $2, $3, $4)', [batch, null, null, true]);
    const b = (await db.query('SELECT mrp, expiry_date FROM public.medicine_batches WHERE id = $1', [batch])).rows[0];
    assert.equal(b.expiry_date, null);
    assert.equal(n(b.mrp), 130, 'clearing the expiry must not touch the price');
  });

  await t.test('a negative MRP is refused', async () => {
    await assert.rejects(
      db.query('SELECT public.update_batch_pricing($1, $2, $3, $4)', [batch, -5, null, false]),
      /MRP cannot be negative/);
  });
});

test('corrections are tenant-scoped', async t => {
  const { db } = await ctx();
  t.after(() => db.close());
  const { item, batch } = await seedPurchase(db);

  // Pretend to be signed in to some other clinic (see user_clinic_ids() in the
  // harness); the rows stay, so this is a permission test, not a cascade test.
  await db.query("SELECT set_config('test.clinic_ids', $1, false)", [randomUUID()]);

  await assert.rejects(
    db.query('SELECT public.correct_inward_item($1, $2::jsonb, $3)', [item, JSON.stringify({ gst_rate: 5 }), 'x']),
    /Not allowed for this clinic/);
  await assert.rejects(
    db.query('SELECT public.delete_inward_item($1, $2)', [item, 'x']),
    /Not allowed for this clinic/);
  await assert.rejects(
    db.query('SELECT public.update_batch_pricing($1, $2, $3, $4)', [batch, 10, null, false]),
    /Not allowed for this clinic/);
});
