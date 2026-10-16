import {json,failure,requireAdmin,sameOrigin,limitedBody,bodyJson} from './cloud.js';
import {authSchema,putToken,takeToken,random,digest,cookie,readCookie,siteOrigin,limit} from './auth.js';
import {supplierSchema} from './suppliers.js';
import {memberSchema} from './member.js';
import {certificateKey,certificateName,defaultSupplierDraft,normalizeSupplierDraft,renderSupplierMail} from './supplier-mail-template.js';

const scopes=['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send'];
const callbackPath='/api/mail/oauth/callback';
const gmailOrigin=(request,env)=>siteOrigin(request,{...env,SITE_URL:env.GMAIL_SITE_URL||env.SITE_URL});
const enc=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const un64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const configured=env=>Boolean(env.GMAIL_CLIENT_ID&&env.GMAIL_CLIENT_SECRET);
async function schema(env){await authSchema(env);await env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_gmail_connection(id INTEGER PRIMARY KEY,email TEXT NOT NULL,tokens TEXT NOT NULL,updated_at TEXT NOT NULL)').run();}
// Client-secret rotation requires reconnecting Gmail. Tokens never leave the server.
async function key(env){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode('medicalmarket:gmail:v1:'+env.GMAIL_CLIENT_SECRET)),'AES-GCM',false,['encrypt','decrypt']);}
export async function seal(env,value){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('mm_gmail_connection:1')},await key(env),enc.encode(JSON.stringify(value)));return b64(iv)+'.'+b64(data);}
export async function unseal(env,value){const [iv,data]=value.split('.');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(iv),additionalData:enc.encode('mm_gmail_connection:1')},await key(env),un64(data))));}
async function google(url,options={}){const response=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});if(!response.ok)throw failure('Google 연결을 확인하지 못했습니다. 계정을 다시 연결해 주세요.',502);return response.json();}
const gmailApi='https://gmail.googleapis.com/gmail/v1/users/me/';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const headerSafe=value=>String(value??'').replace(/[\r\n]+/g,' ').trim().slice(0,200);
const b64Large=bytes=>{let out='';for(let i=0;i<bytes.length;i+=12288)out+=btoa(String.fromCharCode(...bytes.subarray(i,i+12288)));return out;};
const wrapBase64=value=>value.match(/.{1,76}/g)?.join('\r\n')||'';
export async function supplierMailSchema(env){
 await memberSchema(env);await supplierSchema(env);
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS mm_supplier_mail(request_id TEXT PRIMARY KEY,supplier_id TEXT NOT NULL,recipient TEXT NOT NULL,status TEXT NOT NULL,gmail_id TEXT NOT NULL DEFAULT '',sent_at TEXT,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS mm_supplier_mail_followups(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,supplier_id TEXT NOT NULL,recipient TEXT NOT NULL,status TEXT NOT NULL,gmail_id TEXT NOT NULL DEFAULT '',sent_at TEXT,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_supplier_mail_followups_request ON mm_supplier_mail_followups(request_id,sent_at)').run();
 await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS mm_supplier_mail_followups_pending ON mm_supplier_mail_followups(request_id) WHERE status IN ('sending','unknown')").run();
}
async function supplierRequest(env,requestId){
 if(!/^REQ-[a-f0-9-]{36}$/i.test(requestId))throw failure('견적 요청을 확인해 주세요.');
 const row=await env.DB.prepare('SELECT * FROM mm_requests WHERE id=?').bind(requestId).first();
 if(!row)throw failure('견적 요청을 찾을 수 없습니다.',404);
 return {...row,payload:JSON.parse(row.payload)};
}
async function supplierOptions(env,requestId){
 const row=await supplierRequest(env,requestId),productId=row.payload.product?.id;
 const rows=await env.DB.prepare(`SELECT s.id,s.company,s.email,s.phone,s.active,d.classification,d.review_status,d.company_phone,d.company_email,d.contacts_json
  FROM mm_suppliers s JOIN mm_supplier_products p ON p.supplier_id=s.id
  LEFT JOIN mm_supplier_details d ON d.supplier_id=s.id WHERE p.product_id=? AND COALESCE(d.source_key,'')!='legacy:medicalmarket' ORDER BY s.active DESC,s.company`).bind(productId).all();
 const suppliers=rows.results.map(s=>({id:s.id,company:s.company,email:s.email,phone:s.company_phone||s.phone,companyEmail:s.company_email||'',active:!!s.active,classification:s.classification||'manual',reviewStatus:s.review_status||'needs_review',contacts:JSON.parse(s.contacts_json||'[]')}));
 const delivery=await env.DB.prepare('SELECT supplier_id,recipient,status,gmail_id,sent_at FROM mm_supplier_mail WHERE request_id=?').bind(requestId).first();
 const followups=await env.DB.prepare('SELECT id,supplier_id,recipient,status,gmail_id,sent_at FROM mm_supplier_mail_followups WHERE request_id=? ORDER BY updated_at DESC LIMIT 20').bind(requestId).all();
 const connection=await env.DB.prepare('SELECT email FROM mm_gmail_connection WHERE id=1').first();
 const certificate=env.PRIVATE_FILES?await env.PRIVATE_FILES.head(certificateKey):null;
 return {suppliers,delivery:delivery?{supplierId:delivery.supplier_id,recipient:delivery.recipient,status:delivery.status,gmailId:delivery.gmail_id,sentAt:delivery.sent_at}:null,followups:followups.results.map(item=>({id:item.id,supplierId:item.supplier_id,recipient:item.recipient,status:item.status,gmailId:item.gmail_id,sentAt:item.sent_at})),gmailEmail:connection?.email||'',certificateReady:!!certificate,certificateName,product:row.payload.product,qty:row.payload.qty,requestStage:row.stage,cancelled:!!row.cancelled};
}
async function supplierPreview(env,input){
 const row=await supplierRequest(env,String(input.requestId||''));
 const options=await supplierOptions(env,row.id),supplier=options.suppliers.find(s=>s.id===input.supplierId);
 if(!supplier)throw failure('이 제품과 연결된 공급업체를 선택해 주세요.',409);
 const contactId=String(input.contactId||''),contact=contactId?supplier.contacts.find(c=>c.id===contactId&&!c.left&&!c.blocked):null;
 if(contactId&&!contact)throw failure('현재 사용할 수 있는 담당자를 선택해 주세요.',409);
 const recipient=contact?contact.email:(supplier.companyEmail||supplier.email);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient||''))throw failure('수신 이메일을 확인해 주세요.',409);
 const draft=normalizeSupplierDraft(row,input.draft||defaultSupplierDraft(row));
 return {recipient,sender:options.gmailEmail,certificateReady:options.certificateReady,certificateName,subject:draft.subject,draft,html:renderSupplierMail(row,draft)};
}
async function supplierSend(request,env,input){
 await limit(request,env,'supplier-send',30);
 const requestId=String(input.requestId||''),supplierId=String(input.supplierId||''),contactId=String(input.contactId||''),followup=input.followup===true,sendId=followup?crypto.randomUUID():requestId;
 const row=await supplierRequest(env,requestId);
 if(row.cancelled||(!followup&&row.stage!==0)||(followup&&![1,2].includes(row.stage)))throw failure(followup?'진행 중인 요청에서만 추가 메일을 보낼 수 있습니다.':'접수 단계의 요청만 업체에 보낼 수 있습니다.',409);
 if(input.reviewed!==true)throw failure('업체·수신 이메일·제품·수량을 확인해 주세요.',409);
 const options=await supplierOptions(env,requestId),supplier=options.suppliers.find(s=>s.id===supplierId);
 if(!supplier)throw failure('이 제품과 연결된 공급업체를 선택해 주세요.',409);
 const contact=contactId?supplier.contacts.find(c=>c.id===contactId&&!c.left&&!c.blocked):null;
 if(contactId&&!contact)throw failure('현재 사용할 수 있는 담당자를 선택해 주세요.',409);
 const to=contact?contact.email:(supplier.companyEmail||supplier.email);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to||''))throw failure('수신 이메일을 확인해 주세요.',409);
 if(followup){
  if(options.delivery?.status!=='sent')throw failure('첫 발송 완료 후 추가 메일을 보낼 수 있습니다.',409);
  if(options.followups.some(item=>['sending','unknown'].includes(item.status)))throw failure('이전 추가 발송 결과를 먼저 확인해 주세요. 중복 발송을 막기 위해 잠시 제한합니다.',409);
 }else if(options.delivery)throw failure('이미 발송을 시도한 요청입니다. 중복 발송을 막기 위해 Gmail과 발송 상태를 확인해 주세요.',409);
 if(!env.PRIVATE_FILES)throw failure('사업자등록증 비공개 저장소를 연결해 주세요.',503);
 const certificate=await env.PRIVATE_FILES.get(certificateKey);
 if(!certificate)throw failure('사업자등록증을 먼저 업로드해 주세요.',409);
 const certificateBytes=new Uint8Array(await certificate.arrayBuffer());
 if(certificateBytes.length>2*1024*1024)throw failure('첨부파일 크기를 확인해 주세요.',413);
 const draft=normalizeSupplierDraft(row,input.draft||{}),subject=headerSafe(draft.subject),html=renderSupplierMail(row,draft);
 const access=await gmailAccess(env);
 const at=new Date().toISOString();
 try{if(followup)await env.DB.prepare("INSERT INTO mm_supplier_mail_followups(id,request_id,supplier_id,recipient,status,updated_at) VALUES (?,?,?,?,'sending',?)").bind(sendId,requestId,supplierId,to,at).run();else await env.DB.prepare("INSERT INTO mm_supplier_mail(request_id,supplier_id,recipient,status,updated_at) VALUES (?,?,?,'sending',?)").bind(requestId,supplierId,to,at).run();}
 catch{throw failure('다른 발송 처리가 진행 중입니다. 화면을 새로고침해 주세요.',409);}
 try{
  const boundary='mm-'+crypto.randomUUID();
  const encodedName=encodeURIComponent(certificateName);
  const mime=`From: =?UTF-8?B?${b64(enc.encode('(주)피지오컴퍼니'))}?= <${access.email}>\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${b64(enc.encode(subject))}?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapBase64(b64Large(enc.encode(html)))}\r\n--${boundary}\r\nContent-Type: image/jpeg; name*=UTF-8''${encodedName}\r\nContent-Disposition: attachment; filename*=UTF-8''${encodedName}\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapBase64(b64Large(certificateBytes))}\r\n--${boundary}--`;
  const raw=b64Large(enc.encode(mime)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const response=await fetch(gmailApi+'messages/send',{method:'POST',headers:{Authorization:'Bearer '+access.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(20000)});
  if(!response.ok){await env.DB.prepare(`UPDATE ${followup?'mm_supplier_mail_followups':'mm_supplier_mail'} SET status='failed',updated_at=? WHERE ${followup?'id':'request_id'}=?`).bind(new Date().toISOString(),sendId).run();throw failure('Gmail이 발송을 거절했습니다. 연결 상태를 확인해 주세요.',502);}
  const result=await response.json();if(!result.id)throw Error('Gmail 발송 확인 ID 없음');
  const sentAt=new Date().toISOString();await env.DB.batch([
   env.DB.prepare(`UPDATE ${followup?'mm_supplier_mail_followups':'mm_supplier_mail'} SET status='sent',gmail_id=?,sent_at=?,updated_at=? WHERE ${followup?'id':'request_id'}=?`).bind(result.id,sentAt,sentAt,sendId),
   ...(!followup?[env.DB.prepare('UPDATE mm_requests SET stage=1,updated_at=? WHERE id=? AND stage=0').bind(sentAt,requestId)]:[]),
   env.DB.prepare('INSERT INTO mm_request_events VALUES (?,?,?,?)').bind(crypto.randomUUID(),requestId,followup?'공급업체 추가 이메일 발송':'공급업체 이메일 발송',sentAt)
  ]);
  return {status:'sent',recipient:to,sentAt,followup};
 }catch(error){
  const current=await env.DB.prepare(`SELECT status FROM ${followup?'mm_supplier_mail_followups':'mm_supplier_mail'} WHERE ${followup?'id':'request_id'}=?`).bind(sendId).first();
  if(current?.status==='sending')await env.DB.prepare(`UPDATE ${followup?'mm_supplier_mail_followups':'mm_supplier_mail'} SET status='unknown',updated_at=? WHERE ${followup?'id':'request_id'}=?`).bind(new Date().toISOString(),sendId).run();
  throw error.status?error:failure('발송 결과를 확인하지 못했습니다. 중복 발송을 피하려면 Gmail 보낸메일함을 먼저 확인해 주세요.',503);
 }
}
const decodeBase64=value=>{const raw=atob(String(value||'').replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-String(value||'').length%4)%4));return new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0)));};
const header=(payload,name)=>payload.headers?.find(h=>h.name?.toLowerCase()===name)?.value||'';
function bodyText(part){if(part.mimeType==='text/plain'&&part.body?.data)return decodeBase64(part.body.data);for(const child of part.parts||[]){const value=bodyText(child);if(value)return value;}if(part.mimeType==='text/html'&&part.body?.data)return decodeBase64(part.body.data).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');return '';}
function files(part,out=[]){if(part.filename&&part.body?.attachmentId)out.push({id:part.body.attachmentId,name:part.filename,size:part.body.size||0});for(const child of part.parts||[])files(child,out);return out;}
async function mailbox(env,input){const access=await gmailAccess(env),auth={Authorization:'Bearer '+access.access_token},action=input.action||'list',uid=String(input.uid||'');const get=(path)=>google(gmailApi+path,{headers:auth});
 if(action==='list'){
  const folder=['inbox','sent','all'].includes(input.folder)?input.folder:'inbox',page=Number(input.page||0);if(!Number.isInteger(page)||page<0||page>20)throw failure('메일 페이지를 확인해 주세요.');
  const query=new URLSearchParams({maxResults:'25'});if(folder!=='all')query.set('labelIds',folder.toUpperCase());let token='';
  for(let i=0;i<=page;i++){if(token)query.set('pageToken',token);const result=await get('messages?'+query);if(i===page){const items=await Promise.all((result.messages||[]).map(async m=>{const detail=await get('messages/'+encodeURIComponent(m.id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date');return {uid:m.id,sender:header(detail.payload,'from'),subject:header(detail.payload,'subject')||'(제목 없음)',date:header(detail.payload,'date'),unread:detail.labelIds?.includes('UNREAD')||false};}));return {items,total:page*25+items.length+(result.nextPageToken?1:0),hasNext:Boolean(result.nextPageToken)};}token=result.nextPageToken;if(!token)throw failure('마지막 페이지입니다.');}
 }
 if(!/^[A-Za-z0-9_-]{4,128}$/.test(uid))throw failure('메일을 선택해 주세요.');
 if(action==='read'){const m=await get('messages/'+encodeURIComponent(uid)+'?format=full');const text=bodyText(m.payload||'');return {uid,sender:header(m.payload,'from'),to:header(m.payload,'to'),cc:header(m.payload,'cc'),subject:header(m.payload,'subject')||'(제목 없음)',date:header(m.payload,'date'),text:text.slice(0,100000),truncated:text.length>100000,files:files(m.payload)};}
 if(action==='file'){const fileId=String(input.fileId||'');if(!/^[A-Za-z0-9_-]{4,256}$/.test(fileId))throw failure('첨부파일을 선택해 주세요.');const m=await get('messages/'+encodeURIComponent(uid)+'?format=full');const file=files(m.payload).find(f=>f.id===fileId);if(!file||file.size>8*1024*1024)throw failure('첨부파일을 찾을 수 없거나 8MB를 초과합니다.',413);const data=await get('messages/'+encodeURIComponent(uid)+'/attachments/'+encodeURIComponent(fileId));return {name:file.name,base64:data.data.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-data.data.length%4)%4)};}
 throw failure('메일 요청을 확인해 주세요.');
}
async function exchange(env,values){return google('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GMAIL_CLIENT_ID,client_secret:env.GMAIL_CLIENT_SECRET,...values})});}
async function save(env,email,tokens){await env.DB.prepare('INSERT INTO mm_gmail_connection(id,email,tokens,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,tokens=excluded.tokens,updated_at=excluded.updated_at').bind(email,await seal(env,tokens),new Date().toISOString()).run();}
export async function gmailAccess(env){const row=await env.DB.prepare('SELECT * FROM mm_gmail_connection WHERE id=1').first();if(!row)throw failure('Gmail 계정을 먼저 연결해 주세요.',409);let tokens;try{tokens=await unseal(env,row.tokens);}catch{throw failure('Gmail 키가 변경되었습니다. 계정을 다시 연결해 주세요.',409);}if(tokens.expires<Date.now()+60000){const next=await exchange(env,{grant_type:'refresh_token',refresh_token:tokens.refresh_token});if(!next.access_token)throw failure('Gmail 계정을 다시 연결해 주세요.',409);tokens={...tokens,access_token:next.access_token,refresh_token:next.refresh_token||tokens.refresh_token,expires:Date.now()+Number(next.expires_in||3600)*1000};await save(env,row.email,tokens);}return {email:row.email,access_token:tokens.access_token};}
const sessionBinding=request=>digest(readCookie(request,'mm_session')||readCookie(request,'mm_admin'));
export async function gmailAction({request,env}){
 const path=new URL(request.url).pathname.replace('/api/mail/','');
 // Strict administrator cookies are withheld on Google's cross-site redirect.
 // Finish through a same-origin POST, where the original cookie is available.
 // Keep same-origin referrers: no-referrer makes form POST Origin null in browsers.
 // The script removes OAuth parameters before submission; cross-origin referrers stay blocked.
 if(request.method==='GET'&&path==='oauth/callback'){
  const query=new URL(request.url).searchParams,nonce=random();
  const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=['state','code','error'].map(name=>`<input type="hidden" name="${name}" value="${escape(query.get(name))}">`).join('');
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gmail 연결 확인</title><body><p>Gmail 연결을 확인하고 있습니다.</p><form method="post" action="${callbackPath}">${fields}<button>연결 확인 계속하기</button></form><script nonce="${nonce}">history.replaceState(null,'','${callbackPath}');document.forms[0].submit();</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`}});
 }
 if(request.method==='POST')sameOrigin(request);
 await requireAdmin(request,env);await schema(env);
 if(request.method==='GET'&&path==='status'){
  let connected=false,email='',error='';
  if(configured(env)&&await env.DB.prepare('SELECT id FROM mm_gmail_connection WHERE id=1').first())try{const access=await gmailAccess(env);const profile=await google('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+access.access_token}});email=profile.emailAddress;connected=email===access.email;}catch(e){error=e.status?e.message:'Gmail 연결을 확인하지 못했습니다. 다시 연결해 주세요.';}
  return json({provider:'gmail-api',configured:configured(env),connected,email,error,attachment:null,workflowReady:false,redirectUri:gmailOrigin(request,env)+callbackPath});
 }
 if(request.method==='POST'&&path==='oauth/start'){
  if(!configured(env))throw failure('Cloudflare에 GMAIL_CLIENT_ID와 GMAIL_CLIENT_SECRET을 등록해 주세요.',503);
  if(new URL(request.url).origin!==gmailOrigin(request,env))throw failure('정식 홈페이지 주소에서 연결해 주세요.',400);
  await limit(request,env,'gmail-connect',10);
  const verifier=random(),binding=await sessionBinding(request),state=await putToken(env,'gmail-oauth',{verifier,binding},10);
  const challenge=b64(await crypto.subtle.digest('SHA-256',enc.encode(verifier))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:env.GMAIL_CLIENT_ID,redirect_uri:gmailOrigin(request,env)+callbackPath,response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent select_account',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  return json({url:url.href},200,{'Set-Cookie':cookie('mm_gmail_oauth',state,600)});
 }
 if(request.method==='POST'&&path==='oauth/callback'){
  let result='failed';try{
   if(!configured(env))throw Error();const query=new URLSearchParams(new TextDecoder().decode(await limitedBody(request,16384))),state=query.get('state');
   if(!state||state!==readCookie(request,'mm_gmail_oauth'))throw Error();
   const pending=await takeToken(env,state,'gmail-oauth');if(pending.binding!==await sessionBinding(request))throw Error();
   if(query.get('error'))result='cancelled';else{
    if(!query.get('code'))throw Error();
    const tokens=await exchange(env,{grant_type:'authorization_code',code:query.get('code'),redirect_uri:gmailOrigin(request,env)+callbackPath,code_verifier:pending.verifier});
    if(!tokens.access_token||!tokens.refresh_token||!scopes.every(s=>String(tokens.scope||'').split(' ').includes(s)))throw Error();
    const profile=await google('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+tokens.access_token}});
    if(!profile.emailAddress)throw Error();
    await save(env,profile.emailAddress,{access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires:Date.now()+Number(tokens.expires_in||3600)*1000});result='connected';
   }
  }catch{/* Never reflect authorization codes, provider errors or tokens into the page. */}
  return new Response(null,{status:303,headers:{Location:gmailOrigin(request,env)+'/?gmail='+result+'#ops/mail','Set-Cookie':cookie('mm_gmail_oauth','',0),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }
 if(request.method==='POST'&&path==='mailbox')return json(await mailbox(env,await bodyJson(request,8192)));
 if(request.method==='GET'&&path==='supplier-options'){
  await supplierMailSchema(env);
  return json(await supplierOptions(env,new URL(request.url).searchParams.get('requestId')||''));
 }
 if(request.method==='POST'&&path==='supplier-preview'){
  await supplierMailSchema(env);
  return json(await supplierPreview(env,await bodyJson(request,12000)));
 }
 if(request.method==='POST'&&path==='supplier-certificate'){
  await limit(request,env,'supplier-certificate',10);
  if(!env.PRIVATE_FILES)throw failure('비공개 파일 저장소 연결이 필요합니다.',503);
  const bytes=await limitedBody(request,2*1024*1024);
  if(bytes.length<100||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)throw failure('2MB 이하의 JPG 사업자등록증 파일을 선택해 주세요.');
  await env.PRIVATE_FILES.put(certificateKey,bytes,{httpMetadata:{contentType:'image/jpeg'}});
  return json({stored:true,name:certificateName});
 }
 if(request.method==='POST'&&path==='supplier-send'){
  await supplierMailSchema(env);
  return json(await supplierSend(request,env,await bodyJson(request,8192)));
 }
 if(path==='supplier-replies'||path==='supplier-replies/sync'||path==='supplier-replies/file'){
  const {supplierRepliesAction}=await import('./supplier-replies.js');
  return supplierRepliesAction({request,env,path});
 }
 throw failure('이 메일 기능은 아직 클라우드 연결 작업 중입니다.',501);
}
