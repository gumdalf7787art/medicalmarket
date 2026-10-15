"""Local reply collection and conservative quote extraction. Never executes message content."""
import imaplib,email,json,re,hashlib,threading,base64,sqlite3
from contextlib import contextmanager
from email import policy
from email.utils import parseaddr
from datetime import datetime,timedelta
from io import BytesIO
from html.parser import HTMLParser
from decimal import Decimal,ROUND_HALF_UP
import mail_service as mail
SYNC_LOCK=threading.Lock()
@contextmanager
def database():
 mail.PRIVATE.mkdir(parents=True,exist_ok=True)
 c=sqlite3.connect(mail.PRIVATE/'replies.sqlite3')
 c.execute('CREATE TABLE IF NOT EXISTS replies (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
 try:
  with c:yield c
 finally:c.close()
def records():
 with database() as c:rows=[json.loads(x[0]) for x in c.execute('SELECT data FROM replies ORDER BY rowid DESC')]
 for row in rows:
  if row.get('analysis',{}).get('version')!=2:
   notes=[w for w in row.get('analysis',{}).get('warnings',[]) if '자동 판독 불가' in w or '초과 첨부' in w]
   row['analysis']=analyze(row.get('text',''));row['analysis']['warnings']+=notes;store(row)
 return rows
def store(r):
 with database() as c:c.execute('INSERT OR REPLACE INTO replies VALUES (?,?)',(r['id'],json.dumps(r,ensure_ascii=False)))
def deliveries():
 with mail.db() as c:return [d for x in c.execute("SELECT result FROM deliveries WHERE status='sent'") if (d:=json.loads(x[0])).get('kind')!='customer']
class Text(HTMLParser):
 def __init__(self):super().__init__();self.parts=[];self.skip=0
 def handle_starttag(self,t,a):
  if t in ('script','style'):self.skip+=1
  if t in ('p','br','div','tr'):self.parts.append('\n')
 def handle_endtag(self,t):
  if t in ('script','style'):self.skip=max(0,self.skip-1)
 def handle_data(self,d):
  if not self.skip:self.parts.append(d)
def plain_html(value):
 p=Text();p.feed(value);return ''.join(p.parts)
def analyze(text):
 # Only explicit supplier unit prices are used; totals and recommended retail prices are not guessed.
 chunks=text.split('[첨부:');text=re.split(r'(?im)^\s*(?:On .+wrote:|-----Original Message-----|보낸 사람\s*:)',chunks[0])[0]+'\n'+'\n'.join(chunks[1:])
 # Match complete monetary expressions; model numbers and dates are not prices.
 number=r'(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?'
 money=re.compile(r'(?<![\d.,])('+number+r')\s*(천\s*만\s*원|억\s*원|만\s*원|원)(?![\w])|(?<![\d.,])('+number+r')\s*(천\s*만\s*원|억\s*원|만\s*원|원)(?=입니다|이고|이며|으로|에|정도)',re.I)
 label=re.compile(r'(?:공급\s*(?:단가|가격|가)|매입\s*(?:단가|가))\s*[:：]?\s*(?:₩|KRW)?\s*('+number+r')\s*(천\s*만\s*원|억\s*원|만\s*원|원)?(?![\d,.])',re.I)
 candidates=[];evidence=[];ambiguous=False
 def value(n,u):
  unit=re.sub(r'\s','',u or '원');scale={'원':1,'만원':10000,'천만원':10000000,'억원':100000000}[unit]
  v=Decimal(n.replace(',',''))*scale
  return int(v) if v==v.to_integral_value() and 0<v<=1000000000 else None
 for line in text.splitlines():
  line=line.strip()
  if not line or line.startswith('>'):continue
  # Retail guidance and separately charged expenses never become device cost.
  if re.search(r'권장|소비자|판매\s*(?:가|가격|단가)|배송비|운송비|설치비|합계|총액|총\s*금액',line):continue
  explicit=list(label.finditer(line));matches=explicit or list(money.finditer(line))
  if not matches:continue
  if re.search(r'부터|이상|이하|정도|대략|약\s*\d|[~～]|\d\s*-\s*\d',line):ambiguous=True;continue
  for m in matches:
   n,u=(m.group(1),m.group(2)) if explicit or m.group(1) else (m.group(3),m.group(4))
   v=value(n,u)
   if v is not None:candidates.append(v);evidence.append(line)
 values=set(candidates)
 cost=next(iter(values)) if len(values)==1 and not ambiguous else None
 included=bool(re.search(r'(?:부가세|VAT)\s*(?:포함|포함가)',text,re.I));excluded=bool(re.search(r'(?:부가세|VAT)\s*(?:별도|별도가)',text,re.I))
 tax='included' if included and not excluded else 'excluded' if excluded and not included else 'unknown'
 warnings=[]
 if cost is None:warnings.append('공급 단가를 하나로 확정하지 못했습니다. 원본과 대조하여 입력하세요.')
 if tax=='unknown':warnings.append('공급 단가의 부가세 포함 여부를 확인하세요.')
 net=int((Decimal(cost)/Decimal('1.1')).quantize(Decimal('1'),rounding=ROUND_HALF_UP)) if cost and tax=='included' else cost if tax=='excluded' else None
 sale=int((Decimal(net)*Decimal('1.2')).quantize(Decimal('1'),rounding=ROUND_HALF_UP)) if net else None
 conditions='\n'.join(line.strip() for line in text.splitlines() if any(k in line for k in ['배송','운송','설치','납기','보증','유효','결제']))[:3000]
 warnings.append('제품·모델·수량과 배송·설치비를 원본과 대조해 주세요. 비용이 불명확하면 발행하지 마세요.')
 return dict(supplierUnit=cost,taxBasis=tax,netUnit=net,saleUnit=sale,conditions=conditions,warnings=warnings,method='금액 표현·세금 조건 기반 자동 추출',evidence=list(dict.fromkeys(evidence)),version=2)
def attachment_text(name,data):
 if name.lower().endswith('.pdf'):
  from pypdf import PdfReader
  reader=PdfReader(BytesIO(data));return '\n'.join(p.extract_text() or '' for p in reader.pages[:30])
 if name.lower().endswith('.xlsx'):
  from openpyxl import load_workbook
  import zipfile
  with zipfile.ZipFile(BytesIO(data)) as archive:
   if sum(i.file_size for i in archive.infolist())>30*1024*1024:raise ValueError('Expanded attachment too large')
  book=load_workbook(BytesIO(data),read_only=True,data_only=True)
  try:return '\n'.join(' '.join(str(v) for v in row if v is not None) for sheet in book.worksheets[:5] for row in sheet.iter_rows(max_row=1000,max_col=30,values_only=True))
  finally:book.close()
 if name.lower().endswith(('.txt','.csv')):return data.decode('utf-8',errors='replace')
 return ''
def matching(msg,sent):
 refs=set(re.findall(r'<[^>]+>',str(msg.get('In-Reply-To',''))+' '+str(msg.get('References',''))))
 exact=[d for d in sent if d.get('messageId') in refs]
 ids={d['deliveryId'] for d in exact}
 if len(ids)==1:return exact[0]['deliveryId'],[]
 subject=str(msg.get('Subject',''))
 candidates=[]
 for d in sent:
  legacy=re.search(r'DEMO-\d+',d.get('subject',''));rid=d.get('requestId') or (legacy[0] if legacy else '')
  if rid and re.search(r'(?<![\w-])'+re.escape(rid)+r'(?![\w-])',subject):candidates.append(d['deliveryId'])
 return '',list(dict.fromkeys(candidates))
def sync():
 if not mail.PASSWORD:raise ValueError('Gmail 발신 설정에서 계정을 다시 연결해 주세요.')
 if not SYNC_LOCK.acquire(blocking=False):return {'replies':records(),'notice':'회신 확인이 진행 중입니다.'}
 try:
  sent=deliveries();seen={r['id'] for r in records()};added=0
  with imaplib.IMAP4_SSL('imap.gmail.com',993,timeout=25) as imap:
   imap.login(mail.SENDER,mail.PASSWORD);imap.select('INBOX',readonly=True)
   status,data=imap.uid('search',None,'SINCE',(datetime.now()-timedelta(days=30)).strftime('%d-%b-%Y'))
   if status!='OK':raise ValueError('Gmail 회신 검색에 실패했습니다.')
   ids=data[0].split()
   for uid in ids[-200:]:
    status,parts=imap.uid('fetch',uid,'(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES SUBJECT FROM DATE)] RFC822.SIZE)')
    chunk=next((x for x in parts if isinstance(x,tuple)),None)
    if not chunk:continue
    head=email.message_from_bytes(chunk[1],policy=policy.default)
    if parseaddr(str(head.get('From','')))[1].lower()==mail.SENDER.lower():continue
    delivery,candidates=matching(head,sent)
    if not delivery and not candidates:continue
    key=hashlib.sha256(str(head.get('Message-ID','')).encode()+chunk[1]).hexdigest()
    if key in seen:continue
    size=re.search(rb'RFC822.SIZE (\d+)',chunk[0])
    if size and int(size[1])>20*1024*1024:continue
    status,parts=imap.uid('fetch',uid,'(BODY.PEEK[])')
    raw=next((x[1] for x in parts if isinstance(x,tuple)),None)
    if not raw:continue
    msg=email.message_from_bytes(raw,policy=policy.default);body=[];html=[];attachment_parts=[];files=[];notes=[]
    folder=mail.PRIVATE/'replies'/key;folder.mkdir(parents=True,exist_ok=True)
    for part in msg.walk():
     if part.is_multipart():continue
     name=part.get_filename();data=part.get_payload(decode=True) or b''
     if name:
      if len(data)>10*1024*1024:notes.append('10MB 초과 첨부는 Gmail에서 확인하세요.');continue
      fid=hashlib.sha256(data).hexdigest();(folder/fid).write_bytes(data)
      files.append(dict(id=fid,name=name,size=len(data)))
      try:content=attachment_text(name,data)
      except Exception:content=''
      if content.strip():attachment_parts.append('\n[첨부: '+name+']\n'+content[:100000])
      else:notes.append(name+': 자동 판독 불가. 이미지·스캔본 또는 지원하지 않는 형식은 원본 확인이 필요합니다.')
     elif part.get_content_type()=='text/plain':body.insert(0,part.get_content()[:100000])
     elif part.get_content_type()=='text/html':html.append(plain_html(part.get_content())[:100000])
    text='\n'.join((body or html)+attachment_parts);analysis=analyze(text);analysis['warnings']+=notes
    store(dict(id=key,deliveryId=delivery,candidates=candidates,subject=str(msg.get('Subject','')),sender=str(msg.get('From','')),date=str(msg.get('Date','')),text=text[:150000],files=files,analysis=analysis));added+=1
  return {'replies':records(),'notice':f'새 회신 {added}건 · 최근 30일 받은편지함 최대 200건 확인 (스팸함 제외)'}
 except (imaplib.IMAP4.error,OSError):raise ValueError('Gmail 회신 연결에 실패했습니다. 계정 연결 상태를 확인해 주세요.')
 finally:SYNC_LOCK.release()
def action(data):
 if data.get('action')=='sync':return sync()
 if data.get('action')=='list':return {'replies':records()}
 r=next((r for r in records() if r['id']==data.get('id')),None)
 if not r:raise ValueError('회신을 찾을 수 없습니다.')
 if data.get('action')=='link':
  target=data.get('deliveryId')
  if target not in {d['deliveryId'] for d in deliveries()}:raise ValueError('발송된 요청을 선택해 주세요.')
  r['deliveryId']=target;store(r);return {'replies':records()}
 if data.get('action')=='file':
  f=next((f for f in r['files'] if f['id']==data.get('fileId')),None)
  if not f:raise ValueError('첨부를 찾을 수 없습니다.')
  return dict(name=f['name'],base64=base64.b64encode((mail.PRIVATE/'replies'/r['id']/f['id']).read_bytes()).decode())
 raise ValueError('지원하지 않는 요청입니다.')
