import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, applyMigration, n } from './helpers/pharmacy-baseline.mjs';

// Real PostgreSQL triggers/RPCs in memory. No live bills or stock are touched.
test('scheme purchases, supplier credits and batch adjustments', async t => {
  const { db, clinic, user } = await freshDb();
  t.after(() => db.close());
  await applyMigration(db, '20261019130000_pharmacy_pack_dispense_units.sql');
  await applyMigration(db, '20261019140000_pharmacy_purchase_corrections.sql');
  await applyMigration(db, '20261024180000_pharmacy_loose_stock_precision.sql');
  // Columns from the GST migration omitted by the minimal baseline helper.
  await db.exec(`
    ALTER TABLE suppliers ADD COLUMN gstin text;
    ALTER TABLE pharmacy_debit_notes
      ADD COLUMN against_receipt_id uuid REFERENCES pharmacy_inward_receipts(id),
      ADD COLUMN note_date date DEFAULT CURRENT_DATE, ADD COLUMN is_interstate boolean DEFAULT false,
      ADD COLUMN taxable_amount numeric DEFAULT 0, ADD COLUMN cgst_amount numeric DEFAULT 0,
      ADD COLUMN sgst_amount numeric DEFAULT 0, ADD COLUMN igst_amount numeric DEFAULT 0,
      ADD COLUMN round_off numeric DEFAULT 0, ADD COLUMN grand_total numeric DEFAULT 0;
    ALTER TABLE pharmacy_debit_note_items ADD COLUMN hsn_code text, ADD COLUMN gst_rate numeric DEFAULT 0,
      ADD COLUMN taxable_amount numeric DEFAULT 0, ADD COLUMN cgst_amount numeric DEFAULT 0,
      ADD COLUMN sgst_amount numeric DEFAULT 0, ADD COLUMN igst_amount numeric DEFAULT 0,
      ADD COLUMN line_total numeric DEFAULT 0;
    CREATE FUNCTION next_debit_note_number(uuid) RETURNS text LANGUAGE sql AS $$ SELECT gen_random_uuid()::text $$;
  `);
  await applyMigration(db, '20261026100000_pharmacy_scheme_returns.sql');
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  async function seed({ quantity = 10, free = 2, rate = 100, tax = 50, taxable = 1000, batched = true } = {}) {
    const med = randomUUID(), supplier = randomUUID(), receipt = randomUUID(), item = randomUUID();
    await db.query("INSERT INTO medicines_master(id,name,clinic_id,current_stock) VALUES($1,'Scheme medicine',$2,0)", [med,clinic]);
    await db.query("INSERT INTO suppliers(id,name,clinic_id) VALUES($1,'Distributor',$2)", [supplier,clinic]);
    await db.query("INSERT INTO pharmacy_inward_receipts(id,clinic_id,supplier_id,invoice_number,uploaded_by) VALUES($1,$2,$3,'SCHEME-1',$4)", [receipt,clinic,supplier,user]);
    await db.query(`INSERT INTO pharmacy_inward_items(id,receipt_id,medicine_id,clinic_id,quantity,free_quantity,
      unit_cost_price,batch_number,mrp,gst_rate,taxable_amount,cgst_amount,sgst_amount,line_total)
      VALUES($1,$2,$3,$4,$5,$6,$7,$11,150,5,$8,$9,$9,$10)`,
      [item,receipt,med,clinic,quantity,free,rate,taxable,tax/2,taxable+tax,batched ? 'BATCH-1' : null]);
    await db.query('SELECT resync_inward_receipt_totals($1)',[receipt]);
    const batch = (await one('SELECT batch_id FROM pharmacy_inward_items WHERE id=$1',[item])).batch_id;
    return { med,supplier,receipt,item,batch };
  }
  const payload = (s, paid=10, free=2, credit=1000, type='gst_credit') => ({
    receiptId:s.receipt,supplierId:s.supplier,reason:'Scheme return',creditType:type,
    creditReference:'SUPPLIER-CN-1',creditDate:new Date().toISOString().slice(0,10),
    items:[{inwardItemId:s.item,paidQuantity:paid,freeQuantity:free,creditAmount:credit}],
  });
  const save = async (p, id=randomUUID()) => (await one('SELECT save_pharmacy_supplier_return($1,$2,$3::jsonb) id',[clinic,id,JSON.stringify(p)])).id;
  const stock = async s => one('SELECT m.current_stock,b.quantity,b.effective_cost,b.purchase_rate FROM medicines_master m JOIN medicine_batches b ON b.medicine_id=m.id WHERE b.id=$1',[s.batch]);

  await t.test('10 paid plus 2 free adds 12 packs, values 1000, preserves invoice rate and MRP', async () => {
    const s=await seed(); const b=await stock(s);
    assert.equal(n(b.current_stock),12); assert.equal(n(b.quantity),12);
    assert.equal(n(b.purchase_rate),100); assert.ok(Math.abs(n(b.effective_cost)-1000/12)<1e-8);
    const v=await one('SELECT * FROM pharmacy_stock_valuation($1) WHERE medicine_id=$2',[clinic,s.med]);
    assert.equal(n(v.cost_value),1000);
    assert.equal(n((await one('SELECT grand_total FROM pharmacy_inward_receipts WHERE id=$1',[s.receipt])).grand_total),1050);
  });
  await t.test('full lot return removes 12 but credits only 10 paid packs; retry moves stock once',async()=>{
    const s=await seed(), p=payload(s), request=randomUUID();
    const id=await save(p,request); assert.equal(await save(p,request),id);
    const h=await one('SELECT * FROM pharmacy_debit_notes WHERE id=$1',[id]);
    assert.equal(n(h.grand_total),1050); assert.equal(n(h.taxable_amount),1000);
    assert.equal(n((await stock(s)).quantity),0); assert.equal(n((await stock(s)).current_stock),0);
    const r=await one('SELECT * FROM pharmacy_debit_note_items WHERE debit_note_id=$1',[id]);
    assert.equal(n(r.quantity),12); assert.equal(n(r.paid_quantity),10); assert.equal(n(r.free_quantity),2);
    assert.equal(n((await one("SELECT count(*) n FROM stock_movement_log WHERE reference_id=$1",[id])).n),1);
    await assert.rejects(save({...p,reason:'Different'},request),/different details/);
    assert.equal(n((await one('SELECT grand_total FROM pharmacy_inward_receipts WHERE id=$1',[s.receipt])).grand_total),1050);
  });
  await t.test('free-only zero-value return and later credit do not double-decrement stock',async()=>{
    const s=await seed(); const p=payload(s,0,2,0,'stock_only'); const id=await save(p);
    assert.equal(n((await stock(s)).quantity),10);
    assert.equal(n((await one('SELECT grand_total FROM pharmacy_debit_notes WHERE id=$1',[id])).grand_total),0);
    const settled={...p,noteId:id,creditType:'commercial_credit',items:[{...p.items[0],creditAmount:10}]};
    await save(settled);
    assert.equal(n((await stock(s)).quantity),10);
    const note=await one('SELECT * FROM pharmacy_debit_notes WHERE id=$1',[id]);
    assert.equal(n(note.grand_total),10); assert.equal(n(note.cgst_amount),0);
    const reg=await db.query("SELECT * FROM gst_inward_register($1,'2000-01-01','2100-01-01') WHERE document_id=$2",[clinic,id]);
    assert.equal(reg.rows.length,0);
    await assert.rejects(save(settled),/Only a pending supplier credit/);
  });
  await t.test('partial returns enforce paid/free buckets and remaining credit independently',async()=>{
    const s=await seed(); await save(payload(s,4,1,400));
    assert.equal(n((await stock(s)).quantity),7);
    await assert.rejects(save(payload(s,7,0,500)),/remaining purchased quantity/);
    await assert.rejects(save(payload(s,0,2,0)),/remaining purchased quantity/);
    await assert.rejects(save(payload(s,1,0,601)),/remaining net purchase value/);
    await save(payload(s,6,1,600)); assert.equal(n((await stock(s)).quantity),0);
  });
  await t.test('commercial credit can refund the invoice amount without reversing GST or duplicating credit',async()=>{
    const s=await seed();const id=await save(payload(s,5,1,1050,'commercial_credit'));
    const h=await one('SELECT * FROM pharmacy_debit_notes WHERE id=$1',[id]);
    assert.equal(n(h.grand_total),1050);assert.equal(n(h.taxable_amount),0);assert.equal(n(h.cgst_amount),0);
    await assert.rejects(save(payload(s,5,1,1)),/remaining net purchase value/);
    await save(payload(s,5,1,0,'stock_only'));
    assert.equal(n((await stock(s)).quantity),0);
  });
  await t.test('unbatched scheme purchases have effective cost and return only unbatched stock',async()=>{
    const s=await seed({batched:false});
    const v=await one('SELECT * FROM pharmacy_stock_valuation($1) WHERE medicine_id=$2',[clinic,s.med]);
    assert.equal(n(v.cost_value),1000);assert.equal(n(v.pooled_quantity),12);
    await save(payload(s));
    assert.equal(n((await one('SELECT current_stock FROM medicines_master WHERE id=$1',[s.med])).current_stock),0);
  });
  await t.test('legacy unallocated returns block ambiguous repeat returns; direct browser writes are revoked',async()=>{
    const s=await seed();const id=randomUUID();
    await db.query('INSERT INTO pharmacy_debit_notes(id,clinic_id,supplier_id) VALUES($1,$2,$3)',[id,clinic,s.supplier]);
    await db.query('INSERT INTO pharmacy_debit_note_items(clinic_id,debit_note_id,medicine_id,batch_id,quantity) VALUES($1,$2,$3,$4,1)',[clinic,id,s.med,s.batch]);
    await assert.rejects(save(payload(s,1,0,100)),/older unallocated return/);
    const permission=await one("SELECT has_table_privilege('authenticated','pharmacy_debit_note_items','INSERT') direct_write, has_function_privilege('authenticated','save_pharmacy_supplier_return(uuid,uuid,jsonb)','EXECUTE') rpc");
    assert.equal(permission.direct_write,false);assert.equal(permission.rpc,true);
  });
  await t.test('partial GST credits reconcile exact original paise on final return',async()=>{
    const s=await seed({quantity:3,free:0,rate:1,taxable:3,tax:0.14});
    for(let i=0;i<3;i++) await save(payload(s,1,0,1));
    const sum=await one('SELECT sum(cgst_amount) c,sum(sgst_amount) s,sum(line_total) t FROM pharmacy_debit_note_items WHERE inward_item_id=$1',[s.item]);
    assert.equal(n(sum.c),0.07);assert.equal(n(sum.s),0.07);assert.equal(n(sum.t),3.14);
  });
  await t.test('source validation, duplicate lines, missing credit reference and tenant guard roll back',async()=>{
    const s=await seed(), other=await seed();
    await assert.rejects(save({...payload(s),supplierId:other.supplier}),/belonging to this supplier/);
    await assert.rejects(save({...payload(s),items:payload(other).items}),/not on the selected purchase/);
    const p=payload(s); await assert.rejects(save({...p,items:[...p.items,...p.items]}),/only once/);
    await assert.rejects(save({...p,creditReference:''}),/reference is required/);
    await assert.rejects(save({...p,items:[{...p.items[0],paidQuantity:-1}]}),/whole packs/);
    await db.query("SELECT set_config('test.clinic_ids',$1,false)",[randomUUID()]);
    await assert.rejects(save(p),/Not authorised/);
    await db.query("SELECT set_config('test.clinic_ids','',false)");
    assert.equal(n((await stock(s)).quantity),12);
    assert.equal(n((await one('SELECT count(*) n FROM pharmacy_debit_notes WHERE against_receipt_id=$1',[s.receipt])).n),0);
  });
  await t.test('insufficient current batch stock rolls back note, items and movement',async()=>{
    const s=await seed();await db.query('UPDATE medicine_batches SET quantity=1 WHERE id=$1',[s.batch]);
    await assert.rejects(save(payload(s)),/Insufficient stock in the purchase batch/);
    assert.equal(n((await one('SELECT count(*) n FROM pharmacy_debit_notes WHERE against_receipt_id=$1',[s.receipt])).n),0);
    assert.equal(n((await stock(s)).current_stock),12);
  });
  await t.test('purchase corrections cannot invalidate recorded returns',async()=>{
    const s=await seed();await save(payload(s,1,0,100));
    await assert.rejects(db.query('SELECT correct_inward_item($1,$2::jsonb,$3)',[s.item,JSON.stringify({free_quantity:4}),'Correction']),/has supplier returns/);
    assert.equal(n((await stock(s)).quantity),11);
    assert.equal(n((await one('SELECT free_quantity FROM pharmacy_inward_items WHERE id=$1',[s.item])).free_quantity),2);
  });
  await t.test('manual adjustment changes batch/pool together, is idempotent, leaves purchase values intact',async()=>{
    const s=await seed(), request=randomUUID();
    const adjust=(delta,batch=s.batch,id=request)=>db.query('SELECT adjust_pharmacy_stock($1,$2,$3,$4,$5,$6)',[clinic,id,s.med,batch,delta,'Physical count correction']);
    await adjust(-0.066666666667);await adjust(-0.066666666667);
    const b=await stock(s);assert.equal(n(b.current_stock),11.933333333333);assert.equal(n(b.quantity),11.933333333333);
    await assert.rejects(adjust(-20,s.batch,randomUUID()),/insufficient stock/i);
    await assert.rejects(adjust(2,null,randomUUID()),/Select the batch/);
    const p=await one('SELECT grand_total FROM pharmacy_inward_receipts WHERE id=$1',[s.receipt]);assert.equal(n(p.grand_total),1050);
  });
  await t.test('saved sale cost survives later receipt corrections',async()=>{
    const s=await seed(),bill=randomUUID();
    await db.query("INSERT INTO bills(id,clinic_id,bill_type) VALUES($1,$2,'pharmacy')",[bill,clinic]);
    await db.query("INSERT INTO bill_items(bill_id,medicine_id,batch_id,item_name,quantity,clinic_id) VALUES($1,$2,$3,'Scheme medicine',1,$4)",[bill,s.med,s.batch,clinic]);
    await db.query('SELECT correct_inward_item($1,$2::jsonb,$3)',[s.item,JSON.stringify({free_quantity:5}),'Missed free packs']);
    assert.ok(Math.abs(n((await stock(s)).effective_cost)-1000/15)<1e-8);
    const line=await one('SELECT cost_price_at_sale FROM bill_items WHERE bill_id=$1',[bill]);
    assert.ok(Math.abs(n(line.cost_price_at_sale)-1000/12)<1e-8);
  });
});
