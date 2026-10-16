const {chromium}=require('@playwright/test');
const {createServer}=require('node:http');
const {readFile}=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const dist=path.resolve('dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html');
 const file=path.resolve(dist,'.'+name);
 if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
 try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(await readFile(file));}
 catch{res.writeHead(404).end();}
});
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch();
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 let stage=0;
 let supplier=null;
 let supplierHasEmail=true;
 const record=()=>({id:'REQ-real-1',product:{id:'managed-qa',name:'실제 장비',model:'QA-100',maker:'제조사',image:'assets/sample-device.svg'},qty:1,profile:{hospital:'실제 병원',email:'qa@example.test',phone:'010-0000-0000',province:'서울특별시',district:'강남구'},stage,cancelled:false,hasQuote:false,createdAt:'2026-10-16T01:00:00Z',memo:'검증',unread:false});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  let data={};
  if(p==='/api/auth/session')data={user:{id:'admin-1',name:'운영자',role:'admin'},providers:{}};
  else if(p==='/api/cloud/session')data={authenticated:true,configured:true};
  else if(p==='/api/cloud/status')data={};
  else if(p==='/api/cloud/attachments')data={attachments:{}};
  else if(p==='/api/cloud/products')data={products:[{id:'managed-qa',name:'실제 장비',model:'QA-100',maker:'제조사',image:'assets/sample-device.svg',published:true,gallery:[]}],next:null,total:1};
  else if(p==='/api/suppliers'&&req.method()==='POST'){
   const body=req.postDataJSON();
   if(body.productIds.some(id=>id!=='managed-qa'))return route.fulfill({status:400,json:{error:'존재하지 않는 제품이 포함되어 있습니다.'}});
   supplier={...body,id:'supplier-1'};data={supplier};
  }
  else if(p==='/api/suppliers')data={suppliers:supplier?[supplier]:[],total:supplier?1:0,page:1};
  else if(p==='/api/suppliers/linked-supplier')data={supplier:{id:'linked-supplier',company:'시험 제조사',companyPhone:'02-0000-0000',companyEmail:'',email:'supplier@example.test',phone:'02-0000-0000',contacts:[{id:'staff-1',name:'견적 담당자',email:'staff@example.test',phone:'02-1111-1111',mobile:'010-1111-1111'}],classification:'candidate',reviewStatus:'needs_review',active:false,productIds:['managed-qa'],notes:''}};
  else if(p==='/api/mail/supplier-options')data={suppliers:[{id:'linked-supplier',company:'시험 제조사',email:supplierHasEmail?'supplier@example.test':'',phone:'02-0000-0000',companyEmail:'',active:false,classification:'candidate',reviewStatus:'needs_review',contacts:[{id:'staff-1',name:'견적 담당자',email:supplierHasEmail?'staff@example.test':'',phone:'02-1111-1111',mobile:'010-1111-1111'}]}],delivery:null,gmailEmail:'sender@example.test',product:record().product,qty:1,requestStage:stage,cancelled:false};
  else if(p==='/api/member/admin/overview')data={counts:{total:1,cancelled:0,received:stage===0?1:0,supplier:stage===1?1:0,preparing:0,published:0},recent:[record()],pending:[record()]};
  else if(p==='/api/member/admin/REQ-real-1'&&req.method()==='POST'){stage=req.postDataJSON().stage;data={ok:true};}
  else if(p==='/api/member/admin/REQ-real-1')data={request:record(),quote:null,events:[{title:'견적 요청 접수',at:'2026-10-16T01:00:00Z'}],adminEvents:stage?[{operatorName:'운영자',action:'진행 상태: 공급업체 확인 중',at:'2026-10-16T02:00:00Z'}]:[]};
  else if(p==='/api/member/admin'){
   const filter=url.searchParams.get('stage');
   const search=url.searchParams.get('q')||'';
   const matches=(!filter||filter===String(stage))&&(!search||'실제 병원 실제 장비 REQ-real-1'.includes(search));
   data={requests:matches?[record()]:[],total:matches?1:0,page:1};
  }
  else if(p==='/api/member/summary')data={profile:null,favorites:[],counts:{total:0,active:0,unread:0}};
  return route.fulfill({json:data});
 });
 const base='http://127.0.0.1:'+server.address().port+'/?cloud=1';
 await page.goto(base+'#ops');
 await page.getByRole('heading',{name:'견적 진행 현황'}).waitFor();
 await page.getByText('실제 병원').first().waitFor();
 assert.equal(await page.getByText('로컬 시안 데이터').count(),0);
 assert.equal(await page.locator('.admin-menu-group a[href="#ops/customerRequests"]').count(),0);
 await page.locator('.admin-menu-group a[href="#ops/requests"]').click();
 await page.getByRole('heading',{name:'검색 결과'}).waitFor();
 await page.getByRole('link',{name:'REQ-real-1'}).first().click();
 await page.locator('form[data-member-stage]').waitFor();
 await page.getByRole('button',{name:'제품 회사에 단가 문의'}).waitFor();
 await page.getByText('견적 담당자',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-cloud-supplier-send]').isDisabled(),true);
 assert.equal(await page.locator('[data-cloud-supplier-reviewed]').isDisabled(),false);
 assert.equal(await page.locator('[data-cloud-supplier-send]').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(229, 233, 240)');
 await page.locator('[data-cloud-supplier-reviewed]').check();
 await page.waitForFunction(()=>!document.querySelector('[data-cloud-supplier-send]')?.disabled);
 assert.equal(await page.locator('[data-cloud-supplier-send]').isEnabled(),true);
 await page.getByRole('link',{name:'회사 정보 수정'}).click();
 await page.locator('#cloud-supplier-form [name="company"]').waitFor();
 assert.equal(await page.locator('#cloud-supplier-form [name="company"]').inputValue(),'시험 제조사');
 await page.getByRole('link',{name:'견적 요청으로 돌아가기'}).click();
 await page.locator('form[data-member-stage]').waitFor();
 supplierHasEmail=false;
 await page.getByRole('button',{name:'새로고침'}).last().click();
 await page.locator('[data-cloud-supplier-reviewed]:disabled').waitFor();
 assert.equal(await page.locator('[data-cloud-supplier-send]').isDisabled(),true);
 await page.locator('form[data-member-stage] select').selectOption('1');
 await page.locator('form[data-member-stage] button').click();
 await page.waitForFunction(()=>document.querySelectorAll('.member-progress .filled').length===2);
 await page.getByText('진행 상태를 저장했습니다.').waitFor();
 await page.getByRole('heading',{name:'운영 처리 기록'}).waitFor();
 await page.locator('.member-back').click();
 await page.getByText('공급업체 확인 중').first().waitFor();
 await page.goto(base+'#ops/requests-new');
 await page.getByText('조건에 맞는 회원 견적 요청이 없습니다.').waitFor();
 await page.goto(base+'#work/REQ-real-1');
 await page.getByText('실제 병원').first().waitFor();
 assert.equal(await page.locator('#mail-supplier').count(),0);
 await page.goto(base+'#ops/suppliers');
 await page.getByRole('heading',{name:/공급업체 관리/}).waitFor();
 await page.getByRole('button',{name:'업체 등록'}).click();
 await page.locator('#cloud-supplier-form [name="company"]').fill('시험 공급업체');
 await page.locator('#cloud-supplier-form [name="email"]').fill('supplier@example.test');
 const linkedProduct=await page.locator('#cloud-supplier-form [name="productIds"] option').first().getAttribute('value');
 assert.equal(linkedProduct,'managed-qa');
 await page.locator('#cloud-supplier-form [name="productIds"]').selectOption(linkedProduct);
 await page.getByRole('button',{name:'D1에 저장'}).click();
 await page.getByText('supplier@example.test').waitFor();
 assert.deepEqual(supplier.productIds,[linkedProduct]);
 assert.deepEqual(errors,[]);
 console.log('PASS cloud operator overview, filtered D1 requests, detail, stage update, legacy route');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
