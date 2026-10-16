import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest as auth} from '../functions/api/auth/[[path]].js';
import {onRequest as member} from '../functions/api/member/[[path]].js';
import {seal} from '../server/gmail.js';
import {extractSupplierPrice,quoteFromSources,renderCustomerQuoteEmail} from '../server/customer-quote.js';

test('supplier price extraction requires evidence and preserves VAT uncertainty',()=>{
 assert.deepEqual(extractSupplierPrice('담당자 010-1234-5678 / 사업자번호 736-81-01238').price,null);
 assert.equal(extractSupplierPrice('공급 단가 7,000만원 (부가세 별도)').price,70000000);
 assert.equal(extractSupplierPrice('공급 단가 7,000만원 (부가세 별도)').vat,'exclusive');
 const draft=quoteFromSources({product:{name:'초음파',model:'Q40'},qty:2},[{subject:'회신',body:'부가세 별도입니다.'}],[{name:'견적.xlsx',text:'품명 | 단가 | 70,000,000원'}]);
 assert.equal(draft.supplierUnit,70000000);assert.equal(draft.supplierVatUnit,77000000);assert.equal(draft.customerUnit,115500000);assert.equal(draft.amount,231000000);
 assert.equal(quoteFromSources({product:{name:'초음파',model:'Q40'},qty:1},[{body:'가격 1,000,000원'}]).vatStatus,'unknown');
 assert.match(renderCustomerQuoteEmail({profile:{hospital:'테스트 의원'}},{itemName:'초음파',model:'Q40',qty:1,total:1000000},'확인 부탁드립니다.'),/견적서 PDF를 첨부/);
});

test('quote preview data is private; final send registers PDF and sends one mocked Gmail message',async()=>{
 const db=new DatabaseSync(':memory:');
 const DB={prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return db.prepare(sql).get(...values)||null;},async run(){return db.prepare(sql).run(...values);},async all(){return {results:db.prepare(sql).all(...values)};}};},async batch(items){db.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}}};
 const objects=new Map();const env={DB,GMAIL_CLIENT_SECRET:'test-secret',PRIVATE_FILES:{async put(key,value){objects.set(key,new Uint8Array(value));},async get(key){const bytes=objects.get(key);return bytes?{body:bytes}:null;},async delete(key){objects.delete(key);}}};
 let seq=0;const invoke=(handler,kind,path,data,cookie='')=>handler({env,params:{path:path.split('?')[0].split('/')},request:new Request('https://example.test/api/'+kind+'/'+path,{method:data===undefined?'GET':'POST',headers:{Origin:'https://example.test',Cookie:cookie,'CF-Connecting-IP':String(++seq)},...(data===undefined?{}:{body:JSON.stringify(data)})})});
 const buyer=await invoke(auth,'auth','signup',{email:'buyer@example.test',name:'고객',password:'Only-for-test-123!',consent:true});const bc=buyer.headers.get('set-cookie').split(';')[0];
 const operator=await invoke(auth,'auth','signup',{email:'operator@example.test',name:'운영자',password:'Only-for-test-123!',consent:true});const oc=operator.headers.get('set-cookie').split(';')[0],opId=(await operator.json()).user.id;
 db.prepare("UPDATE mm_users SET role='admin' WHERE id=?").run(opId);
 db.exec('CREATE TABLE mm_products(id TEXT PRIMARY KEY,payload TEXT,published INTEGER,deleted INTEGER)');db.prepare('INSERT INTO mm_products VALUES (?,?,1,0)').run('p1',JSON.stringify({name:'초음파',model:'Q40',maker:'공급사'}));
 const contact={hospital:'테스트 의원',email:'buyer@example.test',phone:'010-0000-0000',province:'서울특별시',district:'송파구'};
 const created=await invoke(member,'member','requests',{productId:'p1',qty:2,profile:contact,consent:true},bc),id=(await created.json()).id;
 await invoke(member,'member','admin/'+id,{action:'stage',stage:2},oc);
 db.prepare('INSERT INTO mm_supplier_replies VALUES (?,?,?,?,?,?,?,?,?)').run('reply1',id,'thread1','supplier@example.test','단가 회신','공급 단가 100,000원, 부가세 별도',new Date().toISOString(),'[]',new Date().toISOString());
 const draft=await invoke(member,'member','admin/'+id,{action:'draft'},oc);assert.equal(draft.status,200);const suggestion=await draft.json();assert.equal(suggestion.customerUnit,165000);
 const pdf=btoa('%PDF-1.4\n'+'x'.repeat(200));
 assert.equal((await invoke(member,'member','admin/'+id,{action:'publish-send',itemName:'초음파',model:'Q40',qty:2,unit:165000,pdf,reviewed:false},oc)).status,400);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mm_customer_quotes').get().n,0);
 db.exec('CREATE TABLE mm_gmail_connection(id INTEGER PRIMARY KEY,email TEXT,tokens TEXT,updated_at TEXT)');
 db.prepare('INSERT INTO mm_gmail_connection VALUES (1,?,?,?)').run('sender@example.test',await seal(env,{access_token:'mock-access',refresh_token:'mock-refresh',expires:Date.now()+3600000}),new Date().toISOString());
 const original=globalThis.fetch;let sends=0,raw='';globalThis.fetch=async (url,options)=>{assert.match(String(url),/gmail.googleapis.com\/gmail\/v1\/users\/me\/messages\/send/);sends++;raw=options.body;return new Response(JSON.stringify({id:'gmail-sent-1'}),{status:200,headers:{'Content-Type':'application/json'}});};
 try{
  const sent=await invoke(member,'member','admin/'+id,{action:'publish-send',itemName:'초음파',model:'Q40',qty:2,unit:165000,supplierUnit:100000,supplierVatStatus:'exclusive',terms:'견적추가 사항',emailSubject:'견적 안내',emailMessage:'확인 부탁드립니다.',pdf,reviewed:true},oc);assert.equal(sent.status,200,await sent.text());
  assert.equal(sends,1);const mime=atob(JSON.parse(raw).raw.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-JSON.parse(raw).raw.length%4)%4));assert.match(mime,/Content-Type: application\/pdf/);assert.match(mime,/buyer@example.test/);
  const detail=await invoke(member,'member','requests/'+id,undefined,bc);const result=await detail.json();assert.equal(result.quote.total,330000);assert.equal(result.quote.unitIncludesVat,true);assert.equal(result.request.stage,3);
  const download=await invoke(member,'member','pdf/'+id,undefined,bc);assert.equal(download.status,200);
  const again=await invoke(member,'member','admin/'+id,{action:'publish-send'},oc);assert.equal(again.status,200);assert.equal(sends,1);
 }finally{globalThis.fetch=original;db.close();}
});
