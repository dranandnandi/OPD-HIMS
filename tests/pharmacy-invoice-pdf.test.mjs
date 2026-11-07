import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const outputDir = join(tmpdir(), 'pharmacy-invoice-qa');

const source = await build({ entryPoints:['src/utils/pharmacyInvoicePdf.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external' });
const module = {exports:{}};
new Function('require','module','exports',source.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {createPharmacyInvoicePdf,pharmacyInvoiceContentKey} = module.exports;
const item = {itemName:'A TO Z TAB',quantity:1/15,billedQuantity:1,billedUnit:'Tablet',packSize:15,mrp:170.85,unitPrice:11.39,totalPrice:11.39,taxableAmount:10.85,cgstAmount:0.27,sgstAmount:0.27,gstRate:5,hsnCode:'21069099',batchNumber:'25491155',expiryDate:'2027-04-30'};
const sample = {clinic:{id:'clinic',clinicName:'MediTrust Clinics',address:'Shela, Ahmedabad',phone:'0123456789',gstin:'24AAMCB8446Q1ZW',drugLicenseNumber:'SAMPLE-LICENCE',pharmacyGstScheme:'regular',invoicePaperSize:'A4'},
  patient:{name:'Sample Customer',phone:'0123456789',patientNumber:'TEST-1'},
  bill:{id:'bill',billType:'pharmacy',billNumber:'TEST-PHARMACY-001',billDate:'2026-10-24',paymentStatus:'paid',totalAmount:11.39,paidAmount:11.39,balanceAmount:0,taxableAmount:10.85,cgstAmount:0.27,sgstAmount:0.27,billItems:[item]}};
await mkdir(outputDir,{recursive:true});
test('PDF uses billed tablet quantity, pack MRP, tax and clinic identity',async () => {
  const pdf = createPharmacyInvoicePdf(sample);
  assert.equal(pdf.getNumberOfPages(),1);
  const operators = pdf.internal.pages.flat().join('\n');
  for (const text of ['Tablet','170.85','11.39','24AAMCB8446Q1ZW','25491155','PHARMACY TAX INVOICE']) assert.ok(operators.includes(text), text);
  assert.ok(!operators.includes('0.06666666666666667'));
  await writeFile(join(outputDir, 'pharmacy-a4.pdf'),Buffer.from(pdf.output('arraybuffer')));
});
test('A5 and long multi-page invoices preserve every item and number each page',async () => {
  for (const paper of ['A4','A5']) {
    const data = structuredClone(sample); data.clinic.invoicePaperSize=paper;
    data.bill.billItems=Array.from({length:35},(_,i)=>({...item,itemName:`MEDICINE-${i+1} Extended formulation and dosage description`}));
    for (const field of ['totalAmount','paidAmount','taxableAmount','cgstAmount','sgstAmount']) data.bill[field] *= 35;
    const pdf=createPharmacyInvoicePdf(data), operators=pdf.internal.pages.flat().join('\n');
    assert.ok(pdf.getNumberOfPages()>1);
    for(let i=1;i<=35;i++) assert.ok(operators.includes(`MEDICINE-${i}`));
    for(let i=1;i<=pdf.getNumberOfPages();i++) assert.ok(operators.includes(`Page ${i} of ${pdf.getNumberOfPages()}`));
    await writeFile(join(outputDir, `pharmacy-${paper.toLowerCase()}-long.pdf`),Buffer.from(pdf.output('arraybuffer')));
  }
});
test('composition uses bill of supply and cache invalidates for payment, customer and branding changes',()=>{
  const key=pharmacyInvoiceContentKey(sample);
  assert.equal(key,pharmacyInvoiceContentKey({...sample,bill:{...sample.bill,pdfUrl:'saved.pdf',updatedAt:new Date()}}));
  for(const altered of [ {...sample,bill:{...sample.bill,paidAmount:5}}, {...sample,patient:{...sample.patient,name:'Changed'}}, {...sample,clinic:{...sample.clinic,logoUrl:'new.png'}}]) assert.notEqual(key,pharmacyInvoiceContentKey(altered));
  const pdf=createPharmacyInvoicePdf({...sample,clinic:{...sample.clinic,pharmacyGstScheme:'composition'}});
  assert.ok(pdf.internal.pages.flat().join('\n').includes('BILL OF SUPPLY'));
});

test('sale percentage is preserved exactly despite rounding and GST components show their rates', async () => {
  const data = structuredClone(sample);
  Object.assign(data.bill, { discountAmount: 2.28, taxableAmount: 8.68, cgstAmount: 0.22, sgstAmount: 0.21, totalAmount: 9.11, paidAmount: 9.11 });
  Object.assign(data.bill.billItems[0], { saleDiscountPercent: 20, discount: 2.28, taxableAmount: 8.68, cgstAmount: 0.22, sgstAmount: 0.21, totalPrice: 9.11 });
  for (const paper of ['A4', 'A5']) {
    data.clinic.invoicePaperSize = paper;
    const pdf = createPharmacyInvoicePdf(data), text = pdf.internal.pages.flat().join('\n');
    for (const label of ['Sale discount 20%', 'CGST 2.5%', 'SGST 2.5%', 'GST 5%']) assert.ok(text.includes(label), label);
    assert.ok(!text.includes('20.02%')); assert.ok(!text.includes('estimated'));
    await writeFile(join(outputDir, `pharmacy-discount-${paper.toLowerCase()}.pdf`), Buffer.from(pdf.output('arraybuffer')));
  }
  const exactKey = pharmacyInvoiceContentKey(data);
  delete data.bill.billItems[0].saleDiscountPercent;
  assert.notEqual(exactKey, pharmacyInvoiceContentKey(data));
  const legacy = createPharmacyInvoicePdf(data).internal.pages.flat().join('\n');
  assert.ok(legacy.includes('Sale discount ~20%')); assert.ok(legacy.includes('estimated'));
});

test('mixed discounts and GST rates stay item-wise; IGST uses the full rate', async () => {
  const data = structuredClone(sample);
  data.bill.billItems = [
    { ...item, saleDiscountPercent: 20, discount: 2.28, totalPrice: 9.11, taxableAmount: 8.68, cgstAmount: 0.22, sgstAmount: 0.21 },
    { ...item, itemName: 'SECOND MEDICINE', unitPrice: 112, mrp: 112, saleDiscountPercent: 10, discount: 11.2, totalPrice: 100.8, taxableAmount: 90, gstRate: 12, cgstAmount: 5.4, sgstAmount: 5.4 },
  ];
  Object.assign(data.bill, { totalAmount: 109.91, paidAmount: 109.91, discountAmount: 13.48, taxableAmount: 98.68, cgstAmount: 5.62, sgstAmount: 5.61 });
  const pdf = createPharmacyInvoicePdf(data), text = pdf.internal.pages.flat().join('\n');
  for (const label of ['Sale discount 20%', 'Sale discount 10%', 'CGST 2.5%', 'CGST 6%', 'SGST 6%', 'GST 12%', 'see items']) assert.ok(text.includes(label), label);
  await writeFile(join(outputDir, 'pharmacy-mixed-percentages.pdf'), Buffer.from(pdf.output('arraybuffer')));
  data.bill.billItems = [{ ...item, gstRate: 12, igstAmount: 1.22, cgstAmount: 0, sgstAmount: 0 }];
  Object.assign(data.bill, { igstAmount: 1.22, cgstAmount: 0, sgstAmount: 0, discountAmount: 0 });
  assert.ok(createPharmacyInvoicePdf(data).internal.pages.flat().join('\n').includes('IGST 12%'));
});
