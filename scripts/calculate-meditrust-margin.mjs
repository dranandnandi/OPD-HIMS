// Explicit release of this session's pharmacy migrations only.
// Supabase CLI supplies an ephemeral database login in memory; never persist it.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import pg from 'pg';

const projectRef = (await readFile('supabase/.temp/project-ref','utf8')).trim();
if (projectRef !== 'kiezgfhonvwryxpubfvl') throw new Error('Unexpected linked project.');
const exported = spawnSync('supabase.exe',['db','dump','--linked','--dry-run'], {
  encoding:'utf8',windowsHide:true,timeout:60000,
});
if (exported.status !== 0) throw new Error('Supabase CLI could not initialize its database login.');
const connection = {};
for (const name of ['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE']) {
  const match = exported.stdout.match(new RegExp(`^\\s*(?:export\\s+)?${name}=(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s\\n]+))\\s*$`,'m'));
  if (!match) throw new Error(`CLI did not provide ${name}.`);
  connection[name] = match[1] ?? match[2] ?? match[3];
  if (connection[name].includes('${') || connection[name].includes('$(')) throw new Error('CLI connection has an unresolved value.');
}
if (!connection.PGHOST.endsWith('.supabase.com') || !connection.PGUSER.includes(projectRef)) throw new Error('Database target does not match the linked project.');
const certificateResponse=await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt',{signal:AbortSignal.timeout(20000)});
if(!certificateResponse.ok) throw new Error('Could not download the published Supabase CA certificate.');
const certificate=await certificateResponse.text();
const authority=new X509Certificate(certificate);
if(!authority.ca || !authority.subject.includes('Supabase')) throw new Error('Unexpected database certificate authority.');
// Read-only report; no migration, data update, or permission change is executed.
const client = new pg.Client({host:connection.PGHOST,port:Number(connection.PGPORT),user:connection.PGUSER,
  password:connection.PGPASSWORD,database:connection.PGDATABASE,ssl:{rejectUnauthorized:true,ca:[...rootCertificates,certificate]},connectionTimeoutMillis:15000});
try {
  await client.connect();
  const membership=(await client.query("SELECT pg_has_role(current_user,'postgres','MEMBER') allowed")).rows[0];
  if(!membership.allowed) throw new Error('Expected existing CLI role membership is unavailable.');
  await client.query('SET ROLE postgres');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '30s'");
  const clinicId='238307be-362b-4fff-bb9a-3f2f9ff44519';
  const clinic=(await client.query('SELECT id,clinic_name,drug_license_number FROM public.clinic_settings WHERE id=$1',[clinicId])).rows[0];
  if(clinic?.clinic_name!=='Meditrust Clinics'||clinic.drug_license_number!=='GJ-ADR-272601') throw new Error('Clinic identity mismatch.');
  const lotSql=`WITH m AS (
    SELECT m.*,p.cost_price,p.selling_price,
      coalesce((SELECT sum(b.quantity) FROM public.medicine_batches b WHERE b.clinic_id=$1 AND b.medicine_id=m.id),0) batch_qty
    FROM public.medicines_master m LEFT JOIN public.clinic_medicine_prices p ON p.medicine_id=m.id AND p.clinic_id=m.clinic_id
    WHERE m.clinic_id=$1 AND m.is_active AND m.current_stock>0
  ), lots AS (
    SELECT m.id,m.name,'batch' source,b.id lot_id,b.quantity qty,b.mrp,
      coalesce(b.effective_cost,b.purchase_rate) cost,m.gst_rate,b.expiry_date,
      CASE WHEN b.effective_cost IS NOT NULL THEN 'effective_batch_cost' ELSE 'batch_purchase_rate' END cost_source
    FROM m JOIN public.medicine_batches b ON b.medicine_id=m.id AND b.clinic_id=$1 WHERE b.quantity>0
    UNION ALL
    SELECT m.id,m.name,'pool',NULL::uuid,greatest(0,m.current_stock-m.batch_qty),m.selling_price,
      coalesce(m.effective_pool_cost,m.cost_price),m.gst_rate,m.expiry_date,
      CASE WHEN m.effective_pool_cost IS NOT NULL THEN 'effective_pool_cost' ELSE 'catalogue_cost' END
    FROM m WHERE m.current_stock>m.batch_qty
  )`;
  const totals=(await client.query(`${lotSql} SELECT
    count(DISTINCT id)::int stocked_products,count(*)::int lots,
    round(sum(qty*coalesce(cost,0)),2) cost_excluding_gst,
    round(sum(qty*coalesce(cost,0)*(1+coalesce(gst_rate,0)/100)),2) estimated_cost_including_gst,
    round(sum(qty*coalesce(mrp,0)),2) mrp_including_gst,
    round(sum(qty*coalesce(mrp,0)/(1+coalesce(gst_rate,0)/100)),2) mrp_excluding_gst,
    count(*) FILTER (WHERE cost IS NULL)::int missing_cost_lots,
    count(*) FILTER (WHERE cost=0)::int zero_cost_lots,
    count(*) FILTER (WHERE mrp IS NULL OR mrp<=0)::int missing_mrp_lots,
    count(*) FILTER (WHERE gst_rate IS NULL)::int missing_gst_lots,
    round(sum(qty*coalesce(mrp,0)) FILTER(WHERE cost IS NULL OR cost<=0),2) mrp_of_missing_or_zero_cost,
    round(sum(qty*coalesce(cost,0)) FILTER(WHERE mrp IS NULL OR mrp<=0),2) cost_of_missing_mrp,
    count(*) FILTER(WHERE expiry_date < (now() AT TIME ZONE 'Asia/Kolkata')::date)::int expired_lots,
    round(coalesce(sum(qty*coalesce(cost,0)) FILTER(WHERE expiry_date < (now() AT TIME ZONE 'Asia/Kolkata')::date),0),2) expired_cost,
    round(coalesce(sum(qty*coalesce(mrp,0)) FILTER(WHERE expiry_date < (now() AT TIME ZONE 'Asia/Kolkata')::date),0),2) expired_mrp,
    (SELECT count(*)::int FROM m WHERE batch_qty>current_stock) batch_stock_mismatches
    FROM lots`,[clinicId])).rows[0];
  const groups=(await client.query(`${lotSql} SELECT source,cost_source,count(*)::int lots,count(DISTINCT id)::int products,
    round(sum(qty*coalesce(cost,0)),2) cost_excluding_gst,round(sum(qty*coalesce(mrp,0)),2) mrp_including_gst
    FROM lots GROUP BY source,cost_source ORDER BY source,cost_source`,[clinicId])).rows;
  const exceptions=(await client.query(`${lotSql} SELECT id,name,source,qty,mrp,cost,gst_rate,expiry_date FROM lots
    WHERE cost IS NULL OR cost<=0 OR mrp IS NULL OR mrp<=0 OR gst_rate IS NULL OR cost>mrp OR expiry_date < (now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY name`,[clinicId])).rows;
  const receipts=(await client.query(`SELECT status,count(*)::int invoices,min(receipt_date) earliest,max(receipt_date) latest,
    round(sum(total_amount),2) total_amount,round(sum(taxable_amount),2) taxable_amount,
    round(sum(cgst_amount+sgst_amount+igst_amount),2) gst,round(sum(grand_total),2) grand_total
    FROM public.pharmacy_inward_receipts WHERE clinic_id=$1 GROUP BY status`,[clinicId])).rows;
  const purchaseLines=(await client.query(`SELECT count(*)::int lines,count(DISTINCT i.medicine_id)::int products,
    round(sum(i.taxable_amount),2) taxable_amount,round(sum(i.line_total),2) line_total,
    round(sum(i.total_cost_price),2) legacy_total_cost,
    round(sum((i.quantity+i.free_quantity)*i.mrp),2) mrp,
    count(*) FILTER(WHERE i.mrp IS NULL OR i.mrp<=0)::int missing_mrp_lines,
    count(*) FILTER(WHERE i.taxable_amount=0 AND i.unit_cost_price>0)::int zero_taxable_nonzero_rate,
    round(sum(i.quantity),3) paid_packs,round(sum(i.free_quantity),3) free_packs
    FROM public.pharmacy_inward_items i JOIN public.pharmacy_inward_receipts r ON r.id=i.receipt_id AND r.clinic_id=i.clinic_id
    WHERE i.clinic_id=$1`,[clinicId])).rows[0];
  const purchaseEstimate=(await client.query(`WITH lines AS (
    SELECT i.*,coalesce(nullif(i.mrp,0),p.selling_price) estimated_mrp
    FROM public.pharmacy_inward_items i JOIN public.pharmacy_inward_receipts r ON r.id=i.receipt_id AND r.clinic_id=i.clinic_id
    LEFT JOIN public.clinic_medicine_prices p ON p.medicine_id=i.medicine_id AND p.clinic_id=i.clinic_id
    WHERE i.clinic_id=$1 AND r.status='completed'
  ) SELECT round(sum((quantity+free_quantity)*estimated_mrp),2) estimated_mrp_including_gst,
    round(sum((quantity+free_quantity)*estimated_mrp/(1+coalesce(gst_rate,0)/100)),2) estimated_mrp_excluding_gst,
    round(sum((quantity+free_quantity)*estimated_mrp) FILTER(WHERE mrp IS NULL OR mrp<=0),2) catalogue_mrp_fallback,
    count(*) FILTER(WHERE estimated_mrp IS NULL OR estimated_mrp<=0)::int still_missing_mrp,
    round(sum(taxable_amount),2) purchase_cost_excluding_gst FROM lines`,[clinicId])).rows[0];
  const productDetail=(await client.query(`${lotSql} SELECT id,name,round(sum(qty*coalesce(cost,0)),2) cost_excluding_gst,
    round(sum(qty*coalesce(cost,0)*(1+coalesce(gst_rate,0)/100)),2) estimated_cost_including_gst,
    round(sum(qty*coalesce(mrp,0)),2) mrp_including_gst,
    round(sum(qty*coalesce(mrp,0)/(1+coalesce(gst_rate,0)/100)),2) mrp_excluding_gst
    FROM lots GROUP BY id,name ORDER BY name`,[clinicId])).rows;
  const stockMismatches=(await client.query(`SELECT m.id,m.name,m.current_stock,m.pack_size,m.stock_unit,p.selling_price,p.cost_price,
    coalesce(sum(b.quantity),0) batch_quantity,coalesce(sum(b.quantity),0)-m.current_stock excess_batch_quantity
    FROM public.medicines_master m LEFT JOIN public.medicine_batches b ON b.medicine_id=m.id AND b.clinic_id=m.clinic_id
    LEFT JOIN public.clinic_medicine_prices p ON p.medicine_id=m.id AND p.clinic_id=m.clinic_id
    WHERE m.clinic_id=$1 AND m.is_active GROUP BY m.id,p.selling_price,p.cost_price
    HAVING coalesce(sum(b.quantity),0)>m.current_stock ORDER BY excess_batch_quantity DESC`,[clinicId])).rows;
  const missingMrpCatalogue=(await client.query(`SELECT m.name,p.selling_price,i.mrp receipt_mrp,i.quantity,i.unit_cost_price,i.taxable_amount,i.line_total,
    b.mrp batch_mrp,b.quantity batch_quantity FROM public.medicines_master m
    LEFT JOIN public.clinic_medicine_prices p ON p.medicine_id=m.id AND p.clinic_id=m.clinic_id
    LEFT JOIN public.pharmacy_inward_items i ON i.medicine_id=m.id AND i.clinic_id=m.clinic_id
    LEFT JOIN public.medicine_batches b ON b.id=i.batch_id AND b.clinic_id=m.clinic_id
    WHERE m.clinic_id=$1 AND (m.name ILIKE 'OFLOX 400%' OR (b.quantity>0 AND (b.mrp IS NULL OR b.mrp<=0))) ORDER BY m.name`,[clinicId])).rows;
  const n=v=>Number(v)||0;
  const r=v=>Math.round((v+Number.EPSILON)*100)/100;
  const report={clinic,checkedAt:new Date().toISOString(),scope:'Current active on-hand stock; batch prices and net scheme-adjusted costs; pooled stock uses recorded clinic prices. GST-inclusive acquisition estimate uses master GST rates, not payment receipts.',totals,groups,exceptions,receipts,purchaseLines,purchaseEstimate,productDetail,stockMismatches,missingMrpCatalogue};
  report.calculation={differenceMrpMinusCostExGst:r(n(totals.mrp_including_gst)-n(totals.cost_excluding_gst)),
    potentialMarginExGst:r(n(totals.mrp_excluding_gst)-n(totals.cost_excluding_gst)),
    potentialMarginPercentExGst:r((n(totals.mrp_excluding_gst)-n(totals.cost_excluding_gst))/n(totals.mrp_excluding_gst)*100),
    estimatedCashSpread:r(n(totals.mrp_including_gst)-n(totals.estimated_cost_including_gst)),
    estimatedCashSpreadPercent:r((n(totals.mrp_including_gst)-n(totals.estimated_cost_including_gst))/n(totals.mrp_including_gst)*100),
    estimatedMarkupPercent:r((n(totals.mrp_including_gst)-n(totals.estimated_cost_including_gst))/n(totals.estimated_cost_including_gst)*100)};
  const invoiceCost=receipts.filter(r=>r.status==='completed').reduce((s,r)=>s+n(r.grand_total),0);
  report.purchaseCalculation={scope:'All 49 completed purchase invoices, including purchased stock subsequently sold. Four missing purchase MRPs estimated from catalogue selling prices; payment settlement not verified.',invoiceCostIncludingGst:r(invoiceCost),estimatedMrpIncludingGst:n(purchaseEstimate.estimated_mrp_including_gst),
    estimatedCashSpread:r(n(purchaseEstimate.estimated_mrp_including_gst)-invoiceCost),
    estimatedCashSpreadPercent:r((n(purchaseEstimate.estimated_mrp_including_gst)-invoiceCost)/n(purchaseEstimate.estimated_mrp_including_gst)*100),
    estimatedGrossMarginExGst:r(n(purchaseEstimate.estimated_mrp_excluding_gst)-n(purchaseEstimate.purchase_cost_excluding_gst)),
    estimatedGrossMarginPercentExGst:r((n(purchaseEstimate.estimated_mrp_excluding_gst)-n(purchaseEstimate.purchase_cost_excluding_gst))/n(purchaseEstimate.estimated_mrp_excluding_gst)*100)};
  await writeFile('output/meditrust-pharmacy-20261030/stock-margin.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({clinic:report.clinic,checkedAt:report.checkedAt,purchaseEstimate,calculation:report.purchaseCalculation,stockDataWarnings:{quantityMismatches:stockMismatches.length,missingMrps:exceptions.filter(e=>e.mrp==null||Number(e.mrp)<=0).length,costAboveMrp:exceptions.filter(e=>Number(e.cost)>Number(e.mrp)&&e.mrp!=null).map(e=>e.name)}},null,2));
  await client.query('ROLLBACK');
} finally { await client.end(); }
