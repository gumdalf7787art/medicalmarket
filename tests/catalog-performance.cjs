const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();let requests=0,delay=0;
  const rows=Array.from({length:847},(_,i)=>({id:'perf-'+i,name:'Performance product '+i,model:'P'+i,maker:'Sample maker',categoryIds:['1010b0'],published:true,deleted:false,image:'',gallery:[],descriptionHtml:'<p>Product description '+i+'</p>',revision:1}));
  await page.route('**/api/cloud/**',async route=>{
   const url=new URL(route.request().url());let data={};
   if(url.pathname.endsWith('/session'))data={authenticated:false,configured:true};
   else if(url.pathname.endsWith('/products')){requests++;assert.equal(url.searchParams.get('bulk'),'1');if(delay)await new Promise(r=>setTimeout(r,delay));data={products:rows,next:null};}
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:8799/?cloud=1#catalog');
  await page.getByRole('heading',{name:'제품 탐색 847개',exact:true}).waitFor();
  assert.equal(requests,1);
  let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  await page.getByRole('link',{name:'제품 살펴보기',exact:true}).first().click();
  await page.locator('.legacy-description').filter({hasText:'Product description'}).waitFor();
  assert.equal(requests,1);assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation').length),1);
  assert.match(page.url(),/#product\/managed-perf-/);
  delay=2000;await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.legacy-description').filter({hasText:'Product description'}).waitFor({timeout:1500});
  assert.equal(await page.getByText('제품 정보를 불러오는 중입니다.',{exact:true}).count(),0);
  // The delayed refresh remains active; cached content was visible first.
  console.log('PASS 847 products: one bulk request, detail reuse without reload, cached detail before delayed refresh');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
