import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const dir=new URL('./',import.meta.url);
const source=JSON.parse(await fs.readFile(new URL('source-data.json',dir),'utf8'));
const r=source.results;
const extra=JSON.parse(await fs.readFile(new URL('supplemental-data.json',dir),'utf8')).results;
const attachments=JSON.parse(await fs.readFile(new URL('attachments.json',dir),'utf8'));
const n=x=>x===null||x===undefined||x===''?0:Number(x);
const round=x=>Math.round((x+Number.EPSILON)*100)/100;
const sum=(a,k)=>a.reduce((t,x)=>t+n(x[k]),0);
const dateKey=d=>d?new Date(new Date(d).getTime()+19800000).toISOString().slice(0,10):'';
const serial=d=>d?new Date(d).getTime()/86400000+25569+5.5/24:null;
const daySerial=d=>d?Date.parse(dateKey(d)+'T00:00:00Z')/86400000+25569:null;
const trim=s=>String(s||'').trim().replace(/\s+/g,' ');
const cutoff=r.context[0].cutoff,cutoffDay=Number(dateKey(cutoff).slice(-2));
const wb=Workbook.create();
const names=['MIS','Clinical','Doctors','Daily','Training','People costs','Financial context','Pharmacy','Inputs','Visits','Bills','Bill lines','Payments','Clinical records','Purchases','Review'];
const sheets=Object.fromEntries(names.map(name=>[name,wb.worksheets.add(name)]));
const ends={};
const numFmt='#,##0.00;(#,##0.00);"-"';
const moneyFmt='"₹"#,##0.00;("₹"#,##0.00);"-"';
const counts='#,##0;(#,##0);"-"';
const title=(name,text,note='')=>{
 const s=sheets[name];s.showGridLines=false;
 s.getRange('A1:Z180').format.font={name:'Arial',size:10,color:'#172B4D'};
 s.getRange('A1:Z180').format.rowHeight=21;
 s.getRange('A2').values=[[text]];s.getRange('A2').format.font={name:'Arial',size:15,bold:true,color:'#193B5A'};
 s.getRange('A3').values=[[note]];s.getRange('A3').format.font={name:'Arial',size:10,italic:true,color:'#526579'};
 s.getRange('A2:H2').format.borders={bottom:{style:'thin',color:'#AFC1D0'}};
 s.getRange('A:A').format.columnWidth=38;
 s.getRange('B:Z').format.columnWidth=18;
 if(['MIS','Clinical','Doctors','Training'].includes(name))s.tabColor='#193B5A';
 if(name==='Inputs')s.tabColor='#6D93B0';
 return s;
};
const header=(s,row,labels)=>{
 const range=s.getRangeByIndexes(row-1,0,1,labels.length);range.values=[labels];
 range.format={fill:'#193B5A',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},wrapText:true,horizontalAlignment:'center',verticalAlignment:'center',rowHeight:34};
};
const table=(name,text,note,labels,rows,widths=[])=>{
 const s=title(name,text,note);header(s,5,labels);
 if(rows.length)s.getRangeByIndexes(5,0,rows.length,labels.length).values=rows;
 ends[name]=5+rows.length;
 for(let i=0;i<labels.length;i++){
  const range=s.getRangeByIndexes(0,i,Math.max(ends[name]+1,8),1);range.format.columnWidth=widths[i]??18;
 }
 for(let i=0;i<rows.length;i++)if(i%2===1)s.getRangeByIndexes(5+i,0,1,labels.length).format.fill='#F2F6F9';
 s.freezePanes.freezeRows(5);
 s.freezePanes.freezeColumns(1);
 return s;
};
const v=(s,addr,value)=>s.getRange(addr).values=[[value]];
const f=(s,addr,formula)=>s.getRange(addr).formulas=[[formula]];
const body=(s,row,values)=>s.getRangeByIndexes(row-1,0,1,values.length).values=[values];
const section=(s,row,text,last='D')=>{v(s,'A'+row,text);s.getRange(`A${row}:${last}${row}`).format={fill:'#E2EBF2',font:{name:'Arial',size:10,bold:true,color:'#193B5A'},rowHeight:25};};
const ref=(name,col)=>`'${name}'!$${col}$6:$${col}$${ends[name]}`;
const total=(s,row,last='D')=>s.getRange(`A${row}:${last}${row}`).format={fill:'#E2EBF2',font:{name:'Arial',size:10,bold:true,color:'#172B4D'},borders:{top:{style:'thin',color:'#AFC1D0'}}};

// Controls and provenance. User adjustments never write back to patient records.
let s=title('Inputs','Reporting basis and manual additions','Blue figures in amber cells are editable inputs.');
header(s,5,['Input','Value','Basis']);
s.getRange('A:A').format.columnWidth=42;s.getRange('B:B').format.columnWidth=23;s.getRange('C:C').format.columnWidth=100;
const controls=[
 ['Period start',daySerial('2026-10-01T00:00:00+05:30'),'October 2026, Asia/Kolkata'],
 ['Database cutoff',serial(cutoff),'Repeatable-read snapshot. 30 October is partial; 31 October is excluded.'],
 ['Allocation days',cutoffDay,'Even spread across elapsed calendar dates; estimated allocation only.'],
 ['Manual consultations',12,'User-confirmed missing consultations; original dates and doctor counts unavailable.'],
 ['Consultation fee (INR)',500,'User confirmed ₹500 per consultation. Existing recorded fees are preserved.'],
 ['Manual daycare cases',5,'User-confirmed total missing daycare cases. No further cases assumed.'],
 ['Daycare fee (INR)',500,'User confirmed ₹500 per daycare case.'],
 ['Manual cash received (INR)',null,'Unknown. Enter confirmed receipts only; blank is not zero.'],
 ['Doctors for manual allocation',3,'Distinct active Doctor profiles by name: Amit Agarwal, Rensi, Ruchi Patel.'],
 ['Training completion basis','Conducted','User confirmed every session in the October schedule was conducted.']
];
s.getRange('A6:C15').values=controls;
s.getRange('B6').setNumberFormat('dd-mmm-yyyy');s.getRange('B7').setNumberFormat('dd-mmm-yyyy hh:mm');
s.getRange('B9:B13').format.fill='#FFF2CC';s.getRange('B9:B13').format.font.color='#174EA6';
for(const range of ['B9','B11'])s.getRange(range).dataValidation={rule:{type:'whole',operator:'between',formula1:0,formula2:100000}};
for(const range of ['B10','B12','B13'])s.getRange(range).dataValidation={rule:{type:'decimal',operator:'greaterThanOrEqual',formula1:0}};
section(s,18,'Definitions and scope','C');
const methods=[
 ['Billed value','Bill totals include recorded GST. Cancelled bills are excluded. Pharmacy stock issues are not added as revenue.'],
 ['Cash','Payment ledger by payment date, including all recorded refunds and cancelled-bill receipts. No bank reconciliation is supplied.'],
 ['Manual additions','12 consultations + 5 daycare cases = 17 service encounters. Unique patients and clinical details cannot be inferred.'],
 ['Doctor allocation','12 manual consultations are allocated equally: four each. Doctor-wise allocations are estimates, not historical records.'],
 ['Date allocation','Integer cases are spread evenly across 1–30 October. These dates are estimates and do not establish software go-live.'],
 ['Clinical denominator','Documentation indicators use only the 19 recorded October visits. Manual cases are excluded from clinical rates.'],
 ['Doctor identity','Two exact-name profiles for Dr Amit Agarwal are grouped for reporting; original IDs remain in Visits.'],
 ['Training','One clinical and one staff slot per listed date. 24 dates = 48 conducted sessions, confirmed by the user.'],
 ['Payroll period','September payroll remains September actuals. Full monthly salary rates are reference amounts, not October payroll expense.'],
 ['P&L period and entity','Bioscape company P&L covers Q1–September FY26–27. No unsupported allocation to the Meditrust clinic or October is made.'],
 ['Unavailable factors','October payroll, rent, admin expenses, paid supplier invoices, attendance hours, competency scores and clinical outcomes are unavailable.'],
 ['October close','Month-to-date MIS. Refresh after 31 October and supply October expenses before finalizing the month’s P&L.']
];
methods.forEach(([a,b],i)=>{v(s,'A'+(19+i),a);v(s,'C'+(19+i),b)});
section(s,33,'Source register','C');
const sources=[
 ['Application','Meditrust Clinics only','Clinic 238307be-362b-4fff-bb9a-3f2f9ff44519. Snapshot '+new Date(cutoff).toLocaleString('en-GB',{timeZone:'Asia/Kolkata'})+' IST.'],
 ['Billing and collections','Supabase public tables','bills, bill_items, payment_records, refund_requests; cross-month refunds inspected.'],
 ['Clinical','Supabase public tables','visits, patients, diagnoses, symptoms, prescriptions, tests_ordered, test_results, appointments, IPD and lab integration tables.'],
 ['Pharmacy','Supabase public tables','pharmacy_inward_receipts/items, dispenses, supplier returns and live stock aggregates.'],
 ['Payroll','September 2026 actuals','salary process Sep 2026 (2).xlsx, Sheet1!A1:H10. Bank, Aadhaar and PAN data omitted.'],
 ['Training','October 2026 conducted','October_2026_Training_Schedule (1).xlsx, October 2026!A1:D25; completion confirmed by user.'],
 ['Financial context','Bioscape FY26–27','P&L- Bioscape Healthspan Private Limited (2).pdf, pages 1–2. Original amounts in INR lakh.'],
 ['Manual activity','User confirmation','12 consultations + 5 daycare at ₹500 each. Doctor/date allocations estimated.']
];s.getRange('A34:C41').values=sources;

const doctorById=new Map(r.doctors.map(d=>[d.id,trim(d.name)]));
const doctorNames=[...new Set(r.doctors.filter(d=>d.role_name==='Doctor'&&d.is_active).map(d=>trim(d.name)))].sort();
assert.equal(doctorNames.length,3);
const patients=new Map(r.patients.map(p=>[p.id,p]));
const firstVisits=new Map(r.first_visits.map(v=>[v.patient_id,v.first_visit]));
const visitById=new Map(r.visits.map(v=>[v.id,v]));
const billsById=new Map([...extra.linked_bills,...r.bills].map(b=>[b.id,b]));
const docOf=(item,bill)=>{
 const visit=visitById.get(bill?.visit_id);
 if(visit?.doctor_id)return [doctorById.get(visit.doctor_id)||'Unassigned','Visit doctor ID'];
 const matches=doctorNames.filter(name=>trim(item.item_name).toLowerCase().includes(name.toLowerCase()));
 return matches.length===1?[matches[0],'Named bill description']:['Unassigned','No doctor link'];
};
const has=x=>x!==null&&x!==undefined&&x!=='';
const rxByVisit=id=>r.prescriptions.filter(x=>x.visit_id===id);
const dxByVisit=id=>r.diagnoses.filter(x=>x.visit_id===id);
const testByVisit=id=>r.tests.filter(x=>x.visit_id===id);
const visitRows=r.visits.map(x=>{
 const p=patients.get(x.patient_id)||{},vt=x.vitals||{},dob=dateKey(p.date_of_birth),dt=dateKey(x.encounter_at);
 let age=has(p.age)?n(p.age):null,ageBasis=has(p.age)?'Registered age':'Missing';
 if(dob){age=Number(dt.slice(0,4))-Number(dob.slice(0,4))-(dt.slice(5)<dob.slice(5)?1:0);ageBasis='DOB at encounter';}
 const diagnosis=dxByVisit(x.id),followValid=x.follow_up_date&&dateKey(x.follow_up_date)>=dt;
 const advice=(x.advice||[]).filter(a=>!String(a).includes('Please try uploading the image again'));
 return [x.id,x.patient_id,serial(x.encounter_at),daySerial(x.encounter_at),doctorById.get(x.doctor_id)||'Unassigned',x.doctor_id||'',p.gender||'Unknown',age,ageBasis,new Date(firstVisits.get(x.patient_id))<new Date(x.encounter_at)?'Returning in registry':'First in registry',Number(r.symptoms.some(a=>a.visit_id===x.id)),Number(diagnosis.length>0),rxByVisit(x.id).length,testByVisit(x.id).length,Number(['bloodPressure','pulse','temperature','respiratoryRate','oxygenSaturation'].every(k=>has(vt[k]))),Number(Object.values(vt).some(has)),Number(diagnosis.some(d=>trim(d.icd10_code))),daySerial(x.follow_up_date),Number(Boolean(followValid)),Number(Boolean(trim(x.chief_complaint))),Number(advice.length>0),x.appointment_id||'',diagnosis.map(d=>d.name).join('; '),trim(x.chief_complaint),vt.bloodPressure||'',has(vt.pulse)?n(vt.pulse):null,has(vt.temperature)?n(vt.temperature):null,has(vt.oxygenSaturation)?n(vt.oxygenSaturation):null,has(vt.respiratoryRate)?n(vt.respiratoryRate):null,has(vt.weight)?n(vt.weight):null];
});
s=table('Visits','Recorded October encounters','Source: Meditrust visit cohort. Dates and times are IST. No manual cases appear here.',
 ['Visit ID','Patient ID','Encounter at (IST)','Encounter date','Doctor','Source doctor ID','Sex','Age (years)','Age basis','Registry history','Symptoms documented','Diagnosis documented','Prescription lines','Test order lines','Five core vitals','Any vitals','ICD coded','Follow-up date','Valid follow-up date','Complaint documented','Advice documented','Appointment ID','Diagnoses','Chief complaint','BP (mmHg)','Pulse (/min)','Temperature (source unit)','SpO2 (%)','Resp. rate (/min)','Weight (kg)'],visitRows,
 [38,38,23,16,24,38,12,13,20,24,15,15,16,16,15,12,12,16,16,15,15,38,40,55,16,14,20,13,17,14]);
s.getRange(`C6:C${ends.Visits}`).setNumberFormat('dd-mmm-yyyy hh:mm');for(const col of ['D','R'])s.getRange(`${col}6:${col}${ends.Visits}`).setNumberFormat('dd-mmm-yyyy');

const billRows=r.bills.map(b=>{const pay=r.bill_payment_reconcile.find(p=>p.bill_id===b.id)||{};return [b.id,b.bill_number,serial(b.bill_date),daySerial(b.bill_date),b.bill_type,b.status,b.visit_id||'',b.patient_id,n(b.total_amount),n(b.paid_amount),n(b.balance_amount),n(b.total_refunded_amount),n(b.cgst_amount)+n(b.sgst_amount)+n(b.igst_amount),null,null,null,n(pay.ledger_payments),n(pay.ledger_refunds),null];});
s=table('Bills','Bill register and revenue eligibility','Source: October bill dates through cutoff. Current cancellation status is used.',
 ['Bill ID','Bill number','Bill at (IST)','Bill date','Module','Status','Visit ID','Patient ID','Bill total (INR)','Paid balance field','Balance due','Refund total field','GST (INR)','Eligible flag','Eligible billed value','Eligible ex-GST value','Ledger receipts','Ledger refunds','Paid-field difference'],billRows,[38,28,23,16,14,14,38,38,18,18,18,18,18,14,20,20,18,18,21]);
for(let row=6;row<=ends.Bills;row++){
 f(s,'N'+row,`=IF(F${row}="cancelled",0,1)`);f(s,'O'+row,`=I${row}*N${row}`);f(s,'P'+row,`=(I${row}-M${row})*N${row}`);f(s,'S'+row,`=J${row}-(Q${row}-R${row})`);
}s.getRange(`C6:C${ends.Bills}`).setNumberFormat('dd-mmm-yyyy hh:mm');s.getRange(`D6:D${ends.Bills}`).setNumberFormat('dd-mmm-yyyy');s.getRange(`I6:S${ends.Bills}`).setNumberFormat(numFmt);

const lineRows=r.bill_items.map(x=>{const b=billsById.get(x.bill_id),[doctor,basis]=docOf(x,b);return [x.id,x.bill_id,b?.bill_number||'',daySerial(b?.bill_date),x.item_type,x.item_name,n(x.quantity),n(x.billed_quantity??x.quantity),n(x.unit_price),n(x.total_price),n(x.discount),n(x.taxable_amount),n(x.cgst_amount)+n(x.sgst_amount)+n(x.igst_amount),x.cost_price_at_sale===null?null:n(x.cost_price_at_sale),n(x.refunded_amount),b?.status||'Missing bill',doctor,basis,null,null,null,null,null,null];});
s=table('Bill lines','Bill lines and calculations','Source: bill_items joined to the October bill register. Stock quantity is in packs.',
 ['Line ID','Bill ID','Bill number','Bill date','Item type','Description','Stock quantity (packs)','Billed quantity','Billed unit price','Net line total','Discount (%)','Taxable amount','Line GST','Cost / pack at sale','Refund amount','Bill status','Doctor attribution','Attribution basis','Gross value','Discount (INR)','Eligible flag','Eligible line value','Known snapshot COGS','Cost-covered taxable sales'],lineRows,[38,38,28,16,17,40,20,18,20,18,16,18,18,22,18,16,25,27,18,18,15,20,22,24]);
for(let row=6;row<=ends['Bill lines'];row++){
 f(s,'S'+row,`=H${row}*I${row}`);f(s,'T'+row,`=MAX(0,S${row}-J${row})`);f(s,'U'+row,`=IF(P${row}="cancelled",0,1)`);f(s,'V'+row,`=J${row}*U${row}`);
 f(s,'W'+row,`=IF(ISBLANK(N${row}),"",G${row}*N${row}*U${row})`);f(s,'X'+row,`=IF(AND(U${row}=1,E${row}="medicine",NOT(ISBLANK(N${row}))),L${row},0)`);
}s.getRange(`D6:D${ends['Bill lines']}`).setNumberFormat('dd-mmm-yyyy');s.getRange(`G6:O${ends['Bill lines']}`).setNumberFormat(numFmt);s.getRange(`S6:X${ends['Bill lines']}`).setNumberFormat(numFmt);

s=table('Payments','Collections and refunds','Source: payment-date ledger. All recorded refunds remain included, including possible duplicates.',
 ['Payment ID','Bill ID','Bill number','Payment at (IST)','Payment date','Record type','Method','Amount (INR)','Net cash (INR)','Bill period','Bill status'],
 r.payments.map(p=>[p.id,p.bill_id,billsById.get(p.bill_id)?.bill_number||'',serial(p.payment_date),daySerial(p.payment_date),p.record_type,p.payment_method,n(p.amount),null,dateKey(p.bill_date)<'2026-10-01'?'Earlier month':'October',p.bill_status]),[38,38,28,23,16,15,15,18,18,18,18]);
for(let row=6;row<=ends.Payments;row++)f(s,'I'+row,`=IF(F${row}="refund",-H${row},H${row})`);
s.getRange(`D6:D${ends.Payments}`).setNumberFormat('dd-mmm-yyyy hh:mm');s.getRange(`E6:E${ends.Payments}`).setNumberFormat('dd-mmm-yyyy');s.getRange(`H6:I${ends.Payments}`).setNumberFormat(numFmt);

const clinicalRows=[
 ...r.diagnoses.map(x=>['Diagnosis',x.id,x.visit_id,x.name,x.icd10_code||'',x.is_primary?'Primary':'Additional',null,'','','',null]),
 ...r.symptoms.map(x=>['Symptom',x.id,x.visit_id,x.name,x.severity||'','',null,'','',x.duration||'',null]),
 ...r.prescriptions.map(x=>['Prescription',x.id,x.visit_id,x.medicine,x.route||'','',x.quantity,x.dosage||'',x.frequency||'',x.duration||'',null]),
 ...r.tests.map(x=>['Test order',x.id,x.visit_id||'',x.testName,x.test_type,x.status,null,'',x.urgency||'','',serial(x.ordered_date||x.ordered_at)])
];
s=table('Clinical records','Clinical record detail','Source: normalized diagnoses, symptoms, prescriptions and test orders. Original wording retained.',
 ['Record type','Record ID','Visit ID','Recorded label','Code / route / type','Status','Quantity','Dose','Frequency / urgency','Duration','Order at (IST)'],clinicalRows,[20,38,38,48,24,20,15,25,25,22,23]);
s.getRange(`K6:K${ends['Clinical records']}`).setNumberFormat('dd-mmm-yyyy hh:mm');

s=table('Purchases','Pharmacy receipt register','Source: receipt dates in October. Supplier invoice dates are shown separately.',
 ['Receipt ID','Invoice number','Supplier','Receipt at (IST)','Receipt date','Supplier invoice date','Status','Taxable (INR)','Discount (INR)','GST (INR)','Grand total (INR)','Eligible purchases','Eligible ex-GST cost'],
 r.purchases.map(x=>[x.id,x.invoice_number,trim(x.supplier_name),serial(x.receipt_date),daySerial(x.receipt_date),daySerial(x.supplier_invoice_date),x.status,n(x.taxable_amount),n(x.discount_amount),n(x.cgst_amount)+n(x.sgst_amount)+n(x.igst_amount),n(x.grand_total),null,null]),[38,24,32,23,16,22,16,18,18,18,20,20,22]);
for(let row=6;row<=ends.Purchases;row++){f(s,'L'+row,`=IF(G${row}="completed",K${row},0)`);f(s,'M'+row,`=IF(G${row}="completed",H${row},0)`)}
s.getRange(`D6:D${ends.Purchases}`).setNumberFormat('dd-mmm-yyyy hh:mm');s.getRange(`E6:F${ends.Purchases}`).setNumberFormat('dd-mmm-yyyy');s.getRange(`H6:M${ends.Purchases}`).setNumberFormat(numFmt);

// Training is actual conducted activity, on the user's explicit confirmation.
const trainingSource=attachments['October_2026_Training_Schedule (1).xlsx'].sheets[0].rows.slice(1);
const trainingRows=trainingSource.map(cells=>{const d=Object.fromEntries(cells.map(c=>[c.cell.replace(/\d+/,''),c.value]));const [dd,mon,yy]=String(d.A).split('-');const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const dt=Date.UTC(+yy,months.indexOf(mon),+dd)/86400000+25569;return [dt,d.B,d.C,'Conducted',d.D,'Conducted',null,null,null,null];});
s=table('Training','October training conducted','All listed sessions were conducted, confirmed by the user on 30 October 2026.',
 ['Date','Day','Clinical topic','Clinical status','Staff training topic','Staff status','Clinical count','Staff count','Total sessions','Attendance / hours'],trainingRows,[17,16,55,18,57,18,17,17,18,26]);
for(let row=6;row<=ends.Training;row++){
 f(s,'G'+row,`=IF(D${row}="Conducted",1,0)`);f(s,'H'+row,`=IF(F${row}="Conducted",1,0)`);f(s,'I'+row,`=SUM(G${row}:H${row})`);v(s,'J'+row,'Not supplied');
 s.getRange(`C${row}:F${row}`).format.wrapText=true;s.getRange(`A${row}:J${row}`).format.rowHeight=42;
}s.getRange(`A6:A${ends.Training}`).setNumberFormat('dd-mmm-yyyy');
const tr=ends.Training+2;v(s,'C'+tr,'Conducted totals');f(s,'G'+tr,`=SUM(G6:G${ends.Training})`);f(s,'H'+tr,`=SUM(H6:H${ends.Training})`);f(s,'I'+tr,`=SUM(I6:I${ends.Training})`);total(s,tr,'J');
v(s,'A'+(tr+2),'48 slots across 24 dates. Session length, attendance and assessment scores were not supplied.');

const payroll=attachments['salary process Sep 2026 (2).xlsx'].sheets[0].rows.slice(1).map(cells=>Object.fromEntries(cells.map(c=>[c.cell.replace(/\d+/,''),c.value])));
s=table('People costs','People costs: September actuals','Source: salary process Sep 2026 (2).xlsx, Sheet1!A1:H10. Not October payroll.',
 ['Name','Engagement','Designation','Monthly rate (INR)','Period days','Pay days','Payable (INR)','Recomputed payable','Difference (INR)'],
 payroll.map(p=>[trim(p.B),p.C,trim(p.D),n(p.E),n(p.F),n(p.G),n(p.H),null,null]),[34,19,34,22,15,15,22,23,21]);
for(let row=6;row<=ends['People costs'];row++){f(s,'H'+row,`=D${row}/E${row}*F${row}`);f(s,'I'+row,`=G${row}-H${row}`)}
s.getRange(`D6:I${ends['People costs']}`).setNumberFormat(numFmt);
const pr=ends['People costs']+2;v(s,'A'+pr,'Total September payable');f(s,'D'+pr,`=SUM(D6:D${ends['People costs']})`);f(s,'G'+pr,`=SUM(G6:G${ends['People costs']})`);f(s,'H'+pr,`=SUM(H6:H${ends['People costs']})`);f(s,'I'+pr,`=SUM(I6:I${ends['People costs']})`);total(s,pr,'I');s.getRange(`D${pr}:I${pr}`).setNumberFormat(moneyFmt);
section(s,pr+3,'September payroll coverage','C');
body(s,pr+4,['Employees',null]);f(s,'B'+(pr+4),`=COUNTIF(B6:B${ends['People costs']},"Employee")`);
body(s,pr+5,['Consultants',null]);f(s,'B'+(pr+5),`=COUNTIF(B6:B${ends['People costs']},"Consultant")`);
body(s,pr+6,['Employee payable (INR)',null]);f(s,'B'+(pr+6),`=SUMIF(B6:B${ends['People costs']},"Employee",G6:G${ends['People costs']})`);
body(s,pr+7,['Consultant payable (INR)',null]);f(s,'B'+(pr+7),`=SUMIF(B6:B${ends['People costs']},"Consultant",G6:G${ends['People costs']})`);
v(s,'A'+(pr+9),'Monthly rates total ₹514,000 if all listed roles are paid for a full month. This is a reference, not October actuals.');
v(s,'A'+(pr+10),'September payable is ₹358,000; payment disbursement evidence and October attendance/payroll were not supplied.');

s=title('Financial context','Bioscape financial context','Historical company actuals through September. All figures on this sheet are INR lakh.');
s.getRange('A:A').format.columnWidth=39;s.getRange('B:F').format.columnWidth=16;
header(s,5,['Particulars','Q1 FY26–27','July','August','September','YTD September']);
const pl=[
 ['Revenue','-',null,null,null,'-'],['Direct cost',null,null,null,null,'-'],['Gross contribution','-','-','-',null,'-'],
 ['Employee cost',null,0.4,0.6,3.6,4.6],['Rent and electricity',null,2.6,2.6,2.6,7.8],['Sales and marketing',null,null,null,null,'-'],['Other administrative',2.4,3.3,1.2,0.6,7.5],['Total indirect expenses',2.4,6.3,4.4,6.8,19.9],['EBIDTA (source label)',-2.4,-6.3,-4.4,-6.8,-19.9],['Depreciation','-','-',null,null,'-'],['Finance cost',null,null,null,null,'-'],['PBT',-2.4,-6.34,-4.39,-6.81,-19.9]
];s.getRange('A6:F17').values=pl;s.getRange('B6:F17').setNumberFormat('0.00;(0.00);"-"');total(s,13,'F');total(s,17,'F');
section(s,20,'Funding and utilization reported in the PDF','C');header(s,21,['Particular','INR lakh','Basis']);
const funding=[['Promoter loan',100,'Reported source of funds'],['Biomap loan',60,'Reported source of funds'],['Total funding',null,'Sum of reported funding'],['Equipment',6,'Reported utilization'],['Infrastructure',64,'Reported utilization'],['Expenses',21,'Reported utilization'],['Deposits',18,'Reported utilization'],['Total utilization',null,'Sum of reported utilization'],['Funding less utilization',null,'Calculated residual, not bank-confirmed cash'],['Reported bank balance',50,'As stated in the source; date not specified'],['Unexplained difference',null,'₹1 lakh: funding less utilization is 51; reported bank is 50']];
s.getRange('A22:C32').values=funding;f(s,'B24','=SUM(B22:B23)');f(s,'B29','=SUM(B25:B28)');f(s,'B30','=B24-B29');f(s,'B32','=B30-B31');
section(s,35,'October–March funding estimate in the source','C');header(s,36,['Particular','INR lakh','Source status']);
s.getRange('A37:C43').values=[['Capex',150,'Approximate; ₹50 lakh per facility'],['Expenses',60,'Source estimate, not actual October expenses'],['Biomap loan repayment',60,'Source estimate'],['Miscellaneous',30,'Source estimate'],['Total funding requirement',null,'Source estimate'],['Bank funds assumed available',50,'Source assumption'],['Promoter funding requirement',null,'Source estimate']];
f(s,'B41','=SUM(B37:B40)');f(s,'B43','=B41-B42');total(s,41,'C');
s.getRange('B22:B43').setNumberFormat(numFmt);s.getRange('C:C').format.columnWidth=80;
v(s,'A46','Source: P&L- Bioscape Healthspan Private Limited (2).pdf, pages 1–2. Dashes/blanks are preserved.');
v(s,'A47','The source states its October–March funding figures are estimates. They are not posted as October actual expenses.');
v(s,'A48','September payable ₹3.58 lakh versus P&L employee cost ₹3.6 lakh: ₹0.02 lakh difference, consistent with rounding.');

// Doctor summary combines exact-name duplicate profiles only.
s=title('Doctors','Doctor-wise October MIS','Recorded visits use profile IDs. Manual consultation allocation: four each, estimated.');
header(s,5,['Doctor','Recorded visits','Allocated consultations','Total consultations','Recorded fee lines','Recorded fee value','Manual fee value','Adjusted fee value']);
s.getRange('A:A').format.columnWidth=28;s.getRange('B:H').format.columnWidth=21;
const docRows=[...doctorNames,'Unassigned'];
for(let i=0;i<docRows.length;i++){
 const row=6+i;v(s,'A'+row,docRows[i]);f(s,'B'+row,`=COUNTIF(${ref('Visits','E')},A${row})`);
 f(s,'C'+row,i<doctorNames.length?`=INT('Inputs'!$B$9/'Inputs'!$B$14)+IF(${i+1}<=MOD('Inputs'!$B$9,'Inputs'!$B$14),1,0)`:'=0');
 f(s,'D'+row,`=SUM(B${row}:C${row})`);
 f(s,'E'+row,`=COUNTIFS(${ref('Bill lines','E')},"consultation",${ref('Bill lines','Q')},A${row},${ref('Bill lines','U')},1)`);
 f(s,'F'+row,`=SUMIFS(${ref('Bill lines','V')},${ref('Bill lines','E')},"consultation",${ref('Bill lines','Q')},A${row})`);
 f(s,'G'+row,`=C${row}*'Inputs'!$B$10`);f(s,'H'+row,`=SUM(F${row}:G${row})`);
}v(s,'A11','Total');for(const col of ['B','C','D','E','F','G','H'])f(s,col+'11',`=SUM(${col}6:${col}9)`);total(s,11,'H');s.getRange('F6:H11').setNumberFormat(moneyFmt);
v(s,'A14','Dr Amit Agarwal: two source profiles, six and nine recorded visits, grouped as one doctor.');
v(s,'A15','Doctor fees are attributed by visit link, then exact named bill description. Generic descriptions stay unassigned.');
v(s,'A16','Visit count and bill-line count are different measures; missing links and free consultations prevent one-to-one matching.');
v(s,'A17','Dr Rutvik is an Admin/MO profile with no recorded October visits; no invented consultations are assigned to him.');
v(s,'A18','Daycare doctor attribution is unavailable. Manual daycare cases are not assigned to a doctor.');

s=title('Daily','Daily October activity and collections','Manual cases are evenly allocated estimates. Recorded activity and cash retain their actual dates.');
header(s,5,['Date','Recorded visits','Allocated consultations','All consultations','Allocated daycare','All service encounters','Recorded billed value','Manual fee value','Adjusted billed value','Ledger receipts','Ledger refunds','Net ledger cash','Coverage']);
s.getRange('A:A').format.columnWidth=17;s.getRange('B:M').format.columnWidth=21;
for(let d=1;d<=31;d++){
 const row=d+5;v(s,'A'+row,daySerial(`2026-10-${String(d).padStart(2,'0')}T00:00:00+05:30`));
 const eligible=d<=cutoffDay;
 v(s,'M'+row,eligible?(d===cutoffDay?'Partial day at cutoff':'Through cutoff'):'Not yet reported');
 if(!eligible)continue;
 f(s,'B'+row,`=COUNTIF(${ref('Visits','D')},A${row})`);
 f(s,'C'+row,`=INT(${d}*'Inputs'!$B$9/'Inputs'!$B$8)-INT(${d-1}*'Inputs'!$B$9/'Inputs'!$B$8)`);
 f(s,'D'+row,`=SUM(B${row}:C${row})`);
 f(s,'E'+row,`=INT(${d}*'Inputs'!$B$11/'Inputs'!$B$8)-INT(${d-1}*'Inputs'!$B$11/'Inputs'!$B$8)`);
 f(s,'F'+row,`=D${row}+E${row}`);f(s,'G'+row,`=SUMIF(${ref('Bills','D')},A${row},${ref('Bills','O')})`);
 f(s,'H'+row,`=C${row}*'Inputs'!$B$10+E${row}*'Inputs'!$B$12`);f(s,'I'+row,`=SUM(G${row}:H${row})`);
 f(s,'J'+row,`=SUMIFS(${ref('Payments','H')},${ref('Payments','E')},A${row},${ref('Payments','F')},"payment")`);
 f(s,'K'+row,`=SUMIFS(${ref('Payments','H')},${ref('Payments','E')},A${row},${ref('Payments','F')},"refund")`);f(s,'L'+row,`=J${row}-K${row}`);
}s.getRange('A6:A36').setNumberFormat('dd-mmm-yyyy');s.getRange('G6:L38').setNumberFormat(numFmt);v(s,'A38','MTD total');for(const col of ['B','C','D','E','F','G','H','I','J','K','L'])f(s,col+'38',`=SUM(${col}6:${col}36)`);total(s,38,'M');s.freezePanes.freezeRows(5);

s=title('Clinical','Clinical MIS: recorded encounters','Clinical rates use 19 software visits. The 17 manual service encounters have no clinical detail.');
s.getRange('A:A').format.columnWidth=40;s.getRange('B:D').format.columnWidth=16;s.getRange('E:E').format.columnWidth=67;
header(s,5,['Indicator','Count','Denominator','Rate','Definition']);
const cm=[
 ['Recorded visits',`=COUNTA(${ref('Visits','A')})`,null,null,'October encounter dates through cutoff.'],
 ['Unique recorded patients',new Set(r.visits.map(x=>x.patient_id)).size,null,null,'Unique patient IDs in the recorded visit cohort.'],
 ['First visits in the registry',`=COUNTIF(${ref('Visits','J')},"First in registry")`,19,null,'First software visit; not proof of first-ever clinic visit.'],
 ['Returning visits in the registry',`=COUNTIF(${ref('Visits','J')},"Returning in registry")`,19,null,'Earlier software visit exists for the same patient ID.'],
 ['Chief complaint documented',`=SUM(${ref('Visits','T')})`,19,null,'Non-empty complaint text.'],
 ['Structured symptoms documented',`=SUM(${ref('Visits','K')})`,19,null,'At least one normalized symptom record.'],
 ['Diagnosis documented',`=SUM(${ref('Visits','L')})`,19,null,'At least one diagnosis in the normalized diagnosis table.'],
 ['ICD-10 coded visits',`=SUM(${ref('Visits','Q')})`,19,null,'At least one diagnosis has a non-empty ICD-10 code.'],
 ['Visits with prescriptions',`=COUNTIF(${ref('Visits','M')},">0")`,19,null,'At least one prescription line.'],
 ['Prescription lines',`=SUM(${ref('Visits','M')})`,null,null,'Lines, not unique medicines or packs dispensed.'],
 ['Any vitals documented',`=SUM(${ref('Visits','P')})`,19,null,'At least one entered vital value.'],
 ['Five core vitals documented',`=SUM(${ref('Visits','O')})`,19,null,'BP, pulse, temperature, respiratory rate and SpO2.'],
 ['Follow-up date documented',r.visits.filter(x=>x.follow_up_date).length,19,null,'Includes dates that precede the visit; review separately.'],
 ['Valid follow-up date',`=SUM(${ref('Visits','S')})`,19,null,'Follow-up date on or after encounter calendar date.'],
 ['Clinical advice documented',`=SUM(${ref('Visits','U')})`,19,null,'Excludes the software image-upload error text.'],
 ['Visits with test orders',`=COUNTIF(${ref('Visits','N')},">0")`,19,null,'Orders linked to this visit cohort.'],
 ['Test orders linked to cohort',`=SUM(${ref('Visits','N')})`,null,null,'One row per ordered test; excludes orders for earlier visits.'],
 ['Test orders dated in October',r.tests.filter(t=>dateKey(t.ordered_date||t.ordered_at)>='2026-10-01').length,null,null,'Includes orders against earlier encounters.'],
 ['Results recorded in the application',r.test_results.length,null,null,'No application or integrated lab results found at cutoff.'],
 ['Completed appointment records',r.appointments.filter(a=>a.status==='Completed').length,r.appointments.length,null,'Ten completed of eleven appointment records.'],
 ['Past scheduled appointments',r.appointments.filter(a=>a.status==='Scheduled'&&a.appointment_date<cutoff).length,null,null,'Not labelled no-show without attendance evidence.']
];
cm.forEach((a,i)=>{const row=6+i;body(s,row,[a[0],typeof a[1]==='number'?a[1]:null,a[2],null,a[4]]);if(typeof a[1]==='string')f(s,'B'+row,a[1]);if(a[2]!==null)f(s,'D'+row,`=IF(C${row}=0,"n.a.",B${row}/C${row})`);});s.getRange('D6:D26').setNumberFormat('0.0%');
section(s,29,'Patient demographics: recorded patients only','E');header(s,30,['Group','Patients','Denominator','Share','Basis']);
const demographics=[['Male',visitRows.filter(x=>x[6]==='male').length],['Female',visitRows.filter(x=>x[6]==='female').length],['Age under 18',visitRows.filter(x=>x[7]!==null&&x[7]<18).length],['Age 18–39',visitRows.filter(x=>x[7]>=18&&x[7]<40).length],['Age 40–59',visitRows.filter(x=>x[7]>=40&&x[7]<60).length],['Age 60+',visitRows.filter(x=>x[7]>=60).length]];
demographics.forEach(([label,count],i)=>{const row=31+i;body(s,row,[label,count,19,null,i<2?'Recorded patient sex':'DOB at encounter where available; otherwise registered age']);f(s,'D'+row,`=B${row}/C${row}`)});s.getRange('D31:D36').setNumberFormat('0.0%');
section(s,39,'Diagnosis mix: original clinical labels','E');header(s,40,['Recorded diagnosis','Visits','Documented visits','Share','Interpretation']);
const dxNames=[...new Set(r.diagnoses.map(x=>trim(x.name).toUpperCase()))].map(name=>[name,new Set(r.diagnoses.filter(x=>trim(x.name).toUpperCase()===name).map(x=>x.visit_id)).size]).sort((a,b)=>b[1]-a[1]);
dxNames.forEach(([label,count],i)=>{const row=41+i;body(s,row,[label,count,new Set(r.diagnoses.map(x=>x.visit_id)).size,null,label.startsWith('?')?'Provisional wording retained':'Case/whitespace normalized only']);f(s,'D'+row,`=B${row}/C${row}`)});s.getRange(`D41:D${40+dxNames.length}`).setNumberFormat('0.0%');
v(s,'A56','Daycare procedures, outcomes, complications, readmissions, waiting times and satisfaction were not recorded.');
v(s,'A57','No clinical diagnoses, vitals or outcomes have been invented for the manually reported cases.');

s=title('Pharmacy','Pharmacy MIS','Sales are billed amounts. Purchases and stock are separate from clinic profit and cash payments.');
s.getRange('A:A').format.columnWidth=45;s.getRange('B:B').format.columnWidth=22;s.getRange('C:C').format.columnWidth=95;header(s,5,['Indicator','Value','Basis']);
const ph=[
 ['Pharmacy sales, GST included',`=SUMIFS(${ref('Bills','O')},${ref('Bills','E')},"pharmacy")`,'11 non-cancelled pharmacy bills.'],
 ['Pharmacy GST on bills',`=SUMIFS(${ref('Bills','M')},${ref('Bills','E')},"pharmacy",${ref('Bills','N')},1)`,'Recorded bill-level GST.'],
 ['Pharmacy sales excluding GST',`=B6-B7`,'Bill totals less recorded bill-level GST.'],
 ['Pharmacy sale lines',`=COUNTIFS(${ref('Bill lines','E')},"medicine",${ref('Bill lines','U')},1)`,'One bill line per medicine line.'],
 ['Lines missing cost-at-sale',r.bill_items.filter(x=>x.item_type==='medicine'&&x.cost_price_at_sale===null&&billsById.get(x.bill_id)?.status!=='cancelled').length,'No current catalogue cost substituted for missing historical cost.'],
 ['Known snapshot COGS',`=SUM(${ref('Bill lines','W')})`,'Stock quantity in packs × cost per pack. Only cost-covered sales.'],
 ['Taxable sales with known cost',`=SUM(${ref('Bill lines','X')})`,'Only lines with a recorded cost snapshot.'],
 ['Partial margin on covered lines',`=B12-B11`,'Incomplete; not total pharmacy gross profit.'],
 ['Total pharmacy gross profit','n.a.','Missing historical cost on five sale lines.'],
 ['Completed purchase receipts',`=COUNTIF(${ref('Purchases','G')},"completed")`,'Receipt date basis, not supplier invoice date or payment date.'],
 ['Purchase receipts, GST included',`=SUM(${ref('Purchases','L')})`,'Not cash paid and not full-period cost of goods sold.'],
 ['Purchase taxable value',`=SUM(${ref('Purchases','M')})`,'Before purchase GST.'],
 ['Purchase GST',`=B16-B17`,'Recorded purchase receipt totals less taxable values.'],
 ['Supplier returns recorded',r.supplier_returns.length,'No October supplier debit notes found.'],
 ['Dispense stock records',r.dispenses.length,'Not an additional revenue source.'],
 ['Active catalogue products',n(extra.stock_summary[0].active_products),'Snapshot at supplemental extraction; not 31 October closing stock.'],
 ['Products with positive stock',n(extra.stock_summary[0].stocked_products),'Snapshot only.'],
 ['At/below reorder level',n(extra.stock_summary[0].at_or_below_reorder),'Recorded reorder rule.'],
 ['Negative-stock products',n(extra.stock_summary[0].negative_stock_products),'Snapshot only.'],
 ['Expired positive-stock lots',n(extra.expired_lots[0].lots),'Recorded expiry date before 30 October.']
];ph.forEach(([label,val,basis],i)=>{const row=6+i;body(s,row,[label,typeof val==='number'||!String(val).startsWith('=')?val:null,basis]);if(String(val).startsWith('='))f(s,'B'+row,val)});
for(const row of [6,7,8,11,12,13,16,17,18])s.getRange('B'+row).setNumberFormat(moneyFmt);
section(s,29,'Purchases by supplier','C');header(s,30,['Supplier','Receipt value (INR)','Basis']);
const suppliers=[...new Set(r.purchases.map(p=>trim(p.supplier_name)))].sort();
suppliers.forEach((name,i)=>{const row=31+i;body(s,row,[name,null,'Completed receipt totals']);f(s,'B'+row,`=SUMIFS(${ref('Purchases','L')},${ref('Purchases','C')},A${row})`)});s.getRange(`B31:B${30+suppliers.length}`).setNumberFormat(moneyFmt);
v(s,'A'+(33+suppliers.length),'One October receipt, ₹7,928.02, carries a September supplier invoice date.');

s=title('MIS','Meditrust Clinics: October 2026 MIS','Month to date through 30 October 2026, '+new Date(cutoff).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'})+' IST. Final month-end close is pending.');
s.getRange('A:A').format.columnWidth=43;s.getRange('B:D').format.columnWidth=21;s.getRange('E:E').format.columnWidth=3;s.getRange('F:L').format.columnWidth=14;
header(s,5,['Service activity','Recorded','Manual additions','Adjusted total']);
const mainRows=[['Consultation encounters',`='Clinical'!B6`,`='Inputs'!B9`],['Daycare service encounters',0,`='Inputs'!B11`],['Total service encounters',`=SUM(B6:B7)`,`=SUM(C6:C7)`]];
mainRows.forEach(([label,b,c],i)=>{const row=6+i;v(s,'A'+row,label);typeof b==='number'?v(s,'B'+row,b):f(s,'B'+row,b);f(s,'C'+row,c);f(s,'D'+row,`=SUM(B${row}:C${row})`)});total(s,8);
v(s,'A10','19 unique patients are identifiable in software. Manual cases may include repeat patients.');
section(s,12,'Billed value (INR, including recorded GST)');header(s,13,['Income head','Recorded','Manual additions','Adjusted total']);
const heads=[['Consultations','consultation',`='Inputs'!B9*'Inputs'!B10`],['Daycare',null,`='Inputs'!B11*'Inputs'!B12`],['Investigations','test','=0'],['Procedures','procedure','=0'],['Pharmacy','medicine','=0']];
heads.forEach(([label,type,manual],i)=>{const row=14+i;v(s,'A'+row,label);type?f(s,'B'+row,`=SUMIFS(${ref('Bill lines','V')},${ref('Bill lines','E')},"${type}")`):v(s,'B'+row,0);f(s,'C'+row,manual);f(s,'D'+row,`=SUM(B${row}:C${row})`)});
v(s,'A19','Total billed value');for(const col of ['B','C','D'])f(s,col+'19',`=SUM(${col}14:${col}18)`);total(s,19);
v(s,'A20','Recorded GST');f(s,'B20',`=SUMIFS(${ref('Bills','M')},${ref('Bills','N')},1)`);v(s,'C20',0);f(s,'D20','=SUM(B20:C20)');
v(s,'A21','Billed value excluding recorded GST');for(const col of ['B','C','D'])f(s,col+'21',`=${col}19-${col}20`);total(s,21);s.getRange('B14:D21').setNumberFormat(moneyFmt);
section(s,24,'Cash ledger (INR)');header(s,25,['Cash movement','Recorded','Manual receipts','Combined if confirmed']);
v(s,'A26','Payments received');f(s,'B26',`=SUMIF(${ref('Payments','F')},"payment",${ref('Payments','H')})`);
v(s,'A27','Refunds paid');f(s,'B27',`=SUMIF(${ref('Payments','F')},"refund",${ref('Payments','H')})`);
v(s,'A28','Net recorded cash movement');f(s,'B28','=B26-B27');total(s,28);
v(s,'A29','Confirmed manual cash receipts');f(s,'C29',`=IF(ISBLANK('Inputs'!B13),"Unconfirmed",'Inputs'!B13)`);f(s,'D29',`=IF(ISBLANK('Inputs'!B13),"Unconfirmed",B28+'Inputs'!B13)`);
s.getRange('B26:D29').setNumberFormat(moneyFmt);
section(s,32,'Operations and financial context');
const highlights=[
 ['Conducted training dates',trainingRows.length,'24 clinical + 24 staff sessions; user confirmed completed.'],
 ['Conducted training sessions',null,'48 session slots. Attendance, duration and scores unavailable.'],
 ['Purchase receipts (INR)',null,'Purchases are not clinic expenses or cash paid.'],
 ['September payable (INR)',null,'9 listed people: 6 employees and 3 consultants.'],
 ['September company PBT (INR lakh)',-6.81,'Bioscape source P&L, historical company-level actual.'],
 ['YTD September PBT (INR lakh)',-19.9,'Historical source P&L; October is not included.'],
 ['October clinic operating profit','n.a.','October payroll, rent, admin expenses and complete COGS missing.']
];highlights.forEach(([label,val,note],i)=>{const row=33+i;v(s,'A'+row,label);if(val!==null)v(s,'B'+row,val);v(s,'F'+row,note)});
f(s,'B34',`='Training'!I${tr}`);f(s,'B35',`='Pharmacy'!B16`);f(s,'B36',`='People costs'!G${pr}`);s.getRange('B35:B36').setNumberFormat(moneyFmt);s.getRange('B37:B38').setNumberFormat(numFmt);
section(s,42,'Items requiring review','L');
const overviewNotes=[
 'A ₹500 September bill has two ₹500 refunds: potential excess refund ₹500. Both remain in cash totals.',
 'Nine cancelled bills are excluded from billed value. Three active consultation lines are free after 100% discount.',
 'One of 19 visits lacks a doctor; 28 of 29 OPD bills lack a visit ID. Doctor fee attribution is therefore limited.',
 'Five visits lack diagnoses; no application results were found for the 25 October test orders.',
 'Manual date and doctor allocations are estimates. ₹8,500 is service value; payment receipt is unconfirmed.',
 'Training is reported as conducted. The financial attachments retain their September and source-estimate periods.'
];overviewNotes.forEach((note,i)=>v(s,'A'+(43+i),note));

// Native chart, linked to the service activity rows.
const chart=s.charts.add('bar',[s.getRange('A5:A7'),s.getRange('B5:B7'),s.getRange('C5:C7')]);
chart.title='Recorded and manual service activity';chart.titleTextStyle.fontSize=12;chart.titleTextStyle.typeface='Arial';chart.setPosition('F5','M20');
chart.xAxis={axisType:'textAxis',textStyle:{typeface:'Arial',fontSize:10}};chart.yAxis={numberFormatCode:'0',numberFormatSourceLinked:false,textStyle:{typeface:'Arial',fontSize:10}};
chart.series.items[0].fill='#193B5A';chart.series.items[1].fill='#91B4CE';chart.legend={position:'top',textStyle:{typeface:'Arial',fontSize:10}};

// Terminal checks. No report formula reads from this sheet.
s=title('Review','Reconciliation and data review','Checks compare workbook calculations with independent reductions of the extracted records.');
s.getRange('A:A').format.columnWidth=49;s.getRange('B:D').format.columnWidth=23;s.getRange('E:E').format.columnWidth=80;
header(s,5,['Control','Workbook result','Source control','Difference','Basis']);
const eligible=r.bills.filter(b=>b.status!=='cancelled');
const checks=[
 ['Recorded visits',`='Clinical'!B6`,r.visits.length,'Exact encounter-row count.'],
 ['Eligible billed value',`='MIS'!B19`,round(sum(eligible,'total_amount')),'Bill header totals, excluding nine cancelled bills.'],
 ['All bill headers',`=COUNTA(${ref('Bills','A')})`,r.bills.length,'Includes cancelled and zero-value bills.'],
 ['Payment receipts',`='MIS'!B26`,round(sum(r.payments.filter(p=>p.record_type==='payment'),'amount')),'All positive payment ledger entries in period.'],
 ['Refunds paid',`='MIS'!B27`,round(sum(r.payments.filter(p=>p.record_type==='refund'),'amount')),'Includes earlier-period bills.'],
 ['Purchase receipt value',`='Pharmacy'!B16`,round(sum(r.purchases.filter(p=>p.status==='completed'),'grand_total')),'Receipt-date basis.'],
 ['Doctor recorded visits',`='Doctors'!B11`,r.visits.length,'Canonical doctors plus unassigned.'],
 ['Doctor manual consultations',`='Doctors'!C11`,12,'User confirmed total.'],
 ['Daily manual consultations',`='Daily'!C38`,12,'Integer daily allocation.'],
 ['Daily manual daycare',`='Daily'!E38`,5,'Integer daily allocation.'],
 ['Daily billed value',`='Daily'!G38`,round(sum(eligible,'total_amount')),'Actual billing dates, IST.'],
 ['Training clinical sessions',`='Training'!G${tr}`,24,'24 listed dates; user confirmed conducted.'],
 ['Training staff sessions',`='Training'!H${tr}`,24,'24 listed dates; user confirmed conducted.'],
 ['September payroll payable',`='People costs'!G${pr}`,payroll.reduce((t,p)=>t+n(p.H),0),'Original payable salary values.'],
 ['September payroll calculation',`='People costs'!I${pr}`,0,'Monthly rate / 30 × pay days versus supplied payable.'],
 ['Bill-line/header reconciliation',`=SUM(${ref('Bill lines','V')})-SUM(${ref('Bills','O')})`,0,'Checks bill lines against eligible header totals.'],
 ['Paid-field/ledger net reconciliation',`=SUM(${ref('Bills','S')})`,0,'Paid fields versus receipts less refunds, per October bill.']
];checks.forEach(([label,formula,expected,basis],i)=>{const row=6+i;body(s,row,[label,null,expected,null,basis]);f(s,'B'+row,formula);f(s,'D'+row,`=B${row}-C${row}`)});s.getRange(`B6:D${5+checks.length}`).setNumberFormat('0.00');
s.getRange(`D6:D${5+checks.length}`).conditionalFormats.addCustom('ABS(D6)>0.01',{fill:'#FCE5E5',font:{bold:true,color:'#9C2424'}});
const issues=[
 ['Potential excess refund',1,'b8c53ca8-25b6-4c72-b282-8111183dbbb9','Two separate paid refund requests of ₹500 against one ₹500 September bill. Confirm actual cash payout; potential excess ₹500.'],
 ['Cancelled October bills',r.bills.filter(b=>b.status==='cancelled').length,'Bills','Excluded from billed value; cash entries remain in cash analysis.'],
 ['Zero consultation fees',r.bill_items.filter(i=>i.item_type==='consultation'&&n(i.total_price)===0&&billsById.get(i.bill_id)?.status!=='cancelled').length,'Bill lines','Three active zero-value Rensi consultation lines carry 100% discount. Do not impute ₹500 on top of recorded actuals.'],
 ['Lower recorded consultation fees',r.bill_items.filter(i=>i.item_type==='consultation'&&n(i.total_price)>0&&n(i.total_price)<500&&billsById.get(i.bill_id)?.status!=='cancelled').length,'Bill lines','Two ₹300 fees preserved. ₹500 applies to the user’s manual additions.'],
 ['OPD bills without visit ID',r.bills.filter(b=>b.bill_type==='opd'&&!b.visit_id).length,'Bills','28 of 29 OPD bills lack an explicit visit link. No speculative visit linkage applied.'],
 ['Visits without doctor',r.visits.filter(v=>!v.doctor_id).length,'Visits','Unassigned in the doctor summary.'],
 ['Same-name doctor profiles',2,'Dr Amit Agarwal','Grouped by exact name for reporting; no source data merged.'],
 ['Visits without diagnosis',r.visits.filter(v=>!dxByVisit(v.id).length).length,'Visits','Clinical completeness denominator is the 19 software visits.'],
 ['Follow-up date before encounter',r.visits.filter(v=>v.follow_up_date&&dateKey(v.follow_up_date)<dateKey(v.encounter_at)).length,'Visits','Excluded from valid follow-up dates.'],
 ['Software error saved as advice',r.visits.filter(v=>(v.advice||[]).some(x=>String(x).includes('Please try uploading the image again'))).length,'Visits','Excluded from clinical advice documentation count.'],
 ['Test results recorded',r.test_results.length,'Clinical records','Zero results and no integrated lab order/result records found. Does not establish tests were not performed.'],
 ['Test orders linked to earlier visit',r.tests.filter(t=>!visitById.has(t.visit_id)).length,'Clinical records','Included in October order volume; excluded from October visit-cohort rates.'],
 ['Missing cost-at-sale lines',r.bill_items.filter(i=>i.item_type==='medicine'&&i.cost_price_at_sale===null).length,'Bill lines','Full pharmacy gross profit remains unavailable.'],
 ['Earlier supplier invoice',1,'Purchases: CRED004866','₹7,928.02 received in October; supplier invoice dated September.'],
 ['Funding residual difference (INR lakh)',1,'Financial context!B32','₹160 lakh funding less ₹109 lakh utilization gives ₹51 lakh; PDF reports bank ₹50 lakh. Reconcile ₹1 lakh.'],
 ['October expense accounts','Not supplied','Payroll / P&L attachments','September salary and historical company P&L do not establish October clinic operating expenses.'],
 ['Manual cash receipt','Unconfirmed','Inputs!B13','Do not include manual ₹8,500 in actual collections until confirmed.'],
 ['Training attendance and assessment','Not supplied','Training','Conducted status confirmed by user; attendance, hours and scores cannot be quantified.'],
 ['Month-end close','Pending','Reporting cutoff','Snapshot covers 1 October through 30 October 13:18 IST. 31 October activity is not included.']
];
section(s,26,'Issues, limitations and required follow-up','E');header(s,27,['Review item','Count / status','Reference','Finding']);
s.getRangeByIndexes(27,0,issues.length,4).values=issues;s.getRange(`D28:D${27+issues.length}`).format.wrapText=true;s.getRange(`A28:E${27+issues.length}`).format.rowHeight=58;s.getRange('D:D').format.columnWidth=90;

// Recalculate once, validate outputs and exercise editable controls in memory.
wb.recalculate();
const value=(sheet,cell)=>sheets[sheet].getRange(cell).values[0][0];
const approx=(a,b,label)=>assert.ok(Math.abs(Number(a)-b)<0.011,label+': '+a+' vs '+b);
assert.equal(value('MIS','D6'),31);assert.equal(value('MIS','D7'),5);assert.equal(value('MIS','D8'),36);
approx(value('MIS','D19'),17392.02,'Adjusted billed value');approx(value('MIS','B28'),7392.02,'Net ledger cash');
assert.equal(value('Training','I'+tr),48);approx(value('People costs','G'+pr),358000,'September payable');
for(let i=0;i<checks.length;i++)approx(value('Review','D'+(6+i)),0,'Check '+checks[i][0]);
v(sheets.Inputs,'B9',15);wb.recalculate();assert.equal(value('Doctors','C11'),15);assert.equal(value('Daily','C38'),15);approx(value('MIS','D19'),18892.02,'Manual input recalculation');
v(sheets.Inputs,'B9',12);v(sheets.Inputs,'B13',0);wb.recalculate();approx(value('MIS','D29'),7392.02,'Explicit zero manual cash');
v(sheets.Inputs,'B13',null);wb.recalculate();assert.equal(value('MIS','D29'),'Unconfirmed');
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},summary:'Final formula error scan',maxChars:4000});
console.log('FORMULA_SCAN',errors.ndjson);
await fs.writeFile(new URL('verification.json',dir),JSON.stringify({cutoff,checks:checks.map((x,i)=>({name:x[0],difference:value('Review','D'+(6+i))})),keyResults:{recordedVisits:value('MIS','B6'),manualConsultations:value('MIS','C6'),allConsultations:value('MIS','D6'),daycare:value('MIS','D7'),serviceEncounters:value('MIS','D8'),recordedBilled:value('MIS','B19'),manualBilled:value('MIS','C19'),adjustedBilled:value('MIS','D19'),netRecordedCash:value('MIS','B28'),trainingDates:24,trainingSessions:value('Training','I'+tr),septemberPayroll:value('People costs','G'+pr),recordedClinical:cm.map((x,i)=>({indicator:x[0],count:value('Clinical','B'+(6+i)),denominator:value('Clinical','C'+(6+i)),rate:value('Clinical','D'+(6+i))}))}},null,2));
const output=await SpreadsheetFile.exportXlsx(wb);await output.save(fileURLToPath(new URL('Meditrust_October_2026_MIS.xlsx',dir)));
for(const [name,range] of [['MIS','A1:M29'],['Clinical','A1:E27'],['Doctors','A1:H18'],['Daily','A1:F16'],['Training','A1:J11'],['People costs','A1:I17'],['Financial context','A1:F18'],['Pharmacy','A1:C26'],['Inputs','A1:C15'],['Visits','A1:I10'],['Bills','A1:F10'],['Bill lines','C1:L10'],['Payments','C1:K10'],['Clinical records','A1:F10'],['Purchases','B1:G10'],['Review','A1:E23']]){
 const png=await wb.render({sheetName:name,range,scale:1,format:'png'});await fs.writeFile(new URL('preview-'+name.replaceAll(' ','-')+'.png',dir),new Uint8Array(await png.arrayBuffer()));
 console.log('RENDERED',name);
}
console.log(JSON.stringify({output:'Meditrust_October_2026_MIS.xlsx',sheets:names.length,adjustedBilled:value('MIS','D19'),trainingSessions:value('Training','I'+tr),payroll:value('People costs','G'+pr)}));
