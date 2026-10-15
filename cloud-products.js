const cloudMode = !['localhost','127.0.0.1',''].includes(location.hostname) || new URLSearchParams(location.search).get('cloud')==='1';
let cloudReady=!cloudMode,cloudAuthenticated=false,cloudConfigured=false,cloudError='',cloudStorageStatus=null,cloudSaving=false;
const CLOUD_CATALOG_CACHE='mm-public-catalog-v2';
function cloudApplyRows(rows){
  rows=rows.map(row=>{const old=managementState.products[row.id];return row._summary&&old&&!old._summary&&old.updatedAt===row.updatedAt?{...old,...row,_summary:false}:row;});
  managementState={products:Object.fromEntries(rows.map(p=>[p.id,{...p,descriptionHtml:sanitizeProductHtml(p.descriptionHtml)}])),categories:null};
  managementProducts.splice(0);products.splice(0);applyManagedProducts();
}
function cloudCacheRows(rows){
  try{sessionStorage.setItem(CLOUD_CATALOG_CACHE,JSON.stringify({at:Date.now(),rows:rows.filter(p=>p.published&&!p.deleted)}));}catch{/* Storage disabled/full: the network path remains available. */}
}
async function cloudRequest(path,options={}){
  const response=await fetch('/api/cloud/'+path,{credentials:'same-origin',cache:'no-store',...options});
  const type=response.headers.get('content-type')||'';
  if(!type.includes('application/json'))throw Error('클라우드 API 배포를 확인해 주세요.');
  const data=await response.json();if(!response.ok){if(response.status===401)cloudAuthenticated=false;throw Error(data.error||'서버 처리에 실패했습니다.');}return data;
}
async function cloudLoadProducts(){
  const rows=[];let after='';
  do{const data=await cloudRequest('products?bulk=1&'+(cloudAuthenticated?'admin=1&':'summary=1&')+'after='+encodeURIComponent(after));rows.push(...data.products);after=data.next;}while(after);
  cloudApplyRows(rows);cloudCacheRows(rows);
}
function cloudLoginPanel(){return `<section class="admin-panel"><h2>제품 관리 로그인</h2><p>제품 정보와 사진을 저장하려면 운영자 로그인이 필요합니다.</p>${!cloudConfigured?'<p class="notice warn">Cloudflare → Settings → Variables and secrets에 ADMIN_PASSWORD를 Secret으로 추가하고 재배포하세요. 다른 계정과 겹치지 않는 12자 이상의 운영자 비밀번호를 사용하세요.</p>':''}<form id="cloud-login"><label>운영자 비밀번호<input name="password" type="password" autocomplete="current-password" required minlength="12"></label><button class="primary" ${cloudSaving?'disabled':''}>로그인</button></form>${cloudError?`<p role="alert">${e(cloudError)}</p>`:''}</section>`;}
function cloudProductGate(){
  if(!cloudMode)return '';
  if(!cloudReady)return '<section class="admin-panel">제품 정보를 불러오는 중입니다.</section>';
  if(!cloudAuthenticated)return cloudLoginPanel();
  return '';
}
async function saveCloudManagement(next){
  if(!cloudReady||!cloudAuthenticated)throw Error('운영자 로그인이 필요합니다.');
  if(next.categories!==managementState.categories)throw Error('카테고리의 서버 저장은 아직 연결되지 않았습니다. 기존 분류를 사용해 주세요.');
  const changes=Object.entries(next.products).filter(([id,row])=>row!==managementState.products[id]);
  if(changes.length!==1)throw Error('제품을 한 번에 하나씩 저장해 주세요.');
  if(cloudSaving)throw Error('저장이 진행 중입니다. 잠시 기다려 주세요.');
  cloudSaving=true;
  try{const [,row]=changes[0];const {product:stored}=await cloudRequest('products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...row,gallery:row.gallery||[],descriptionHtml:row.descriptionHtml||''})});
    managementState={...managementState,products:{...managementState.products,[stored.id]:stored}};applyManagedProducts();cloudCacheRows(Object.values(managementState.products));catalogPages.clear();detailLoads.clear();return true;
  }finally{cloudSaving=false;}
}
async function uploadCloudPhoto(file){
  if(!cloudAuthenticated)throw Error('운영자 로그인 후 사진을 추가해 주세요.');
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>8*1024*1024)throw Error('8MB 이하의 사진 파일을 선택해 주세요.');
  const bitmap=await createImageBitmap(file);
  try{
    if(bitmap.width*bitmap.height>40000000)throw Error('사진 해상도가 너무 큽니다. 크기를 줄여 주세요.');
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.84));if(!blob||blob.type!=='image/webp')throw Error('사진 최적화에 실패했습니다.');
    const url=(await cloudRequest('image',{method:'POST',headers:{'Content-Type':'image/webp'},body:blob})).url;await saveImageThumbnail(url,blob);return url;
  }finally{bitmap.close();}
}
document.addEventListener('submit',async event=>{
  if(event.target.id!=='cloud-login')return;event.preventDefault();if(cloudSaving)return;
  const password=String(new FormData(event.target).get('password')||'');cloudSaving=true;cloudError='';
  try{await cloudRequest('session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});cloudAuthenticated=true;cloudConfigured=true;await cloudLoadProducts();}
  catch(error){cloudError=error.message;}finally{cloudSaving=false;render();}
});
document.addEventListener('click',async event=>{
  if(!event.target.closest('[data-cloud-logout]'))return;
  try{await cloudRequest('session',{method:'DELETE'});cloudAuthenticated=false;manageEditor=null;productEditDraft=null;await cloudLoadProducts();render();}catch(error){toast(error.message);}
});
queueMicrotask(async()=>{
  if(!cloudMode)return;
  // Public cloud edition never imports this browser's demo catalogue into D1.
  managementState={products:{},categories:null};managementProducts.splice(0);products.splice(0);
  // Only public products, a short lifetime, and no cached admin authorization.
  if(!/^#(ops|work|quote)(\/|$)/.test(location.hash))try{
    const cached=JSON.parse(sessionStorage.getItem(CLOUD_CATALOG_CACHE)||'null');
    if(cached&&Array.isArray(cached.rows)&&Date.now()-cached.at>=0&&Date.now()-cached.at<60000){cloudApplyRows(cached.rows);cloudReady=true;render();}
  }catch{/* A corrupt cache must not block loading. */}
  try{const [session,status]=await Promise.all([cloudRequest('session'),cloudRequest('status')]);cloudAuthenticated=session.authenticated;cloudConfigured=session.configured;cloudStorageStatus=status;await cloudLoadProducts();}
  catch(error){cloudError=error.message;}finally{cloudReady=true;render();}
});

// Keep ordinary internal navigation in React; new tabs/downloads retain native behavior.
document.addEventListener('click',event=>{
  if(!cloudMode||!cloudReady||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const link=event.target.closest('a[href]');if(!link||link.target||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);if(url.origin!==location.origin)return;
  let hash='';
  if(['/product','/product.html'].includes(url.pathname)&&url.searchParams.has('id'))hash='#product/'+encodeURIComponent(url.searchParams.get('id'));
  else if(['/','/index.html'].includes(url.pathname)&&url.hash)hash=url.hash;
  if(!hash)return;
  event.preventDefault();
  if(location.hash!==hash)location.hash=hash;
},true);
