const cloudReplyCache=new Map(),cloudReplyLoading=new Set(),cloudReplyBusy=new Set(),cloudReplyNotice=new Map();
let cloudReplyUnread=0,cloudReplyWatchStarted=false,cloudReplyAutoBusy=false,cloudReplyLastAuto=0,cloudReplyAutoError='';
async function cloudReplyRefreshSummary(){
 try{
  const response=await fetch('/api/mail/supplier-replies/summary',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)return;
  const data=await response.json(),next=Number(data.unread||0);
  if(next!==cloudReplyUnread){cloudReplyUnread=next;cloudReplyCache.clear();for(const key of memberCache.keys())if(key.startsWith('admin'))memberCache.delete(key);if(location.hash.startsWith('#ops'))render();}
 }catch{/* A temporary connection error must not interrupt other admin work. */}
}
async function cloudReplyAutoSync(){
 if(cloudReplyAutoBusy||!cloudMode||!cloudAuthenticated||!location.hash.startsWith('#ops')||document.visibilityState==='hidden')return;
 cloudReplyAutoBusy=true;cloudReplyLastAuto=Date.now();
 try{
  const response=await fetch('/api/mail/supplier-replies/sync',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(90000)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Gmail 자동 확인에 실패했습니다.');
  cloudReplyAutoError='';
  if(data.linked){cloudReplyCache.clear();memberCache.delete('admin/overview');cloudReplyNotice.set('all',`새 공급업체 회신 ${data.linked}건이 도착했습니다.`);}
  await cloudReplyRefreshSummary();
  if(data.linked&&location.hash.startsWith('#ops'))render();
 }catch(error){cloudReplyAutoError=error.message;if(location.hash==='#ops/replies')render();}
 finally{cloudReplyAutoBusy=false;}
}
function cloudReplyEnsureWatch(){
 if(cloudReplyWatchStarted)return;cloudReplyWatchStarted=true;
 queueMicrotask(()=>cloudReplyRefreshSummary());
 setTimeout(()=>cloudReplyAutoSync(),2500);
 setInterval(()=>{if(cloudMode&&cloudAuthenticated&&location.hash.startsWith('#ops')&&document.visibilityState!=='hidden'){
  cloudReplyRefreshSummary();if(Date.now()-cloudReplyLastAuto>=5*60000)cloudReplyAutoSync();
 }},60000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloudMode&&cloudAuthenticated&&location.hash.startsWith('#ops')){
  cloudReplyRefreshSummary();if(Date.now()-cloudReplyLastAuto>=5*60000)cloudReplyAutoSync();
 }});
}
function cloudReplyDashboardNotice(){return cloudReplyUnread>0?`<a class="cloud-reply-alert" href="#ops/replies" role="status">새 공급업체 회신 <strong>${cloudReplyUnread}건</strong>이 도착했습니다. 확인하기 →</a>`:'';}
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
function cloudReplyItems(item){return item.replies.map(reply=>`<article class="cloud-reply-message ${reply.seen?'':'cloud-reply-new'}"><div class="section-head"><div><h3>${reply.seen?'':'<span class="cloud-reply-new-label">새 회신</span> '}${e(reply.subject||'(제목 없음)')}</h3><p>${e(reply.sender)} · ${e(new Date(reply.receivedAt).toLocaleString('ko-KR'))}</p></div>${reply.seen?'':`<button type="button" data-cloud-reply-seen="${e(reply.id)}" data-cloud-reply-request="${e(item.requestId)}">확인 완료</button>`}</div><pre class="cloud-reply-body">${e(reply.text||'텍스트 본문이 없습니다. Gmail에서 원본을 확인해 주세요.')}</pre>${reply.files.length?`<div class="cloud-reply-files"><b>첨부파일</b>${reply.files.map(file=>file.size>8*1024*1024?`<span>${e(file.name)} · 8MB 초과, Gmail에서 확인</span>`:`<a href="/api/mail/supplier-replies/file?${new URLSearchParams({requestId:item.requestId,replyId:reply.id,fileId:file.id})}">↓ ${e(file.name)} (${Math.ceil(file.size/1024)}KB)</a>`).join('')}</div>`:'<p class="member-help">첨부파일 없음</p>'}</article>`).join('');}
function cloudSupplierReplyPanel(id){
 const key=id,result=cloudReplyCache.get(key);if(!result&&!cloudReplyLoading.has(key))queueMicrotask(()=>cloudReplyLoad(id));
 const notice=cloudReplyNotice.get(key);
 return `<section class="member-panel cloud-supplier-replies"><div class="section-head"><div><h2>공급업체 회신</h2><p>운영 화면을 열어 두면 약 5분 간격으로 Gmail 회신을 자동 확인합니다.</p></div><button type="button" data-cloud-reply-sync="${e(id)}" ${cloudReplyBusy.has(key)?'disabled':''}>${cloudReplyBusy.has(key)?'회신 확인 중…':'지금 확인'}</button></div>${notice?`<p class="notice" role="status">${e(notice)}</p>`:''}${!result?'<p>회신 내역을 불러오고 있습니다.</p>':result.error?`<p role="alert">${e(result.error)}</p>`:result.requests[0]?.replies.length?cloudReplyItems(result.requests[0]):'<p>아직 연결된 회신이 없습니다. 자동 확인 중이며, 필요하면 지금 확인을 누르세요.</p>'}<p class="member-help">발신 주소가 발송 수신자와 다른 메일은 자동 연결하지 않습니다. 그런 메일은 구글 메일 확인에서 직접 확인해 주세요.</p></section>`;
}
function cloudSupplierReplies(mode='replies'){
 const result=cloudReplyCache.get('all');if(!result&&!cloudReplyLoading.has('all'))queueMicrotask(()=>cloudReplyLoad());
 const attention=mode==='attention',notice=cloudReplyNotice.get('all');
 const rows=(result?.requests||[]).filter(item=>!attention||!item.replies.length);
 return `${adminHeading(attention?'미회신·발송 문제':'공급사 의뢰·회신',attention?'회신을 기다리는 요청을 확인하세요.':'새 회신은 왼쪽 메뉴에 건수로 표시됩니다.')}<div class="admin-filters"><button type="button" data-cloud-reply-sync="" ${cloudReplyBusy.has('all')?'disabled':''}>${cloudReplyBusy.has('all')?'회신 확인 중…':'지금 회신 확인'}</button><a href="#ops/gmail">구글 메일 원본 확인 →</a></div><p class="member-help">운영 화면이 열려 있으면 약 5분마다 자동 확인합니다.${cloudReplyAutoError?` <span role="alert">최근 자동 확인 실패: ${e(cloudReplyAutoError)}</span>`:''}</p>${notice?`<p class="notice" role="status">${e(notice)}</p>`:''}${!result?'<section class="admin-panel"><p>발송·회신 내역을 불러오고 있습니다.</p></section>':result.error?`<section class="admin-panel"><p role="alert">${e(result.error)}</p></section>`:rows.length?rows.map(item=>`<section class="admin-panel cloud-reply-case"><div class="section-head"><div><h2>${e(item.product||'제품')} · ${e(item.hospital||'병원명 미등록')}</h2><p>관리번호 ${e(item.requestId)} · 수신 ${e(item.recipient)} · ${e(new Date(item.sentAt).toLocaleString('ko-KR'))}</p></div><a href="#ops/requests?id=${encodeURIComponent(item.requestId)}">요청 상세 →</a></div><p class="cloud-reply-count">${item.replies.length?`회신 ${item.replies.length}건`:'회신 대기'}</p>${cloudReplyItems(item)}</section>`).join(''):`<section class="admin-panel"><p>${attention?'현재 회신 대기 중인 발송 내역이 없습니다.':'발송한 공급업체 메일이 없습니다.'}</p></section>`}<p class="member-help">최근 발송 내역 최대 100건을 표시하며, 자동 확인은 최근 20건의 Gmail 대화를 확인합니다. 자동 연결되지 않은 메일은 구글 메일 확인에서 원본을 확인해 주세요.</p>`;
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-cloud-reply-seen]');if(!button)return;
 const replyId=button.dataset.cloudReplySeen,requestId=button.dataset.cloudReplyRequest;button.disabled=true;
 try{
  const response=await fetch('/api/mail/supplier-replies/seen',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({replyId})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'확인 상태를 저장하지 못했습니다.');
  for(const result of cloudReplyCache.values())for(const item of result.requests||[])for(const reply of item.replies||[])if(reply.id===replyId)reply.seen=true;
  for(const [key,result] of memberCache)if(key.startsWith('admin'))for(const row of [...(result.requests||[]),...(result.recent||[]),...(result.pending||[]),...(result.request?[result.request]:[])])if(row.id===requestId)row.supplierReplyUnread=Math.max(0,Number(row.supplierReplyUnread||0)-1);
  cloudReplyUnread=Math.max(0,cloudReplyUnread-1);
  await cloudReplyRefreshSummary();render();
 }catch(error){button.disabled=false;cloudReplyNotice.set('all',error.message);render();}
});
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-cloud-reply-sync]');if(!button)return;
 const id=button.dataset.cloudReplySync||'',key=id||'all';if(cloudReplyBusy.has(key))return;
 cloudReplyBusy.add(key);cloudReplyNotice.delete(key);render();
 try{
  const response=await fetch('/api/mail/supplier-replies/sync',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:id})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'회신을 확인하지 못했습니다.');
  cloudReplyNotice.set(key,`발송 내역 ${data.checked}건을 확인했습니다. 새 회신 ${data.linked}건을 연결했습니다.${data.failed?' 확인하지 못한 발송 내역 '+data.failed+'건이 있습니다.':''}`);
  cloudReplyCache.delete(key);await cloudReplyLoad(id);await cloudReplyRefreshSummary();
  if(id)memberCache.delete('admin/'+encodeURIComponent(id));
  memberCache.delete('admin/overview');render();
 }catch(error){cloudReplyNotice.set(key,error.message);render();}
 finally{cloudReplyBusy.delete(key);render();}
});
