import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('pharmacy register pages, searches and totals only permitted clinic pharmacy bills', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const clinic = '00000000-0000-0000-0000-000000000001';
  const other = '00000000-0000-0000-0000-000000000002';
  await db.exec(`CREATE ROLE authenticated;
    CREATE TABLE patients(id uuid PRIMARY KEY, name text, phone text, patient_number text, age int, gender text, address text, created_at timestamptz);
    CREATE TABLE bills(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid, patient_id uuid, bill_type text, bill_number text, status text, visit_id uuid, bill_date timestamptz, total_amount numeric, balance_amount numeric);
    INSERT INTO patients VALUES ('${clinic}', 'Sample Customer', '1234567890', 'P1', 30, 'female', '', now());
    INSERT INTO bills(clinic_id,patient_id,bill_type,bill_number,status,bill_date,total_amount,balance_amount)
      SELECT '${clinic}','${clinic}','pharmacy','BILL-' || n,'pending','2026-10-24T10:00:00Z',100,50 FROM generate_series(1,28) n;
    INSERT INTO bills(clinic_id,bill_type,bill_number,status,bill_date,total_amount,balance_amount) VALUES
      ('${other}','pharmacy','OTHER','paid',now(),9999,0), ('${clinic}','opd','OPD','paid',now(),800,0),
      ('${clinic}','pharmacy','CANCELLED','cancelled','2026-10-23T10:00:00Z',800,800);
    UPDATE bills SET visit_id=gen_random_uuid() WHERE bill_number='BILL-1';
    ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_clinic ON bills USING (clinic_id = current_setting('test.clinic')::uuid);
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT ON bills,patients TO authenticated;`);
  await db.exec(await readFile('supabase/migrations/20261024190000_pharmacy_bill_register.sql','utf8'));
  await db.exec(`SET ROLE authenticated; SET test.clinic='${clinic}';`);
  const query = async (target=clinic, search='', status='all', source='all', from=null, to=null, page=0) =>
    (await db.query('SELECT pharmacy_bill_register($1,$2,$3,$4,$5,$6,$7) AS result',[target,search,status,source,from,to,page])).rows[0].result;
  const first = await query();
  assert.equal(first.total,29); assert.equal(first.bills.length,25); assert.equal(first.sales,2800); assert.equal(first.outstanding,1400);
  const second = await query(clinic,'','all','all',null,null,1);
  assert.equal(second.bills.length,4); assert.ok(second.bills.every(b => !first.bills.some(a => a.id===b.id)));
  assert.equal((await query(other)).total,0, 'RLS blocks explicitly requested other clinic');
  assert.equal((await query(clinic,'sample customer')).total,28);
  assert.equal((await query(clinic,'123456')).total,28);
  assert.equal((await query(clinic,'%')).total,0,'search metacharacters are literal');
  assert.equal((await query(clinic,'','all','visit')).total,1);
  assert.equal((await query(clinic,'','pending','counter')).total,27);
  assert.equal((await query(clinic,'','all','all','2026-10-24T00:00:00Z','2026-10-25T00:00:00Z')).total,28);
});
