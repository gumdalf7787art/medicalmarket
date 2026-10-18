const catalogPages=new Map(),detailLoads=new Map();
const browseScrollPositions=new Map();let catalogReturnHash='#catalog';
history.scrollRestoration='manual';
function rememberBrowsePosition(){if(location.hash.startsWith('#catalog')){browseScrollPositions.set(location.hash,window.scrollY);catalogReturnHash=location.hash;}}
function productThumbnail(url){return /^\/media\/[a-f0-9-]{36}\.webp$/.test(url)?url+'?thumb=1':url;}
function catalogLocation(){const [path,search='']=location.hash.slice(1).split('?');const parts=path.split('/');return {code:parts[1]==='all'?'':parts[1]||'',page:Math.max(1,parseInt(parts[2])||1),q:new URLSearchParams(search).get('q')||''};}
function catalogHash(code,page,q){return '#catalog/'+(code||'all')+'/'+page+(q?'?q='+encodeURIComponent(q):'');}
function catalogPageResult(params,fallback){
 const key=JSON.stringify(params),pages=Math.max(1,Math.ceil(fallback.length/15)),page=Math.min(params.page,pages);
 if(!cloudMode)return {products:fallback.slice((page-1)*15,page*15),page,pages,total:fallback.length};
 const entry=catalogPages.get(key);
 if(entry)return entry;
 const initial={products:[],page:params.page,pages,total:fallback.length,loading:true};catalogPages.set(key,initial);
 cloudRequest('products?page='+params.page+'&category='+encodeURIComponent(params.code)+'&q='+encodeURIComponent(params.q)).then(result=>{
  result.products=result.products.map(p=>({...p,legacyId:p.id,id:'managed-'+p.id}));catalogPages.set(key,result);
 }).catch(error=>catalogPages.set(key,{...initial,loading:false,error:error.message})).finally(()=>{if(location.hash.startsWith('#catalog')&&JSON.stringify(catalogLocation())===key)render();});
 return initial;
}
function catalogPagination(params,result){
 if(result.loading)return '';
 if(result.error)return `<p role="alert">${e(result.error)}</p><button data-catalog-retry>다시 불러오기</button>`;
 const first=Math.floor((result.page-1)/5)*5+1;
 const link=(page,label)=>`<a href="${e(catalogHash(params.code,page,params.q))}" ${page===result.page?'aria-current="page"':''}>${label}</a>`;
 return `<nav class="catalog-pagination" aria-label="제품 목록 페이지">${result.page>1?link(result.page-1,'이전'):''}${Array.from({length:Math.min(5,result.pages-first+1)},(_,i)=>link(first+i,first+i)).join('')}${result.page<result.pages?link(result.page+1,'다음'):''}<span>${result.page} / ${result.pages} 페이지 · 총 ${result.total}개</span></nav>`;
}
async function loadProductDetail(p){
 const key=p.legacyId||p.id.replace(/^managed-/,'');
 if(detailLoads.has(key))return detailLoads.get(key);
 const promise=cloudRequest('products?id='+encodeURIComponent(key)).then(({product:row})=>{
  row.descriptionHtml=sanitizeProductHtml(row.descriptionHtml);row._summary=false;
  managementState.products[key]=row;applyManagedProducts();return row;
 }).finally(()=>{detailLoads.delete(key);});detailLoads.set(key,promise);return promise;
}
let detailError='';
function cloudDetailView(p){
 const current=location.href;
 if(!detailError)loadProductDetail(p).then(()=>{if(location.href===current)render();}).catch(error=>{detailError=error.message;if(location.href===current)render();});
 return `<div class="browse-content"><h1>${e(p.name)}</h1>${p.image?`<img class="detail-loading-photo" src="${e(productThumbnail(p.image))}" alt="${e(p.name)}">`:''}<p role="status">${detailError?e(detailError):'상세 설명을 불러오는 중입니다.'}</p>${detailError?'<button data-detail-retry>다시 불러오기</button>':''}</div>`;
}
document.addEventListener('click',event=>{
 if(event.target.closest('[data-catalog-retry]')){catalogPages.delete(JSON.stringify(catalogLocation()));render();}
 if(event.target.closest('[data-detail-retry]')){detailError='';render();}
});
// Warm only the product the visitor is about to open, not all descriptions.
let prefetching=false;
document.addEventListener('pointerover',event=>{
 const link=event.target.closest('a[href*="product.html?id="]');if(!cloudMode||prefetching||!link)return;
 const id=new URL(link.href).searchParams.get('id'),p=product(id);if(!p?._summary)return;
 prefetching=true;loadProductDetail(p).catch(()=>{}).finally(()=>{prefetching=false;});
});

async function saveImageThumbnail(url,blob){
 const name=url.split('/').pop();if(!/^[a-f0-9-]{36}\.webp$/.test(name))return;
 const bitmap=await createImageBitmap(blob);
 try{const scale=Math.min(1,480/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
 const thumb=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.78));if(!thumb)throw Error('썸네일 생성에 실패했습니다.');
 await cloudRequest('image',{method:'POST',headers:{'Content-Type':'image/webp','X-Thumbnail-For':name},body:thumb});return thumb.size;
 }finally{bitmap.close();}
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-build-thumbnails]');if(!button||productImportRunning)return;
 productImportRunning=true;cloudSaving=true;button.disabled=true;let completed=0,bytes=0;const errors=[];
 const status=document.getElementById('thumbnail-progress');
 try{await cloudLoadProducts();const urls=[...new Set(Object.values(managementState.products).flatMap(p=>[p.image,...(p.gallery||[])]).filter(url=>/^\/media\/[a-f0-9-]{36}\.webp$/.test(url)))];let cursor=0;
 await Promise.all(Array.from({length:3},async()=>{while(cursor<urls.length){const url=urls[cursor++];try{const response=await fetch(url);if(!response.ok)throw Error('사진 읽기 실패');const savedBytes=await saveImageThumbnail(url,await response.blob());bytes+=savedBytes||0;completed++;}catch(error){errors.push(url);}status.textContent=`썸네일 ${completed}/${urls.length}개 · 실패 ${errors.length}개 · ${(bytes/1024/1024).toFixed(2)}MB`;}}));
 status.textContent+=errors.length?' · 다시 실행하면 재생성할 수 있습니다.':' · 완료';
 }catch(error){status.textContent=error.message;}finally{productImportRunning=false;cloudSaving=false;button.disabled=false;}
});

function equipmentHero({code='',q='',items=[],favorites=false}={}){
 const category=categoryData.find(c=>c.id===code)?.name;
 const title=favorites?'눈여겨본 장비를, 한곳에서.':category|| (q?'찾으시는 장비를 만나보세요.':'진료의 다음 선택.');
 const description=favorites?'관심제품을 살펴보고 간편하게 견적을 요청하세요.':category?category+' 제품을 살펴보고 우리 병원에 맞는 장비를 선택하세요.':q?'검색 결과에 맞는 장비를 확인하고 간편하게 견적을 요청하세요.':'다양한 의료장비를 한곳에서, 견적 요청까지 간편하게.';
 const real=items.filter(p=>!p.deleted&&p.published!==false&&p.image&&!p.image.includes('sample-')&&/^(https:\/\/|\/media\/|assets\/)/.test(p.image)).slice(0,2);
 const general=!code&&!q&&!favorites;
 const pictures=general?[
  {image:'assets/hero/xcube-cutout.png',name:'XCUBE 90 초음파 장비',cutout:true},
  {image:'assets/hero/smart-cutout.png',name:'Smart-M 재활 장비',cutout:true},
  {image:'assets/hero/fes-cutout.png',name:'FES 3000 물리치료 장비',cutout:true}
 ]:real;
 return `<section class="catalog-banner equipment-hero ${pictures.length?'':'equipment-hero-text'}"><div class="equipment-hero-copy"><p class="home-kicker">MEDICAL MARKET · EQUIPMENT</p><h1>${e(title)}</h1><p>${e(description)}</p><a href="#catalog/all/1">전체 제품 살펴보기 ↗</a></div>${pictures.length?`<div class="equipment-hero-visual ${general?'is-cutout':''}">${pictures.map(p=>`<figure><img src="${e(p.image)}" alt="${e(p.name)}" decoding="async"><figcaption>${e(p.model||p.name)}</figcaption></figure>`).join('')}</div>`:''}</section>`;
}
