"""Local-only Gmail SMTP sender. Password is kept in process memory, never in browser storage or files."""
from pathlib import Path
from contextlib import contextmanager
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from datetime import datetime, timezone
import os, base64, hashlib, html, json, re, secrets, smtplib, sqlite3, ssl, threading
ROOT=Path(__file__).resolve().parent
PRIVATE=Path(os.environ.get('MEDICALMARKET_PRIVATE_DIR', str(ROOT.parent/'medicalmarket-private'/'mail')))
SENDER=os.environ.get('MEDICALMARKET_MAIL_SENDER','sender@example.com')
COPY_TO=os.environ.get('MEDICALMARKET_MAIL_COPY','copy@example.com')
TOKEN=secrets.token_urlsafe(32)
LOCK=threading.Lock()
PASSWORD=''
TEMPLATE=(ROOT/'supplier-email.html').read_text(encoding='utf-8-sig')

@contextmanager
def db():
 PRIVATE.mkdir(parents=True,exist_ok=True)
 c=sqlite3.connect(PRIVATE/'deliveries.sqlite3',timeout=10)
 c.execute('CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, digest TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL)')
 try:
  with c:yield c
 finally:c.close()

def attachment():
 try:
  meta=json.loads((PRIVATE/'attachment.json').read_text(encoding='utf-8'))
  data=(PRIVATE/'business-registration.bin').read_bytes()
  if hashlib.sha256(data).hexdigest()!=meta['sha256']:return None
  return {**meta,'data':data}
 except (OSError,ValueError,KeyError):return None

def status():
 a=attachment()
 return dict(sender=SENDER,copyTo=COPY_TO,connected=bool(PASSWORD),attachment={k:v for k,v in a.items() if k!='data'} if a else None,csrf=TOKEN)

def connect(value):
 global PASSWORD
 password=re.sub(r'\s','',str(value or ''))
 if not re.fullmatch(r'[A-Za-z0-9]{16}',password):raise ValueError('Google 앱 비밀번호 16자리를 입력해 주세요. 일반 로그인 비밀번호는 사용하지 않습니다.')
 try:
  with smtplib.SMTP_SSL('smtp.gmail.com',465,context=ssl.create_default_context(),timeout=20) as smtp:smtp.login(SENDER,password)
 except smtplib.SMTPAuthenticationError:raise ValueError('Gmail 인증에 실패했습니다. 계정과 앱 비밀번호를 확인해 주세요.')
 except (OSError,smtplib.SMTPException):raise ValueError('Gmail에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.')
 PASSWORD=password
 return status()

def save_attachment(payload):
 try:data=base64.b64decode(payload.get('base64',''),validate=True)
 except (ValueError,TypeError):raise ValueError('파일을 읽을 수 없습니다.')
 if not data or len(data)>8*1024*1024:raise ValueError('사업자등록증은 8MB 이하 파일을 사용해 주세요.')
 kinds=[(b'%PDF-','application/pdf','.pdf'),(b'\x89PNG\r\n\x1a\n','image/png','.png'),(b'\xff\xd8\xff','image/jpeg','.jpg')]
 kind=next((x for x in kinds if data.startswith(x[0])),None)
 if not kind:raise ValueError('PDF, PNG, JPG 사업자등록증을 선택해 주세요.')
 PRIVATE.mkdir(parents=True,exist_ok=True)
 meta=dict(name='샘플회사_사업자등록증'+kind[2],type=kind[1],size=len(data),sha256=hashlib.sha256(data).hexdigest())
 with LOCK:
  (PRIVATE/'business-registration.bin').write_bytes(data)
  (PRIVATE/'attachment.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8')
 return status()

def extra_attachments(payload):
 files=payload.get('attachments',[])
 if not isinstance(files,list) or len(files)>5:raise ValueError('추가 첨부는 최대 5개입니다.')
 result=[];total=0
 for f in files:
  if not isinstance(f,dict):raise ValueError('첨부파일을 확인해 주세요.')
  name=Path(str(f.get('name',''))).name
  if not name or len(name)>180 or any(ord(c)<32 for c in name):raise ValueError('첨부 파일명을 확인해 주세요.')
  try:data=base64.b64decode(f.get('base64',''),validate=True)
  except (ValueError,TypeError):raise ValueError('첨부파일을 읽을 수 없습니다.')
  total+=len(data)
  if not data or total>8*1024*1024:raise ValueError('추가 첨부는 합계 8MB 이하로 선택해 주세요.')
  result.append(dict(name=name,data=data,sha256=hashlib.sha256(data).hexdigest()))
 return result

def clean_payload(p):
 lengths={'requestId':100,'supplier':200,'supplierId':200,'hospital':100,'region':100,'productNumber':100,'productName':300,'model':200,'maker':200,'extra':2000,'subject':300,'to':254,'deliveryId':100}
 out={}
 for k,n in lengths.items():
  v=p.get(k,'')
  if not isinstance(v,str) or len(v)>n:raise ValueError('입력 내용을 확인해 주세요: '+k)
  out[k]=v.strip()
 if any(not out[k] for k in ['requestId','supplier','supplierId','hospital','region','productNumber','productName','subject']):raise ValueError('병원·지역·제품·공급업체 정보를 확인해 주세요.')
 if not re.fullmatch(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}',out['to']):raise ValueError('수신 이메일 형식을 확인해 주세요. 한 주소만 입력할 수 있습니다.')
 if '\n' in out['subject'] or '\r' in out['subject']:raise ValueError('메일 제목에 줄바꿈을 사용할 수 없습니다.')
 if not re.fullmatch(r'[a-zA-Z0-9_-]{16,100}',out['deliveryId']):raise ValueError('발송 식별자가 올바르지 않습니다.')
 q=p.get('quantity')
 if isinstance(q,bool) or not isinstance(q,int) or not 1<=q<=999:raise ValueError('수량을 확인해 주세요.')
 out['quantity']=q
 return out

def render_email(p,has_attachment=True):
 replacements={k:html.escape(str(v),quote=True) for k,v in p.items()}
 replacements['attachmentNote']='저희 사업자등록증을 첨부파일로 함께 보내드립니다.' if has_attachment else '사업자등록증은 발송 전 첨부할 예정입니다.'
 replacements['extraBlock']=('<div style="background:#f3f6fc;padding:16px;border-radius:8px"><strong>추가 요청사항</strong><p style="white-space:pre-wrap;margin-bottom:0">'+html.escape(p['extra'])+'</p></div>') if p.get('extra') else ''
 return re.sub(r'\{\{(\w+)\}\}',lambda m:replacements.get(m[1],''),TEMPLATE)

def receipt(delivery_id):
 with db() as c:row=c.execute('SELECT status,result FROM deliveries WHERE id=?',(delivery_id,)).fetchone()
 return json.loads(row[1]) if row else {'status':'not_found'}

def send(payload):
 p=clean_payload(payload)
 extras=extra_attachments(payload)
 p['attachmentHashes']=[{'name':f['name'],'sha256':f['sha256']} for f in extras]
 p['copyTo']=COPY_TO
 digest=hashlib.sha256(json.dumps(p,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
 with LOCK:
  with db() as c:
   prior=c.execute('SELECT digest,status,result FROM deliveries WHERE id=?',(p['deliveryId'],)).fetchone()
   if prior:
    if prior[0]!=digest:raise ValueError('이 발송 건의 내용을 변경할 수 없습니다. 기존 발송 상태를 먼저 확인해 주세요.')
    if prior[1] in ('sent','sending','unknown'):return json.loads(prior[2])
   if not PASSWORD:raise ValueError('먼저 Gmail 발신 계정을 연결해 주세요.')
   a=attachment()
   if not a:raise ValueError('먼저 사업자등록증을 등록해 주세요.')
   result={'status':'sending','requestId':p['requestId'],'deliveryId':p['deliveryId'],'to':p['to'],'copyTo':COPY_TO,'subject':p['subject']}
   c.execute('INSERT OR REPLACE INTO deliveries VALUES (?,?,?,?)',(p['deliveryId'],digest,'sending',json.dumps(result)))
 msg=EmailMessage();msg['From']=formataddr(('샘플 의료기기 회사',SENDER));msg['To']=p['to'];msg['Reply-To']=SENDER;msg['Subject']=p['subject'];msg['Message-ID']=make_msgid(domain='medicalmarket.local')
 if p['to'].lower()!=COPY_TO.lower():msg['Cc']=COPY_TO
 plain=f"안녕하십니까? 샘플 의료기기 회사입니다.\n사업자등록증을 첨부했습니다.\n{p['hospital']} ({p['region']})에서 견적 요청을 받았습니다.\n제품번호 {p['productNumber']}\n{p['productName']} / {p['model']} / {p['maker']} / {p['quantity']}대\n공급 견적서 및 정해진 판매가·권장 판매가격, 공급단가·부가세·구성·납기·설치·보증·결제·유효기간을 회신 부탁드립니다.\n{p['extra']}\n감사합니다.\n샘플 의료기기 회사 / 대표 샘플 대표 / 000-00-00000\n00-0000-0000 / 회사 주소 설정 필요\n{SENDER}"
 msg.set_content(plain);msg.add_alternative(render_email(p),subtype='html')
 major,minor=a['type'].split('/');msg.add_attachment(a['data'],maintype=major,subtype=minor,filename=a['name'])
 for f in extras:msg.add_attachment(f['data'],maintype='application',subtype='octet-stream',filename=f['name'])
 sending=False
 try:
  with smtplib.SMTP_SSL('smtp.gmail.com',465,context=ssl.create_default_context(),timeout=25) as smtp:
   smtp.login(SENDER,PASSWORD)
   sending=True
   refused=smtp.send_message(msg)
   if refused:
    result.update(status='unknown',error='일부 수신자만 접수되었을 수 있습니다. Gmail 보낸편지함을 확인해 주세요.')
    raise OSError('partial recipient acceptance')
   result.update(status='sent',sentAt=datetime.now(timezone.utc).isoformat(),messageId=str(msg['Message-ID']),attachment=a['name'])
 except (smtplib.SMTPAuthenticationError,smtplib.SMTPRecipientsRefused,smtplib.SMTPSenderRefused,smtplib.SMTPDataError):
  result.update(status='failed',error='메일 서버가 발송을 거절했습니다. 계정·수신주소를 확인해 주세요.')
 except (OSError,smtplib.SMTPException):
  if result['status']!='sent':result.update(status='unknown' if sending else 'failed',error='발송 결과를 확인할 수 없습니다. Gmail 보낸편지함을 확인해 주세요.' if sending else 'Gmail 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.')
 with db() as c:c.execute('UPDATE deliveries SET status=?,result=? WHERE id=?',(result['status'],json.dumps(result,ensure_ascii=False),p['deliveryId']))
 return result
