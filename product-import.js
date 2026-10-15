// Only explicitly selected, pre-reviewed product packages are imported. No local DB discovery.
let productImportRunning=false;
function productImportPanel(){return cloudMode&&cloudAuthenticated?`<details class="admin-panel"><summary>기존 제품 자료 가져오기</summary><p>개인정보를 제거한 제품 이전 파일만 선택하세요. 기존 제품은 덮어쓰지 않으며, 실패한 파일은 다시 실행할 수 있습니다.</p><label>제품 이전 파일<input id="product-import-files" type="file" accept=".json" multiple ${productImportRunning?'disabled':''}></label><p id="product-import-progress" role="status"></p><button type="button" data-build-thumbnails>목록용 썸네일 만들기</button><p id="thumbnail-progress" role="status"></p><label>검토 완료된 제품 첨부 이전 파일<input id="attachment-import-files" type="file" accept=".json" multiple ${productImportRunning?'disabled':''}></label><p id="attachment-progress" role="status"></p></details>`:'';}
window.addEventListener('beforeunload',event=>{if(productImportRunning){event.preventDefault();event.returnValue='';}});
document.addEventListener('change',async event=>{
 if(event.target.id!=='attachment-import-files'||productImportRunning)return;
 const files=[...event.target.files];if(!files.length)return;
 productImportRunning=true;cloudSaving=true;event.target.disabled=true;let completed=0;const errors=[];
 const progress=message=>{const el=document.getElementById('attachment-progress');if(el)el.textContent=message;};
 try{
  for(const file of files){
   try{
    if(file.size>45*1024*1024)throw Error('이전 파일은 45MB 이하여야 합니다.');
    const pack=JSON.parse(await file.text());
    if(pack.format!=='medicalmarket-attachments-v1'||!Array.isArray(pack.products)||pack.products.length>100||typeof pack.base64!=='string'||!/^\w{64}$/.test(pack.hash))throw Error('첨부 이전 파일 형식 오류');
    const bytes=Uint8Array.from(atob(pack.base64),c=>c.charCodeAt(0));
    for(const product of pack.products){
     await cloudRequest('attachments?'+new URLSearchParams({product:product.id,name:product.name,extension:pack.extension}),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-SHA256':pack.hash},body:bytes});completed++;
    }
   }catch(error){errors.push(file.name+': '+error.message);}
   progress(`첨부 연결 ${completed}건 · 실패 ${errors.length}건`);
  }
  await cloudLoadProducts();manageMessage=`제품 첨부 이전 완료: ${completed}건 · 실패 ${errors.length}건`+(errors.length?' / '+errors.join(' / '):'');
 }catch(error){manageMessage=`첨부 이전 확인 필요: ${completed}건 저장 · ${error.message}`;}
 finally{productImportRunning=false;cloudSaving=false;render();}
});
document.addEventListener('change',async event=>{
 if(event.target.id!=='product-import-files'||productImportRunning)return;
 const files=[...event.target.files];if(!files.length)return;
 productImportRunning=true;cloudSaving=true;event.target.disabled=true;
 let completed=0,skipped=0;const failures=[],imageUrls=new Map();
 const progress=text=>{const el=document.getElementById('product-import-progress');if(el)el.textContent=text;};
 const retry=async fn=>{for(let i=0;;i++){try{return await fn();}catch(error){if(i>=2||/로그인|버전|변경되었습니다/.test(error.message))throw error;await new Promise(r=>setTimeout(r,1500*(i+1)));}}};
 try{
  await cloudLoadProducts();
  for(let fi=0;fi<files.length;fi++){
   const file=files[fi];if(file.size>40*1024*1024)throw Error('이전 파일 하나의 크기는 40MB 이하여야 합니다.');
   const pack=JSON.parse(await file.text());
   if(pack.format!=='medicalmarket-products-v1'||!Array.isArray(pack.products)||pack.products.length>30||!pack.images||typeof pack.images!=='object')throw Error('제품 이전 파일 형식이 올바르지 않습니다.');
   const pending=pack.products.filter(p=>{if(managementState.products[p.id]){skipped++;return false;}return true;});
   if(!pending.length)continue;
   const needed=new Set(pending.flatMap(p=>[...(p.gallery||[]),...((p.descriptionHtml||'').match(/asset:[a-f0-9]{64}/g)||[])].map(x=>x.replace(/^asset:/,''))));
   const entries=Object.entries(pack.images).filter(([hash])=>needed.has(hash)&&!imageUrls.has(hash));
   let cursor=0,uploaded=0;
   const uploads=await Promise.allSettled(Array.from({length:3},async()=>{
    while(cursor<entries.length){
     const [hash,b64]=entries[cursor++];if(!/^[a-f0-9]{64}$/.test(hash)||typeof b64!=='string')throw Error('사진 형식이 올바르지 않습니다.');
     const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
     const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
     if(actual!==hash)throw Error('이전 사진 파일이 손상되었습니다.');
     const result=await retry(()=>cloudRequest('image',{method:'POST',headers:{'Content-Type':'image/webp','X-Image-SHA256':hash},body:bytes}));imageUrls.set(hash,result.url);
     progress(`파일 ${fi+1}/${files.length} · 사진 ${++uploaded}/${entries.length} · 제품 저장 ${completed}개 · 기존 ${skipped}개`);
    }
   }));
   const failedUpload=uploads.find(result=>result.status==='rejected');if(failedUpload)throw failedUpload.reason;
   for(const source of pending){
    try{
     const replace=url=>{if(!/^asset:[a-f0-9]{64}$/.test(url))throw Error('승인된 이전 사진만 사용할 수 있습니다.');const value=imageUrls.get(url.slice(6));if(!value)throw Error('사진 업로드가 완료되지 않았습니다.');return value;};
     const row={...source,image:source.image?replace(source.image):'',gallery:source.gallery.map(replace),descriptionHtml:source.descriptionHtml.replace(/asset:[a-f0-9]{64}/g,replace),revision:0};
     const {product}=await retry(()=>cloudRequest('products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)}));
     managementState.products[product.id]=product;completed++;
    }catch(error){failures.push(source.id+': '+error.message);}
    progress(`파일 ${fi+1}/${files.length} · 제품 저장 ${completed}개 · 기존 ${skipped}개 · 실패 ${failures.length}개`);
   }
  }
  await cloudLoadProducts();manageMessage=`제품 이전 완료: 저장 ${completed}개, 기존 ${skipped}개, 실패 ${failures.length}개.`+(failures.length?' '+failures.join(' / '):'');
 }catch(error){manageMessage=`제품 이전 중단: 저장 ${completed}개. ${error.message} 같은 파일을 다시 선택하면 저장되지 않은 제품부터 진행합니다.`;}
 finally{productImportRunning=false;cloudSaving=false;render();}
});
