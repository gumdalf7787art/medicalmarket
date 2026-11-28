import assert from 'node:assert/strict';
import {onRequest} from '../functions/content/shop/view.js';
for(const method of ['GET','HEAD']){
  const response=onRequest({request:new Request('https://medicalmarket.co.kr/content/shop/view?it_id=1681359513&utm_source=google',{method})});
  assert.equal(response.status,301);
  assert.equal(response.headers.get('Location'),'https://medicalmarket.co.kr/product?id=managed-legacy-1681359513');
}
for(const query of ['', '?it_id=', '?it_id=../../evil','?it_id=https://example.com','?it_id=123%26next=evil']){
  const response=onRequest({request:new Request('https://medicalmarket.co.kr/content/shop/view'+query)});
  assert.equal(response.status,404);
  assert.equal(response.headers.get('Location'),null);
}
console.log('Legacy product links: permanent redirects, HEAD and invalid IDs passed');
