let cloudSupplierRows=null,cloudSupplierTotal=0,cloudSupplierPage=1,cloudSupplierQuery='',cloudSupplierEditing=null,cloudSupplierBusy=false,cloudSupplierError='';

async function loadCloudSuppliers(){
  if(cloudSupplierBusy)return;
  cloudSupplierBusy=true;cloudSupplierError='';
  try{
    const query=new URLSearchParams({page:String(cloudSupplierPage),q:cloudSupplierQuery});
    const response=await fetch('/api/suppliers?'+query,{credentials:'same-origin',cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'공급업체 목록을 불러오지 못했습니다.');
    cloudSupplierRows=data.suppliers;cloudSupplierTotal=data.total;
  }catch(error){cloudSupplierError=error.message;cloudSupplierRows=[];}
  finally{cloudSupplierBusy=false;if(location.hash.startsWith('#ops/suppliers'))render();}
}

function cloudSupplierForm(row){
  const current=new Set(row?.productIds||[]);
  const choices=products.filter(p=>!p.deleted).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ko'));
  return `<section class="admin-panel cloud-supplier-form"><div class="admin-panel-title"><h2>${row?'공급업체 수정':'공급업체 등록'}</h2>${row?'<button type="button" data-cloud-supplier-cancel>닫기</button>':''}</div>
    <form id="cloud-supplier-form" data-id="${e(row?.id||'')}">
      <div class="supplier-edit-grid"><label>업체명 *<input name="company" value="${e(row?.company||'')}" maxlength="120" required></label>
      <label>담당자명<input name="contactName" value="${e(row?.contactName||'')}" maxlength="80"></label>
      <label>견적 요청 이메일 *<input name="email" type="email" value="${e(row?.email||'')}" maxlength="254" required></label>
      <label>전화번호<input name="phone" value="${e(row?.phone||'')}" maxlength="40"></label></div>
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
  return `${adminHeading('공급업체 관리','업체·담당자·견적 요청 이메일·취급 제품을 D1에 저장합니다.')}
    <div class="actions"><button type="button" data-cloud-supplier-new>업체 등록</button><button type="button" data-cloud-supplier-refresh>새로고침</button></div>
    ${cloudSupplierError?`<p class="notice warn" role="alert">${e(cloudSupplierError)}</p>`:''}
    ${cloudSupplierEditing?cloudSupplierForm(editing):''}
    <section class="admin-panel"><form id="cloud-supplier-search" class="admin-search"><label>업체 검색<input name="query" value="${e(cloudSupplierQuery)}" placeholder="업체명·담당자·이메일"></label><button>검색</button></form>
      <div class="admin-panel-title"><h2>등록된 공급업체 <b>${cloudSupplierTotal}</b></h2><span>20개씩 표시</span></div>
      ${cloudSupplierRows===null?'<p>공급업체 정보를 불러오는 중입니다.</p>':rows.length?`<div class="table-wrap"><table class="admin-table"><thead><tr><th>업체명</th><th>담당자</th><th>견적 요청 이메일</th><th>취급 제품</th><th>상태</th><th></th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${e(row.company)}</strong></td><td>${e(row.contactName||'미등록')}</td><td>${e(row.email)}</td><td>${row.productIds.length}개</td><td>${row.active?'사용 중':'중지'}</td><td><button type="button" data-cloud-supplier-edit="${e(row.id)}">수정</button></td></tr>`).join('')}</tbody></table></div>`:'<p>등록된 공급업체가 없습니다.</p>'}
      <div class="admin-filters">${cloudSupplierPage>1?'<button type="button" data-cloud-supplier-page="prev">이전</button>':''}<span>${cloudSupplierPage} / ${Math.max(1,Math.ceil(cloudSupplierTotal/20))}</span>${cloudSupplierPage*20<cloudSupplierTotal?'<button type="button" data-cloud-supplier-page="next">다음</button>':''}</div>
    </section>`;
}

document.addEventListener('submit',async event=>{
  if(event.target.id==='cloud-supplier-search'){
    event.preventDefault();cloudSupplierQuery=String(new FormData(event.target).get('query')||'').trim();cloudSupplierPage=1;cloudSupplierRows=null;render();return;
  }
  if(event.target.id!=='cloud-supplier-form')return;
  event.preventDefault();if(cloudSupplierBusy)return;
  const form=event.target,data=new FormData(form),id=form.dataset.id;
  const payload={company:data.get('company'),contactName:data.get('contactName'),email:data.get('email'),phone:data.get('phone'),notes:data.get('notes'),active:data.has('active'),productIds:data.getAll('productIds')};
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
});
