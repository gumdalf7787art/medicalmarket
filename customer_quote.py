"""Explicitly reviewed customer quotes; source costs and supplier files are never included."""
import json,hashlib,re,ssl,smtplib
from email.message import EmailMessage
from email.utils import formataddr,make_msgid
from datetime import datetime,timezone
import mail_service as mail
from quote_pdf import build_quote_pdf

def send(data):
 if data.get('reviewed') is not True:raise ValueError('원본과 고객용 견적을 확인해 주세요.')
 p={}
 for key,limit in [('sendId',100),('requestId',100),('to',254),('hospital',100),('productName',300),('model',200),('customerTerms',5000)]:
  val=data.get(key,'')
  if not isinstance(val,str) or len(val)>limit:raise ValueError('견적 정보를 확인해 주세요.')
  p[key]=val.strip()
 if not all(p[k] for k in ['sendId','requestId','to','hospital','productName','customerTerms']):raise ValueError('견적 필수 정보를 확인해 주세요.')
 if not re.fullmatch(r'[a-zA-Z0-9_-]{16,100}',p['sendId']) or not re.fullmatch(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}',p['to']):raise ValueError('수신 주소와 발송 식별자를 확인해 주세요.')
 for key in ['saleUnit','shipping','installation','quantity']:
  v=data.get(key)
  if isinstance(v,bool) or not isinstance(v,int) or not (1 if key in ('saleUnit','quantity') else 0)<=v<=(999 if key=='quantity' else 1_000_000_000):raise ValueError('금액과 수량을 확인해 주세요.')
  p[key]=v
 if any('\n' in p[k] or '\r' in p[k] for k in ['requestId','productName']):raise ValueError('제품명과 요청번호에 줄바꿈을 넣을 수 없습니다.')
 total=p['saleUnit']*p['quantity']+p['shipping']+p['installation'];tax=(total+5)//10
 escaped={k:mail.html.escape(str(v)) for k,v in p.items()}
 body=f"""<html lang="ko"><body style="font-family:Arial,sans-serif;color:#17233b"><div style="max-width:720px;margin:auto;padding:28px;border:1px solid #e2e7ef"><p>{escaped['hospital']} 담당자님, 안녕하십니까?</p><p><strong>샘플 의료기기 회사입니다.</strong><br>메디컬마켓을 통해 문의해 주셔서 감사합니다.<br>요청하신 제품의 견적을 아래와 같이 안내드립니다. 정식 견적서는 첨부된 PDF 파일에서 확인하실 수 있습니다.</p><h2 style="padding:18px;background:#17233b;color:#ffffff">의료기기 견적 안내</h2><p>수신: {escaped['hospital']} / {escaped['requestId']}</p><table cellpadding="12" style="border-collapse:collapse;border:1px solid #ccd3df"><tr><th>제품</th><th>모델</th><th>수량</th><th>판매 단가 (세전)</th></tr><tr><td>{escaped['productName']}</td><td>{escaped['model']}</td><td>{p['quantity']}</td><td>{p['saleUnit']:,}원</td></tr></table><p>배송비 {p['shipping']:,}원 / 설치비 {p['installation']:,}원 (세전)</p><p>공급가액 {total:,}원 / 부가세 {tax:,}원</p><h3>합계 {total+tax:,}원</h3><p style="white-space:pre-wrap">{escaped['customerTerms']}</p><p>제품 및 구매 조건에 궁금한 점이 있으시면 이 메일로 회신해 주세요.<br>감사합니다.</p><hr><p>샘플 의료기기 회사 · 대표 샘플 대표 · 000-00-00000<br>회사 주소 설정 필요<br>00-0000-0000 · {mail.SENDER}</p></div></body></html>"""
 digest=hashlib.sha256(json.dumps(p,sort_keys=True,ensure_ascii=False).encode()).hexdigest();key='customer-'+p['sendId']
 with mail.LOCK:
  prior=mail.receipt(key)
  if prior.get('status') in ('sent','sending','unknown'):return prior
  if not mail.PASSWORD:raise ValueError('Gmail 발신 계정을 연결해 주세요.')
  pdf=build_quote_pdf(p)
  folder=mail.PRIVATE/'customer-quotes';folder.mkdir(parents=True,exist_ok=True)
  (folder/(digest+'.pdf')).write_bytes(pdf)
  result=dict(status='sending',deliveryId=key,to=p['to'],requestId=p['requestId'],kind='customer')
  with mail.db() as c:c.execute('INSERT OR REPLACE INTO deliveries VALUES (?,?,?,?)',(key,digest,'sending',json.dumps(result)))
 msg=EmailMessage();msg['From']=formataddr(('샘플 의료기기 회사',mail.SENDER));msg['To']=p['to'];msg['Reply-To']=mail.SENDER
 if p['to'].lower()!=mail.COPY_TO.lower():msg['Cc']=mail.COPY_TO
 msg['Subject']='[샘플회사] 고객 견적서 · '+p['requestId'];msg['Message-ID']=make_msgid()
 msg.set_content(f"{p['hospital']} 담당자님, 안녕하십니까?\n샘플 의료기기 회사입니다. 문의해 주셔서 감사합니다. 요청하신 견적서를 PDF로 첨부합니다.\n{p['productName']} / {p['model']} / {p['quantity']}대\n판매 단가 {p['saleUnit']:,}원 (부가세 별도)\n배송비 {p['shipping']:,}원 / 설치비 {p['installation']:,}원\n부가세 {tax:,}원 / 합계 {total+tax:,}원\n{p['customerTerms']}\n샘플 의료기기 회사 / 00-0000-0000")
 msg.add_alternative(body,subtype='html');msg.add_attachment(pdf,maintype='application',subtype='pdf',filename='샘플회사_견적서_'+re.sub(r'[^A-Za-z0-9_-]','_',p['requestId'])+'.pdf')
 sending=False
 try:
  with smtplib.SMTP_SSL('smtp.gmail.com',465,context=ssl.create_default_context(),timeout=25) as smtp:
   smtp.login(mail.SENDER,mail.PASSWORD);sending=True;refused=smtp.send_message(msg)
   if refused:raise OSError('partial delivery')
  result.update(status='sent',sentAt=datetime.now(timezone.utc).isoformat(),messageId=str(msg['Message-ID']))
 except (smtplib.SMTPAuthenticationError,smtplib.SMTPSenderRefused,smtplib.SMTPRecipientsRefused,smtplib.SMTPDataError):result.update(status='failed',error='메일 서버에서 발송이 거절되었습니다. 연결과 수신자를 확인해 주세요.')
 except (OSError,smtplib.SMTPException):result.update(status='unknown' if sending else 'failed',error='발송 결과를 확인하지 못했습니다. Gmail 보낸편지함을 확인하세요.')
 with mail.db() as c:c.execute('UPDATE deliveries SET status=?,result=? WHERE id=?',(result['status'],json.dumps(result),key))
 return result
