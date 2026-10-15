const {chromium}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const dist=path.resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{const f=path.resolve(dist,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));if(!f.startsWith(dist+path.sep)){res.writeHead(403).end();return;}fs.readFile(f,(err,b)=>{res.writeHead(err?404:200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});res.end(err?'':b);});});
let browser;
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/?cloud=1';browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const product={id:'qa',name:'샘플 초음파 진단장비',model:'QA-100',maker:'샘플 제조사',image:'assets/sample-device.svg',published:true,gallery:[]};
let favorites=['qa'],profile={hospital:'샘플 의원',email:'qa@example.test',phone:'010-0000-0000',province:'서울특별시',district:'강남구'};
const request={id:'REQ-qa',product,profile,qty:1,memo:'시연 요청입니다.',stage:3,hasQuote:true,unread:true,createdAt:'2026-10-16T01:00:00Z'};
await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),p=u.pathname;let data={};
if(p==='/api/auth/session')data={user:{id:'qa-user',name:'샘플 회원',email:'qa@example.test',role:'user'},providers:{}};
if(p==='/api/cloud/session')data={authenticated:false,configured:true};
if(p==='/api/cloud/products')data={products:[product],next:null,total:1};
if(p==='/api/member/summary')data={profile,favorites,counts:{total:1,active:0,quotes:1,unread:1}};
if(p==='/api/member/requests'&&req.method()==='POST')assert.equal(req.postDataJSON().productId,'qa');
if(p==='/api/member/requests')data=req.method()==='POST'?{id:'REQ-qa'}:{requests:[request],page:1,total:1};
if(p==='/api/member/requests/REQ-qa')data={request,quote:{unit:1000000,shipping:0,installation:0,net:1000000,tax:100000,total:1100000,terms:'설치 일정 협의',issuedAt:'2026-10-16'},events:[{title:'견적 요청 접수',at:'2026-10-16'}]};
if(p==='/api/member/favorite'){favorites=[];data={ok:true};}
if(p==='/api/member/profile'){profile=req.postDataJSON();data={profile};}
if(p==='/api/member/pdf/REQ-qa')return route.fulfill({body:'%PDF-1.4\n',headers:{'content-type':'application/pdf','content-disposition':'attachment; filename="quote.pdf"'}});
return route.fulfill({json:data});});
await page.goto(base+'#account');await page.locator('.member-stats').waitFor();assert.equal(await page.locator('.member-navigation nav a').count(),6);await page.getByRole('heading',{name:'샘플 초음파 진단장비'}).waitFor();
fs.mkdirSync('../react-qa',{recursive:true});await page.screenshot({path:'../react-qa/member-desktop.png',fullPage:true});
await page.locator('.member-navigation a[href="#account/quotes"]').click();await page.locator('.member-request a').click();await page.getByText('1,100,000원',{exact:true}).waitFor();const downloading=page.waitForEvent('download');await page.getByText('견적서 PDF 다운로드 ↓',{exact:true}).click();assert.equal((await downloading).suggestedFilename(),'quote.pdf');
await page.locator('.member-navigation a[href="#account/favorites"]').click();await page.locator('.member-favorites article').waitFor();await page.locator('[data-favorite]').click();await page.getByText('아직 관심제품이 없습니다.',{exact:true}).waitFor();
await page.locator('.member-navigation a[href="#account/profile"]').click();await page.locator('#member-profile').waitFor();await page.locator('[name="hospital"]').fill('수정된 샘플 의원');await page.getByRole('button',{name:'정보 저장'}).click();await page.getByText('병원·연락처 정보를 저장했습니다.',{exact:true}).waitFor();assert.equal(profile.hospital,'수정된 샘플 의원');
await page.goto(base+'#product/managed-qa');await page.locator('[data-quote-product]').click();await page.locator('#member-request').waitFor();await page.locator('#member-request [name=consent]').check();await page.getByRole('button',{name:'견적 요청하기 →'}).click();await page.waitForURL(/#account\/detail/);await page.locator('.member-timeline').waitFor();
await page.setViewportSize({width:390,height:844});await page.locator('.member-navigation a[href="#account/requests"]').click();await page.locator('.member-request').waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'../react-qa/member-mobile.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS member desktop/mobile, sidebar, requests, quote/PDF, favorites, profile; mock API');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
