import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initialize} from '../server/guides.js';
import {onRequestGet} from '../functions/guide/[[slug]].js';
const sqlite=new DatabaseSync(':memory:');
const DB={prepare(sql){let args=[];return {bind(...v){args=v;return this;},first(){return sqlite.prepare(sql).get(...args);},all(){return {results:sqlite.prepare(sql).all(...args)};},run(){return {meta:sqlite.prepare(sql).run(...args)};}};}};
await initialize(DB);
sqlite.exec('CREATE TABLE mm_products(id TEXT PRIMARY KEY,payload TEXT,published INTEGER,deleted INTEGER)');
for(let i=0;i<45;i++){
 const id=String(i).padStart(2,'0');
 sqlite.prepare('INSERT INTO mm_products VALUES(?,?,1,0)').run(id,JSON.stringify({name:'장비',model:i<25?'Model A&B':'Other',gallery:[]}));
 sqlite.prepare('INSERT INTO mm_guides VALUES(?,?,?,?,?,?,1,1,?,?,?)').run('guide-'+id,id,'제품 '+id,'요약','본문','[]','2026-01-01','2026-01-01','2026-01-01');
}
const view=async(query='')=>(await onRequestGet({env:{DB},params:{slug:[]},request:new Request('https://medicalmarket.co.kr/guide'+query)})).text();
const first=await view();
assert.equal((first.match(/class="card"/g)||[]).length,20);
assert.match(first,/aria-current="page" aria-label="1페이지"/);
assert.match(first,/aria-label="3페이지"/);
const second=await view('?page=2');
assert.match(second,/aria-current="page" aria-label="2페이지"/);
assert.match(second,/rel="prev"/);assert.match(second,/rel="next"/);
assert.equal((await view('?page=3')).match(/class="card"/g).length,5);
assert.match(await view('?page=999'),/aria-current="page" aria-label="3페이지"/);
const search=await view('?q=Model+A%26B&page=2');
assert.equal(search.match(/class="card"/g).length,5);
assert.match(search,/q=Model\+A%26B&amp;page=1/);
assert.doesNotMatch(search,/aria-label="3페이지"/);
const empty=await view('?q=absent');assert.match(empty,/검색 결과가 없습니다/);assert.doesNotMatch(empty,/<nav class="guide-pages"/);
sqlite.prepare('UPDATE mm_guides SET published=0 WHERE product_id IN (SELECT id FROM mm_products WHERE id>=?)').run('20');
assert.doesNotMatch(await view(),/aria-label="2페이지"/);
sqlite.exec('UPDATE mm_products SET deleted=1');
assert.doesNotMatch(await view(),/<nav class="guide-pages"/);
console.log('Guide pagination: 45 posts, page bounds, encoded search, unpublished and deleted visibility passed');

