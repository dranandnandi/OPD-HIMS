import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints:['src/utils/pharmacyExpiry.ts'],bundle:true,write:false,platform:'node',format:'esm' });
const { pharmacyDate, expiryStatus, expiryWithin, buildExpiryLots, expiryDateKey } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const now = new Date('2026-10-29T18:35:00Z'); // 30 October in India.

test('expiry uses India calendar days and keeps the expiry day distinct from expired', () => {
  assert.equal(pharmacyDate(now),'2026-10-30');
  assert.equal(expiryStatus('2026-10-29',now).kind,'expired');
  assert.equal(expiryStatus('2026-10-30',now).label,'Expires today');
  assert.equal(expiryStatus('2026-10-31',now).days,1);
  assert.equal(expiryStatus('2026-11-06',now).kind,'critical');
  assert.equal(expiryStatus('2026-11-07',now).kind,'soon');
  assert.equal(expiryStatus('2026-11-29',now).kind,'soon');
  assert.equal(expiryStatus('2026-11-30',now).kind,'good');
  assert.equal(expiryStatus('2026-10-30',new Date('2026-10-30T18:29:59Z')).kind,'critical');
  assert.equal(expiryStatus('2026-10-30',new Date('2026-10-30T18:30:00Z')).kind,'expired');
});

test('unknown and invalid dates are never shown as safe or expired', () => {
  for(const date of [undefined,null,'', 'invalid', '2026-02-30',new Date(NaN)]) {
    assert.equal(expiryDateKey(date),null);
    assert.equal(expiryStatus(date,now).kind,'unknown');
    assert.equal(expiryWithin(date,30,now,true),false);
  }
  assert.equal(expiryWithin('2026-10-29',30,now),false);
  assert.equal(expiryWithin('2026-10-29',30,now,true),true);
  assert.equal(expiryWithin('2026-11-14',7,now),false);
  assert.equal(expiryWithin('2026-11-14',15,now),true);
});

const medicine = {id:'med',name:'Example',currentStock:3,expiryDate:new Date('2028-01-01')};
const batch = (id,quantity,expiryDate) => ({id,medicineId:'med',quantity,expiryDate:expiryDate?new Date(expiryDate):undefined});
test('a fresh master expiry cannot hide old batches and residual pool is counted once', () => {
  const lots=buildExpiryLots([medicine],[batch('old',0.5,'2026-10-29'),batch('near',1,'2026-11-02'),batch('empty',0,'2026-01-01')]);
  assert.deepEqual(lots.map(l=>[l.id,l.quantity]),[['old',0.5],['near',1],['pool:med',1.5]]);
  assert.deepEqual(lots.map(l=>expiryStatus(l.expiryDate,now).kind),['expired','critical','good']);
  assert.equal(lots.reduce((sum,l)=>sum+l.quantity,0),3);
});

test('fully batched stock ignores stale master dates, unknown batch dates stay unknown', () => {
  const lots=buildExpiryLots([{...medicine,currentStock:2,expiryDate:new Date('2020-01-01')}],
    [batch('fresh',1,'2028-01-01'),batch('missing',1)]);
  assert.equal(lots.length,2);
  assert.deepEqual(lots.map(l=>expiryStatus(l.expiryDate,now).kind),['good','unknown']);
  assert.deepEqual(buildExpiryLots([{...medicine,currentStock:0}],[]),[]);
});

test('expiry report returns individual affected lots and changes its window without pooling quantities',async()=>{
  const fixture={client:{
    from:()=>{const query={select:()=>query,eq:()=>query,order:()=>query,limit:async()=>({data:[],error:null})};return query;},
    rpc:async(name,args)=>{fixture.lastRpc={name,args};return {data:0,error:null};},
  }}; globalThis.expiryFixture=fixture;
  const serviceBundle=await build({entryPoints:['src/services/pharmacyService.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
    name:'expiry-fixtures',setup(b){
      b.onResolve({filter:/\/(supabase|supabaseClient|profileService|billingService)$/},a=>({path:a.path,namespace:'expiry-fixture'}));
      b.onLoad({filter:/.*/,namespace:'expiry-fixture'},a=>({contents:
        a.path.endsWith('/supabase')?'export const supabase=globalThis.expiryFixture.client;':
        a.path.endsWith('/supabaseClient')?'export const supabaseUrl="https://example.invalid";':
        a.path.endsWith('/profileService')?'export const getCurrentProfile=async()=>({clinicId:"clinic"});':
        'export const billingService={};'}));
    }
  }]});
  const {pharmacyService}=await import(`data:text/javascript;base64,${Buffer.from(serviceBundle.outputFiles[0].text).toString('base64')}`);
  const today=new Date(`${pharmacyDate()}T00:00:00Z`);
  const plus=days=>{const date=new Date(today);date.setUTCDate(date.getUTCDate()+days);return date;};
  pharmacyService.getAllMedicinesWithPrices=async()=>[{...medicine,currentStock:4,expiryDate:plus(500)}];
  pharmacyService.getBatches=async()=>[batch('past',1),batch('near',1),batch('later',1),batch('missing',1)].map((b,i)=>({...b,expiryDate:[plus(-1),plus(7),plus(45),undefined][i]}));
  const short=await pharmacyService.getExpiringMedicines(30);
  assert.deepEqual(short.map(m=>[m.expiryLotId,m.currentStock]),[['past',1],['near',1]]);
  const long=await pharmacyService.getExpiringMedicines(60);
  assert.deepEqual(long.map(m=>m.expiryLotId),['past','near','later']);
  const dashboard=await pharmacyService.getPharmacyDashboardData();
  assert.equal(dashboard.expiredCount,1);
  assert.equal(dashboard.expiringCount,1);
  assert.equal(dashboard.expiryLots.length,4);
  await pharmacyService.updateBatchPricing('batch',{expiryDate:new Date('2026-11-29T18:30:00Z')});
  assert.equal(fixture.lastRpc.args.p_expiry_date,'2026-11-30','India midnight must not save the previous UTC day');
});
