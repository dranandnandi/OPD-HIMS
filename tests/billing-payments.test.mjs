import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

const bundled = await build({
  entryPoints: ['src/utils/billingPayments.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { canReceiveBillPayment, validateBillPayment } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const reception = { roleName: 'receptionist', permissions: ['reception', 'opd_billing', 'modules_assigned'] };
const pending = { paymentStatus: 'pending', balanceAmount: 1000 };

test('pharmacy-only users collect pharmacy balances without gaining OPD access', () => {
  const pharmacist = { roleName: 'pharmacist', permissions: ['pharmacy', 'modules_assigned'] };
  assert.equal(canReceiveBillPayment(pharmacist, { ...pending, billType: 'pharmacy' }), true);
  assert.equal(canReceiveBillPayment(pharmacist, { ...pending, billType: 'opd' }), false);
});

test('reception can collect without invoice editing rights', () => {
  assert.equal(canReceiveBillPayment(reception, pending), true);
  assert.equal(canReceiveBillPayment({ ...reception, roleName: 'nurse_reception' }, pending), true);
  assert.equal(canReceiveBillPayment({ roleName: 'admin', permissions: [] }, pending), true);
  assert.equal(canReceiveBillPayment(null, pending), false);
  assert.equal(canReceiveBillPayment({ roleName: 'nurse', permissions: ['modules_assigned', 'opd_visits'] }, pending), false);
  assert.equal(canReceiveBillPayment({ ...reception, permissions: ['reception', 'modules_assigned'] }, pending), false);
});

test('only outstanding pending, partial and overdue bills accept collection', () => {
  for (const paymentStatus of ['pending', 'partial', 'overdue']) {
    assert.equal(canReceiveBillPayment(reception, { ...pending, paymentStatus }), true);
  }
  for (const paymentStatus of ['paid', 'cancelled']) {
    assert.equal(canReceiveBillPayment(reception, { ...pending, paymentStatus }), false);
    assert.ok(validateBillPayment({ ...pending, paymentStatus }, 100));
  }
  assert.equal(canReceiveBillPayment(reception, { ...pending, balanceAmount: 0 }), false);
});

test('full and partial payments pass; invalid and stale excessive amounts fail', () => {
  assert.equal(validateBillPayment(pending, 1000), null);
  assert.equal(validateBillPayment(pending, 250.50), null);
  for (const amount of [0, -1, NaN, Infinity, 1000.01]) {
    assert.ok(validateBillPayment(pending, amount));
  }
  // Another cashier has collected 800 since the list was opened.
  assert.ok(validateBillPayment({ paymentStatus: 'partial', balanceAmount: 200 }, 1000));
  assert.equal(validateBillPayment({ paymentStatus: 'partial', balanceAmount: 200 }, 200), null);
});

test('existing receipt trigger updates pending -> partial -> paid without changing invoice totals', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TYPE bill_payment_status_enum AS ENUM ('pending', 'partial', 'paid', 'overdue', 'cancelled');
    CREATE TABLE bills (
      id uuid PRIMARY KEY, total_amount numeric, paid_amount numeric DEFAULT 0,
      balance_amount numeric, status bill_payment_status_enum DEFAULT 'pending',
      total_refunded_amount numeric DEFAULT 0, payment_method text,
      last_refund_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE payment_records (
      bill_id uuid REFERENCES bills(id), amount numeric, record_type text DEFAULT 'payment',
      payment_method text, payment_date timestamptz DEFAULT now(), created_at timestamptz DEFAULT now()
    );
    CREATE FUNCTION refresh_bill_refund_status_for_bill(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  `);
  await db.exec(await readFile('supabase/migrations/20261015000000_bill_payment_method_sync.sql', 'utf8'));
  await db.exec(`
    CREATE TRIGGER payment_insert AFTER INSERT ON payment_records
      FOR EACH ROW EXECUTE FUNCTION update_bill_paid_amount();
    INSERT INTO bills (id, total_amount, balance_amount)
      VALUES ('00000000-0000-0000-0000-000000000001', 1000, 1000);
  `);
  const collect = async (amount, method, date) => {
    await db.query(`INSERT INTO payment_records (bill_id, amount, payment_method, payment_date)
      VALUES ('00000000-0000-0000-0000-000000000001', $1, $2, $3)`, [amount, method, date]);
    return (await db.query('SELECT * FROM bills')).rows[0];
  };
  const partial = await collect(300, 'cash', '2026-10-23T10:00:00Z');
  assert.equal(partial.status, 'partial');
  assert.equal(Number(partial.paid_amount), 300);
  assert.equal(Number(partial.balance_amount), 700);
  const paid = await collect(700, 'upi', '2026-10-23T10:05:00Z');
  assert.equal(paid.status, 'paid');
  assert.equal(Number(paid.paid_amount), 1000);
  assert.equal(Number(paid.balance_amount), 0);
  assert.equal(Number(paid.total_amount), 1000);
  assert.equal(paid.payment_method, 'upi');
  assert.equal((await db.query('SELECT * FROM payment_records')).rows.length, 2);
});
