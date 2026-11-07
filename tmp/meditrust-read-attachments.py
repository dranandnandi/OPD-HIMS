import json,datetime
from pathlib import Path
import openpyxl,pdfplumber
out=Path('outputs/meditrust-october-2026')
sources={}
for name in ['salary process Sep 2026 (2).xlsx','October_2026_Training_Schedule (1).xlsx']:
 path=Path('C:/Users/Lenovo/Downloads')/name
 wb=openpyxl.load_workbook(path,data_only=True)
 wf=openpyxl.load_workbook(path,data_only=False)
 sheets=[]
 for ws in wb:
  rows=[]
  for row in ws:
   if name.startswith('salary') and row[0].row>10:continue
   cells=[]
   for cell in row:
    if cell.value is not None:
     v=cell.value
     if isinstance(v,(datetime.datetime,datetime.date)):v=v.isoformat()
     f=wf[ws.title][cell.coordinate].value
     cells.append({'cell':cell.coordinate,'value':v,**({'formula':f} if isinstance(f,str) and f.startswith('=') else {})})
   if cells:rows.append(cells)
  sheets.append({'name':ws.title,'rows':rows,'max_row':ws.max_row,'max_column':ws.max_column,'merged':[str(r) for r in ws.merged_cells.ranges]})
 sources[name]={'path':str(path),'sheets':sheets}
pdf_path=Path('C:/Users/Lenovo/Downloads/P&L- Bioscape Healthspan Private Limited (2).pdf')
with pdfplumber.open(pdf_path) as pdf:
 sources[pdf_path.name]={'path':str(pdf_path),'pages':[{'page':n+1,'text':p.extract_text(),'tables':p.extract_tables()} for n,p in enumerate(pdf.pages)]}
out.joinpath('attachments.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2),encoding='utf8')
for name,s in sources.items():
 print('\nFILE',name)
 if 'pages' in s:
  for p in s['pages']:print('PAGE',p['page'],p['text'])
 else:
  for sh in s['sheets']:
   print('SHEET',sh['name'],sh['max_row'],sh['max_column'])
   for row in sh['rows']:print(' | '.join(str(c['cell'])+'='+str(c['value']) for c in row))
