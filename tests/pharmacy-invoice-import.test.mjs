import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { freshDb, applyMigration, n } from './helpers/pharmacy-baseline.mjs';

async function loadTs(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { cleanExtraction, PHARMACY_SCHEMA } = await loadTs('../supabase/functions/_shared/pharmacy-extraction.ts');
const { mergeInvoicePages, possibleDuplicateLines, normalizeInvoiceNumber, invoiceHeaderReview } = await loadTs('../src/utils/pharmacyImport.ts');
const { computeGstLine } = await loadTs('../src/utils/gst.ts');

test('sample columns preserve MRP, old MRP, 5% GST, discount and printed line totals', () => {
  const result = cleanExtraction({ complete: true, visibleRowCount: 1, invoiceInfo: { invoiceNumber: '177', totalAmount: null }, medicines: [{
    medicineName: 'ASTHALIN 2 TAB', serialNumber: '1', quantity: 1, unitCostPrice: 9.94,
    mrp: 13.04, oldMrp: null, discountPercent: 5, discountAmount: null, gstRate: 5,
    totalCostPrice: 9.94, taxableAmount: 9.44, netAmount: 9.92, hsnCode: '300490', rack: 'A1'
  }] });
  const row = result.medicines[0];
  assert.equal(row.mrp, 13.04); assert.equal(row.oldMrp, null); assert.equal(row.gstRate, 5);
  assert.equal(row.discountAmount, null); assert.equal(row.taxableAmount, 9.44); assert.equal(row.netAmount, 9.92);
  const calculated = computeGstLine({ quantity: row.quantity, unitPrice: row.unitCostPrice, discountPercent: row.discountPercent, gstRate: row.gstRate, priceIncludesGst: false });
  assert.equal(calculated.taxable, 9.44); assert.equal(calculated.total, 9.91);
  // The supplier's 1-paisa rounding difference stays visible, not overwritten.
  assert.equal(row.netAmount, 9.92);
});
test('unknown fields remain unknown and incomplete model responses fail', () => {
  const result = cleanExtraction({ complete: true, visibleRowCount: 1, medicines: [{ medicineName: '', quantity: null, unitCostPrice: null }] });
  assert.equal(result.medicines.length, 1);
  assert.equal(result.medicines[0].gstRate, null);
  assert.equal(result.medicines[0].mrp, null);
  assert.equal(result.medicines[0].quantity, null);
  assert.throws(() => cleanExtraction({ complete: true, visibleRowCount: 15, medicines: Array(12).fill({}) }), /Incomplete/);
  assert.throws(() => cleanExtraction({ complete: false, visibleRowCount: 1, medicines: [{}] }), /Incomplete/);
  const wire = cleanExtraction({ complete: true, visibleRowCount: 1, invoiceInfo: { roundOff: -0.12 }, medicines: [{ medicineName: '', quantity: -1, unitCostPrice: -1, gstRate: -1 }] });
  assert.equal(wire.medicines[0].gstRate, null);
  assert.equal(wire.medicines[0].quantity, null);
  assert.equal(wire.invoiceInfo.roundOff, -0.12);
  const countUnions = value => value && typeof value === 'object' ? (Array.isArray(value.type) ? 1 : 0) + Object.values(value).reduce((n, child) => n + countUnions(child), 0) : 0;
  assert.ok(countUnions(PHARMACY_SCHEMA) <= 16, 'Claude strict schema union limit');
});
test('15 pages retain every row, single invoice total and separate repeated batches', () => {
  const pages = Array.from({ length: 15 }, (_, i) => ({ key: `hash:${i + 1}`, fileName: 'bill.pdf', page: i + 1, status: 'complete', data: {
    invoiceInfo: { invoiceNumber: '177', totalAmount: 1500 },
    medicines: Array.from({ length: 20 }, (_, j) => ({ medicineName: `Product ${j}`, quantity: 1, unitCostPrice: 5, batchNumber: `B${i}` }))
  } }));
  const merged = mergeInvoicePages(pages);
  assert.equal(merged.medicines.length, 300); assert.equal(merged.invoiceInfo.totalAmount, 1500);
  assert.equal(new Set(merged.medicines.map(m => m.sourceKey)).size, 300);
  assert.deepEqual(merged.warnings, []);
  assert.deepEqual(possibleDuplicateLines(merged.medicines), []);
  pages[14].data.invoiceInfo.invoiceNumber = '178';
  assert.match(mergeInvoicePages(pages).warnings[0], /conflicting invoiceNumber/);
});

test('header review ignores OCR spacing, preserves real differences and invalidates stale confirmation', () => {
  assert.equal(normalizeInvoiceNumber('177 /Credit'), normalizeInvoiceNumber('177/Credit'));
  assert.notEqual(normalizeInvoiceNumber('177/Credit'), normalizeInvoiceNumber('177'));
  const pages = Array.from({ length: 15 }, (_, i) => ({ key: `file:${i + 1}`, page: i + 1,
    fileName: 'bill.pdf', status: 'complete', data: { medicines: Array(i === 14 ? 3 : 15).fill({ medicineName: 'Product' }),
      invoiceInfo: { supplierName: 'Seller A', supplierGstin: 'GST-A', invoiceNumber: i % 2 ? '177 /Credit' : '177/Credit', invoiceDate: '2026-10-21' } } }));
  const header = { supplierId: 'selected-supplier', supplierGstin: 'GST-A', invoiceNumber: '177', invoiceDate: '2026-10-21' };
  assert.deepEqual(invoiceHeaderReview(pages, header).conflicts, []);
  assert.ok(!mergeInvoicePages(pages).warnings.some(w => w.includes('conflicting invoiceNumber')));
  for (const i of [6, 9, 14]) pages[i].data.invoiceInfo = { ...pages[i].data.invoiceInfo, supplierName: 'Seller B', supplierGstin: 'GST-B', invoiceNumber: '177' };
  const reviewed = invoiceHeaderReview(pages, header);
  assert.deepEqual(reviewed.conflicts, ['invoiceNumber', 'supplierGstin', 'supplierName']);
  assert.equal(mergeInvoicePages(pages).medicines.length, 213);
  assert.equal(invoiceHeaderReview(JSON.parse(JSON.stringify(pages)), { ...header }).signature, reviewed.signature, 'saved drafts retain the confirmation');
  assert.notEqual(invoiceHeaderReview(pages, { ...header, supplierId: 'different-supplier' }).signature, reviewed.signature);
  assert.notEqual(invoiceHeaderReview(pages, { ...header, invoiceDate: '2026-10-22' }).signature, reviewed.signature);
  pages[0].data.invoiceInfo.supplierGstin = 'CORRECTED-GST';
  assert.notEqual(invoiceHeaderReview(pages, header).signature, reviewed.signature, 'retrying a page requires fresh confirmation');
  assert.notEqual(invoiceHeaderReview([...pages, { key: 'part-2', status: 'pending', page: 1 }], header).signature, reviewed.signature);
});

async function setup(t) {
  const ctx = await freshDb(); t.after(() => ctx.db.close());
  for (const migration of ['20261019130000_pharmacy_pack_dispense_units.sql', '20261019140000_pharmacy_purchase_corrections.sql', '20261022120000_pharmacy_invoice_imports.sql', '20261022121000_pharmacy_invoice_import_permissions.sql']) await applyMigration(ctx.db, migration);
  const supplier = randomUUID(), medicine = randomUUID();
  await ctx.db.query('INSERT INTO suppliers (id, name, clinic_id) VALUES ($1, $2, $3)', [supplier, 'Supplier', ctx.clinic]);
  await ctx.db.query('INSERT INTO medicines_master (id, name, clinic_id, current_stock) VALUES ($1, $2, $3, 0)', [medicine, 'ASTHALIN', ctx.clinic]);
  const header = { supplierId: supplier, invoiceNumber: '177', invoiceDate: '2026-10-21', roundOff: 0, isInterstate: false };
  const item = { medicineId: medicine, sourceKey: 'file:1:0', quantity: 1, freeQuantity: 0, packSize: 10, unitCostPrice: 100, gstRate: 5, mrp: 150, discountPercent: 10, discountAmount: 0, batchNumber: 'B1', expiryDate: '2028-02-29', source: { page: 1 } };
  const draft = async (target = null, payload = { pages: [] }) => (await ctx.db.query('INSERT INTO pharmacy_invoice_imports (clinic_id, target_receipt_id, payload) VALUES ($1, $2, $3) RETURNING id', [ctx.clinic, target, JSON.stringify(payload)])).rows[0].id;
  const post = async (id, rows = [item], head = header, revision = 0) => (await ctx.db.query('SELECT post_pharmacy_invoice_import($1, $2, $3::jsonb, $4::jsonb) AS id', [id, revision, JSON.stringify(head), JSON.stringify(rows)])).rows[0].id;
  return { ...ctx, supplier, medicine, header, item, draft, post };
}
test('drafts do not move stock; finalize is atomic, idempotent and supports Part 2', async t => {
  const { db, medicine, draft, post, item } = await setup(t);
  const id = await draft();
  assert.equal(n((await db.query('SELECT current_stock FROM medicines_master WHERE id=$1', [medicine])).rows[0].current_stock), 0);
  const receipt = await post(id);
  assert.equal(await post(id), receipt);
  assert.equal(n((await db.query('SELECT current_stock FROM medicines_master WHERE id=$1', [medicine])).rows[0].current_stock), 1);
  assert.equal(n((await db.query('SELECT grand_total FROM pharmacy_inward_receipts WHERE id=$1', [receipt])).rows[0].grand_total), 94.5);
  const part2 = await draft(receipt);
  assert.equal(await post(part2, [{ ...item, quantity: 2, sourceKey: 'file:2:0' }]), receipt);
  assert.equal(n((await db.query('SELECT current_stock FROM medicines_master WHERE id=$1', [medicine])).rows[0].current_stock), 3);
  assert.equal(n((await db.query('SELECT grand_total FROM pharmacy_inward_receipts WHERE id=$1', [receipt])).rows[0].grand_total), 283.5);
  assert.equal((await db.query('SELECT * FROM pharmacy_inward_receipts')).rows.length, 1);
  const repeated = await draft(receipt);
  await assert.rejects(post(repeated), /already been posted/);
  assert.equal(n((await db.query('SELECT current_stock FROM medicines_master WHERE id=$1', [medicine])).rows[0].current_stock), 3);
});
test('failed pages, stale revisions, invalid lines and mismatched bills cannot post', async t => {
  const { db, draft, post, item, header } = await setup(t);
  await assert.rejects(post(await draft(null, { pages: [{ status: 'failed' }] })), /Finish all pages/);
  await assert.rejects(post(await draft(), [item], header, 7), /Draft changed/);
  const invalid = await draft();
  await assert.rejects(post(invalid, [item, { ...item, sourceKey: 'different', gstRate: null }]), /Invalid or unresolved/);
  assert.equal((await db.query('SELECT * FROM pharmacy_inward_receipts')).rows.length, 0, 'receipt and first stock insert roll back together');
  assert.equal((await db.query('SELECT * FROM pharmacy_inward_items')).rows.length, 0);
  const receipt = await post(await draft());
  await assert.rejects(post(await draft(receipt), [{ ...item, sourceKey: 'next' }], { ...header, invoiceNumber: 'wrong' }), /Continuation must match/);
  await assert.rejects(post(await draft()), /already exists/);
});
test('clinic isolation applies to posting and source medicine', async t => {
  const { db, draft, post, item } = await setup(t);
  const id = await draft();
  await db.query("SELECT set_config('test.clinic_ids', $1, false)", [randomUUID()]);
  await assert.rejects(post(id), /access denied/);
  await db.query("SELECT set_config('test.clinic_ids', '', false)");
  const other = randomUUID(), med = randomUUID();
  await db.query('INSERT INTO clinic_settings (id) VALUES ($1)', [other]);
  await db.query('INSERT INTO medicines_master (id, name, clinic_id) VALUES ($1, $2, $3)', [med, 'Other clinic medicine', other]);
  await assert.rejects(post(id, [{ ...item, medicineId: med }]), /Medicine access denied/);
});

test('supplier bill numbers are scoped by supplier and financial year', async t => {
  const { db, clinic, draft, post, item, header } = await setup(t);
  await post(await draft());
  await post(await draft(), [{ ...item, sourceKey: 'year2' }], { ...header, invoiceDate: '2027-04-01' });
  const supplier = randomUUID();
  await db.query('INSERT INTO suppliers (id, name, clinic_id) VALUES ($1, $2, $3)', [supplier, 'Second supplier', clinic]);
  await post(await draft(), [{ ...item, sourceKey: 'supplier2' }], { ...header, supplierId: supplier });
  assert.equal((await db.query('SELECT id FROM pharmacy_inward_receipts')).rows.length, 3);
});

test('draft RLS blocks another clinic and clients cannot mark a draft posted', async t => {
  const { db, clinic, user, draft, post } = await setup(t);
  const id = await draft();
  // The baseline lacks production table grants; grant only what the policies query.
  await db.exec('GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT ON clinic_settings, pharmacy_inward_receipts TO authenticated;');
  await db.exec('SET ROLE authenticated');
  assert.equal((await db.query('SELECT id FROM pharmacy_invoice_imports WHERE id=$1', [id])).rows.length, 1);
  await assert.rejects(db.query("UPDATE pharmacy_invoice_imports SET status='posted' WHERE id=$1", [id]), /row-level security/);
  await db.query("SELECT set_config('test.clinic_ids', $1, false)", [randomUUID()]);
  assert.equal((await db.query('SELECT id FROM pharmacy_invoice_imports WHERE id=$1', [id])).rows.length, 0);
  await assert.rejects(db.query('INSERT INTO pharmacy_invoice_imports (clinic_id, created_by) VALUES ($1,$2)', [clinic, user]), /row-level security/);
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('test.clinic_ids', '', false)");
  await post(id);
  await db.exec('SET ROLE authenticated');
  assert.equal((await db.query("UPDATE pharmacy_invoice_imports SET payload='{}' WHERE id=$1 RETURNING id", [id])).rows.length, 0);
  await db.exec('RESET ROLE');
});

test('import permissions remove explicit anonymous grants from database defaults', async t => {
  const { db } = await setup(t);
  await db.exec('GRANT ALL ON pharmacy_invoice_imports TO anon; GRANT EXECUTE ON FUNCTION post_pharmacy_invoice_import(uuid, integer, jsonb, jsonb) TO anon;');
  await applyMigration(db, '20261022121000_pharmacy_invoice_import_permissions.sql');
  const { rows: [access] } = await db.query(`SELECT
    has_function_privilege('anon', 'post_pharmacy_invoice_import(uuid,integer,jsonb,jsonb)', 'EXECUTE') AS anonymous_post,
    has_table_privilege('anon', 'pharmacy_invoice_imports', 'SELECT') AS anonymous_read,
    has_function_privilege('authenticated', 'post_pharmacy_invoice_import(uuid,integer,jsonb,jsonb)', 'EXECUTE') AS signed_in_post`);
  assert.deepEqual(access, { anonymous_post: false, anonymous_read: false, signed_in_post: true });
});
