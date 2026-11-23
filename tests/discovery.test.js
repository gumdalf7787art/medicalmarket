import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/discovery.js';
import {discoverySchema, stage, classify} from '../server/discovery.js';
import {modelFromLink, sources} from '../server/discovery-sources.js';
import {mac} from '../server/cloud.js';

test('official link extraction and grouped legacy model numbers',()=>{
  assert.equal(modelFromLink('inbody',new URL(sources.inbody.url+'/6'),'InBody970S 최고사양 장비'),'InBody970S');
  assert.equal(modelFromLink('bistos0340',new URL(sources.bistos0340.url),'More Info BT-350'),'BT-350');
  assert.equal(modelFromLink('alpinion',new URL('product_view_xc60.do',sources.alpinion.url),'X-CUBE 60'),'X-CUBE 60');
  const products=[{id:'a',maker:'㈜비스토스',model:'BT-740/770/780(8.4")'}];
  assert.equal(classify({maker:'Bistos',model:'BT-770'},products,new Set()).kind,'compare');
  assert.equal(classify({maker:'다른 제조사',model:'BT-770'},products,new Set()).kind,'draft');
});

test('private pilot, repeat imports and explicit approval of publication or supplier link',async()=>{
  const db=new DatabaseSync(':memory:');
  const DB={
    prepare(sql){let args=[];return {
      bind(...values){args=values;return this;},first(){return db.prepare(sql).get(...args);},
      run(){return {meta:db.prepare(sql).run(...args)};}, all(){return {results:db.prepare(sql).all(...args)};},
      execute(){return sql.startsWith('SELECT')?this.all():this.run();}
    };},
    batch(statements){db.exec('BEGIN');try{const results=statements.map(s=>s.execute());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}
  };
  const env={DB,ADMIN_PASSWORD:'only-for-local-test'};
  const token=(Date.now()+3600000)+'.test';
  const cookie='mm_admin='+token+'.'+await mac(token,env);
  const call=(data,auth=cookie,origin='https://example.test')=>onRequest({env,request:new Request('https://example.test/api/discovery',{method:data?'POST':'GET',headers:{Origin:origin,Cookie:auth},body:data?JSON.stringify(data):undefined})});
  assert.equal((await call(null,'')).status,401);
  assert.equal((await call({action:'pilot'},cookie,'https://other.test')).status,403);
  await discoverySchema(env);
  for(const key of Object.keys(sources)){
    db.prepare("INSERT INTO mm_suppliers(id,company,email,created_at,updated_at) VALUES(?,?,'','','')").run(key,sources[key].maker);
    db.prepare('INSERT INTO mm_supplier_details(supplier_id,source_key) VALUES(?,?)').run(key,'legacy:'+key);
    for(let n=0;n<2;n++)assert.equal((await call({action:'pilot',key})).status,200);
  }
  const rows=(await (await call()).json()).rows;
  assert.equal(rows.length,30);
  assert.ok(rows.every(row=>row.recommendedCategory));
  const inbody=rows.find(row=>row.model==='InBody970S');
  assert.equal(inbody.recommendedCategory,'20f010');
  const change={action:'category',supplier:inbody.supplier_id,identity:inbody.identity,category:'c02010'};
  assert.equal((await call(change)).status,200);
  assert.equal((await call({action:'pilot',key:'inbody'})).status,200);
  assert.equal((await (await call()).json()).rows.find(row=>row.identity===inbody.identity).category,'c02010');
  assert.equal(db.prepare('SELECT count(*) n FROM mm_products').get().n,0);
  const first=rows.find(r=>r.model==='BT-350');
  const approve={supplier:first.supplier_id,identity:first.identity,action:'publish',name:'태아감시장치 BT-350',category:'201050'};
  assert.equal((await call(approve)).status,200);
  assert.equal((await call(approve)).status,409);
  const product=db.prepare('SELECT * FROM mm_products').get();
  assert.equal(product.published,1);
  assert.match(JSON.parse(product.payload).image,/^https:\/\/www\.bistos\.co\.kr\//);
  assert.deepEqual(JSON.parse(product.payload).gallery,[JSON.parse(product.payload).image]);
  db.prepare('DELETE FROM mm_supplier_products').run();
  db.prepare("UPDATE mm_discovery SET decision='' WHERE identity=?").run(first.identity);
  assert.equal((await call(approve)).status,409);
  assert.equal((await call({...approve,action:'link',product:product.id})).status,200);
  assert.equal(db.prepare('SELECT count(*) n FROM mm_supplier_products').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM mm_products').get().n,1);
  const path='/media/'+crypto.randomUUID()+'.webp';
  env.MEDIA={head:async key=>key==='product-images/'+path.slice(7)?{}:null};
  const draft={action:'prepare',supplier:inbody.supplier_id,identity:inbody.identity,gallery:[path],paragraphs:['A < B']};
  assert.equal((await call({...draft,gallery:['https://example.test/image']})).status,400);
  const {version}=await (await call(draft)).json();
  assert.ok(version);
  const publish={...draft,action:'publish',name:inbody.model,category:'20f010',version};
  assert.equal((await call({...publish,version:'stale'})).status,409);
  assert.equal(db.prepare('SELECT count(*) n FROM mm_products').get().n,1);
  const published=await (await call(publish)).json();
  const saved=JSON.parse(db.prepare('SELECT payload FROM mm_products WHERE id=?').get(published.product).payload);
  assert.equal(saved.image,path);
  assert.deepEqual(saved.gallery,[path]);
  assert.equal(saved.descriptionHtml,'<p>A &lt; B</p>');
});
