import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/utils/supplierReturns.ts'], bundle:true,write:false,platform:'node',format:'esm' });
const { purchaseNetValue, supplierReturnPreview } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const item = { quantity:10,freeQuantity:2,unitCostPrice:100,taxableAmount:1000,lineTotal:1050,cgstAmount:25,sgstAmount:25,igstAmount:0 };
test('preview preserves invoice amount and distinguishes free/pending/commercial returns',()=>{
  assert.equal(purchaseNetValue(item),1000);
  assert.deepEqual(supplierReturnPreview(item,{creditAmount:1000},'gst_credit'),{taxable:1000,cgst:25,sgst:25,igst:0,total:1050});
  assert.equal(supplierReturnPreview(item,{creditAmount:1000},'stock_only').total,0);
  assert.deepEqual(supplierReturnPreview(item,{creditAmount:1050},'commercial_credit'),{taxable:0,cgst:0,sgst:0,igst:0,total:1050});
});
test('purchase cost uses supplier discounts and spreads them over all packs',()=>{
  const legacy={quantity:10,freeQuantity:2,unitCostPrice:100,discountPercent:10,discountAmount:50};
  assert.equal(purchaseNetValue(legacy),850);
  assert.equal(purchaseNetValue({...item,effectiveUnitCost:1000/12}),1000);
  assert.equal(purchaseNetValue({...item,taxableAmount:0,lineTotal:0,discountPercent:100}),0);
});
test('partial GST preview reconciles prior paise rounding to the original tax',()=>{
  const source={...item,quantity:3,freeQuantity:0,taxableAmount:3,lineTotal:3.14,cgstAmount:.07,sgstAmount:.07};
  const previous=[];
  let total=0;
  for(let i=0;i<3;i++){
    const t=supplierReturnPreview(source,{creditAmount:1},'gst_credit',previous);total+=t.total;
    previous.push({taxableAmount:1,cgstAmount:t.cgst,sgstAmount:t.sgst,igstAmount:0});
  }
  assert.equal(Math.round(total*100),314);
});
