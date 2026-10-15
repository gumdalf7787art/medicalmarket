"""Customer-facing quote PDF. Only sales fields are accepted by the caller."""
from io import BytesIO
from pathlib import Path
from html import escape
from datetime import datetime,timezone,timedelta
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,KeepTogether
from reportlab.lib.pagesizes import A4

def build_quote_pdf(p):
 if 'QuoteKR' not in pdfmetrics.getRegisteredFontNames():
  pdfmetrics.registerFont(TTFont('QuoteKR',str(Path('C:/Windows/Fonts/malgun.ttf'))))
  pdfmetrics.registerFont(TTFont('QuoteKRB',str(Path('C:/Windows/Fonts/malgunbd.ttf'))))
 navy=colors.HexColor('#17233b');blue=colors.HexColor('#2867d9');line=colors.HexColor('#dce3ed')
 style=ParagraphStyle('Body',fontName='QuoteKR',fontSize=10,leading=16,textColor=navy,wordWrap='CJK')
 bold=ParagraphStyle('Bold',parent=style,fontName='QuoteKRB')
 small=ParagraphStyle('Small',parent=style,fontSize=9,leading=14)
 right=ParagraphStyle('Right',parent=style,alignment=TA_RIGHT)
 def para(t,st=style):return Paragraph(escape(str(t)).replace('\n','<br/>'),st)
 total=p['saleUnit']*p['quantity']+p['shipping']+p['installation'];tax=(total+5)//10
 out=BytesIO();doc=SimpleDocTemplate(out,pagesize=A4,rightMargin=42,leftMargin=42,topMargin=42,bottomMargin=48,title='샘플회사 견적서 '+p['requestId'],author='샘플 의료기기 회사')
 width=A4[0]-84
 story=[para('SAMPLE COMPANY · MEDICAL MARKET',small),Spacer(1,14),para('견 적 서',ParagraphStyle('Title',parent=bold,fontSize=26,leading=34)),Spacer(1,18)]
 issued=datetime.now(timezone(timedelta(hours=9))).strftime('%Y.%m.%d')
 info=Table([[para('수신  '+p['hospital'],bold),para('견적번호  '+p['requestId'],right)],[para('요청하신 제품의 견적을 아래와 같이 안내드립니다.'),para('발행일  '+issued,right)]],colWidths=[width*.6,width*.4]);info.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]));story +=[info,Spacer(1,20)]
 rows=[[para(x,bold) for x in ['제품 / 모델','수량','판매 단가 (세전)','금액 (세전)']],[para(p['productName']+'\n'+p['model']),para(p['quantity'],right),para(f"{p['saleUnit']:,}원",right),para(f"{p['saleUnit']*p['quantity']:,}원",right)]]
 table=Table(rows,colWidths=[width*.4,width*.1,width*.25,width*.25],repeatRows=1,hAlign='LEFT');table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#edf2fa')),('LINEBELOW',(0,0),(-1,0),1,line),('LINEBELOW',(0,1),(-1,-1),.5,line),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),12)]));story +=[table,Spacer(1,18)]
 amounts=[('배송비 (세전)',p['shipping']),('설치비 (세전)',p['installation']),('공급가액',total),('부가세 (10%)',tax),('총 견적금액',total+tax)]
 summary=Table([[para(k,bold if i==4 else style),para(f'{v:,}원',right)] for i,(k,v) in enumerate(amounts)],colWidths=[width*.64,width*.36]);summary.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('BACKGROUND',(0,4),(-1,4),colors.HexColor('#eaf1ff')),('LINEABOVE',(0,4),(-1,4),1,blue)]));story +=[summary,Spacer(1,24),para('납기 및 거래 조건',bold),Spacer(1,8)]
 # Break long conditions into bounded paragraphs to permit clean multi-page flow.
 for textline in p['customerTerms'].splitlines():
  if not textline:story.append(Spacer(1,6));continue
  for i in range(0,len(textline),250):story.append(para(textline[i:i+250]))
 story +=[Spacer(1,24),KeepTogether([para('샘플 의료기기 회사',bold),para('대표 샘플 대표 · 사업자등록번호 000-00-00000',small),para('회사 주소 설정 필요',small),para('00-0000-0000 · sender@example.com',small)])]
 def footer(canvas,doc):
  canvas.setFont('QuoteKR',8);canvas.setFillColor(colors.HexColor('#7c8799'));canvas.drawString(42,25,'SAMPLE COMPANY');canvas.drawRightString(A4[0]-42,25,str(doc.page))
 doc.build(story,onFirstPage=footer,onLaterPages=footer)
 return out.getvalue()
