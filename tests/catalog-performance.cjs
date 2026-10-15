const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  const rows=Array.from({length:847},(_,i)=>({id:'perf-'+i,name:'Performance product '+i,model:'P'+i,maker:'Sample maker',categoryIds:['1010b0'],published:true,deleted:false,image:'',gallery:[],descriptionHtml:'<p>Product description '+i+'</p>',updatedAt:'2026-10-15',revision:1}));
  const summary=p=>{const {descriptionHtml,gallery,...rest}=p;return {...rest,_summary:true};};
  await page.route('**/api/cloud/**',async route=>{
   await new Promise(resolve=>setTimeout(resolve,400));
   const url=new URL(route.request().url());let data={};requests.push(url.search);
   if(url.pathname.endsWith('/session'))data={authenticated:false,configured:true};
   else if(url.pathname.endsWith('/products')){
    if(url.searchParams.has('id'))data={product:rows.find(p=>p.id===url.searchParams.get('id'))};
    else if(url.searchParams.has('page')){const list=rows.filter(p=>p.name.includes(url.searchParams.get('q')||'')),n=Math.min(Number(url.searchParams.get('page')),Math.max(1,Math.ceil(list.length/15)));data={products:list.slice((n-1)*15,n*15).map(summary),total:list.length,page:n,pages:Math.max(1,Math.ceil(list.length/15))};}
    else data={products:rows.map(summary),next:null};
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:8799/?cloud=1#home');
  await page.locator('.market-slide-image').waitFor();
  assert.equal(await page.getByText('제품 정보를 불러오는 중입니다.',{exact:true}).count(),0);
  assert.match(await page.locator('.market-slide-image').getAttribute('src'),/^\/media\//);
  await page.waitForTimeout(1500);
  await page.goto('http://127.0.0.1:8799/?cloud=1#catalog');
  await page.locator('.catalog-pagination').waitFor();assert.equal(await page.locator('.equipment-card').count(),15);
  await page.getByRole('link',{name:'2',exact:true}).click();await page.getByRole('heading',{name:'Performance product 15',exact:true}).waitFor();
  assert.equal(await page.locator('.equipment-card').count(),15);
  await page.getByRole('link',{name:'제품 살펴보기',exact:true}).nth(12).scrollIntoViewIfNeeded();
  const priorScroll=await page.evaluate(()=>scrollY);assert(priorScroll>200);
  await page.getByRole('link',{name:'제품 살펴보기',exact:true}).nth(12).click();await page.locator('.legacy-description').filter({hasText:'Product description 27'}).waitFor();
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>scrollY),0);
  await page.goBack();await page.getByRole('link',{name:'2',exact:true}).filter({has:page.locator(':scope[aria-current=page]')}).count();
  await page.getByRole('heading',{name:'Performance product 15',exact:true}).waitFor();
  await page.waitForTimeout(100);assert(Math.abs(await page.evaluate(()=>scrollY)-priorScroll)<5);
  await page.getByRole('textbox',{name:'제품 검색'}).fill('product 846');await page.getByRole('button',{name:'검색',exact:true}).click();
  await page.getByRole('heading',{name:'Performance product 846',exact:true}).waitFor();assert.equal(await page.locator('.equipment-card').count(),1);
  assert(requests.some(q=>q.includes('summary=1')));assert(requests.some(q=>q.includes('page=2')));assert(requests.some(q=>q.includes('id=perf-27')));
  assert.deepEqual(errors,[]);console.log('PASS 847 products: 15 per page, page 2, one detail, back to page 2, search resets page');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
