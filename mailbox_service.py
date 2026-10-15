"""Read-only Gmail viewer. No message content is persisted or executed."""
import base64, email, imaplib, re
from email import policy
import mail_service as mail
from reply_service import plain_html
LIMIT=25*1024*1024

def literals(data):
 return [x[1] for x in data if isinstance(x,tuple) and isinstance(x[1],bytes)]

def folders(client):
 result={'inbox':'INBOX'}
 ok,rows=client.list()
 if ok!='OK':raise ValueError('메일함 목록을 불러오지 못했습니다.')
 for row in rows:
  if not isinstance(row,bytes):continue
  m=re.match(rb'\((.*?)\)\s+(?:"[^"]*"|NIL)\s+(.+)$',row)
  if not m:continue
  flags=m[1].lower();name=m[2].decode('ascii')
  if b'\\sent' in flags:result['sent']=name
  if b'\\all' in flags:result['all']=name
 return result

def fetch_message(client,uid):
 ok,rows=client.uid('fetch',uid,'(RFC822.SIZE)')
 match=re.search(rb'RFC822.SIZE (\d+)',b' '.join(x for x in rows if isinstance(x,bytes)))
 if ok!='OK' or not match:raise ValueError('메일이 이동되었거나 삭제되었습니다. 목록을 새로고침해 주세요.')
 if int(match[1])>LIMIT:raise ValueError('25MB를 넘는 메일은 Gmail에서 확인해 주세요.')
 ok,rows=client.uid('fetch',uid,'(BODY.PEEK[])')
 raw=literals(rows)
 if ok!='OK' or not raw:raise ValueError('메일 내용을 불러오지 못했습니다.')
 return email.message_from_bytes(raw[0],policy=policy.default)

def metadata(msg,uid):
 return dict(uid=uid,subject=str(msg.get('Subject','(제목 없음)')),sender=str(msg.get('From','')),to=str(msg.get('To','')),cc=str(msg.get('Cc','')),date=str(msg.get('Date','')))

def action(data):
 if not mail.PASSWORD:raise ValueError('발신·첨부 설정에서 Gmail 계정을 먼저 연결해 주세요.')
 kind=data.get('folder','inbox');op=data.get('action','list')
 if kind not in ('inbox','sent','all') or op not in ('list','read','file'):raise ValueError('올바른 메일함과 작업을 선택해 주세요.')
 client=None
 try:
  client=imaplib.IMAP4_SSL('imap.gmail.com',993,timeout=25);client.login(mail.SENDER,mail.PASSWORD)
  names=folders(client)
  if kind not in names:raise ValueError('Gmail에서 해당 메일함을 찾지 못했습니다.')
  ok,_=client.select(names[kind],readonly=True)
  if ok!='OK':raise ValueError('메일함을 열지 못했습니다.')
  validity=(client.response('UIDVALIDITY')[1] or [b''])[0].decode()
  if op=='list':
   page=max(0,min(100000,int(data.get('page',0))))
   ok,rows=client.uid('search',None,'ALL')
   if ok!='OK':raise ValueError('메일 목록을 불러오지 못했습니다.')
   ids=(rows[0] or b'').split()[::-1];chosen=ids[page*25:(page+1)*25];items=[]
   if chosen:
    ok,rows=client.uid('fetch',b','.join(chosen),'(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO CC DATE)])')
    if ok!='OK':raise ValueError('메일 목록을 불러오지 못했습니다.')
    for part in rows:
     if not isinstance(part,tuple):continue
     m=re.search(rb'UID (\d+)',part[0])
     if not m:continue
     msg=email.message_from_bytes(part[1],policy=policy.default);item=metadata(msg,m[1].decode());item['unread']=b'\\Seen' not in part[0];items.append(item)
    items.sort(key=lambda x:int(x['uid']),reverse=True)
   return dict(items=items,total=len(ids),page=page,validity=validity)
  uid=str(data.get('uid',''))
  if not re.fullmatch(r'[1-9]\d{0,15}',uid) or str(data.get('validity',''))!=validity:raise ValueError('메일 목록을 새로고침한 뒤 다시 선택해 주세요.')
  msg=fetch_message(client,uid);parts=list(msg.walk());files=[]
  for i,part in enumerate(parts):
   if part.get_filename() or part.get_content_disposition()=='attachment':
    files.append(dict(id=str(i),name=part.get_filename() or '첨부파일',size=len(part.get_payload(decode=True) or b'')))
  if op=='file':
   selected=next((x for x in files if x['id']==str(data.get('fileId'))),None)
   if not selected:raise ValueError('첨부파일을 찾지 못했습니다.')
   raw=parts[int(selected['id'])].get_payload(decode=True) or b''
   return dict(name=selected['name'],base64=base64.b64encode(raw).decode())
  body=msg.get_body(preferencelist=('plain','html'))
  text=body.get_content() if body else ''
  if body and body.get_content_type()=='text/html':text=plain_html(text)
  return dict(**metadata(msg,uid),text=str(text)[:500000],truncated=len(str(text))>500000,files=files)
 except (imaplib.IMAP4.error,OSError):raise ValueError('Gmail을 읽지 못했습니다. 계정 연결과 인터넷 상태를 확인해 주세요.')
 finally:
  if client:
   try:client.logout()
   except Exception:pass
