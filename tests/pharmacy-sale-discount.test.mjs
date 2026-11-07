import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { noSaleDiscount, saleDiscountPercent, updateSaleDiscount } = await load('src/utils/saleDiscount.ts');
const { computeGstLine } = await load('src/utils/gst.ts');
const total = selection => computeGstLine({ quantity: 1, unitPrice: 170.85 / 15,
  discountPercent: saleDiscountPercent(selection), gstRate: 5, priceIncludesGst: true });

test('supplier discount or retained numeric discount cannot reduce a sale without opt-in', () => {
  for (const selection of [noSaleDiscount(), { discountPercent: 20, discountAmount: 2.28 }, { applySaleDiscount: false, discountPercent: 20 }]) {
    const line = total(selection);
    assert.equal(line.discount, 0); assert.equal(line.total, 11.39);
    assert.equal(line.taxable, 10.85); assert.equal(line.cgst + line.sgst, 0.54);
  }
});
test('explicit customer discount is charged once and removing it restores the MRP', () => {
  const chosen = updateSaleDiscount(noSaleDiscount(), { applySaleDiscount: true, discountPercent: 20 });
  assert.equal(total(chosen).discount, 2.28); assert.equal(total(chosen).total, 9.11);
  const removed = updateSaleDiscount(chosen, { applySaleDiscount: false });
  assert.deepEqual(removed, noSaleDiscount()); assert.equal(total(removed).total, 11.39);
  assert.equal(total(updateSaleDiscount(removed, { applySaleDiscount: true })).discount, 0);
});
test('choosing a different medicine clears the previous medicine customer discount', () => {
  const chosen = { applySaleDiscount: true, discountPercent: 20 };
  assert.deepEqual(updateSaleDiscount(chosen, {}, true), noSaleDiscount());
  assert.equal(total(updateSaleDiscount(chosen, {}, true)).total, 11.39);
  assert.deepEqual(updateSaleDiscount(chosen, {}, false), chosen, 'same medicine quantity/batch changes preserve intentional sale discount');
});
test('invalid discount input cannot make the amount negative or non-finite', () => {
  for (const discountPercent of [NaN, Infinity, -20]) assert.equal(total({ applySaleDiscount: true, discountPercent }).total, 11.39);
  assert.equal(total({ applySaleDiscount: true, discountPercent: 120 }).total, 0);
});
