import {json,failure,bodyJson,sameOrigin,requireAdmin} from './cloud.js';
import {userRequired,currentUser,limit,emailValue} from './auth.js';
import {quoteFromSources,normalizeCustomerQuote,customerEmailSubject,renderCustomerQuoteEmail,sendCustomerQuoteEmail} from './customer-quote.js';
const stamp=()=>new Date().toISOString();
const text=(v,max=1000)=>String(v||'').trim().slice(0,max);
export async function memberSchema(env){await env.DB.batch([
 env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_member_profiles(user_id TEXT PRIMARY KEY,payload TEXT NOT NULL)'),
 env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_favorites(user_id TEXT NOT NULL,product_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,product_id))'),
 env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,payload TEXT NOT NULL,stage INTEGER NOT NULL DEFAULT 0,cancelled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)'),
 env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_requests_owner ON mm_requests(user_id,created_at)'),
 env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_requests_workflow ON mm_requests(cancelled,stage,created_at)'),
 env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_customer_quotes(request_id TEXT PRIMARY KEY,payload TEXT NOT NULL,pdf_key TEXT NOT NULL,issued_at TEXT NOT NULL,viewed_at TEXT)'),
 env.DB.prepare("CREATE TABLE IF NOT EXISTS mm_customer_quote_deliveries(request_id TEXT PRIMARY KEY,status TEXT NOT NULL,gmail_id TEXT NOT NULL DEFAULT '',pdf_key TEXT NOT NULL,payload TEXT NOT NULL,sent_at TEXT,updated_at TEXT NOT NULL)"),
 env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_request_events(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,title TEXT NOT NULL,at TEXT NOT NULL)'),
 env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_request_admin_events(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,operator_id TEXT,operator_name TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL)'),
 env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_request_admin_events_request ON mm_request_admin_events(request_id,at)'),
 env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_supplier_replies(gmail_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,thread_id TEXT NOT NULL,sender TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,received_at TEXT NOT NULL,files_json TEXT NOT NULL,linked_at TEXT NOT NULL)'),
 env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_supplier_reply_seen(gmail_id TEXT PRIMARY KEY,seen_at TEXT NOT NULL)')
]);}
function profile(data){const p={hospital:text(data.hospital,80),email:emailValue(data.email),phone:text(data.phone,20),province:text(data.province,40),district:text(data.district,40)};if(!p.hospital||!p.province||!p.district||!/^[0-9+() -]{8,20}$/.test(p.phone))throw failure('병원명·지역·연락처를 확인해 주세요.');return p;}
const event=(env,id,title,at)=>env.DB.prepare('INSERT INTO mm_request_events VALUES (?,?,?,?)').bind(crypto.randomUUID(),id,title,at);
const adminEvent=(env,id,operator,action,at)=>env.DB.prepare('INSERT INTO mm_request_admin_events VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),id,operator?.id||null,text(operator?.name,80)||'운영자',action,at);
async function record(env,id,user,admin=false){const row=await env.DB.prepare('SELECT * FROM mm_requests WHERE id=?'+(admin?'':' AND user_id=?')).bind(...(admin?[id]:[id,user.id])).first();if(!row)throw failure('요청을 찾을 수 없습니다.',404);return row;}
function publicRequest(row){return {...JSON.parse(row.payload),id:row.id,stage:row.stage,cancelled:!!row.cancelled,createdAt:row.created_at,updatedAt:row.updated_at,hasQuote:!!row.issued_at,issuedAt:row.issued_at||null,unread:!!row.issued_at&&!row.viewed_at,...(row.supplier_reply_unread===undefined?{}:{supplierReplyUnread:Number(row.supplier_reply_unread||0)})};}
const supplierReplyUnreadSql="(SELECT COUNT(*) FROM mm_supplier_replies sr LEFT JOIN mm_supplier_reply_seen ss ON ss.gmail_id=sr.gmail_id WHERE sr.request_id=r.id AND ss.gmail_id IS NULL) AS supplier_reply_unread";
export async function memberAction({request,env,params}){
 const path=Array.isArray(params.path)?params.path: String(params.path||'').split('/');const [action,id]=path;
 const admin=action==='admin'||action==='admin-pdf';let user;
 if(admin){await requireAdmin(request,env);user=await currentUser(request,env);}else user=await userRequired(request,env);
 await memberSchema(env);
 const url=new URL(request.url);const at=stamp();
 if(request.method==='GET'){
  if(admin&&id==='overview'){
   const counts=await env.DB.prepare('SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN cancelled=1 THEN 1 ELSE 0 END),0) AS cancelled,COALESCE(SUM(CASE WHEN cancelled=0 AND stage=0 THEN 1 ELSE 0 END),0) AS received,COALESCE(SUM(CASE WHEN cancelled=0 AND stage=1 THEN 1 ELSE 0 END),0) AS supplier,COALESCE(SUM(CASE WHEN cancelled=0 AND stage=2 THEN 1 ELSE 0 END),0) AS preparing,COALESCE(SUM(CASE WHEN cancelled=0 AND stage=3 THEN 1 ELSE 0 END),0) AS published FROM mm_requests').first();
   const recent=await env.DB.prepare('SELECT r.*,q.issued_at,q.viewed_at,'+supplierReplyUnreadSql+' FROM mm_requests r LEFT JOIN mm_customer_quotes q ON q.request_id=r.id ORDER BY r.created_at DESC LIMIT 5').all();
   const pending=await env.DB.prepare('SELECT r.*,q.issued_at,q.viewed_at,'+supplierReplyUnreadSql+' FROM mm_requests r LEFT JOIN mm_customer_quotes q ON q.request_id=r.id WHERE r.cancelled=0 AND r.stage<3 ORDER BY r.stage ASC,r.created_at ASC LIMIT 5').all();
   return json({counts,recent:recent.results.map(publicRequest),pending:pending.results.map(publicRequest)});
  }
  if(action==='summary'){
   const p=await env.DB.prepare('SELECT payload FROM mm_member_profiles WHERE user_id=?').bind(user.id).first();
   const f=await env.DB.prepare('SELECT product_id FROM mm_favorites WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all();
   const counts=await env.DB.prepare('SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN r.stage<3 AND r.cancelled=0 THEN 1 ELSE 0 END),0) AS active,COUNT(q.request_id) AS quotes,COALESCE(SUM(CASE WHEN q.request_id IS NOT NULL AND q.viewed_at IS NULL THEN 1 ELSE 0 END),0) AS unread FROM mm_requests r LEFT JOIN mm_customer_quotes q ON q.request_id=r.id WHERE r.user_id=?').bind(user.id).first();
   return json({profile:p?JSON.parse(p.payload):null,favorites:f.results.map(x=>x.product_id),counts});
  }
  if(action==='requests'&&!id||action==='admin'&&!id){
   const page=Math.max(1,Math.min(10000,Math.floor(Number(url.searchParams.get('page')))||1));const search=text(url.searchParams.get('q'),100);const stage=url.searchParams.get('stage');const quotes=url.searchParams.get('quotes')==='1';
   let where=admin?'1=1':'r.user_id=?',args=admin?[]:[user.id];
   if(search){where+=" AND (r.id LIKE ? OR json_extract(r.payload,'$.product.name') LIKE ? OR json_extract(r.payload,'$.profile.hospital') LIKE ?)";args.push('%'+search+'%','%'+search+'%','%'+search+'%');}
   if(stage==='cancelled')where+=' AND r.cancelled=1';
   else if(/^[0-3]$/.test(stage||'')){where+=' AND r.stage=? AND r.cancelled=0';args.push(Number(stage));}
   if(quotes)where+=' AND q.request_id IS NOT NULL';
   const join=' FROM mm_requests r LEFT JOIN mm_customer_quotes q ON q.request_id=r.id WHERE '+where;
   const count=await env.DB.prepare('SELECT COUNT(*) AS total'+join).bind(...args).first();
   const rows=await env.DB.prepare('SELECT r.*,q.issued_at,q.viewed_at'+(admin?','+supplierReplyUnreadSql:'')+join+' ORDER BY r.created_at DESC LIMIT 15 OFFSET ?').bind(...args,(page-1)*15).all();
   return json({requests:rows.results.map(publicRequest),total:count.total,page});
  }
  if(action==='requests'&&id||action==='admin'&&id){
   const row=await record(env,id,user,admin);const q=await env.DB.prepare('SELECT payload,issued_at,viewed_at FROM mm_customer_quotes WHERE request_id=?').bind(id).first();
   const events=await env.DB.prepare('SELECT title,at FROM mm_request_events WHERE request_id=? ORDER BY at').bind(id).all();
   if(q&&!admin)await env.DB.prepare('UPDATE mm_customer_quotes SET viewed_at=? WHERE request_id=? AND viewed_at IS NULL').bind(at,id).run();
   const adminEvents=admin?await env.DB.prepare('SELECT operator_name AS operatorName,action,at FROM mm_request_admin_events WHERE request_id=? ORDER BY at DESC').bind(id).all():null;
   const supplierReplyUnread=admin?await env.DB.prepare('SELECT COUNT(*) AS count FROM mm_supplier_replies sr LEFT JOIN mm_supplier_reply_seen ss ON ss.gmail_id=sr.gmail_id WHERE sr.request_id=? AND ss.gmail_id IS NULL').bind(id).first():null;
   return json({request:publicRequest({...row,issued_at:q?.issued_at,viewed_at:q?.viewed_at,...(admin?{supplier_reply_unread:supplierReplyUnread.count}:{})}),quote:q?{...JSON.parse(q.payload),issuedAt:q.issued_at}:null,events:events.results,...(admin?{adminEvents:adminEvents.results}:{})});
  }
  if((action==='pdf'||action==='admin-pdf')&&id){await record(env,id,user,admin);const q=await env.DB.prepare('SELECT pdf_key FROM mm_customer_quotes WHERE request_id=?').bind(id).first();if(!q||!env.PRIVATE_FILES)throw failure('견적서 파일을 찾을 수 없습니다.',404);const file=await env.PRIVATE_FILES.get(q.pdf_key);if(!file)throw failure('파일을 찾을 수 없습니다.',404);const disposition=admin&&url.searchParams.get('download')!=='1'?'inline':'attachment';return new Response(file.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':disposition+'; filename="quote-'+id+'.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
  throw failure('요청 경로를 확인해 주세요.',404);
 }
 if(request.method!=='POST')throw failure('지원하지 않는 요청입니다.',405);sameOrigin(request);
 const data=await bodyJson(request,admin?12000000:16000);
 if(!admin)await limit(request,env,'member-write',100);
 if(action==='profile'){const p=profile(data);await env.DB.prepare('INSERT INTO mm_member_profiles VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload').bind(user.id,JSON.stringify(p)).run();return json({profile:p});}
 if(action==='favorite'){
  const key=text(data.productId,150);if(!key)throw failure('제품을 선택해 주세요.');
  if(data.saved===true){const n=await env.DB.prepare('SELECT COUNT(*) AS n FROM mm_favorites WHERE user_id=?').bind(user.id).first();if(n.n>=500)throw failure('관심제품은 최대 500개까지 저장할 수 있습니다.');await env.DB.prepare('INSERT INTO mm_favorites VALUES (?,?,?) ON CONFLICT DO NOTHING').bind(user.id,key,at).run();}
  else await env.DB.prepare('DELETE FROM mm_favorites WHERE user_id=? AND product_id=?').bind(user.id,key).run();return json({ok:true});
 }
 if(action==='requests'&&!id){
  if(data.consent!==true)throw failure('개인정보 제공 동의가 필요합니다.');const p=profile(data.profile||{});const qty=Number(data.qty);if(!Number.isInteger(qty)||qty<1||qty>999)throw failure('수량은 1~999로 입력해 주세요.');
  const stored=await env.DB.prepare('SELECT payload FROM mm_products WHERE id=? AND published=1 AND deleted=0').bind(text(data.productId,150)).first();if(!stored)throw failure('현재 요청 가능한 제품을 선택해 주세요.',404);
  const product=JSON.parse(stored.payload),rid='REQ-'+crypto.randomUUID();
  const snapshot={product:{id:text(data.productId,150),name:text(product.name,200),model:text(product.model,150),maker:text(product.maker,150),image:text(product.thumbnail||product.image,2000)},qty,profile:p,memo:text(data.memo),consentAt:at};
  await env.DB.batch([env.DB.prepare('INSERT INTO mm_requests VALUES (?,?,?,0,0,?,?)').bind(rid,user.id,JSON.stringify(snapshot),at,at),env.DB.prepare('INSERT INTO mm_member_profiles VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload').bind(user.id,JSON.stringify(p)),event(env,rid,'견적 요청 접수',at)]);return json({id:rid},201);
 }
 if(action==='cancel'&&id){await record(env,id,user);const row=await env.DB.prepare('UPDATE mm_requests SET cancelled=1,updated_at=? WHERE id=? AND user_id=? AND stage=0 AND cancelled=0 RETURNING id').bind(at,id,user.id).first();if(!row)throw failure('접수 단계의 요청만 취소할 수 있습니다.',409);await event(env,id,'고객 요청 취소',at).run();return json({ok:true});}
 if(action==='admin'&&id){
  const row=await record(env,id,null,true);if(row.cancelled)throw failure('취소된 요청입니다.',409);
  if(data.action==='draft'){
   const replies=await env.DB.prepare('SELECT subject,body FROM mm_supplier_replies WHERE request_id=? ORDER BY received_at DESC LIMIT 10').bind(id).all();
   const attachments=Array.isArray(data.attachments)?data.attachments.slice(0,20).map(x=>({name:text(x.name,180),text:text(x.text,100000),error:text(x.error,200)})):[];
   return json(quoteFromSources(JSON.parse(row.payload),replies.results,attachments));
  }
  if(data.action==='stage'){if(![0,1,2].includes(data.stage)||data.stage<row.stage)throw failure('진행 단계는 앞으로만 변경할 수 있습니다.');const updated=await env.DB.prepare('UPDATE mm_requests SET stage=?,updated_at=? WHERE id=? AND stage<=? AND cancelled=0 RETURNING id').bind(data.stage,at,id,data.stage).first();if(!updated)throw failure('요청 상태가 변경되었습니다.',409);const title=['요청 접수','공급업체 확인 중','견적 작성 중'][data.stage];await env.DB.batch([event(env,id,title,at),adminEvent(env,id,user,'진행 상태: '+title,at)]);return json({ok:true});}
  if(data.action==='publish-send'){
   const existing=await env.DB.prepare('SELECT status,gmail_id,pdf_key,payload,sent_at FROM mm_customer_quote_deliveries WHERE request_id=?').bind(id).first();
   const saved=await env.DB.prepare('SELECT request_id FROM mm_customer_quotes WHERE request_id=?').bind(id).first();
   if(saved)return json({ok:true,alreadySent:!!existing?.gmail_id});
   if(existing&&existing.status!=='sent'&&existing.status!=='failed')throw failure('고객 메일 발송 결과를 확인 중입니다. 중복 발송을 피하려면 Gmail 보낸메일함을 먼저 확인해 주세요.',409);
   const requestData=JSON.parse(row.payload);
   const finalize=async delivery=>{const issuedAt=delivery.sent_at||new Date().toISOString();await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO mm_customer_quotes VALUES (?,?,?,?,NULL)').bind(id,delivery.payload,delivery.pdf_key,issuedAt),
    env.DB.prepare('UPDATE mm_requests SET stage=3,updated_at=? WHERE id=? AND cancelled=0').bind(issuedAt,id),
    event(env,id,'고객 견적서 등록 및 이메일 발송',issuedAt),adminEvent(env,id,user,'고객 견적서 등록 및 이메일 발송',issuedAt)
   ]);return json({ok:true,recipient:requestData.profile.email,sentAt:issuedAt});};
   if(existing?.status==='sent')return finalize(existing);
   if(row.stage<2)throw failure('견적 작성 중 단계에서 등록해 주세요.',409);
   if(!env.PRIVATE_FILES)throw failure('비공개 파일 저장소 연결이 필요합니다.',503);
   if(data.reviewed!==true)throw failure('고객 제품 금액과 PDF 내용을 확인해 주세요.');
   const quote=normalizeCustomerQuote(requestData,data),recipient=emailValue(requestData.profile.email);
   const subject=text(data.emailSubject,160)||customerEmailSubject(requestData,quote);
   if(/[\r\n]/.test(subject))throw failure('이메일 제목을 확인해 주세요.');
   const message=text(data.emailMessage,2000),html=renderCustomerQuoteEmail(requestData,quote,message);
   let bytes;try{bytes=Uint8Array.from(atob(data.pdf||''),c=>c.charCodeAt(0));}catch{throw failure('PDF 파일을 확인해 주세요.');}
   if(bytes.length<100||bytes.length>8000000||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw failure('8MB 이하 PDF 견적서를 확인해 주세요.');
   const key='customer-quotes/'+id+'/'+crypto.randomUUID()+'.pdf';await env.PRIVATE_FILES.put(key,bytes,{httpMetadata:{contentType:'application/pdf'}});
   const payload=JSON.stringify(quote);
   try{
    if(existing?.status==='failed'){const claimed=await env.DB.prepare("UPDATE mm_customer_quote_deliveries SET status='sending',gmail_id='',pdf_key=?,payload=?,sent_at=NULL,updated_at=? WHERE request_id=? AND status='failed'").bind(key,payload,at,id).run();if((claimed.meta?.changes??claimed.changes??0)!==1)throw Error('claim lost');}
    else await env.DB.prepare("INSERT INTO mm_customer_quote_deliveries(request_id,status,pdf_key,payload,updated_at) VALUES (?,'sending',?,?,?)").bind(id,key,payload,at).run();
   }catch{await env.PRIVATE_FILES.delete(key);throw failure('다른 발송 처리가 진행 중입니다. 화면을 새로고침해 주세요.',409);}
   try{
    const {gmailAccess}=await import('./gmail.js');const access=await gmailAccess(env);
    const gmailId=await sendCustomerQuoteEmail(access,recipient,subject,html,bytes);const sentAt=new Date().toISOString();
    await env.DB.prepare("UPDATE mm_customer_quote_deliveries SET status='sent',gmail_id=?,sent_at=?,updated_at=? WHERE request_id=?").bind(gmailId,sentAt,sentAt,id).run();
    return finalize({payload,pdf_key:key,sent_at:sentAt});
   }catch(error){
    const current=await env.DB.prepare('SELECT status FROM mm_customer_quote_deliveries WHERE request_id=?').bind(id).first();
    if(current?.status==='sending')await env.DB.prepare("UPDATE mm_customer_quote_deliveries SET status=?,updated_at=? WHERE request_id=?").bind(error.definite?'failed':'unknown',new Date().toISOString(),id).run();
    if(error.definite)await env.PRIVATE_FILES.delete(key);
    throw error.status?error:failure('메일 발송 결과가 불확실합니다. 재시도 전에 Gmail 보낸메일함을 확인해 주세요.',503);
   }
  }
  if(data.action==='publish'){
   if(row.stage<2)throw failure('견적 작성 중 단계에서 등록해 주세요.',409);
   if(!env.PRIVATE_FILES)throw failure('비공개 파일 저장소 연결이 필요합니다.',503);
   const qty=JSON.parse(row.payload).qty,unit=Number(data.unit),shipping=Number(data.shipping),installation=Number(data.installation);
   if(![unit,shipping,installation].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000000)||unit===0)throw failure('판매금액과 배송·설치비를 확인해 주세요.');
   let bytes;try{bytes=Uint8Array.from(atob(data.pdf||''),c=>c.charCodeAt(0));}catch{throw failure('PDF 파일을 확인해 주세요.');}
   if(bytes.length>8000000||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw failure('8MB 이하 PDF 견적서를 첨부해 주세요.');
   const key='customer-quotes/'+id+'/'+crypto.randomUUID()+'.pdf';await env.PRIVATE_FILES.put(key,bytes,{httpMetadata:{contentType:'application/pdf'}});
   const net=unit*qty+shipping+installation,tax=Math.round(net*0.1);const quote={unit,shipping,installation,net,tax,total:net+tax,terms:text(data.terms,3000)};
   try{await env.DB.batch([env.DB.prepare('INSERT INTO mm_customer_quotes VALUES (?,?,?,?,NULL) ON CONFLICT(request_id) DO UPDATE SET payload=excluded.payload,pdf_key=excluded.pdf_key,issued_at=excluded.issued_at,viewed_at=NULL').bind(id,JSON.stringify(quote),key,at),env.DB.prepare('UPDATE mm_requests SET stage=3,updated_at=? WHERE id=?').bind(at,id),event(env,id,'고객 견적서 등록',at),adminEvent(env,id,user,'고객 견적서 등록',at)]);}catch(error){await env.PRIVATE_FILES.delete(key);throw error;}
   return json({ok:true});
  }
 }
 throw failure('요청 경로를 확인해 주세요.',404);
}
