const {chromium}=require('@playwright/test');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const server=http.createServer((req,res)=>{const p=path.join(process.cwd(),'dist',decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));try{res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(p));}catch{res.statusCode=404;res.end();}}).listen(8897);
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const products=[{id:'search-1',name:'자기장 치료기 MAG',model:'MAG-1',maker:'Test',categoryIds:['1010b0'],published:true,image:''}];
  await page.route('**/api/**',route=>{const u=new URL(route.request().url());let data={};if(u.pathname.endsWith('/products'))data=u.searchParams.has('page')?{products:u.searchParams.get('q')==='없는제품'?[]:products,total:1,pages:1,page:1}:{products,next:null};else if(u.pathname.endsWith('/session'))data={authenticated:false};return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
  await page.goto('http://127.0.0.1:8897/?cloud=1#home');
  const input=page.locator('#header-search input');await input.fill('자기장');
  await page.getByRole('option').filter({hasText:'자기장 치료기 MAG'}).waitFor();
  await input.press('ArrowDown');await input.press('Enter');
  await page.locator('#catalog-query').waitFor();assert(page.url().includes('#catalog/1010b0/1'));
  await input.fill('자기장');await page.getByRole('option').filter({hasText:'자기장 치료기 MAG'}).click();
  await page.waitForURL(/q=/);assert(new URL(page.url()).hash.includes(encodeURIComponent('자기장 치료기 MAG')));
  const catalog=page.locator('#catalog-query');await catalog.fill('자기장');
  await page.getByRole('option').filter({hasText:'자기장 치료기 MAG'}).waitFor();
  await catalog.press('Escape');assert.equal(await page.getByRole('listbox').count(),0);
  await catalog.fill('없는제품');await page.getByText('추천 항목이 없습니다. Enter로 검색해 보세요.').waitFor();
  await catalog.fill('');assert.equal(await page.getByRole('listbox').count(),0);
  await page.setViewportSize({width:390,height:844});await input.fill('자기장');await page.getByRole('option').filter({hasText:'자기장 치료기 MAG'}).waitFor();
  const box=await page.getByRole('listbox').boundingBox();assert(box.x>=0&&box.x+box.width<=390);
  await page.screenshot({path:'F:/Medical-Market/search-autocomplete-mobile.png'});assert.deepEqual(errors,[]);
  console.log('PASS recommendation navigation, keyboard, dismissal, empty states and mobile layout');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
