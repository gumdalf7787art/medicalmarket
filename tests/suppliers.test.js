import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest as auth} from '../functions/api/auth/[[path]].js';
import {onRequest as suppliers} from '../functions/api/suppliers/[[path]].js';

const db=new DatabaseSync(':memory:');
const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);},async all(){return {results:db.prepare(sql).all(...args)};}};},async batch(statements){db.exec('BEGIN');try{const out=[];for(const item of statements)out.push(await item.run());db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}}};
const env={DB};
let sequence=0;
const call=(handler,path,data,cookie='',origin='https://example.test')=>handler({env,params:{path:path.split('?')[0].split('/').filter(Boolean)},request:new Request('https://example.test/api/'+(handler===auth?'auth/':'suppliers/')+path,{method:data?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'CF-Connecting-IP':String(++sequence)},...(data?{body:JSON.stringify(data)}:{})})});
const cookie=response=>response.headers.get('set-cookie').split(';')[0];

test('supplier contacts and product links are private D1 records',async()=>{
  const member=await call(auth,'signup',{email:'member@example.test',name:'회원',password:'Only-for-test-123!',consent:true});
  const operator=await call(auth,'signup',{email:'operator@example.test',name:'운영자',password:'Only-for-test-123!',consent:true});
  const memberCookie=cookie(member),operatorCookie=cookie(operator),operatorId=(await operator.json()).user.id;
  db.prepare("UPDATE mm_users SET role='admin' WHERE id=?").run(operatorId);
  assert.equal((await call(suppliers,'')).status,401);
  assert.equal((await call(suppliers,'',null,memberCookie)).status,401);
  const draft={company:'테스트 업체',contactName:'담당자',email:'supplier@example.test',phone:'02-0000-0000',notes:'테스트 전용',active:true,productIds:['product-1']};
  assert.equal((await call(suppliers,'',draft,memberCookie)).status,401);
  assert.equal((await call(suppliers,'',draft,operatorCookie,'https://evil.test')).status,403);
  assert.equal((await call(suppliers,'',draft,operatorCookie)).status,409);
  db.prepare('INSERT INTO mm_products VALUES (?,?,1,0,1,?)').run('product-1',JSON.stringify({name:'시험 장비'}),new Date().toISOString());
  const created=await call(suppliers,'',draft,operatorCookie);assert.equal(created.status,201);
  const record=(await created.json()).supplier;assert.equal(record.email,draft.email);assert.deepEqual(record.productIds,['product-1']);
  assert.equal((await call(suppliers,record.id,null,memberCookie)).status,401);
  let listed=await (await call(suppliers,'?q=테스트',null,operatorCookie)).json();
  assert.equal(listed.total,1);assert.equal(listed.suppliers[0].id,record.id);
  const updated=await call(suppliers,record.id,{...draft,contactName:'새 담당자',active:false,productIds:[]},operatorCookie);
  assert.equal(updated.status,200);assert.equal((await updated.json()).supplier.active,false);
  listed=await (await call(suppliers,record.id,null,operatorCookie)).json();
  assert.equal(listed.supplier.contactName,'새 담당자');assert.deepEqual(listed.supplier.productIds,[]);
  assert.equal((await call(suppliers,record.id,{...draft,email:'bad'},operatorCookie)).status,400);
  assert.equal((await call(suppliers,record.id,{...draft,productIds:['missing']},operatorCookie)).status,409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mm_suppliers').get().n,1);
});
