import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled=await build({entryPoints:['src/services/pharmacyInvoiceService.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
 name:'invoice-fixtures',setup(b){
  b.onResolve({filter:/\/(supabase|billingService|clinicSettingsService|profileService|pharmacyInvoicePdf)$/},a=>({path:a.path,namespace:'fixtures'}));
  b.onLoad({filter:/.*/,namespace:'fixtures'},a=>({contents:
   a.path.endsWith('/supabase')?'export const supabase=globalThis.invoiceFixture.client;':
   a.path.endsWith('/billingService')?'export const billingService={getBillById:async()=>globalThis.invoiceFixture.bill};':
   a.path.endsWith('/clinicSettingsService')?'export const clinicSettingsService={getClinicSettings:async()=>globalThis.invoiceFixture.clinic};':
   a.path.endsWith('/profileService')?'export const getCurrentProfile=async()=>({clinicId:"clinic"});':
   'export const pharmacyInvoiceContentKey=data=>JSON.stringify({paid:data.bill.paidAmount,clinic:data.clinic.id}); export const createPharmacyInvoicePdf=()=>({output:()=>new Blob(["sample PDF"],{type:"application/pdf"})});'}));
 }
}]});
const fixture={}; globalThis.invoiceFixture=fixture;
const updates=[];
fixture.client={storage:{from:name=>({getPublicUrl:path=>({data:{publicUrl:`https://storage.example/${name}/${path}`}}),upload:async(path,blob)=>{fixture.uploaded={path,type:blob.type};return {error:fixture.uploadError};}})},
 from:table=>({update:values=>{updates.push({table,values}); const query={eq:(key,value)=>{updates.push({key,value});return query;},select:()=>query,maybeSingle:async()=>({data:fixture.changed?null:{id:'bill'},error:null})};return query;}})};
const {pharmacyInvoiceService}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
function reset(){fixture.bill={id:'bill',billType:'pharmacy',patient:{name:'Test'},paidAmount:0,sourceUpdatedAt:'2026-10-24T10:00:00.123456Z'}; fixture.clinic={id:'clinic'};fixture.uploadError=null;fixture.changed=false;fixture.uploaded=null;updates.length=0;}

test('local PDF is saved under clinic/bill and linked with exact timestamp guard',async()=>{
 reset(); const result=await pharmacyInvoiceService.generate('bill');
 assert.equal(result.cached,false);assert.match(fixture.uploaded.path,/^pharmacy-invoices\/clinic\/bill\/[a-f0-9]{64}\.pdf$/);
 assert.equal(fixture.uploaded.type,'application/pdf');
 assert.ok(updates.some(x=>x.key==='clinic_id'&&x.value==='clinic'));
 assert.ok(updates.some(x=>x.key==='updated_at'&&x.value===fixture.bill.sourceUpdatedAt));
 fixture.bill.pdfUrl=result.url;fixture.uploaded=null;updates.length=0;
 assert.equal((await pharmacyInvoiceService.generate('bill')).cached,true);
 assert.equal(fixture.uploaded,null);assert.equal(updates.length,0);
 fixture.bill.paidAmount=10;
 assert.notEqual((await pharmacyInvoiceService.generate('bill')).url,result.url,'payment changes invalidate cache');
});
test('failed upload cannot save a broken link; concurrent bill changes are reported',async()=>{
 reset(); fixture.uploadError={message:'Storage unavailable'};
 await assert.rejects(pharmacyInvoiceService.generate('bill'),/saving failed/);assert.equal(updates.length,0);
 reset();fixture.changed=true;
 await assert.rejects(pharmacyInvoiceService.generate('bill'),/bill changed/);
});
test('wrong clinic and non-pharmacy bills cannot generate or upload',async()=>{
 reset();fixture.clinic.id='other';await assert.rejects(pharmacyInvoiceService.generate('bill'),/Clinic settings/);assert.equal(fixture.uploaded,null);
 reset();fixture.bill.billType='opd';await assert.rejects(pharmacyInvoiceService.generate('bill'),/Pharmacy invoice/);assert.equal(fixture.uploaded,null);
});
