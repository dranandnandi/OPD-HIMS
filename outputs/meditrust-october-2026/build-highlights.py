import html,json
from pathlib import Path
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import pdfplumber

out=Path(__file__).resolve().parent
facts=json.loads((out/'verification.json').read_text())['keyResults']
pdfmetrics.registerFont(TTFont('Arial','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('Arial-Bold','C:/Windows/Fonts/arialbd.ttf'))
navy=colors.HexColor('#193B5A'); ink=colors.HexColor('#23394D'); muted=colors.HexColor('#60768A'); pale=colors.HexColor('#F0F5F8')
styles={
 'title':ParagraphStyle('title',fontName='Arial-Bold',fontSize=25,leading=30,textColor=navy,spaceAfter=8),
 'sub':ParagraphStyle('sub',fontName='Arial',fontSize=10,leading=14,textColor=muted,spaceAfter=17),
 'h':ParagraphStyle('h',fontName='Arial-Bold',fontSize=13,leading=17,textColor=navy,spaceBefore=15,spaceAfter=8),
 'body':ParagraphStyle('body',fontName='Arial',fontSize=10.5,leading=15,textColor=ink,spaceAfter=8),
 'cell':ParagraphStyle('cell',fontName='Arial',fontSize=10.5,leading=14,textColor=ink),
 'head':ParagraphStyle('head',fontName='Arial-Bold',fontSize=10,leading=14,textColor=colors.white),
 'small':ParagraphStyle('small',fontName='Arial',fontSize=8,leading=11,textColor=muted,spaceBefore=9),
 'big':ParagraphStyle('big',fontName='Arial-Bold',fontSize=23,leading=28,textColor=navy),
 'label':ParagraphStyle('label',fontName='Arial',fontSize=10,leading=14,textColor=muted)
}
def p(t,kind='body'):return Paragraph(html.escape(str(t)).replace('\n','<br/>'),styles[kind])
story=[]
def add(t,kind='body'):story.append(p(t,kind))
def table(headers,rows,widths):
 t=Table([[p(x,'head') for x in headers]]+[[p(x,'cell') for x in row] for row in rows],colWidths=widths,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,pale]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
 story.append(t)
def cards(items):
 t=Table([[[p(value,'big'),p(label,'label')] for value,label in items]],colWidths=[165]*3,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),pale),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),14),('BOTTOMPADDING',(0,0),(-1,-1),14)]))
 story.append(t);story.append(Spacer(1,8))

add('Meditrust Clinics','title');add('October 2026 MIS | Highlights through 30 October','sub')
cards([(str(facts['allConsultations']),'Consultations'),(str(facts['daycare']),'Daycare cases'),(str(facts['trainingSessions']),'Training sessions conducted')])
add('Clinical and service activity','h')
table(['Activity','October highlights'],[
 ['Patient services','31 consultations and 5 daycare service encounters'],
 ['Clinical care','56 prescription lines and 25 investigation orders'],
 ['Service and pharmacy value',f"₹{facts['adjustedBilled']:,.2f}"],
 ['Pharmacy operations','49 completed purchase receipts; 788 products with stock']
],[185,310])
add('Training and team development','h')
add('48 sessions were conducted across 24 training days: 24 clinical sessions and 24 general/staff sessions.')
add('Clinical learning covered chest pain, hypertension, stroke, respiratory care, antibiotic stewardship and case simulations. Staff training covered patient safety, emergency response, medication checks, day-care observation, pharmacy counselling and patient communication.')
add('Marketing and community outreach','h')
add('12,000 pamphlets distributed, supported by Facebook and Instagram content, paid social visibility and Google Business Profile engagement.')
add('The month combined patient services, pharmacy operations, structured training and local outreach.')
add('Service totals include user-confirmed additional activity. Service value includes the reported additional services and is distinct from cash collections. Software figures are through 30 October 2026, 13:18 IST.','small')

story.append(PageBreak())
add('Marketing highlights','title');add('October 2026 | Digital visibility and local outreach','sub')
cards([('12,000','Pamphlets distributed'),('2,44,327','Paid reach'),('4.9 / 5','Google rating')])
add('Digital activity','h')
table(['Activity','Reported result'],[
 ['Paid social advertising','₹9,775 spend; 5,12,098 impressions'],
 ['Facebook and Instagram','45 posts published on each platform'],
 ['Facebook video library','35 videos; 53,619 reported views'],
 ['Video engagement','11,815 reported 75% video views'],
 ['WhatsApp engagement','1,172 clicks'],
 ['Featured introduction content','Dr Ruchi: 286 reactions; clinic: 201 reactions']
],[185,310])
add('Google Business Profile','h')
table(['Activity','Reported result'],[
 ['Profile visibility','625 impressions'],
 ['Customer actions','87 direction requests, 13 call clicks and 12 website clicks'],
 ['Overall profile engagement','112 actions; 17.9% action rate'],
 ['Customer feedback','7 reviews received; 4.9 / 5 rating']
],[185,310])
add('Local distribution and digital content supported clinic awareness, while Google search and Maps generated direct engagement with the clinic.','small')
add('Source: user-supplied October marketing report and confirmation of 12,000 pamphlets distributed. Video-library views are reported snapshot figures; posts are counted separately by platform.','small')

def footer(canvas,doc):
 canvas.saveState();canvas.setStrokeColor(colors.HexColor('#CAD7E1'));canvas.line(50,39,A4[0]-50,39);canvas.setFont('Arial',8);canvas.setFillColor(muted);canvas.drawString(50,25,'Meditrust Clinics | October 2026 MIS');canvas.drawRightString(A4[0]-50,25,str(doc.page));canvas.restoreState()
target=out/'Meditrust_October_2026_MIS_Concise.pdf'
SimpleDocTemplate(str(target),pagesize=A4,leftMargin=50,rightMargin=50,topMargin=42,bottomMargin=54,title='Meditrust Clinics - October 2026 MIS',author='Meditrust Clinics').build(story,onFirstPage=footer,onLaterPages=footer)
with pdfplumber.open(target) as pdf:
 assert len(pdf.pages)==2,len(pdf.pages)
 text='\n'.join(page.extract_text() or '' for page in pdf.pages)
 assert all(s in text for s in ['31 consultations','5 daycare','48 sessions','12,000','17,392.02','2,44,327'])
 assert not any(s in text.lower() for s in ['unassigned','symptoms','reconciliation','refund','cancelled','negative','pbt'])
 for i,page in enumerate(pdf.pages):page.to_image(resolution=110).save(out/f'concise-page-{i+1}.png')
 print('Verified: two-page highlights MIS; requested detail removed; service and marketing figures preserved.')
