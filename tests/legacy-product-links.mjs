import assert from 'node:assert/strict';
import {legacyProductAliases} from '../server/legacy-product-links.js';
const routes=['content/shop/view','content/shop/view.php','m/content/shop/view','m/content/shop/view.php','shop/item','shop/item.php','theme/default/_subpage/shop/view.php','theme/default/mobile/_subpage/shop/view.php'];
const known=new Set(['legacy-1681359513',...Object.values(legacyProductAliases)]);
const env={DB:{prepare(sql){assert.match(sql,/published=1 AND deleted=0/);return {bind(id){return {async first(){return known.has(id)?{id}:null;}};}};}}};
for(const path of routes){
 const {onRequest}=await import('../functions/'+path+'.js');
 for(const [id,target] of Object.entries({'1681359513':'legacy-1681359513',...legacyProductAliases})){
  for(const method of ['GET','HEAD']){
   const r=await onRequest({env,request:new Request('https://www.medicalmarket.co.kr/'+path+'?it_id='+id+'&ca_id=10',{method})});
   assert.equal(r.status,301,path);assert.equal(r.headers.get('Location'),'https://medicalmarket.co.kr/product?id=managed-'+target);
  }
 }
 for(const id of ['', '../../evil','https://example.com','9999999999','1698901490','1699248741']){
  const r=await onRequest({env,request:new Request('https://medicalmarket.co.kr/'+path+'?it_id='+encodeURIComponent(id))});
  assert.equal(r.status,404);assert.equal(r.headers.get('Location'),null);assert.match(await r.text(),/등록된 제품 둘러보기/);
 }
 const down=await onRequest({env:{},request:new Request('https://medicalmarket.co.kr/'+path+'?it_id=1681359513')});
 assert.equal(down.status,503);
}
console.log('8 legacy route formats, 7 reviewed aliases, missing products, invalid IDs and DB failures passed');
