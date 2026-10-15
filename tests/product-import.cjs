const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
(async()=>{
 const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();const base='http://127.0.0.1:8799';
 await page.goto(base+'/?cloud=1#ops/products');await page.locator('[name=password]').fill('local-test-password-only');await page.locator('#cloud-login button').click();
 await page.locator('#product-import-files').waitFor({state:'attached'});
 const b64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=32;return c.toDataURL('image/webp').split(',')[1];});
 const hash=crypto.createHash('sha256').update(Buffer.from(b64,'base64')).digest('hex');
 const id='import-test-'+Date.now();
 const product={id,name:'Import test',model:'TEST',maker:'Test',categoryIds:['101010'],published:true,deleted:false,image:'asset:'+hash,gallery:['asset:'+hash],descriptionHtml:'<p>Import description</p><img src="asset:'+hash+'">'};
 const pack={format:'medicalmarket-products-v1',products:[product],images:{[hash]:b64}};
 const file={name:'test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pack))};
 await page.locator('#product-import-files').setInputFiles(file);
 await page.locator('.manage-feedback').filter({hasText:'저장 1개'}).waitFor();
 await page.locator('#product-import-files').setInputFiles(file);
 await page.locator('.manage-feedback').filter({hasText:'기존 1개'}).waitFor();
 const data=await (await page.request.get(base+'/api/cloud/products?admin=1')).json();const row=data.products.find(p=>p.id===id);assert(row);assert.match(row.descriptionHtml,/\/media\//);assert.equal(row.gallery[0],row.image);
 const image=await page.request.get(base+row.image);assert.equal(image.status(),200);
 const bad=await page.request.post(base+'/api/cloud/image',{headers:{Origin:base,'Content-Type':'image/webp','X-Image-SHA256':'bad'},data:Buffer.from(b64,'base64')});assert.equal(bad.status(),400);
 const again=await page.request.post(base+'/api/cloud/image',{headers:{Origin:base,'Content-Type':'image/webp','X-Image-SHA256':hash},data:Buffer.from(b64,'base64')});assert.equal((await again.json()).url,row.image);
 await page.request.post(base+'/api/cloud/products',{headers:{Origin:base},data:{...row,deleted:true,published:false}});
 console.log('PASS import package: images, description URL remapping, duplicate resume, hash validation, R2 idempotency');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
