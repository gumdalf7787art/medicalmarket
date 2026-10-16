let socialCompletionStarted=false,authMembersBootstrap=false;
let authUser=null,authReady=false,authProviders={},authEmailReady=false,authNotice='',authBusy=false,authMembers=null,authMembersNext=null,authMemberOffset=0,authMemberQuery='',authBootstrap=false,authLegacyView=false,authLegacyTotal=0,authLegacyCredentials=0,authMemberTotal=0;
async function authFetch(path,data){const response=await fetch('/api/auth/'+path,{credentials:'same-origin',cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error||'로그인 처리에 실패했습니다.');return result;}
function authConsent(){return `<label class="auth-consent"><input type="checkbox" name="consent" required> <span>개인정보 수집·이용에 동의합니다. (필수)</span></label><details><summary>수집·이용 내용 보기</summary><p>회원 식별 및 서비스 이용을 위해 이름, 이메일, 로그인 제공자의 회원 식별값을 수집합니다. 이메일 가입 시 비밀번호는 복원이 불가능한 해시 형태로 저장합니다. 회원 탈퇴 시 삭제하며, 법령에 따라 보관해야 하는 자료는 해당 기간 동안 별도로 보관합니다.</p></details>`;}
function authPage(mode='login'){
 const [view,query='']=mode.split('?'),params=new URLSearchParams(query),token=params.get('token')||'';
 if(view==='social'){
  if(!socialCompletionStarted){socialCompletionStarted=true;queueMicrotask(completePendingSocial);}
  return `<section class="auth-page"><div class="auth-card"><p role="status">${e(authNotice||'로그인을 마치고 홈으로 이동하고 있습니다.')}</p>${authNotice?'<a href="#auth/login">로그인 다시 하기</a>':''}</div></section>`;
 }
 const title={login:'로그인',signup:'회원가입',forgot:'비밀번호 찾기',reset:'새 비밀번호 설정',verify:'이메일 확인',legacy:'기존 회원 계정 사용하기','legacy-activate':'기존 회원 비밀번호 설정'}[view]||'로그인';
 const providers=()=>`<div class="auth-social">${['kakao','naver'].map(provider=>`<a class="auth-${provider} ${authProviders[provider]?'':'is-unavailable'}" ${authProviders[provider]?'href="/api/auth/oauth/'+provider+'/start"':'aria-disabled="true"'}>${provider==='kakao'?'카카오':'네이버'}로 ${view==='signup'?'가입하기':'계속하기'}${authProviders[provider]?'':' · 준비 중'}</a>`).join('')}</div>`;
 let fields='';
 if(['login','signup','forgot','legacy'].includes(view))fields+='<label>이메일<input type="email" name="email" autocomplete="email" required maxlength="254" placeholder="이메일 주소"></label>';
 if(['signup'].includes(view))fields+='<label>이름<input name="name" autocomplete="name" maxlength="80" required placeholder="이름 또는 이용할 표시 이름"></label>';
 if(['login','signup','reset','legacy-activate'].includes(view))fields+=`<label>비밀번호<input name="password" type="password" required minlength="${view==='login'?1:12}" maxlength="${view==='login'?255:128}" autocomplete="${view==='login'?'current-password':'new-password'}" placeholder="${view==='login'?'비밀번호':'12자 이상'}"></label>`;
 if(['signup','reset','legacy-activate'].includes(view))fields+='<label>비밀번호 확인<input name="passwordConfirm" type="password" required minlength="12" autocomplete="new-password"></label>';
 if(['signup','legacy-activate'].includes(view))fields+=authConsent();
 if(['verify','reset','legacy-activate'].includes(view))fields+=`<input type="hidden" name="token" value="${e(token)}">`;
 if(view==='verify')return '<section class="auth-page"><div class="auth-card"><h1>이메일 인증이 필요하지 않습니다.</h1><a href="#auth/login">로그인하기</a></div></section>';
 return `<section class="auth-page"><div class="auth-card"><p class="auth-eyebrow">MEDICAL MARKET</p><h1>${title}</h1><p>하나의 계정으로 제품 탐색과 견적 요청을 이용하세요.</p>${['login','signup'].includes(view)?providers()+'<div class="auth-divider">이메일로 이용하기</div>':''}${view==='legacy'?'<p>예전에 등록한 이메일과 비밀번호가 있다면 로그인 화면에서 바로 이용할 수 있습니다. 비밀번호가 없다면 이메일 확인 링크로 연결해 주세요.</p>':''}${view==='legacy-activate'?'<p>새 비밀번호를 설정하면 기존 회원 정보가 연결되고 로그인됩니다. 같은 이메일로 가입한 계정이 있다면 그 계정의 비밀번호가 변경됩니다.</p>':''}<form id="member-auth" data-action="${e(view)}">${fields}<p class="auth-message" role="status">${e(authNotice||params.get('error')||'')}</p><button class="primary" ${authBusy?'disabled':''}>${authBusy?'처리 중…':title}</button></form><div class="auth-links"><a href="#auth/login">로그인</a><a href="#auth/signup">회원가입</a><a href="#auth/forgot">비밀번호 찾기</a><a href="#auth/legacy">기존 회원 계정 사용하기</a></div>${!authEmailReady&&['forgot','legacy'].includes(view)?'<p class="auth-hint">계정 확인 메일 발신 설정을 준비 중입니다. 설정 전에는 운영자에게 문의해 주세요.</p>':''}<p class="auth-hint">신규 회원은 이메일 인증 없이 가입됩니다. 기존 회원도 이전 이메일과 비밀번호로 로그인할 수 있습니다. 운영자 권한은 별도로 지정합니다.</p></div></section>`;
}
function accountPage(){if(!authReady)return '<section class="auth-page">계정 확인 중…</section>';if(!authUser)return authPage();return `<section class="auth-page"><div class="auth-card"><h1>내 계정</h1><p><strong>${e(authUser.name)}</strong>님, 반갑습니다.</p><dl><dt>이메일</dt><dd>${e(authUser.displayEmail||'SNS 제공 이메일 없음')}</dd>${authUser.legacyName?'<dt>이전 회원 정보</dt><dd>'+e(authUser.legacyName)+' · 연결 완료</dd>':''}<dt>회원 권한</dt><dd>${authUser.role==='admin'?'운영자':'사용자'}</dd></dl><div class="auth-links">${authUser.role==='admin'?'<a href="#ops">운영 관리 →</a>':''}<a href="#catalog">제품 탐색 →</a><button type="button" data-member-logout>로그아웃</button></div></div></section>`;}
function authGate(){if(!authReady)return '<section class="auth-page">계정 확인 중…</section>';return `<section class="auth-page"><div class="auth-card"><h1>운영자 전용 화면</h1><p>${authUser?'지정된 운영자 계정만 이용할 수 있습니다.':'운영자로 지정된 계정으로 로그인해 주세요.'}</p><a class="primary" href="#auth/login">로그인</a><a href="#home">홈으로 돌아가기</a>${authBootstrap&&!authUser?'<details><summary>기존 운영자 연결</summary>'+cloudLoginPanel()+'</details>':''}</div></section>`;}
async function loadAuthMembers(){try{const result=await authFetch('members?legacy='+(authLegacyView?'1':'0')+'&offset='+authMemberOffset+'&q='+encodeURIComponent(authMemberQuery));authMembersBootstrap=!!result.bootstrapAvailable;authMembers=result.members;authMembersNext=result.next;if(authLegacyView){authLegacyTotal=result.total||0;authLegacyCredentials=result.credentials||0;}else authMemberTotal=result.total||0;}catch(error){authNotice=error.message;authMembers=[];}if(location.hash==='#ops/members')render();}
function memberManagement(){
 if(authMembers===null){authMembers=[];queueMicrotask(loadAuthMembers);}
 const canImport=authUser?.owner||(!authUser&&authBootstrap&&cloudAuthenticated);
 const heading=adminHeading('회원 관리','사용자와 지정된 운영자 계정을 관리합니다.');
 const legacyNotice=authLegacyView?`<p>이전 회원 ${authLegacyTotal}명 · 기존 비밀번호 연결 ${authLegacyCredentials}명 · 이전 이메일과 비밀번호로 로그인하면 정보가 연결됩니다. 권한은 자동 이전하지 않습니다.</p>`:`<p>가입 회원 ${authMemberTotal}명</p>`;
 const rows=authMembers.map((u,index)=>{
  const role=authLegacyView?'이전 회원':u.role==='admin'?'운영자':'사용자';
  const action=!authLegacyView&&authUser?.owner&&u.id!==authUser.id?`<button type="button" data-member-role="${e(u.id)}" data-role="${u.role==='admin'?'user':'admin'}">${u.role==='admin'?'사용자로 변경':'운영자로 변경'}</button>`:!authLegacyView&&authMembersBootstrap?`<button type="button" data-member-first-admin="${e(u.id)}">최초 운영자로 지정</button>`:'';
  const status=authLegacyView?(u.claimed_by?'연결 완료':'계정 미연결'):u.email?(u.verified?'이메일 가입':'이메일 가입 · 확인 전'):'SNS 가입';
  const date=!authLegacyView&&u.created_at?new Date(u.created_at).toLocaleDateString('ko-KR'):'—';
  return `<tr><td>${authLegacyView?'—':authMemberOffset+index+1}</td><td>${e(u.name)}</td><td>${e(u.email||u.socialEmail||'SNS 제공 이메일 없음')}</td><td>${date}</td><td>${role} ${action}</td><td>${status}</td></tr>`;
 }).join('');
 return `${heading}<section class="admin-panel">${canImport?'<details><summary>기존 회원 정보 가져오기</summary><p>이전 회원 이름·이메일 파일을 가져옵니다.</p><input type="file" id="legacy-members-file" accept="application/json"><p id="legacy-members-result" role="status"></p></details>':''}${authUser?.owner?'<details><summary>기존 회원 비밀번호 연결</summary><p>비공개 이전 파일만 선택해 주세요. 비밀번호 해시는 공개 저장소에 저장하지 않습니다.</p><input type="file" id="legacy-credentials-file" accept="application/json"><p id="legacy-credentials-result" role="status"></p></details>':''}<div class="auth-links"><button data-member-view="current">로그인 회원</button><button data-member-view="legacy">이전 회원 정보</button></div>${legacyNotice}<form id="member-search" class="admin-search"><input name="query" placeholder="이메일 또는 이름 검색" value="${e(authMemberQuery)}"><button>검색</button></form><p role="status">${e(authNotice)}</p><div class="table-wrap"><table class="admin-table"><thead><tr><th>순번</th><th>이름</th><th>이메일</th><th>가입일</th><th>권한</th><th>계정 상태</th></tr></thead><tbody>${rows}</tbody></table></div><div class="auth-links">${authMemberOffset?'<button data-member-prev>이전</button>':''}${authMembersNext!==null?'<button data-member-next>다음</button>':''}</div><p>운영자 권한 변경은 최초 운영자 본인만 할 수 있으며 변경 후 해당 회원은 다시 로그인해야 합니다. SNS 이메일은 제공자가 허용한 경우에 표시됩니다.</p></section>`;
}
function adoptAuthUser(user){
 authUser=user;cloudAuthenticated=user?.role==='admin';authMembers=null;
 // Preserve older local work, but never silently assign it to a newly logged-in member.
 KEY=!user&&authBootstrap?'medicalmarket-public-demo-v1':'medicalmarket-account-v1:'+ (user?.id||'guest');state=defaultState();
 try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved&&Array.isArray(saved.requests)&&Array.isArray(saved.cart))state=saved;}catch{}
 resetMemberData();
}

document.addEventListener('submit',async event=>{
 if(event.target.id==='member-search'){event.preventDefault();authMemberQuery=String(new FormData(event.target).get('query')||'');authMemberOffset=0;await loadAuthMembers();return;}
 if(event.target.id!=='member-auth')return;event.preventDefault();if(authBusy)return;
 const form=event.target,data=Object.fromEntries(new FormData(form));data.consent=data.consent==='on';if(data.passwordConfirm!==undefined&&data.passwordConfirm!==data.password){authNotice='비밀번호가 일치하지 않습니다.';form.querySelector('[role=status]').textContent=authNotice;return;}
 authBusy=true;form.querySelector('button').disabled=true;authNotice='';
 try{const result=await authFetch(form.dataset.action,data);if(result.user){adoptAuthUser(result.user);await cloudLoadProducts();location.hash='#home';}else{authNotice=result.message||'완료했습니다.';if(form.dataset.action==='reset')location.hash='#auth/login';}}
 catch(error){authNotice=error.message;}finally{authBusy=false;render();}
});
document.addEventListener('click',async event=>{
 const logout=event.target.closest('[data-member-logout]'),role=event.target.closest('[data-member-role]');
 try{
  const firstAdmin=event.target.closest('[data-member-first-admin]');if(firstAdmin&&confirm('선택한 회원을 최초 운영자로 지정할까요? 이 기능은 한 번만 사용할 수 있습니다.')){await authFetch('bootstrap-admin',{id:firstAdmin.dataset.memberFirstAdmin});await loadAuthMembers();toast('운영자로 지정했습니다. 해당 계정으로 다시 로그인해 주세요.');}
  const view=event.target.closest('[data-member-view]');if(view){authLegacyView=view.dataset.memberView==='legacy';authMemberOffset=0;await loadAuthMembers();}
  if(logout){await authFetch('logout',{});await cloudRequest('session',{method:'DELETE'});adoptAuthUser(null);await cloudLoadProducts();location.hash='#home';render();}
  if(role&&confirm('정말 이 회원을 '+(role.dataset.role==='admin'?'운영자':'사용자')+'로 변경하시겠습니까? 변경하면 해당 회원은 다시 로그인해야 합니다.')){await authFetch('role',{id:role.dataset.memberRole,role:role.dataset.role});await loadAuthMembers();toast('회원 권한을 변경했습니다.');}
  if(event.target.closest('[data-member-next]')){authMemberOffset=authMembersNext;await loadAuthMembers();}
  if(event.target.closest('[data-member-prev]')){authMemberOffset=Math.max(0,authMemberOffset-50);await loadAuthMembers();}
 }catch(error){toast(error.message);}
});
window.addEventListener('hashchange',()=>{authNotice='';if(location.hash!=='#auth/social')socialCompletionStarted=false;});

document.addEventListener('change',async event=>{
 if(event.target.id!=='legacy-members-file')return;
 const input=event.target,file=input.files?.[0],status=document.getElementById('legacy-members-result');if(!file)return;
 input.disabled=true;
 try{if(file.size>2000000)throw Error('2MB 이하의 이전 파일을 선택해 주세요.');const data=JSON.parse(await file.text());if(!Array.isArray(data.members)||data.members.length>10000)throw Error('회원 이전 파일 형식을 확인해 주세요.');let count=0;for(let i=0;i<data.members.length;i+=20){const members=data.members.slice(i,i+20).map(row=>({email:row.email,name:row.name}));await authFetch('legacy-import',{members});count+=members.length;status.textContent=count+'명 처리 중…';}status.textContent=count+'명 이전 정보를 저장했습니다. 기존 비밀번호와 권한은 이전하지 않습니다.';}catch(error){status.textContent=error.message;}finally{input.disabled=false;input.value='';}
});
document.addEventListener('change',async event=>{
 if(event.target.id!=='legacy-credentials-file')return;
 const input=event.target,file=input.files?.[0],status=document.getElementById('legacy-credentials-result');if(!file)return;
 input.disabled=true;
 try{
  if(file.size>2000000)throw Error('2MB 이하의 비공개 파일을 선택해 주세요.');
  const data=JSON.parse(await file.text());if(!Array.isArray(data.members)||data.members.length>10000)throw Error('기존 비밀번호 파일 형식을 확인해 주세요.');
  let count=0;for(let i=0;i<data.members.length;i+=20){await authFetch('legacy-credentials-import',{members:data.members.slice(i,i+20)});count+=Math.min(20,data.members.length-i);status.textContent=count+'명 처리 중…';}
  status.textContent=count+'명의 기존 비밀번호 정보를 연결했습니다.';
 }catch(error){status.textContent=error.message;}finally{input.disabled=false;input.value='';}
});

async function completePendingSocial(){
 try{
  const session=await authFetch('session');
  const result=session.user?session:await authFetch('social',{});
  if(!result.user)throw Error('SNS 로그인을 다시 진행해 주세요.');
  adoptAuthUser(result.user);location.hash='#home';render();
 }catch(error){authNotice='로그인 시간이 만료되었거나 연결을 완료하지 못했습니다. 로그인 화면에서 다시 시작해 주세요.';if(location.hash==='#auth/social')render();}
}
