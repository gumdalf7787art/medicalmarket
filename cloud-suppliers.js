let cloudSupplierRows=null,cloudSupplierTotal=0,cloudSupplierPage=1,cloudSupplierQuery='',cloudSupplierEditing=null,cloudSupplierBusy=false,cloudSupplierError='',cloudSupplierImportStatus='';

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

function cloudSupplierManagement(){
  if(!cloudSupplierRows&&!cloudSupplierBusy)queueMicrotask(loadCloudSuppliers);
  const rows=cloudSupplierRows||[];
  const editing=cloudSupplierEditing==='new'?null:rows.find(row=>row.id===cloudSupplierEditing);
  return `${adminHeading('공급업체 관리','업체·복수 담당자·취급 제품을 운영자 전용 D1에 저장합니다.')}
    <div class="actions"><button type="button" data-cloud-supplier-new>업체 등록</button><button type="button" data-cloud-supplier-refresh>새로고침</button></div>
    <section class="admin-panel"><h2>기존 공급업체 자료 이관</h2><p>로컬 통합 목록 JSON을 선택하면 기존 업체와 확인이 필요한 후보를 구분해 비공개 D1에 저장합니다. 동일 원본은 다시 올려도 중복 등록되지 않습니다.</p>
      <label>로컬 공급업체 통합 목록 JSON<input id="cloud-supplier-import-file" type="file" accept=".json,application/json" ${cloudSupplierBusy?'disabled':''}></label>
      <p id="supplier-import-progress" role="status">${e(cloudSupplierImportStatus)}</p><p class="admin-footnote">이관 자료는 공개 GitHub·R2에 저장되지 않습니다. 모든 기존 연락처는 확인 전 상태로 등록되며 메일은 발송되지 않습니다.</p></section>
    ${cloudSupplierError?`<p class="notice warn" role="alert">${e(cloudSupplierError)}</p>`:''}
    ${cloudSupplierEditing?cloudSupplierForm(editing):''}
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
    cloudSupplierEditing=null;cloudSupplierRows=null;toast('공급업체 정보를 저장했습니다.');
  }catch(error){cloudSupplierError=error.message;toast(error.message);}
  finally{cloudSupplierBusy=false;render();}
});

document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-cloud-supplier-new')){cloudSupplierEditing='new';render();}
  if(button.hasAttribute('data-cloud-supplier-cancel')){cloudSupplierEditing=null;render();}
  if(button.dataset.cloudSupplierEdit){cloudSupplierEditing=button.dataset.cloudSupplierEdit;render();}
  if(button.hasAttribute('data-cloud-supplier-refresh')){cloudSupplierRows=null;render();}
  if(button.dataset.cloudSupplierPage){cloudSupplierPage+=button.dataset.cloudSupplierPage==='next'?1:-1;cloudSupplierRows=null;render();}
  if(button.hasAttribute('data-supplier-contact-add'))document.getElementById('supplier-contacts')?.insertAdjacentHTML('beforeend',supplierContactFields());
  if(button.hasAttribute('data-supplier-contact-remove'))button.closest('.supplier-contact-row')?.remove();
});
