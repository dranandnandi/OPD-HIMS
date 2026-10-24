import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { freshDb, applyMigration, n } from './helpers/pharmacy-baseline.mjs';

async function load(path) {
  const bundled = await build({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}
const { toStockUnits, stockBreakdown, packSpec } = await load('src/utils/packUnits.ts');
const { computeGstLine, sumGstLines } = await load('src/utils/gst.ts');

test('one tablet is billed at 11.39 without whole-rupee rounding', () => {
  const line = computeGstLine({ quantity: 1, unitPrice: 11.39, gstRate: 5, priceIncludesGst: true });
  assert.equal(sumGstLines([line], false).grandTotal, 11.39);
  assert.equal(sumGstLines([line], false).roundOff, 0);
  assert.equal(stockBreakdown(toStockUnits(14, 15), packSpec({packSize:15,stockUnit:'Strip',dispenseUnit:'Tablet'})), '14 Tablet');
  assert.equal(packSpec({ name: 'A TO Z TAB', dosageForm: 'other', packSize: 15 }).dispenseUnit, 'Tablet');
  assert.equal(packSpec({ name: 'Example CAP', dosageForm: 'other' }).dispenseUnit, 'Capsule');
  assert.equal(packSpec({ name: 'Unknown product', dosageForm: 'other' }).dispenseUnit, 'Unit');
  assert.equal(packSpec({ name: 'Example TAB', dispenseUnit: 'Dose' }).dispenseUnit, 'Dose');
});

test('individual loose sales consume exactly the available packs and returns restore them', async t => {
  const { db, clinic, user } = await freshDb();
  t.after(() => db.close());
  await applyMigration(db, '20261019130000_pharmacy_pack_dispense_units.sql');
  await applyMigration(db, '20261019150000_ipd_dispense_stock_fixes.sql');
  await applyMigration(db, '20261024180000_pharmacy_loose_stock_precision.sql');

  for (const pack of [3, 7, 15, 30]) {
    await t.test(`all tablets in a pack of ${pack}, with old and new clients`, async () => {
      const med = randomUUID(), batch = randomUUID();
      await db.query(`INSERT INTO medicines_master (id,name,clinic_id,current_stock,pack_size,stock_unit,dispense_unit)
        VALUES ($1,'Test Tablet',$2,1,$3,'Strip','Tablet')`, [med,clinic,pack]);
      await db.query(`INSERT INTO medicine_batches (id,clinic_id,medicine_id,batch_number,quantity)
        VALUES ($1,$2,$3,'TEST',1)`, [batch,clinic,med]);
      const sell = (quantity) => db.query(`INSERT INTO pharmacy_dispensed_items
        (medicine_id,clinic_id,batch_id,dispensed_by,quantity,pack_size,billed_quantity,billed_unit,selling_price_at_dispense)
        VALUES ($1,$2,$3,$4,$5,$6,1,'Tablet',11.39) RETURNING quantity`, [med,clinic,batch,user,quantity,pack]);
      for (let i=0;i<pack;i++) {
        // Older browser tabs send only 3 decimals; the server must fix those too.
        await sell(i%2 ? toStockUnits(1,pack) : Math.round(1000/pack)/1000);
        const remaining = (await db.query('SELECT current_stock FROM medicines_master WHERE id=$1',[med])).rows[0];
        assert.equal(Math.round(n(remaining.current_stock)*pack*1000)/1000, pack-i-1);
      }
      assert.equal(n((await db.query('SELECT quantity FROM medicine_batches WHERE id=$1',[batch])).rows[0].quantity),0);
      assert.equal(n((await db.query('SELECT current_stock FROM medicines_master WHERE id=$1',[med])).rows[0].current_stock),0);
      await assert.rejects(sell(toStockUnits(1,pack)), /Insufficient stock/);
      // The refund/restock path adds stored sale quantities, preserving the
      // exact tablet count even though a fractional pack repeats in decimal.
      const sales = (await db.query('SELECT quantity FROM pharmacy_dispensed_items WHERE medicine_id=$1',[med])).rows;
      for (const sale of sales) {
        await db.query('UPDATE medicine_batches SET quantity=quantity+$1 WHERE id=$2',[sale.quantity,batch]);
        await db.query('UPDATE medicines_master SET current_stock=current_stock+$1 WHERE id=$2',[sale.quantity,med]);
      }
      assert.equal(n((await db.query('SELECT current_stock FROM medicines_master WHERE id=$1',[med])).rows[0].current_stock),1);
      assert.equal(n((await db.query('SELECT quantity FROM medicine_batches WHERE id=$1',[batch])).rows[0].quantity),1);
    });
  }
  await t.test('whole strips and invoice lines preserve their quantity semantics', async () => {
    const med=randomUUID(), bill=randomUUID();
    await db.query(`INSERT INTO medicines_master (id,name,clinic_id,current_stock,pack_size) VALUES ($1,'Tablet',$2,3,15)`,[med,clinic]);
    await db.query('INSERT INTO bills (id,clinic_id) VALUES ($1,$2)',[bill,clinic]);
    const write = (qty,billed,unit) => db.query(`INSERT INTO bill_items
      (bill_id,item_name,medicine_id,quantity,pack_size,billed_quantity,billed_unit)
      VALUES ($1,'Tablet',$2,$3,15,$4,$5) RETURNING quantity`,[bill,med,qty,billed,unit]);
    assert.equal(n((await write(1,1,'Strip')).rows[0].quantity),1);
    assert.equal(n((await write(0.067,1,'Tablet')).rows[0].quantity),toStockUnits(1,15));
    assert.equal(n((await write(0.5,7.5,'Tablet')).rows[0].quantity),0.5);
  });
});
