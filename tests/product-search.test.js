import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {matchesProductSearch,productSearchSql,productSearchRank,productSearchOrderSql,highlightProductSearch} from '../server/product-search.js';
import categories from '../server/search-categories.js';
import {onRequestGet} from '../functions/api/cloud/products.js';

test('search category dictionary stays synchronized with navigation',()=>{
 const source=readFileSync(new URL('../category-data.js',import.meta.url),'utf8');
 assert.deepEqual(categories,JSON.parse(source.match(/const categoryData=(\[.*?\]);/s)[1]));
});
test('category, related terms, spacing, maker and multi-word queries agree in client and SQL',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mm_products(payload TEXT)');
 const products=[
  {name:'ALTMS',model:'ALT-MS',maker:'ACME',categoryIds:['1010b0']},
  {name:'자기장 치료기',model:'MAG-2',categoryIds:['1010b0']},
  {name:'Ultrasound Q40',model:'Q40',categoryIds:['20']},
  {name:'기능적 전기자극치료기',model:'F-3000',categoryIds:['101060']}
 ];
 products.forEach(p=>db.prepare('INSERT INTO mm_products VALUES (?)').run(JSON.stringify(p)));
 for(const [query,expected] of [['자기장',[0,1]],['자기장치료',[0,1]],['자기장 치료',[0,1]],['magnetic',[0,1]],['자기장 ALTMS',[0]],['alt ms',[0]],['ACME',[0]],['초음파',[2]],['FES',[3]],['없는제품',[]],['%_',[ ]],['',[0,1,2,3]]]){
  const plan=productSearchSql(query);
  const sql=db.prepare('SELECT rowid FROM mm_products WHERE '+plan.sql).all(...plan.args).map(r=>r.rowid-1);
  assert.deepEqual(sql,expected,query);
  assert.deepEqual(products.flatMap((p,i)=>matchesProductSearch(p,query)?[i]:[]),expected,query);
 }
 db.close();
});
test('public endpoint applies flexible search before pagination and excludes hidden products',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mm_products(id TEXT,payload TEXT,published INTEGER,deleted INTEGER)');
 for(let i=0;i<34;i++)db.prepare('INSERT INTO mm_products VALUES (?,?,?,?)').run(String(i).padStart(2,'0'),JSON.stringify({id:String(i),name:'Device '+i,model:'M'+i,categoryIds:['1010b0'],image:''}),i===32?0:1,i===33?1:0);
 const env={DB:{prepare(sql){return {bind(...args){return {first:async()=>db.prepare(sql).get(...args),all:async()=>({results:db.prepare(sql).all(...args)})};}}}}};
 for(const [page,length] of [[1,15],[2,15],[3,2]]){
  const response=await onRequestGet({request:new Request('https://example.com/api/cloud/products?page='+page+'&q='+encodeURIComponent('자기장치료')),env});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.total,32);assert.equal(data.pages,3);assert.equal(data.products.length,length);
 }
 const response=await onRequestGet({request:new Request('https://example.com/api/cloud/products?page=1&category=20&q='+encodeURIComponent('자기장')),env});
 assert.equal((await response.json()).total,0);db.close();
});
test('direct matches rank above related products across pages, even without a photo',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mm_products(id TEXT,payload TEXT,published INTEGER,deleted INTEGER)');
 const rows=Array.from({length:20},(_,i)=>({id:String(i).padStart(2,'0'),name:'Related '+i,model:'R'+i,categoryIds:['1010b0'],image:'photo.webp'}));
 rows.push({id:'90',name:'자기장 치료기',model:'X',categoryIds:['1010b0'],image:''},{id:'91',name:'자기장치료',model:'Y',categoryIds:['1010b0'],image:''});
 for(const p of rows)db.prepare('INSERT INTO mm_products VALUES (?,?,1,0)').run(p.id,JSON.stringify(p));
 const env={DB:{prepare(sql){return {bind(...args){return {first:async()=>db.prepare(sql).get(...args),all:async()=>({results:db.prepare(sql).all(...args)})};}}}}};
 const data=await (await onRequestGet({request:new Request('https://example.com/api/cloud/products?page=1&q='+encodeURIComponent('자기장치료')),env})).json();
 assert.deepEqual(data.products.slice(0,2).map(p=>p.id),['91','90']);assert.equal(data.total,22);assert.equal(data.products.length,15);
 for(const query of ['자기장치료','자기장 X','R-1','']){
  const order=productSearchOrderSql(query);
  const scores=db.prepare('SELECT id,'+order.sql+' AS score FROM mm_products').all(...order.args);
  for(const row of scores)assert.equal(row.score,productSearchRank(rows.find(p=>p.id===row.id),query));
 }db.close();
});
test('highlighting preserves text, handles spacing and model separators, and escapes HTML',()=>{
 assert.equal(highlightProductSearch('자기장 치료기','자기장치료'),'<mark class="search-highlight">자기장 치료</mark>기');
 assert.equal(highlightProductSearch('ALT-MS','altms'),'<mark class="search-highlight">ALT-MS</mark>');
 assert.equal(highlightProductSearch('<img onerror="x">','img'),'&lt;<mark class="search-highlight">img</mark> onerror=&quot;x&quot;&gt;');
 assert.equal(highlightProductSearch('ALTMS','자기장'),'ALTMS');
 assert.equal(highlightProductSearch('A&B',''),'A&amp;B');
});
