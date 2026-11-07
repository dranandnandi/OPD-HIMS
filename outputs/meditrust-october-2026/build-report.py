import json, html, datetime
from pathlib import Path
from collections import Counter
import openpyxl, pdfplumber
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4

out=Path(__file__).resolve().parent
data=json.loads(out.joinpath('source-data.json').read_text())['results']
extra=json.loads(out.joinpath('supplemental-data.json').read_text())['results']
facts=json.loads(out.joinpath('verification.json').read_text())['keyResults']
at=json.loads(out.joinpath('attachments.json').read_text(encoding='utf8'))
wb=openpyxl.load_workbook(out/'Meditrust_October_2026_MIS.xlsx',data_only=True)
pdfmetrics.registerFont(TTFont('Arial','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('Arial-Bold','C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Arial',normal='Arial',bold='Arial-Bold',italic='Arial',boldItalic='Arial-Bold')
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='ReportTitle',fontName='Arial-Bold',fontSize=21,leading=25,textColor=colors.HexColor('#193B5A'),spaceAfter=8))
styles.add(ParagraphStyle(name='ReportH',fontName='Arial-Bold',fontSize=12,leading=15,textColor=colors.HexColor('#193B5A'),spaceBefore=13,spaceAfter=7))
styles.add(ParagraphStyle(name='ReportBody',fontName='Arial',fontSize=9.4,leading=13,spaceAfter=7,textColor=colors.HexColor('#23394D')))
styles.add(ParagraphStyle(name='ReportSmall',fontName='Arial',fontSize=8,leading=10.5,spaceAfter=5,textColor=colors.HexColor('#526579')))
styles.add(ParagraphStyle(name='Cell',fontName='Arial',fontSize=8.6,leading=11,textColor=colors.HexColor('#23394D')))
styles.add(ParagraphStyle(name='CellSmall',fontName='Arial',fontSize=8.1,leading=10,textColor=colors.HexColor('#23394D')))
styles.add(ParagraphStyle(name='HeadCell',fontName='Arial-Bold',fontSize=8.5,leading=11,textColor=colors.white))
story=[]
def p(text,style='ReportBody'):
 return Paragraph(html.escape(str(text)).replace('\n','<br/>'),styles[style])
def add(text,style='ReportBody'):story.append(p(text,style))
def heading(text):add(text,'ReportH')
def money(x):return f'₹{float(x):,.2f}'
def table(headers,rows,widths,small=False):
 content=[[p(c,'HeadCell') for c in headers]]+[[p('' if c is None else c,'CellSmall' if small else 'Cell') for c in row] for row in rows]
 t=Table(content,colWidths=widths,repeatRows=1,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#193B5A')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F1F5F8')]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,0),.5,colors.HexColor('#AFC1D0'))]))
 story.append(t);story.append(Spacer(1,6))
def page(title,subtitle):add(title,'ReportTitle');add(subtitle,'ReportSmall')
def br():story.append(PageBreak())

page('Meditrust Clinics\nOctober 2026 MIS','Bioscape Healthspan Private Limited | Operational and marketing highlights through 30 October 2026')
add('October activity combines 31 consultations, five daycare service encounters, 48 conducted training sessions and digital and local marketing outreach. Clinical and billing figures use the 30 October, 13:18 IST software snapshot; marketing uses the supplied October report. September people costs and company expenses provide historical context.')
heading('Service activity')
table(['Measure','Recorded','Manual','Adjusted'],[
 ['Consultation encounters',19,12,31],['Daycare service encounters',0,5,5],['Total service encounters',19,17,36]
],[245,80,80,90])
add('The 12 additional consultations and five daycare cases are ₹500 each, adding ₹8,500 in reported service value. The software identifies 19 unique patients.','ReportSmall')
heading('Billed value and collections')
table(['Income head','Recorded','Manual','Adjusted'],[
 [wb['MIS'].cell(row,1).value,money(wb['MIS'].cell(row,2).value),money(wb['MIS'].cell(row,3).value),money(wb['MIS'].cell(row,4).value)] for row in range(14,20)
],[200,97,97,101])
table(['Cash ledger','Amount','Basis'],[
 ['Payments received',money(wb['MIS']['B26'].value),'Software payment-date ledger'],['Refunds paid',money(wb['MIS']['B27'].value),'Recorded refund transactions'],['Net recorded cash movement',money(wb['MIS']['B28'].value),'Software receipts less refunds']
],[200,100,195])
add('Billed value includes recorded GST of ₹66.29. Adjusted billed value excluding recorded GST is ₹17,325.73. Cash totals above cover recorded software transactions; the ₹8,500 additional service value is reported separately from collections.','ReportSmall')

br();page('Marketing and community outreach','October digital activity and profile snapshot through 30 October 2026')
heading('Local outreach and paid visibility')
table(['Activity / metric','Reported result'],[
 ['Pamphlets distributed','12,000'],
 ['Paid social advertising spend','₹9,775'],
 ['Paid reach','2,44,327'],
 ['Paid impressions','5,12,098'],
 ['WhatsApp clicks','1,172'],
 ['WhatsApp requests','3']
],[300,195])
heading('Facebook and Instagram content')
table(['Metric','Reported result'],[
 ['October posts published','45 Facebook + 45 Instagram posts'],
 ['Followers at the reporting snapshot','Facebook: 21 | Instagram: 83'],
 ['Facebook video library','35 videos | 53,619 reported views'],
 ['Reported 75% video views','11,815'],
 ['Featured post reactions','Dr Ruchi introduction: 286 | Clinic introduction: 201']
],[230,265])
heading('Google Business Profile engagement')
table(['Metric','October result'],[
 ['Profile impressions','625'],
 ['Mobile Maps visibility','482 impressions (77% of profile impressions)'],
 ['Other profile visibility','Mobile Search: 83 | Desktop Search: 38 | Desktop Maps: 22'],
 ['Profile actions','112: 87 direction requests + 13 call clicks + 12 website clicks'],
 ['Action rate','17.9% (112 actions / 625 impressions)'],
 ['Customer reviews and rating','7 reviews received | 4.9 / 5 rating']
],[230,265],small=True)
add('Local pamphlet distribution complemented paid visibility, regular social content, video engagement and Google discovery. Doctor and clinic introduction content generated 286 and 201 reactions respectively.','ReportSmall')
add('Sources: user-supplied marketing report dated 30 October 2026; pamphlet distribution confirmed by the user. Video-library views and follower counts are reported snapshots. Posts are counted by platform.','ReportSmall')

br();page('Clinical and doctor MIS','Clinical documentation rates use only the 19 recorded October encounters.')
heading('Doctor-wise consultations and fees')
table(['Doctor','Recorded visits','Allocated visits','Total visits','Adjusted fee value'],[
 [wb['Doctors'].cell(row,1).value,wb['Doctors'].cell(row,2).value,wb['Doctors'].cell(row,3).value,wb['Doctors'].cell(row,4).value,money(wb['Doctors'].cell(row,8).value)] for row in range(6,10)
],[155,80,80,70,110])
add('Manual consultations are allocated four each across the three distinct active Doctor names. This is an estimated reporting allocation. Dr Amit Agarwal’s two exact-name profiles are grouped, preserving the original IDs. Daycare cases remain unassigned to doctors.','ReportSmall')
add('Recorded visit counts and bill lines are reported separately. Fees use an explicit visit doctor where available, then the doctor named in the bill description.','ReportSmall')
heading('Documentation and utilization')
selected=['Chief complaint documented','Structured symptoms documented','Diagnosis documented','ICD-10 coded visits','Visits with prescriptions','Any vitals documented','Five core vitals documented','Valid follow-up date','Clinical advice documented','Visits with test orders']
items=[x for x in facts['recordedClinical'] if x['indicator'] in selected]
table(['Indicator','Recorded visits','Rate'],[[x['indicator'],f"{x['count']} / {x['denominator']}",f"{x['rate']*100:.1f}%"] for x in items],[315,95,85])
add('There are 18 first visits and one returning visit in the software registry, with 56 prescription lines. Twenty-five test orders were dated in October; 23 are linked to the October encounter cohort.','ReportSmall')
add('Patient mix: 10 male and 9 female patients. Age is calculated at the encounter from DOB where available, otherwise registered age. Five core vitals means BP, pulse, temperature, respiratory rate and SpO2. The valid follow-up indicator counts dates on or after the encounter.','ReportSmall')

br();page('Training conducted','24 training days | 24 clinical sessions | 24 general/staff sessions | 48 sessions total')
add('All sessions in the October schedule were conducted, as confirmed by the user. Each clinical or staff slot on a date is counted as one session, covering clinical protocols, patient safety, pharmacy practice and staff operations.','ReportSmall')
training=[]
for cells in at['October_2026_Training_Schedule (1).xlsx']['sheets'][0]['rows'][1:]:
 d={''.join(c for c in cell['cell'] if c.isalpha()):cell['value'] for cell in cells}
 training.append([d['A'][:6],d['C'],d['D']])
table(['Date','Clinical session conducted','Staff session conducted'],training,[50,217,228],small=True)

br();page('People and financial context','September actuals are retained in their source period. Amounts are INR unless marked lakh.')
heading('September payable salary and consultant fees')
payroll=[]
for cells in at['salary process Sep 2026 (2).xlsx']['sheets'][0]['rows'][1:]:
 d={''.join(c for c in cell['cell'] if c.isalpha()):cell['value'] for cell in cells};payroll.append([str(d['B']).strip(),d['C'],str(d['D']).strip(),money(d['H'])])
table(['Person','Type','Role','September payable'],payroll,[145,70,160,120])
add('September payable totals ₹3,58,000: ₹1,50,500 for six employees and ₹2,07,500 for three consultants. All supplied payable amounts reconcile to monthly salary ÷ 30 × pay days. The full monthly rates total ₹5,14,000; this is a reference rate, not October payroll expense.','ReportSmall')
heading('Bioscape historical company expenses')
table(['INR lakh','July','August','September','YTD September'],[
 ['Employee cost','0.40','0.60','3.60','4.60'],['Rent and electricity','2.60','2.60','2.60','7.80'],['Other administrative','3.30','1.20','0.60','7.50'],['Total indirect expenses','6.30','4.40','6.80','19.90']
],[175,75,75,80,90])
add('Source: P&L- Bioscape Healthspan Private Limited (2).pdf, page 1. Q1 indirect expense is ₹2.40 lakh. The September payroll file reports ₹3.58 lakh, consistent with the rounded ₹3.60 lakh employee-cost line. These figures retain their historical company-level reporting period.','ReportSmall')
heading('Funding context from the source PDF')
add('Reported funding is ₹160 lakh: ₹100 lakh promoter loan and ₹60 lakh Biomap loan. Reported utilization is ₹109 lakh: equipment ₹6 lakh, infrastructure ₹64 lakh, expenses ₹21 lakh and deposits ₹18 lakh. The source also reports a ₹50 lakh bank balance.','ReportSmall')
add('The source’s October-March funding requirement is an approximate ₹300 lakh: capex ₹150 lakh, expenses ₹60 lakh, Biomap repayment ₹60 lakh and miscellaneous ₹30 lakh. Against ₹50 lakh bank funds, promoter funding is ₹250 lakh. These source estimates are not October actual expense entries.','ReportSmall')

br();page('Pharmacy and service operations','October pharmacy activity and operational delivery')
heading('Pharmacy performance')
table(['Indicator','Value','Interpretation'],[
 ['Billed pharmacy sales',money(wb['Pharmacy']['B6'].value),'11 bills, 19 medicine lines'],['Recorded sales GST',money(wb['Pharmacy']['B7'].value),'Bill-level recorded GST'],['Sales excluding recorded GST',money(wb['Pharmacy']['B8'].value),'₹1,392.02 less ₹66.29'],['Completed purchase receipts',49,'Receipt-date basis'],['Purchase value including GST',money(wb['Pharmacy']['B16'].value),'Recorded receipt totals'],['Purchase taxable value',money(wb['Pharmacy']['B17'].value),'Recorded purchase value before GST'],['Purchase GST',money(wb['Pharmacy']['B18'].value),'Recorded purchase receipt GST'],['Active catalogue',790,'Active medicine products'],['Snapshot stock',f"{extra['stock_summary'][0]['stocked_products']} products",'Positive stock at the extraction snapshot']
],[200,110,185])
add('Purchases are reported by receipt date; stock figures reflect the extraction snapshot. Sales, inventory purchases and recorded cash collections remain distinct measures.','ReportSmall')
heading('October delivery highlights')
table(['Area','Activity delivered'],[
 ['Consultation and daycare','31 consultation encounters and five daycare service encounters, including user-confirmed additional activity.'],
 ['Clinical documentation','14 visits with recorded diagnoses, 15 with prescriptions and 56 prescription lines.'],
 ['Training','48 conducted sessions across 24 dates, combining clinical and general/staff topics.'],
 ['Pharmacy operations','49 completed purchase receipts, 19 billed medicine lines and 788 products with positive snapshot stock.'],
 ['Digital marketing','45 Facebook and 45 Instagram posts; reported paid reach of 2,44,327 and 5,12,098 impressions.'],
 ['Local outreach','12,000 pamphlets distributed; 87 Google direction requests, 13 call clicks and 12 website clicks.']
],[135,360],small=True)
add('Report basis: Meditrust application records, user-confirmed additional services and training, supplied marketing figures, September salary workbook and the Bioscape financial statement. Doctor/date allocations for the additional consultations are reporting estimates.','ReportSmall')

def footer(canvas,doc):
 canvas.saveState();canvas.setStrokeColor(colors.HexColor('#AFC1D0'));canvas.line(42,38,A4[0]-42,38)
 canvas.setFont('Arial',8);canvas.setFillColor(colors.HexColor('#526579'));canvas.drawString(42,25,'Meditrust Clinics | October 2026 operational and marketing highlights | Through 30 Oct');canvas.drawRightString(A4[0]-42,25,str(doc.page));canvas.restoreState()
path=out/'Meditrust_October_2026_MIS_With_Marketing.pdf'
doc=SimpleDocTemplate(str(path),pagesize=A4,leftMargin=50,rightMargin=50,topMargin=40,bottomMargin=52,title='Meditrust Clinics - October 2026 MIS',author='Meditrust Clinics')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
with pdfplumber.open(path) as pdf:
 for i,page in enumerate(pdf.pages):page.to_image(resolution=105).save(out/f'report-page-{i+1}.png')
 print('Report pages:',len(pdf.pages))
 print('Page text lengths:',[len(p.extract_text() or '') for p in pdf.pages])
 print('Page headings:',[(p.extract_text() or '').splitlines()[0] for p in pdf.pages])
