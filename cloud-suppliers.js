let cloudSupplierRows=null,cloudSupplierTotal=0,cloudSupplierPage=1,cloudSupplierQuery='',cloudSupplierEditing=null,cloudSupplierBusy=false,cloudSupplierError='',cloudSupplierImportStatus='';
const cloudSupplierDirect=new Map(),cloudSupplierDirectLoading=new Set(),cloudSupplierDirectFailed=new Set();

async function loadCloudSupplierDirect(id){
  if(cloudSupplierDirectLoading.has(id))return;
  cloudSupplierDirectLoading.add(id);
  try{
    const response=await fetch('/api/suppliers/'+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'공급업체 정보를 불러오지 못했습니다.');
    cloudSupplierDirect.set(id,data.supplier);
    cloudSupplierDirectFailed.delete(id);
    cloudSupplierError='';
  }catch(error){cloudSupplierDirectFailed.add(id);cloudSupplierError=error.message;}
  finally{cloudSupplierDirectLoading.delete(id);if(location.hash.startsWith('#ops/suppliers?'))render();}
}

async function loadCloudSuppliers(){
  if(cloudSupplierBusy)return;
  cloudSupplierBusy=true;
  try{
    const query=new URLSearchParams({page:String(cloudSupplierPage),q:cloudSupplierQuery});
    const response=await fetch('/api/suppliers?'+query,{credentials:'same-origin',cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'공급업체 목록을 불러오지 못했습니다.');
    cloudSupplierRows=data.suppliers;cloudSupplierTotal=data.total;
  }catch(error){cloudSupplierError=error.message;cloudSupplierRows=[];}
  finally{cloudSupplierBusy=false;if(location.hash.startsWith('#ops/suppliers'))render();}
}

const supplierClassLabel=value=>({legacy:'기존 업체',candidate:'업체 확인 필요',manual:'직접 등록'})[value]||'확인 필요';
function supplierContactFields(contact={},index=0){
  return `<div class="supplier-contact-row" data-contact-id="${e(contact.id||'')}"><div class="supplier-edit-grid">
    <label>담당자 이름<input name="contact-name" value="${e(contact.name||'')}" maxlength="80"></label>
    <label>유선번호<input name="contact-phone" value="${e(contact.phone||'')}" maxlength="40"></label>
    <label>휴대폰번호<input name="contact-mobile" value="${e(contact.mobile||'')}" maxlength="40"></label>
    <label>이메일<input name="contact-email" type="email" value="${e(contact.email||'')}" maxlength="254"></label>
    </div><label class="check"><input name="contact-left" type="checkbox" ${contact.left?'checked':''}> 퇴사</label>
    <label class="check"><input name="contact-blocked" type="checkbox" ${contact.blocked?'checked':''}> 연락 제외</label>
    <button type="button" data-supplier-contact-remove>담당자 삭제</button></div>`;
}
function cloudSupplierForm(row){
  const current=new Set(row?.productIds||[]);
  const choices=Object.values(managementState.products).filter(p=>!p.deleted).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ko'));
  return `<section class="admin-panel cloud-supplier-form"><div class="admin-panel-title"><h2>${row?'공급업체 수정':'공급업체 등록'}</h2>${row?'<button type="button" data-cloud-supplier-cancel>닫기</button>':''}</div>
    <form id="cloud-supplier-form" data-id="${e(row?.id||'')}">
      <div class="supplier-edit-grid"><label>업체명 *<input name="company" value="${e(row?.company||'')}" maxlength="120" required></label>
      <label>회사 유선번호<input name="companyPhone" value="${e(row?.companyPhone||row?.phone||'')}" maxlength="40"></label>
      <label>회사 이메일<input name="companyEmail" type="email" value="${e(row?.companyEmail||'')}" maxlength="254"></label>
      <label>기본 연락 이메일<input name="email" type="email" value="${e(row?.email||'')}" maxlength="254"></label></div>
      <div class="supplier-edit-grid"><label>자료 구분<select name="classification"><option value="manual" ${row?.classification==='manual'||!row?'selected':''}>직접 등록</option><option value="legacy" ${row?.classification==='legacy'?'selected':''}>기존 업체</option><option value="candidate" ${row?.classification==='candidate'?'selected':''}>업체 확인 필요</option></select></label>
      <label>확인 상태<select name="reviewStatus"><option value="needs_review" ${row?.reviewStatus!=='confirmed'?'selected':''}>확인 필요</option><option value="confirmed" ${row?.reviewStatus==='confirmed'?'selected':''}>확인 완료</option></select></label></div>
      <h3>담당자 연락처</h3><p class="admin-footnote">빈칸은 그대로 두고, 실제 확인한 뒤 사용 상태로 바꿔 주세요.</p>
      <div id="supplier-contacts">${(row?.contacts||[]).map(supplierContactFields).join('')}</div>
      <button type="button" data-supplier-contact-add>+ 담당자 추가</button>
      <label>취급 제품 <small>여러 제품은 Ctrl 또는 Shift 키로 선택할 수 있습니다.</small><select name="productIds" multiple size="7">${choices.map(p=>`<option value="${e(p.id)}" ${current.has(p.id)?'selected':''}>${e(p.name)}${p.model?' · '+e(p.model):''}</option>`).join('')}</select></label>
      <label>운영 메모<textarea name="notes" rows="3" maxlength="1000">${e(row?.notes||'')}</textarea></label>
      <label class="check"><input name="active" type="checkbox" ${row?.active===false?'':'checked'}> 사용 중인 업체</label>
      <button class="primary" ${cloudSupplierBusy?'disabled':''}>${cloudSupplierBusy?'저장 중…':'D1에 저장'}</button>
    </form><p class="admin-footnote">연락처와 메모는 운영자만 조회합니다. 저장해도 메일은 발송되지 않습니다.</p></section>`;
}

function cloudSupplierManagement(page='suppliers'){
  if(page==='suppliers?discovery=1')return discoveryPanel();
  const params=new URLSearchParams(page.includes('?')?page.slice(page.indexOf('?')+1):''),directId=params.get('edit')||'',returnId=params.get('return')||'';
  if(directId&&!cloudSupplierDirect.has(directId)&&!cloudSupplierDirectLoading.has(directId)&&!cloudSupplierDirectFailed.has(directId))queueMicrotask(()=>loadCloudSupplierDirect(directId));
  if(!cloudSupplierRows&&!cloudSupplierBusy)queueMicrotask(loadCloudSuppliers);
  const rows=cloudSupplierRows||[];
  const editing=directId?cloudSupplierDirect.get(directId):cloudSupplierEditing==='new'?null:rows.find(row=>row.id===cloudSupplierEditing);
  return `${adminHeading('공급업체 관리','업체·복수 담당자·취급 제품을 운영자 전용 D1에 저장합니다.')}
    ${returnId?`<p><a class="member-back" data-cloud-supplier-return href="#ops/requests?id=${encodeURIComponent(returnId)}">← 견적 요청으로 돌아가기</a></p>`:''}
    <div class="actions"><button type="button" data-cloud-supplier-new>업체 등록</button><button type="button" data-cloud-supplier-refresh>새로고침</button><a href="#ops/suppliers?discovery=1">공식 홈페이지 장비 검토</a></div>
    ${cloudSupplierError?`<p class="notice warn" role="alert">${e(cloudSupplierError)}</p>`:''}
    ${directId?editing?cloudSupplierForm(editing):cloudSupplierDirectFailed.has(directId)?`<button type="button" data-cloud-supplier-direct-retry="${e(directId)}">회사 정보 다시 불러오기</button>`:'<section class="admin-panel"><p role="status">해당 회사 정보를 불러오고 있습니다.</p></section>':cloudSupplierEditing?cloudSupplierForm(editing):''}
    <section class="admin-panel"><h2>기존 공급업체 자료 이관</h2><p>로컬 통합 목록 JSON을 선택하면 기존 업체와 확인이 필요한 후보를 구분해 비공개 D1에 저장합니다. 동일 원본은 다시 올려도 중복 등록되지 않습니다.</p>
      <label>로컬 공급업체 통합 목록 JSON<input id="cloud-supplier-import-file" type="file" accept=".json,application/json" ${cloudSupplierBusy?'disabled':''}></label>
      <p id="supplier-import-progress" role="status">${e(cloudSupplierImportStatus)}</p><p class="admin-footnote">이관 자료는 공개 GitHub·R2에 저장되지 않습니다. 모든 기존 연락처는 확인 전 상태로 등록되며 메일은 발송되지 않습니다.</p></section>
    <section class="admin-panel"><form id="cloud-supplier-search" class="admin-search"><label>업체 검색<input name="query" value="${e(cloudSupplierQuery)}" placeholder="업체명·기본 이메일"></label><button>검색</button></form>
      <div class="admin-panel-title"><h2>등록된 공급업체 <b>${cloudSupplierTotal}</b></h2><span>20개씩 표시</span></div>
      ${cloudSupplierRows===null?'<p>공급업체 정보를 불러오는 중입니다.</p>':rows.length?`<div class="table-wrap"><table class="admin-table"><thead><tr><th>업체명</th><th>구분·확인</th><th>기본 이메일</th><th>담당자</th><th>취급 제품</th><th>상태</th><th></th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${e(row.company)}</strong></td><td>${supplierClassLabel(row.classification)} · ${row.reviewStatus==='confirmed'?'확인 완료':'확인 필요'}</td><td>${e(row.email||'미등록')}</td><td>${row.contacts?.length||0}명</td><td>${row.productIds.length}개</td><td>${row.active?'사용 중':'중지'}</td><td><button type="button" data-cloud-supplier-edit="${e(row.id)}">수정</button></td></tr>`).join('')}</tbody></table></div>`:'<p>등록된 공급업체가 없습니다.</p>'}
      <div class="admin-filters">${cloudSupplierPage>1?'<button type="button" data-cloud-supplier-page="prev">이전</button>':''}<span>${cloudSupplierPage} / ${Math.max(1,Math.ceil(cloudSupplierTotal/20))}</span>${cloudSupplierPage*20<cloudSupplierTotal?'<button type="button" data-cloud-supplier-page="next">다음</button>':''}</div>
    </section>`;
}

const supplierImportEmail=(value,valid)=>valid&&value?String(value).trim():'';
function supplierImportRow(row){
  const contacts=(row.contacts||[]).map((contact,index)=>({
    id:String(contact.id||`contact-${index+1}`),name:contact.name||'',phone:contact.phone||'',mobile:contact.mobile||'',
    email:supplierImportEmail(contact.email,contact.emailFormatValid),left:!!contact.left,blocked:!!contact.blocked
  }));
  const companyEmail=supplierImportEmail(row.companyEmail,row.companyEmailFormatValid);
  const email=companyEmail||contacts.find(contact=>contact.email&&!contact.left&&!contact.blocked)?.email||'';
  const productIds=[...new Set((row.products||[]).map(product=>`legacy-${product.id}`))];
  return {sourceKey:`legacy:${row.id}`,classification:String(row.source||'').startsWith('wm_member:')?'legacy':'candidate',
    reviewStatus:'needs_review',company:row.company||'',companyPhone:row.companyPhone||'',companyEmail,
    contactName:'',email,phone:row.companyPhone||'',contacts,productIds,notes:'',active:false};
}

document.addEventListener('change',async event=>{
  if(event.target.id!=='cloud-supplier-import-file')return;
  const file=event.target.files?.[0];if(!file||cloudSupplierBusy)return;
  cloudSupplierBusy=true;cloudSupplierError='';let completed=0,created=0,skipped=0;
  const progress=message=>{cloudSupplierImportStatus=message;const node=document.getElementById('supplier-import-progress');if(node)node.textContent=message;};
  try{
    if(file.size>3*1024*1024)throw Error('3MB 이하의 공급업체 통합 목록 파일을 선택해 주세요.');
    const source=JSON.parse(await file.text());
    if(source.format!=='medicalmarket-suppliers-v1'||!Array.isArray(source.suppliers)||source.suppliers.length!==294)throw Error('공급업체 통합 목록 JSON 파일을 확인해 주세요.');
    for(const row of source.suppliers){
      const payload=supplierImportRow(row);
      const response=await fetch('/api/suppliers/import',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok)throw Error(`${completed+1}번째 업체: ${result.error||'저장 실패'}`);
      completed++;if(result.status==='created')created++;else skipped++;
      if(completed%10===0||completed===source.suppliers.length)progress(`${completed}/${source.suppliers.length}건 처리 · 신규 ${created}건 · 기존 ${skipped}건`);
    }
    cloudSupplierImportStatus=`이관 완료: 신규 ${created}건 · 기존 ${skipped}건. 연락처 확인 후 사용 상태로 변경하세요.`;
  }catch(error){cloudSupplierError=error.message;cloudSupplierImportStatus=`중단: ${completed}건 처리. 같은 파일을 다시 선택하면 이어서 진행할 수 있습니다.`;}
  finally{cloudSupplierBusy=false;cloudSupplierRows=null;cloudSupplierPage=1;render();}
});

document.addEventListener('submit',async event=>{
  if(event.target.id==='cloud-supplier-search'){
    event.preventDefault();cloudSupplierQuery=String(new FormData(event.target).get('query')||'').trim();cloudSupplierPage=1;cloudSupplierRows=null;render();return;
  }
  if(event.target.id!=='cloud-supplier-form')return;
  event.preventDefault();if(cloudSupplierBusy)return;
  const form=event.target,data=new FormData(form),id=form.dataset.id;
  const contacts=[...form.querySelectorAll('.supplier-contact-row')].map((node,index)=>({
    id:node.dataset.contactId||`manual-${index+1}`,name:node.querySelector('[name="contact-name"]').value,
    phone:node.querySelector('[name="contact-phone"]').value,mobile:node.querySelector('[name="contact-mobile"]').value,
    email:node.querySelector('[name="contact-email"]').value,left:node.querySelector('[name="contact-left"]').checked,
    blocked:node.querySelector('[name="contact-blocked"]').checked
  }));
  const payload={company:data.get('company'),contactName:'',email:data.get('email'),phone:data.get('companyPhone'),
    companyPhone:data.get('companyPhone'),companyEmail:data.get('companyEmail'),classification:data.get('classification'),
    reviewStatus:data.get('reviewStatus'),contacts,notes:data.get('notes'),active:data.has('active'),productIds:data.getAll('productIds')};
  cloudSupplierBusy=true;
  try{
    const response=await fetch('/api/suppliers'+(id?'/'+encodeURIComponent(id):''),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'저장하지 못했습니다.');
    cloudSupplierEditing=null;cloudSupplierRows=null;cloudSupplierDirect.delete(id);cloudSupplierMailCache.clear();toast('공급업체 정보를 저장했습니다.');
    const route=new URLSearchParams(location.hash.split('?')[1]||''),returnId=route.get('return');
    if(returnId){location.hash='#ops/requests?id='+encodeURIComponent(returnId);return;}
  }catch(error){cloudSupplierError=error.message;toast(error.message);}
  finally{cloudSupplierBusy=false;render();}
});

document.addEventListener('click',event=>{
  if(event.target.closest('[data-cloud-supplier-return]'))cloudSupplierMailCache.clear();
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.cloudSupplierDirectRetry){cloudSupplierDirectFailed.delete(button.dataset.cloudSupplierDirectRetry);cloudSupplierError='';render();return;}
  if(button.hasAttribute('data-cloud-supplier-new')){cloudSupplierEditing='new';render();}
  if(button.hasAttribute('data-cloud-supplier-cancel')){const params=new URLSearchParams(location.hash.split('?')[1]||''),returnId=params.get('return');if(returnId){cloudSupplierMailCache.clear();location.hash='#ops/requests?id='+encodeURIComponent(returnId);}else if(params.has('edit'))location.hash='#ops/suppliers';else{cloudSupplierEditing=null;render();}}
  if(button.dataset.cloudSupplierEdit){cloudSupplierEditing=button.dataset.cloudSupplierEdit;render();}
  if(button.hasAttribute('data-cloud-supplier-refresh')){cloudSupplierRows=null;render();}
  if(button.dataset.cloudSupplierPage){cloudSupplierPage+=button.dataset.cloudSupplierPage==='next'?1:-1;cloudSupplierRows=null;render();}
  if(button.hasAttribute('data-supplier-contact-add'))document.getElementById('supplier-contacts')?.insertAdjacentHTML('beforeend',supplierContactFields());
  if(button.hasAttribute('data-supplier-contact-remove'))button.closest('.supplier-contact-row')?.remove();
});

const discoverySuppliers={inbody:'인바디',alpinion:'알피니언메디칼시스템',bistos0340:'비스토스'};
let discoveryRows=null,discoveryBusy=false,discoveryMessage='';
async function discoveryRequest(data) {
  const response=await fetch('/api/discovery',{cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('수집 서버가 응답하지 않았습니다 (HTTP '+response.status+').');
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'장비 검토 요청이 실패했습니다.');
  return result;
}
function discoveryRow(row,index) {
  const labels={draft:'비공개 초안',candidate:'공급업체 연결 후보',compare:'모델 비교 필요',linked:'이미 연결됨',published:'공개 완료',connected:'연결 완료'};
  const status=row.decision||row.kind;
  const category=row.category||row.recommendedCategory;
  const options=row.matches.map(p=>`<option value="${e(p.id)}">${e(p.name)} · ${e(p.model)} · ${e(p.id)}</option>`).join('');
  return `<tr><td>${e(row.company)}</td><td><strong>${e(row.model)}</strong><br>${e(row.maker)} · <a target="_blank" rel="noopener noreferrer" href="${e(row.source_url)}">공식 원문</a></td><td>${labels[status]}</td><td>
    ${status==='draft'?`<label>${row.category?'대표 카테고리':'추천 대표 카테고리'}<select name="category" form="discovery-review-${index}" data-discovery-category="${index}" required>${categoryOptions(category)}</select></label><small role="status" data-category-feedback></small><details><summary>초안 검토</summary><form id="discovery-review-${index}" data-discovery-review="${index}"><label>공개 제품명<input name="name" value="${e(row.model)}" required maxlength="300"></label><button>확인 후 공개</button></form></details>`:['candidate','compare'].includes(status)?`<form data-discovery-review="${index}"><label>기존 제품<select name="product" required><option value="">비교 후 선택</option>${options}</select></label><button>공급업체 연결 승인</button></form>`:''}</td></tr>`;
}
function discoveryPanel() {
  if(discoveryRows===null&&!discoveryBusy)queueMicrotask(()=>updateDiscovery('refresh'));
  return `${adminHeading('공식 홈페이지 장비 검토','제조사와 모델명을 기존 제품과 대조합니다. 원문을 확인한 뒤 공개하거나 공급업체 연결을 승인하세요.')}
    <p><a href="#ops/suppliers">← 공급업체 관리</a></p><section class="admin-panel">
    <div class="actions"><a href="/assets/admin/product-material.html">제품 자료 비공개 저장</a><button data-discovery="scan">공식 목록 다시 수집</button><button data-discovery="pilot">11월 23일 시범 목록 불러오기</button><button data-discovery="refresh">검토 목록 새로고침</button></div>
    <p role="status">${e(discoveryBusy?'처리 중입니다.':discoveryMessage)}</p>
    <div class="table-wrap"><table class="admin-table"><thead><tr><th>공급업체</th><th>모델·제조사</th><th>상태</th><th>검토</th></tr></thead><tbody>${(discoveryRows||[]).map(discoveryRow).join('')}</tbody></table></div>
    ${discoveryRows?.length===0?'<p>저장된 장비가 없습니다.</p>':''}</section>`;
}
async function updateDiscovery(action,review) {
  if(discoveryBusy)return;
  discoveryBusy=true;
  const messages=[];
  try {
    if(review) {
      await discoveryRequest(review);
      messages.push(review.action==='publish'?'제품을 공개했습니다.':'공급업체를 연결했습니다.');
      cloudSupplierRows=null;
      cloudSupplierDirect.clear();
      await cloudLoadProducts();
    } else if(action!=='refresh') {
      for(const [key,name] of Object.entries(discoverySuppliers)) {
        try {
          let result;
          try { result=await discoveryRequest({action,key}); }
          catch(error) {
            if(action!=='scan'||key!=='alpinion')throw error;
            result=await discoveryRequest({action,key,mirror:true});
          }
          messages.push(name+' '+result.count+'건 확인');
        }
        catch(error){messages.push(name+' · '+error.message);}
      }
    }
    discoveryRows=(await discoveryRequest()).rows;
  }catch(error){messages.push(error.message);discoveryRows??=[];}
  finally {
    discoveryMessage=messages.join(' / ');discoveryBusy=false;
    if(location.hash==='#ops/suppliers?discovery=1')render();
  }
}
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-discovery]')?.dataset.discovery;
  if(action&&!discoveryBusy){void updateDiscovery(action);render();}
});
document.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-discovery-review]');
  if(!form)return;
  event.preventDefault();
  if(discoveryBusy)return;
  const row=discoveryRows[Number(form.dataset.discoveryReview)],fields=Object.fromEntries(new FormData(form));
  void updateDiscovery('review',{action:fields.product?'link':'publish',supplier:row.supplier_id,identity:row.identity,...fields});
  render();
});

document.addEventListener('change',async event=>{
  const select=event.target.closest('select[data-discovery-category]');
  if(!select)return;
  const row=discoveryRows[Number(select.dataset.discoveryCategory)];
  const previous=row.category||row.recommendedCategory||'';
  const feedback=select.closest('td').querySelector('[data-category-feedback]');
  if(!select.value){select.value=previous;return;}
  const category=select.value;
  select.disabled=true;
  const button=select.form.querySelector('button');
  button.disabled=true;
  feedback.textContent='저장 중…';
  try{
    await discoveryRequest({action:'category',supplier:row.supplier_id,identity:row.identity,category});
    row.category=category;
    feedback.textContent='비공개 초안에 저장됨';
  }catch(error){
    select.value=previous;
    feedback.textContent=error.message;
  }finally{
    select.disabled=false;
    button.disabled=false;
  }
});
