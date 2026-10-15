// Run against an isolated `wrangler pages dev` instance, never the production site.
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:8799';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?cloud=1#ops/products');await page.locator('#cloud-login').waitFor();
 await page.locator('[name=password]').fill('local-test-password-only');await page.locator('#cloud-login button').click();await page.locator('[data-manage-new]').waitFor();
 await page.goto(base+'/?cloud=1#ops/cloud');await page.locator('#cloud-check button').click();await page.getByText('파일 저장·읽기·점검 파일 삭제 완료',{exact:false}).first().waitFor();
 await page.goto(base+'/?cloud=1#ops/products');await page.locator('[data-manage-new]').click();
 const name='Cloud test '+Date.now();
 await page.locator('[name=name]').fill(name);await page.locator('[name=model]').fill('CLOUD-TEST');await page.locator('[name=maker]').fill('Test maker');await page.locator('[name=category0]').selectOption('10');
 await page.locator('#product-rich-editor').fill('Persistent cloud product description');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2000;c.height=1000;c.getContext('2d').fillRect(0,0,2000,1000);return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#gallery-files').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.locator('#editor-upload-status').filter({hasText:'불러왔습니다'}).waitFor();
 const image=await page.locator('.edit-photo img').getAttribute('src');assert.match(image,/^\/media\/.+\.webp$/);
 await page.locator('#manage-product-form button[type=submit]').click();await page.locator('#manage-product-form').waitFor({state:'detached'});
 await page.reload();const row=page.locator('tr').filter({hasText:name});await row.waitFor();const id=await row.locator('[data-product-edit]').getAttribute('data-product-edit');
 await row.locator('[data-product-edit]').click();assert.equal(await page.locator('#product-rich-editor').textContent(),'Persistent cloud product description');
 assert.equal(await page.locator('.edit-photo img').getAttribute('src'),image);
 const fresh=await browser.newContext();const customer=await fresh.newPage();await customer.goto(base+'/?cloud=1#catalog');await customer.getByRole('heading',{name,exact:true}).waitFor();
 const detailLink=await customer.locator('.equipment-card').filter({hasText:name}).locator('.equipment-view').getAttribute('href');
 await customer.goto(base+'/'+detailLink+'&cloud=1');await customer.locator('.legacy-description').filter({hasText:'Persistent cloud'}).waitFor();
 assert.equal(await customer.locator('#detail-photo').evaluate(el=>el.complete&&el.naturalWidth===1600),true);
 const anon=await fresh.request.post(base+'/api/cloud/products',{headers:{Origin:base},data:{}});assert.equal(anon.status(),401);
 const privateResponse=await fresh.request.get(base+'/media/../../private/secret.pdf');assert.notEqual(privateResponse.headers()['content-type'],'application/pdf');
 const all=(await (await context.request.get(base+'/api/cloud/products?admin=1')).json()).products;const stored=all.find(p=>p.id===id);assert(stored);
 const update=await context.request.post(base+'/api/cloud/products',{headers:{Origin:base},data:{...stored,descriptionHtml:'<script>alert(1)</script><p>safe</p><img src="javascript:bad">',published:false}});assert.equal(update.status(),200);const hidden=(await update.json()).product;assert.equal(hidden.descriptionHtml,'<p>safe</p>');
 const stale=await context.request.post(base+'/api/cloud/products',{headers:{Origin:base},data:stored});assert.equal(stale.status(),409);
 const visible=(await (await fresh.request.get(base+'/api/cloud/products')).json()).products;assert(!visible.some(p=>p.id===id));
 const restore=await context.request.post(base+'/api/cloud/products',{headers:{Origin:base},data:{...hidden,published:true,deleted:true}});assert.equal(restore.status(),200);
 assert.deepEqual(errors,[]);
 console.log('PASS real local D1/R2: login, storage checks, optimized photo, product save, reload, separate browser, hidden products, XSS cleaning, unauthorized writes, revision conflict');
 await fresh.close();await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
