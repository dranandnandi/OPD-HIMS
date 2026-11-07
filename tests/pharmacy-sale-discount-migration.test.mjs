import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('sale percentage migration preserves historical money and accepts only 0-100 percent', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('CREATE TABLE bill_items(id int PRIMARY KEY, discount numeric, total_price numeric); INSERT INTO bill_items VALUES(1,2.28,9.11);');
  await db.exec(await readFile('supabase/migrations/20261025090000_pharmacy_sale_discount_percent.sql', 'utf8'));
  assert.deepEqual((await db.query('SELECT * FROM bill_items')).rows[0], { id: 1, discount: '2.28', total_price: '9.11', sale_discount_percent: null });
  for (const value of [0, 20, 12.3456, 100]) {
    await db.query('UPDATE bill_items SET sale_discount_percent=$1 WHERE id=1', [value]);
    assert.equal(Number((await db.query('SELECT sale_discount_percent FROM bill_items')).rows[0].sale_discount_percent), value);
  }
  for (const value of [-1, 101, 'NaN', 'Infinity']) await assert.rejects(db.query('UPDATE bill_items SET sale_discount_percent=$1 WHERE id=1', [value]));
});
