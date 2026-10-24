import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(path) {
  const bundled = await build({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}
const { resolveDispensePrice } = await load('src/utils/dispensePrice.ts');
const { unitRate } = await load('src/utils/packUnits.ts');
const medicine = { id: 'medicine-a', sellingPrice: 184 };

test('counter sale takes the selected batch MRP before the saved medicine price', () => {
  assert.deepEqual(resolveDispensePrice(medicine, { medicineId: medicine.id, mrp: 200 }), {
    unitPrice: 200, source: 'batch',
  });
});

test('a missing or invalid batch MRP falls back to the saved medicine price', () => {
  // Existing stock includes NEXPRO RD 40 with a null batch MRP and saved price 184.
  for (const mrp of [undefined, null, 0, '0', '', -1, NaN, Infinity]) {
    assert.deepEqual(resolveDispensePrice(medicine, { medicineId: medicine.id, mrp }), {
      unitPrice: 184, source: 'medicine',
    });
  }
  assert.equal(resolveDispensePrice(medicine).unitPrice, 184, 'pool stock uses the saved price');
});

test('switching batches or clearing the batch does not retain the previous MRP', () => {
  const batches = [
    { medicineId: medicine.id, mrp: 200 },
    { medicineId: medicine.id, mrp: 220 },
    { medicineId: medicine.id, mrp: null },
    undefined,
  ];
  assert.deepEqual(batches.map(batch => resolveDispensePrice(medicine, batch).unitPrice), [200, 220, 184, 184]);
  assert.deepEqual(resolveDispensePrice({ id: 'medicine-b' }, batches[0]), { unitPrice: 0, source: 'missing' });
  assert.deepEqual(resolveDispensePrice(undefined, batches[0]), { unitPrice: 0, source: 'missing' });
});

test('numeric string prices become numbers; absent prices remain explicitly missing', () => {
  assert.equal(resolveDispensePrice(medicine, { medicineId: medicine.id, mrp: '200.50' }).unitPrice, 200.5);
  assert.equal(resolveDispensePrice({ ...medicine, sellingPrice: '184.00' }).unitPrice, 184);
  for (const sellingPrice of [null, undefined, 0, '', -1, NaN, Infinity]) {
    assert.deepEqual(resolveDispensePrice({ ...medicine, sellingPrice }), { unitPrice: 0, source: 'missing' });
  }
});

test('MRP stays a whole-pack price and is divided exactly once for loose tablets', () => {
  const { unitPrice } = resolveDispensePrice(medicine, { medicineId: medicine.id, mrp: 200 });
  assert.equal(unitRate(unitPrice, 10, false), 200);
  assert.equal(unitRate(unitPrice, 10, true), 20);
  assert.equal(5 * unitRate(unitPrice, 10, true), 100);
});
