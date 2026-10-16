const cloudReplyCache=new Map(),cloudReplyLoading=new Set(),cloudReplyBusy=new Set(),cloudReplyNotice=new Map();
async function cloudReplyLoad(id=''){
 const key=id||'all';if(cloudReplyLoading.has(key))return;
 cloudReplyLoading.add(key);
 try{
  const response=await fetch('/api/mail/supplier-replies'+(id?'?requestId='+encodeURIComponent(id):''),{credentials:'same-origin',cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'회신을 불러오지 못했습니다.');
  cloudReplyCache.set(key,data);
 }catch(error){cloudReplyCache.set(key,{error:error.message});}
 finally{cloudReplyLoading.delete(key);if(location.hash.startsWith('#ops/requests?id='+id)||location.hash==='#ops/replies'||location.hash.startsWith('#ops/attention'))render();}
}
function cloudReplyItems(item){return item.replies.map(reply=>`<article class="cloud-reply-message"><div class="section-head"><div><h3>${e(reply.subject||'(제목 없음)')}</h3><p>${e(reply.sender)} · ${e(new Date(reply.receivedAt).toLocaleString('ko-KR'))}</p></div></div><pre class="cloud-reply-body">${e(reply.text||'텍스트 본문이 없습니다. Gmail에서 원본을 확인해 주세요.')}</pre>${reply.files.length?`<div class="cloud-reply-files"><b>첨부파일</b>${reply.files.map(file=>file.size>8*1024*1024?`<span>${e(file.name)} · 8MB 초과, Gmail에서 확인</span>`:`<a href="/api/mail/supplier-replies/file?${new URLSearchParams({requestId:item.requestId,replyId:reply.id,fileId:file.id})}">↓ ${e(file.name)} (${Math.ceil(file.size/1024)}KB)</a>`).join('')}</div>`:'<p class="member-help">첨부파일 없음</p>'}</article>`).join('');}
function cloudSupplierReplyPanel(id){
 const key=id,result=cloudReplyCache.get(key);if(!result&&!cloudReplyLoading.has(key))queueMicrotask(()=>cloudReplyLoad(id));
 const notice=cloudReplyNotice.get(key);
 return `<section class="member-panel cloud-supplier-replies"><div class="section-head"><div><h2>공급업체 회신</h2><p>발송한 Gmail 대화에서 업체 주소로 온 회신을 이 요청에 연결합니다.</p></div><button type="button" data-cloud-reply-sync="${e(id)}" ${cloudReplyBusy.has(key)?'disabled':''}>${cloudReplyBusy.has(key)?'회신 확인 중…':'회신 가져오기'}</button></div>${notice?`<p class="notice" role="status">${e(notice)}</p>`:''}${!result?'<p>회신 내역을 불러오고 있습니다.</p>':result.error?`<p role="alert">${e(result.error)}</p>`:result.requests[0]?.replies.length?cloudReplyItems(result.requests[0]):'<p>아직 연결된 회신이 없습니다. 업체가 답장을 보낸 뒤 회신 가져오기를 눌러 주세요.</p>'}<p class="member-help">발신 주소가 발송 수신자와 다른 메일은 자동 연결하지 않습니다. 그런 메일은 구글 메일 확인에서 직접 확인해 주세요.</p></section>`;
}
function cloudSupplierReplies(mode='replies'){
 const result=cloudReplyCache.get('all');if(!result&&!cloudReplyLoading.has('all'))queueMicrotask(()=>cloudReplyLoad());
 const attention=mode==='attention',notice=cloudReplyNotice.get('all');
 const rows=(result?.requests||[]).filter(item=>!attention||!item.replies.length);
 return `${adminHeading(attention?'미회신·발송 문제':'공급사 의뢰·회신',attention?'회신을 기다리는 요청을 확인하세요.':'업체 답장을 원래 견적 요청과 함께 확인하세요.')}<div class="admin-filters"><button type="button" data-cloud-reply-sync="" ${cloudReplyBusy.has('all')?'disabled':''}>${cloudReplyBusy.has('all')?'회신 확인 중…':'Gmail 회신 가져오기'}</button><a href="#ops/gmail">구글 메일 원본 확인 →</a></div>${notice?`<p class="notice" role="status">${e(notice)}</p>`:''}${!result?'<section class="admin-panel"><p>발송·회신 내역을 불러오고 있습니다.</p></section>':result.error?`<section class="admin-panel"><p role="alert">${e(result.error)}</p></section>`:rows.length?rows.map(item=>`<section class="admin-panel cloud-reply-case"><div class="section-head"><div><h2>${e(item.product||'제품')} · ${e(item.hospital||'병원명 미등록')}</h2><p>관리번호 ${e(item.requestId)} · 수신 ${e(item.recipient)} · ${e(new Date(item.sentAt).toLocaleString('ko-KR'))}</p></div><a href="#ops/requests?id=${encodeURIComponent(item.requestId)}">요청 상세 →</a></div><p class="cloud-reply-count">${item.replies.length?`회신 ${item.replies.length}건`:'회신 대기'}</p>${cloudReplyItems(item)}</section>`).join(''):`<section class="admin-panel"><p>${attention?'현재 회신 대기 중인 발송 내역이 없습니다.':'발송한 공급업체 메일이 없습니다.'}</p></section>`}<p class="member-help">최근 발송 내역 최대 100건을 표시하며, 회신 가져오기는 최근 20건의 Gmail 대화를 확인합니다. 자동 연결되지 않은 메일은 구글 메일 확인에서 원본을 확인해 주세요.</p>`;
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-cloud-reply-sync]');if(!button)return;
 const id=button.dataset.cloudReplySync||'',key=id||'all';if(cloudReplyBusy.has(key))return;
 cloudReplyBusy.add(key);cloudReplyNotice.delete(key);render();
 try{
  const response=await fetch('/api/mail/supplier-replies/sync',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:id})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'회신을 확인하지 못했습니다.');
  cloudReplyNotice.set(key,`발송 내역 ${data.checked}건을 확인했습니다. 새 회신 ${data.linked}건을 연결했습니다.${data.failed?' 확인하지 못한 발송 내역 '+data.failed+'건이 있습니다.':''}`);
  cloudReplyCache.delete(key);await cloudReplyLoad(id);
  if(id)memberCache.delete('admin/'+encodeURIComponent(id));
  memberCache.delete('admin/overview');render();
 }catch(error){cloudReplyNotice.set(key,error.message);render();}
 finally{cloudReplyBusy.delete(key);render();}
});
