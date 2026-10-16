import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest as auth} from '../functions/api/auth/[[path]].js';
import {onRequest as member} from '../functions/api/member/[[path]].js';
import {onRequest as suppliers} from '../functions/api/suppliers/[[path]].js';
import {onRequest as mail} from '../functions/api/mail/[[path]].js';
import {seal} from '../server/gmail.js';

test('request-linked supplier contact sends after per-request confirmation even while imported supplier is unreviewed',async()=>{
 const db=new DatabaseSync(':memory:');
 const DB={prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){return db.prepare(sql).run(...values);}};},async batch(statements){db.exec('BEGIN');try{const out=[];for(const item of statements)out.push(await item.run());db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}}};
 const env={DB,GMAIL_CLIENT_ID:'test-id',GMAIL_CLIENT_SECRET:'test-secret'};let calls=0;
 const invoke=(handler,kind,path,data,cookie='')=>handler({env,params:{path:path.split('?')[0].split('/').filter(Boolean)},request:new Request('https://example.test/api/'+kind+'/'+path,{method:data===undefined?'GET':'POST',headers:{Origin:'https://example.test',Cookie:cookie,'CF-Connecting-IP':String(++calls)},...(data===undefined?{}:{body:JSON.stringify(data)})})});
 const session=response=>response.headers.get('set-cookie').split(';')[0];
 const buyer=await invoke(auth,'auth','signup',{email:'buyer@example.test',name:'구매자',password:'Only-for-test-123!',consent:true});
 const operator=await invoke(auth,'auth','signup',{email:'operator@example.test',name:'운영자',password:'Only-for-test-123!',consent:true});
 const buyerCookie=session(buyer),operatorCookie=session(operator),operatorId=(await operator.json()).user.id;
 db.prepare("UPDATE mm_users SET role='admin' WHERE id=?").run(operatorId);
 await invoke(suppliers,'suppliers','',undefined,operatorCookie);
 db.prepare('INSERT INTO mm_products VALUES (?,?,1,0,1,?)').run('legacy-10',JSON.stringify({name:'초음파 Q40',model:'Q40',maker:'시험 제조사'}),new Date().toISOString());
 const request=await invoke(member,'member','requests',{productId:'legacy-10',qty:2,profile:{hospital:'시험 의원',email:'buyer@example.test',phone:'010-0000-0000',province:'서울특별시',district:'강남구'},consent:true},buyerCookie);
 assert.equal(request.status,201);const requestId=(await request.json()).id;
 const supplier={sourceKey:'legacy:company-1',classification:'candidate',reviewStatus:'needs_review',company:'시험 제조사',companyPhone:'02-0000-0000',companyEmail:'',email:'',phone:'02-0000-0000',contacts:[{id:'contact-1',name:'견적 담당자',email:'supplier@example.test',phone:'02-1111-1111',mobile:'010-1111-1111'}],productIds:['legacy-10'],active:false};
 const imported=await invoke(suppliers,'suppliers','import',supplier,operatorCookie);assert.equal(imported.status,201);const supplierId=(await imported.json()).id;
 await invoke(suppliers,'suppliers','import',{...supplier,sourceKey:'legacy:medicalmarket',company:'메디컬마켓'},operatorCookie);
 const optionsPath='supplier-options?requestId='+requestId;
 assert.equal((await invoke(mail,'mail',optionsPath,undefined,buyerCookie)).status,401);
 const options=(await (await invoke(mail,'mail',optionsPath,undefined,operatorCookie)).json());
 assert.equal(options.suppliers.length,1);
 assert.equal(options.suppliers[0].contacts[0].mobile,'010-1111-1111');assert.equal(options.suppliers[0].active,false);
 const send={requestId,supplierId,contactId:'contact-1'};
 assert.equal((await invoke(mail,'mail','supplier-send',send,operatorCookie)).status,409);
 const reviewedSend={...send,reviewed:true};
 assert.equal((await invoke(mail,'mail','supplier-send',reviewedSend,operatorCookie)).status,409);
 db.prepare('INSERT INTO mm_gmail_connection VALUES (1,?,?,?)').run('sender@example.test',await seal(env,{access_token:'test-access',refresh_token:'test-refresh',expires:Date.now()+3600000}),new Date().toISOString());
 const originalFetch=globalThis.fetch;let sent=0;
 globalThis.fetch=async(url,options)=>{assert.match(String(url),/gmail\/v1\/users\/me\/messages\/send$/);assert.equal(options.headers.Authorization,'Bearer test-access');const raw=JSON.parse(options.body).raw,decoded=atob(raw.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-raw.length%4)%4));assert.match(decoded,/To: supplier@example.test/);assert.ok(!decoded.includes('buyer@example.test'));sent++;return Response.json({id:'gmail-123'});};
 try{
  const result=await invoke(mail,'mail','supplier-send',reviewedSend,operatorCookie);assert.equal(result.status,200);assert.equal((await result.json()).status,'sent');assert.equal(sent,1);
  assert.equal((await invoke(mail,'mail','supplier-send',reviewedSend,operatorCookie)).status,409);assert.equal(sent,1);
  const latest=(await (await invoke(mail,'mail',optionsPath,undefined,operatorCookie)).json());assert.equal(latest.delivery.status,'sent');assert.equal(latest.requestStage,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mm_supplier_mail').get().n,1);
 }finally{globalThis.fetch=originalFetch;db.close();}
});
