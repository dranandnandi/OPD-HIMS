import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { freshDb, applyMigration, n } from './helpers/pharmacy-baseline.mjs';

const bundle = async file => {
  const result = await build({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};
const { fifoBatches, allocateFifoBatches } = await bundle('src/utils/pharmacyBatches.ts');
const { invoiceMedicineMatches } = await bundle('src/utils/invoiceMedicineMatching.ts');
const { stockDisplay, packSpec } = await bundle('src/utils/packUnits.ts');
const details = {
  patientName: 'Patient One', patientAddress: 'Patient address', prescriberName: 'Dr One',
  prescriberAddress: 'Prescriber address', prescriptionReference: 'RX-1', prescriptionDate: '2020-01-01',
  pharmacistName: 'Pharmacist One', pharmacistRegistration: 'REG-1', prescriptionVerified: true,
};

async function setup(t) {
  const state = await freshDb(); const { db } = state; t.after(() => db.close());
  await applyMigration(db, '20261019130000_pharmacy_pack_dispense_units.sql');
  await applyMigration(db, '20261019140000_pharmacy_purchase_corrections.sql');
  await applyMigration(db, '20261024180000_pharmacy_loose_stock_precision.sql');
  await db.exec(`ALTER TABLE clinic_settings ADD COLUMN clinic_name text DEFAULT 'Test Clinic', ADD COLUMN drug_license_number text, ADD COLUMN updated_at timestamptz DEFAULT now();
    ALTER TABLE profiles ADD COLUMN role_name text, ADD COLUMN permissions text[];
    UPDATE profiles SET role_name='pharmacist',permissions=ARRAY['modules_assigned','pharmacy'];
    ALTER TABLE suppliers ADD COLUMN gstin text;
    ALTER TABLE pharmacy_debit_notes ADD COLUMN against_receipt_id uuid REFERENCES pharmacy_inward_receipts(id),
      ADD COLUMN note_date date DEFAULT CURRENT_DATE, ADD COLUMN is_interstate boolean DEFAULT false,
      ADD COLUMN taxable_amount numeric DEFAULT 0, ADD COLUMN cgst_amount numeric DEFAULT 0,
      ADD COLUMN sgst_amount numeric DEFAULT 0, ADD COLUMN igst_amount numeric DEFAULT 0,
      ADD COLUMN round_off numeric DEFAULT 0, ADD COLUMN grand_total numeric DEFAULT 0;
    ALTER TABLE pharmacy_debit_note_items ADD COLUMN hsn_code text, ADD COLUMN gst_rate numeric DEFAULT 0,
      ADD COLUMN taxable_amount numeric DEFAULT 0, ADD COLUMN cgst_amount numeric DEFAULT 0,
      ADD COLUMN sgst_amount numeric DEFAULT 0, ADD COLUMN igst_amount numeric DEFAULT 0,
      ADD COLUMN line_total numeric DEFAULT 0;
    CREATE FUNCTION next_debit_note_number(uuid) RETURNS text LANGUAGE sql AS $$ SELECT gen_random_uuid()::text $$;`);
  for (const file of ['20261026100000_pharmacy_scheme_returns.sql','20261030090000_pharmacy_catalogue_options.sql',
    '20261030091000_pharmacy_controlled_sale_register.sql','20261030092000_pharmacy_product_merge.sql',
    '20261107090000_pharmacy_optional_controlled_sale_details.sql']) await applyMigration(db, file);
  const one = async (sql, args=[]) => (await db.query(sql,args)).rows[0];
  async function medicine({ name='Medicine', stock=2, nrx=false, h1=false, clinic=state.clinic, pack=10 }={}) {
    const id = randomUUID();
    await db.query(`INSERT INTO medicines_master(id,clinic_id,name,dosage_form,strength,manufacturer,current_stock,
      pack_size,stock_unit,dispense_unit,is_nrx,is_schedule_h1,opening_pool_quantity,opening_pool_value)
      VALUES($1,$2,$3,'tablet','88mcg','Manufacturer',$4::numeric,$5,'Strip','Tablet',$6,$7,$4::numeric,$4::numeric*100)`,[id,clinic,name,stock,pack,nrx,h1]);
    return id;
  }
  const merge = (source,target) => db.query('SELECT merge_pharmacy_products($1,$2,$3)',[source,target,'Duplicate product confirmed']);
  const supply = (id, data=details, actor=state.user, clinic=state.clinic) => db.query(`INSERT INTO pharmacy_dispensed_items
    (medicine_id,clinic_id,quantity,pack_size,billed_quantity,billed_unit,dispensed_by,controlled_sale_details,selling_price_at_dispense)
    VALUES($1,$2,0.5,10,5,'Tablet',$3,$4::jsonb,21.26) RETURNING id`,[id,clinic,actor,JSON.stringify(data)]);
  const register = (kind='all') => one("SELECT pharmacy_controlled_sale_register('2000-01-01','2100-01-01',$1,0) data",[kind]).then(r => r.data);
  return { ...state, one, medicine, merge, supply, register };
}

test('FIFO uses receipt order, excludes expiry and keeps each MRP when splitting loose sales', () => {
  const batch = (id,received,expiry,quantity,mrp) => ({ id,medicineId:'m',createdAt:new Date(received),expiryDate:new Date(expiry),quantity,mrp });
  const batches = [batch('new','2026-02-01','2027-01-01',2,220),batch('old','2026-01-01','2028-01-01',0.5,212.64),batch('expired','2025-01-01','2026-01-01',5,100)];
  const available = fifoBatches(batches,'m','2026-10-30');
  assert.deepEqual(available.map(b=>b.id),['old','new']);
  const plan = allocateFifoBatches(available,12,10,true);
  assert.deepEqual(plan.map(p=>[p.batch.id,p.quantity,p.batch.mrp]),[['old',5,212.64],['new',7,220]]);
  assert.deepEqual(allocateFifoBatches(available,7,10,true,new Map([['old',0.3]])).map(p=>p.quantity),[2,5]);
  assert.throws(()=>allocateFifoBatches(available,26,10,true),/Not enough/);
  assert.equal(stockDisplay(2,packSpec({packSize:10,stockUnit:'Strip',dispenseUnit:'Tablet'})),'20 Tablet (2 Strip)');
});

test('invoice matching never uses shared MRP or silently chooses between duplicate masters', () => {
  const line={medicineName:'Thyronorm 88',strength:'88mcg',manufacturer:'Manufacturer'};
  const records=[{id:'one',name:'THYRONORM 88',strength:'88mcg',manufacturer:'Manufacturer'},
    {id:'two',name:'Thyronorm 88',strength:'88mcg',manufacturer:'Manufacturer'},
    {id:'wrong',name:'Thyronorm 88',strength:'50mcg',manufacturer:'Manufacturer'}];
  assert.deepEqual(invoiceMedicineMatches(line,records).map(m=>m.id),['one','two']);
  assert.equal(invoiceMedicineMatches({...line,medicineName:'Other brand'},records).length,0);
});

test('merge combines clinic stock, preserves batches and MRP, retains pricing and audit, and is retry safe', async t => {
  const {db,clinic,one,medicine,merge}=await setup(t);
  const source=await medicine({name:'Duplicate',stock:2}), target=await medicine({stock:3});
  const ids=[randomUUID(),randomUUID()];
  await db.query(`INSERT INTO medicine_batches(id,clinic_id,medicine_id,batch_number,quantity,mrp,created_at)
    VALUES($1,$3,$4,'OLD',2,212.64,'2026-01-01'),($2,$3,$5,'NEW',3,212.64,'2026-02-01')`,[...ids,clinic,source,target]);
  await db.query('INSERT INTO clinic_medicine_prices(clinic_id,medicine_id,selling_price,cost_price) VALUES($1,$2,212.64,100),($1,$3,220,110)',[clinic,source,target]);
  await db.exec('SET ROLE authenticated'); await merge(source,target); await merge(source,target); await db.exec('RESET ROLE');
  assert.equal(n((await one('SELECT current_stock FROM medicines_master WHERE id=$1',[target])).current_stock),5);
  assert.equal((await one('SELECT is_active FROM medicines_master WHERE id=$1',[source])).is_active,false);
  const batches=(await db.query('SELECT * FROM medicine_batches WHERE medicine_id=$1 ORDER BY created_at',[target])).rows;
  assert.deepEqual(batches.map(b=>b.id),ids); assert.deepEqual(batches.map(b=>n(b.mrp)),[212.64,212.64]);
  assert.equal(n((await one('SELECT selling_price FROM clinic_medicine_prices WHERE medicine_id=$1',[target])).selling_price),220);
  const audit=await one('SELECT * FROM pharmacy_product_merges'); assert.equal(audit.source_snapshot.name,'Duplicate');
  assert.equal(n(audit.source_price.selling_price),212.64);
  await assert.rejects(db.query(`INSERT INTO pharmacy_dispensed_items(medicine_id,clinic_id,quantity,dispensed_by) VALUES($1,$2,1,auth.uid())`,[source,clinic]),/merged/);
  await assert.rejects(db.query('UPDATE medicines_master SET current_stock=1 WHERE id=$1',[source]),/merged/);
  await assert.rejects(db.query("INSERT INTO medicine_batches(clinic_id,medicine_id,batch_number,quantity,mrp) VALUES($1,$2,'STALE',1,212.64)",[clinic,source]),/merged/);
});

test('incompatible packs, overlapping batches and cross-clinic merges roll back without changes',async t=>{
  const {db,clinic,one,medicine,merge}=await setup(t);
  const source=await medicine(), target=await medicine({pack:15});
  await assert.rejects(merge(source,target),/pack rules must match/);
  await db.query('UPDATE medicines_master SET pack_size=10 WHERE id=$1',[target]);
  await db.query("INSERT INTO medicine_batches(clinic_id,medicine_id,batch_number,quantity) VALUES($1,$2,'SAME',2),($1,$3,'SAME',2)",[clinic,source,target]);
  await assert.rejects(merge(source,target),/share a batch number/);
  const foreign=randomUUID(); await db.query("INSERT INTO clinic_settings(id,name) VALUES($1,'Other clinic')",[foreign]);
  const foreignMed=await medicine({clinic:foreign}); await assert.rejects(merge(source,foreignMed),/your clinic/);
  assert.equal(n((await one('SELECT count(*) n FROM pharmacy_product_merges')).n),0);
  assert.equal(n((await one('SELECT current_stock FROM medicines_master WHERE id=$1',[source])).current_stock),2);
});

test('controlled supply validates provided details and preserves the immutable register and clinic permissions',async t=>{
  const {db,clinic,user,one,medicine,supply,register,merge}=await setup(t);
  const med=await medicine({h1:true,nrx:true});
  await assert.rejects(supply(med,[]),/Invalid NRx/);
  await assert.rejects(supply(med,{prescriberAddress:123}),/prescriberAddress/);
  await assert.rejects(supply(med,{patientName:'x'.repeat(2001)}),/patientName/);
  await assert.rejects(supply(med,{prescriptionVerified:'true'}),/verification/);
  await assert.rejects(supply(med,{prescriptionDate:'not-a-date'}),/valid prescription date/);
  await assert.rejects(supply(med,{...details,prescriptionDate:'2100-01-01'}),/future/);
  assert.equal(n((await one('SELECT current_stock FROM medicines_master WHERE id=$1',[med])).current_stock),2);
  assert.equal((await register()).total,0);
  const supplied=(await supply(med)).rows[0].id;
  const row=(await register('h1')).rows[0]; assert.equal(n(row.quantity),5); assert.equal(row.unit,'Tablet');
  assert.equal(row.recorded_by,user); assert.equal(row.details.prescriberAddress,details.prescriberAddress);
  await db.query('UPDATE medicines_master SET name=$2,is_nrx=false,is_schedule_h1=false WHERE id=$1',[med,'Edited name']);
  await db.query('UPDATE pharmacy_dispensed_items SET refunded_quantity=quantity WHERE id=$1',[supplied]);
  const target=await medicine();
  await db.query("INSERT INTO medicine_batches(clinic_id,medicine_id,batch_number,quantity,mrp) VALUES($1,$2,'SOURCE',0,212.64),($1,$3,'TARGET',0,212.64)",[clinic,med,target]);
  await merge(med,target);
  assert.equal((await register('h1')).rows[0].medicine_name,'Medicine 88mcg');
  assert.equal((await register('nrx')).total,1);
  await db.exec('SET ROLE authenticated');
  assert.equal((await register()).total,1);
  await assert.rejects(db.query('UPDATE pharmacy_controlled_sales SET medicine_name=$1',['Tampered']),/permission denied/);
  await assert.rejects(db.query('DELETE FROM pharmacy_controlled_sales'),/permission denied/);
  await db.exec('RESET ROLE');
  const foreign=randomUUID(); await db.query("INSERT INTO clinic_settings(id,name) VALUES($1,'Foreign')",[foreign]);
  const foreignMed=await medicine({clinic:foreign,h1:true}); await assert.rejects(supply(foreignMed,details,user,foreign),/their clinic/);
  await db.query("UPDATE profiles SET permissions=ARRAY['modules_assigned','opd_patients'] WHERE id=$1",[user]);
  await assert.rejects(register(),/access is required/);
  assert.equal(n((await one('SELECT count(*) n FROM pharmacy_controlled_sales WHERE clinic_id=$1',[clinic])).n),1);
});

test('NRx and H1 supplies accept skipped, blank and partial details without claiming verification',async t=>{
  const {db,one,medicine,supply,register}=await setup(t);
  const med=await medicine({h1:true,nrx:true,stock:5});
  // Both SQL NULL (an older caller) and JSON null (a skipped popup) are accepted.
  await supply(med,null);
  await db.query(`INSERT INTO pharmacy_dispensed_items(medicine_id,clinic_id,quantity,dispensed_by)
    SELECT id,clinic_id,0.5,auth.uid() FROM medicines_master WHERE id=$1`,[med]);
  await supply(med,{});
  const blank=Object.fromEntries(Object.keys(details).filter(k=>k!=='prescriptionVerified').map(k=>[k,'']));
  await supply(med,{...blank,prescriptionVerified:false});
  await supply(med,{patientName:'Known patient',prescriberAddress:'',prescriptionVerified:false});
  const rows=(await register()).rows;
  assert.equal(rows.length,5);
  assert.ok(rows.every(r=>r.details.prescriptionVerified!==true));
  assert.equal(rows.filter(r=>Object.keys(r.details).length===0).length,3);
  assert.equal(rows.find(r=>r.details.patientName==='Known patient').details.prescriberAddress,'');
  assert.equal((await register('h1')).total,5);
  assert.equal((await register('nrx')).total,5);
  assert.equal(n((await one('SELECT current_stock FROM medicines_master WHERE id=$1',[med])).current_stock),2.5);
  const plain=await medicine(); await supply(plain,null);
  assert.equal((await register()).total,5);
});

test('new dosage forms are available on enum installations without changing existing labels',async t=>{
  const {db}=await freshDb(); t.after(()=>db.close());
  await db.exec("CREATE TYPE dosage_form_enum AS ENUM ('tablet','other'); ALTER TABLE medicines_master ALTER COLUMN dosage_form TYPE dosage_form_enum USING dosage_form::dosage_form_enum;");
  await applyMigration(db,'20261030090000_pharmacy_catalogue_options.sql');
  const labels=(await db.query("SELECT unnest(enum_range(NULL::dosage_form_enum))::text label")).rows.map(r=>r.label);
  for(const label of ['tablet','sachet','gel','spray','rotacap','respule','granules','soap','shampoo','lotion','gargle']) assert.ok(labels.includes(label));
});


test('merge rejects different and unknown MRPs without using selling price as MRP',async t=>{
  const {db,clinic,one,medicine,merge}=await setup(t);
  const source=await medicine(), target=await medicine();
  await assert.rejects(merge(source,target),/verify the pack MRP/);
  await db.query("INSERT INTO medicine_batches(clinic_id,medicine_id,batch_number,quantity,mrp) VALUES($1,$2,'OLD',2,212.64),($1,$3,'NEW',2,220)",[clinic,source,target]);
  await assert.rejects(merge(source,target),/same recorded pack MRP/);
  assert.equal(n((await one('SELECT count(*) n FROM pharmacy_product_merges')).n),0);
  await db.query('UPDATE medicine_batches SET mrp=212.64 WHERE medicine_id=$1',[target]);
  await merge(source,target);
  assert.equal(n((await one('SELECT current_stock FROM medicines_master WHERE id=$1',[target])).current_stock),4);
});

test('Meditrust licence update is restricted to its documented clinic identity',async t=>{
  const {db,clinic,one}=await setup(t);
  const meditrust='238307be-362b-4fff-bb9a-3f2f9ff44519';
  await db.query("INSERT INTO clinic_settings(id,name,clinic_name) VALUES($1,'Meditrust','Meditrust Clinics')",[meditrust]);
  await applyMigration(db,'20261030093000_meditrust_drug_licence.sql');
  assert.equal((await one('SELECT drug_license_number FROM clinic_settings WHERE id=$1',[meditrust])).drug_license_number,'GJ-ADR-272601');
  assert.equal((await one('SELECT drug_license_number FROM clinic_settings WHERE id=$1',[clinic])).drug_license_number,null);
});

test('Meditrust flags preserve independent NRx/H1 status and skip changed or other-clinic products',async t=>{
  const {db,clinic,one}=await setup(t);
  const plan=JSON.parse(await readFile('supabase/seed/meditrust_controlled_medicines_20261030.json','utf8'));
  await db.query("INSERT INTO clinic_settings(id,name,clinic_name,drug_license_number) VALUES($1,'Meditrust','Meditrust Clinics','GJ-ADR-272601')",[plan.clinicId]);
  const picks=['ALPRAX 0.25 TAB','FRISIUM 10 TAB','PREGABID 75 CAP','MOXIF 400 MG  ','ZIFI 100  MG TAB'];
  const records=picks.map(name=>plan.medicines.find(m=>m.name.trim()===name.trim()));
  assert.ok(records.every(Boolean));
  for(let i=0;i<records.length;i++) {
    const r=records[i];
    await db.query(`INSERT INTO medicines_master(id,clinic_id,name,generic_name,dosage_form,is_nrx)
      VALUES($1,$2,$3,$4,'tablet',$5)`,[r.id,i===4?clinic:plan.clinicId,r.name,i===3?'Composition changed since review':r.generic,i===2]);
  }
  await applyMigration(db,'20261030094000_meditrust_controlled_medicine_flags.sql');
  const flags=async i=>{const r=await one('SELECT is_nrx,is_schedule_h1 FROM medicines_master WHERE id=$1',[records[i].id]);return [r.is_nrx,r.is_schedule_h1];};
  assert.deepEqual(await flags(0),[true,true]);
  assert.deepEqual(await flags(1),[true,false]);
  assert.deepEqual(await flags(2),[true,true]); // Preserve an existing manual NRx flag.
  assert.deepEqual(await flags(3),[false,false]);
  assert.deepEqual(await flags(4),[false,false]);
});

test('controlled whole-pack supplies record loose units even without an explicit dispense-unit label',async t=>{
  const {db,one,medicine,supply,register}=await setup(t);
  const med=await medicine({h1:true});
  await db.query('UPDATE medicines_master SET dispense_unit=NULL,allow_loose_sale=false WHERE id=$1',[med]);
  await supply(med);
  const row=(await register()).rows[0];
  assert.equal(n(row.quantity),5);
  assert.equal(row.unit,'Tablet');
  assert.equal(n((await one('SELECT count(*) n FROM pharmacy_controlled_sales')).n),1);
});
