import {json,failure,bodyJson} from './cloud.js';
import {limit} from './auth.js';
import {gmailAccess,supplierMailSchema} from './gmail.js';

const gmailApi='https://gmail.googleapis.com/gmail/v1/users/me/';
const requestIdPattern=/^REQ-[a-f0-9-]{36}$/i;
const messageIdPattern=/^[A-Za-z0-9_-]{4,128}$/;
const header=(message,name)=>message.payload?.headers?.find(item=>item.name?.toLowerCase()===name)?.value||'';
const decode=value=>new TextDecoder().decode(Uint8Array.from(atob(String(value||'').replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-String(value||'').length%4)%4)),c=>c.charCodeAt(0)));
const address=value=>{const bracket=String(value||'').match(/<([^<>]+)>/);return (bracket?bracket[1]:String(value||'')).trim().toLowerCase();};
function bodyText(part){
 if(part.mimeType==='text/plain'&&part.body?.data)return decode(part.body.data);
 for(const child of part.parts||[]){const text=bodyText(child);if(text)return text;}
 if(part.mimeType==='text/html'&&part.body?.data)return decode(part.body.data).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
 return '';
}
function attachments(part,out=[]){
 if(part.filename&&part.body?.attachmentId)out.push({id:part.body.attachmentId,name:part.filename.slice(0,180),size:Number(part.body.size||0)});
 for(const child of part.parts||[])attachments(child,out);
 return out;
}
async function gmailGet(access,path){
 const response=await fetch(gmailApi+path,{headers:{Authorization:'Bearer '+access.access_token},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw failure('Gmail 회신을 확인하지 못했습니다. 연결 상태를 확인해 주세요.',502);
 return response.json();
}
async function replySchema(env){
 await supplierMailSchema(env);
 await env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_supplier_replies(gmail_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,thread_id TEXT NOT NULL,sender TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,received_at TEXT NOT NULL,files_json TEXT NOT NULL,linked_at TEXT NOT NULL)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_supplier_replies_request ON mm_supplier_replies(request_id,received_at)')
 ]);
}
async function deliveries(env,requestId,includeFollowups=false){
 const clause=requestId?'AND m.request_id=?':'';
 const rows=await env.DB.prepare(`SELECT m.request_id,m.supplier_id,m.recipient,m.status,m.gmail_id,m.sent_at,r.payload,r.stage,r.cancelled
  FROM mm_supplier_mail m JOIN mm_requests r ON r.id=m.request_id
  WHERE m.status='sent' ${clause} ORDER BY m.sent_at DESC LIMIT 100`).bind(...(requestId?[requestId]:[])).all();
 if(!includeFollowups)return rows.results;
 const additional=await env.DB.prepare(`SELECT m.request_id,m.supplier_id,m.recipient,m.status,m.gmail_id,m.sent_at,r.payload,r.stage,r.cancelled
  FROM mm_supplier_mail_followups m JOIN mm_requests r ON r.id=m.request_id
  WHERE m.status='sent' ${clause} ORDER BY m.sent_at DESC LIMIT 100`).bind(...(requestId?[requestId]:[])).all();
 return [...rows.results,...additional.results].sort((a,b)=>String(b.sent_at).localeCompare(String(a.sent_at)));
}
async function sync(env,requestId){
 const rows=await deliveries(env,requestId,true),access=await gmailAccess(env);
 let linked=0,scanned=0,failed=0;
 for(const row of rows.slice(0,20)){
  if(!messageIdPattern.test(row.gmail_id)){failed++;continue;}
  try{
   const sent=await gmailGet(access,'messages/'+encodeURIComponent(row.gmail_id)+'?format=minimal');
   if(!sent.threadId)throw Error('Missing Gmail thread');
   const thread=await gmailGet(access,'threads/'+encodeURIComponent(sent.threadId)+'?format=full');
   for(const message of thread.messages||[]){
    if(message.id===row.gmail_id||message.labelIds?.includes('SENT'))continue;
    if(address(header(message,'from'))!==address(row.recipient))continue;
    if(Number(message.internalDate||0)<Date.parse(row.sent_at||'')-60000)continue;
    if(!messageIdPattern.test(message.id))continue;
    scanned++;
    const existing=await env.DB.prepare('SELECT gmail_id FROM mm_supplier_replies WHERE gmail_id=?').bind(message.id).first();
    if(existing)continue;
    const at=new Date().toISOString(),body=bodyText(message.payload||'').slice(0,100000);
    const files=attachments(message.payload||'').slice(0,30);
    const receivedAt=new Date(Number(message.internalDate)||Date.now()).toISOString();
    const inserted=await env.DB.prepare('INSERT OR IGNORE INTO mm_supplier_replies VALUES (?,?,?,?,?,?,?,?,?)').bind(message.id,row.request_id,sent.threadId,header(message,'from').slice(0,300),header(message,'subject').slice(0,300),body,receivedAt,JSON.stringify(files),at).run();
    if((inserted.meta?.changes??inserted.changes??0)<1)continue;
    linked++;
    await env.DB.batch([
     env.DB.prepare('UPDATE mm_requests SET stage=2,updated_at=? WHERE id=? AND stage=1 AND cancelled=0').bind(at,row.request_id),
     env.DB.prepare('INSERT INTO mm_request_events VALUES (?,?,?,?)').bind(crypto.randomUUID(),row.request_id,'공급업체 회신 도착',at)
    ]);
   }
  }catch(error){failed++;if(requestId)throw error.status?error:failure('이 요청의 Gmail 발송 내역을 확인하지 못했습니다.',502);}
 }
 if(failed&&failed===Math.min(rows.length,20))throw failure('Gmail 발송 내역을 확인하지 못했습니다. 계정 연결을 확인해 주세요.',502);
 return {linked,scanned,checked:Math.min(rows.length,20),failed};
}
async function listing(env,requestId){
 const rows=await deliveries(env,requestId);
 const replyRows=requestId?await env.DB.prepare('SELECT gmail_id,request_id,sender,subject,body,received_at,files_json FROM mm_supplier_replies WHERE request_id=? ORDER BY received_at DESC').bind(requestId).all():await env.DB.prepare('SELECT gmail_id,request_id,sender,subject,substr(body,1,500) AS body,received_at,files_json FROM mm_supplier_replies ORDER BY received_at DESC LIMIT 200').all();
 const grouped=new Map();for(const reply of replyRows.results){const list=grouped.get(reply.request_id)||[];list.push({id:reply.gmail_id,sender:reply.sender,subject:reply.subject,text:reply.body,receivedAt:reply.received_at,files:JSON.parse(reply.files_json)});grouped.set(reply.request_id,list);}
 const results=[];
 for(const row of rows){
  const payload=JSON.parse(row.payload);
  results.push({requestId:row.request_id,recipient:row.recipient,sentAt:row.sent_at,stage:row.stage,cancelled:!!row.cancelled,product:payload.product?.name||'',hospital:payload.profile?.hospital||'',replies:grouped.get(row.request_id)||[]});
 }
 return {requests:results};
}
async function download(env,url){
 const requestId=url.searchParams.get('requestId')||'',replyId=url.searchParams.get('replyId')||'',fileId=url.searchParams.get('fileId')||'';
 if(!requestIdPattern.test(requestId)||!messageIdPattern.test(replyId)||!messageIdPattern.test(fileId))throw failure('첨부파일을 확인해 주세요.');
 const row=await env.DB.prepare('SELECT files_json FROM mm_supplier_replies WHERE request_id=? AND gmail_id=?').bind(requestId,replyId).first();
 if(!row)throw failure('연결된 회신을 찾을 수 없습니다.',404);
 const file=JSON.parse(row.files_json).find(item=>item.id===fileId);
 if(!file)throw failure('첨부파일을 찾을 수 없습니다.',404);
 if(file.size>8*1024*1024)throw failure('8MB가 넘는 첨부파일은 Gmail에서 확인해 주세요.',413);
 const access=await gmailAccess(env);
 const data=await gmailGet(access,'messages/'+encodeURIComponent(replyId)+'/attachments/'+encodeURIComponent(fileId));
 const binary=Uint8Array.from(atob(String(data.data||'').replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-String(data.data||'').length%4)%4)),c=>c.charCodeAt(0));
 if(binary.length>8*1024*1024)throw failure('8MB가 넘는 첨부파일은 Gmail에서 확인해 주세요.',413);
 return new Response(binary,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
export async function supplierRepliesAction({request,env,path}){
 await replySchema(env);
 const url=new URL(request.url),requestId=url.searchParams.get('requestId')||'';
 if(requestId&&!requestIdPattern.test(requestId))throw failure('견적 요청을 확인해 주세요.');
 if(request.method==='GET'&&path==='supplier-replies')return json(await listing(env,requestId));
 if(request.method==='GET'&&path==='supplier-replies/file')return download(env,url);
 if(request.method==='POST'&&path==='supplier-replies/sync'){
  await limit(request,env,'supplier-replies-sync',20);
  const input=await bodyJson(request,2048),id=String(input.requestId||'');
  if(id&&!requestIdPattern.test(id))throw failure('견적 요청을 확인해 주세요.');
  return json(await sync(env,id));
 }
 throw failure('회신 요청을 확인해 주세요.',405);
}
