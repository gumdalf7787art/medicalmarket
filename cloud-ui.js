let cloudCheckResult = null;
let cloudCheckBusy = false;
function cloudSetup() {
  return `${adminHeading('클라우드 연결', 'D1 데이터베이스와 두 R2 저장소의 연결을 확인합니다.')}
    <section class="admin-panel"><h2>Cloudflare 연결 설정</h2>
    <p>Pages 프로젝트 → Settings → Bindings에서 다음 세 가지를 추가하세요.</p>
    <div class="table-wrap"><table class="admin-table"><thead><tr><th>종류</th><th>변수 이름</th><th>연결할 저장소</th></tr></thead><tbody>
    <tr><td>D1</td><td>DB</td><td>medicalmarket-db</td></tr>
    <tr><td>R2</td><td>MEDIA</td><td>medicalmarket-assets</td></tr>
    <tr><td>R2</td><td>PRIVATE_FILES</td><td>medicalmarket-private</td></tr></tbody></table></div>
    ${cloudMode&&!cloudAuthenticated?cloudLoginPanel():`<form id="cloud-check"><button class="primary" ${cloudCheckBusy?'disabled':''}>${cloudCheckBusy?'연결 확인 중…':'D1·R2 읽기·쓰기 확인'}</button></form>`}
    <div>${cloudStorageStatus?Object.entries(cloudStorageStatus.checks).map(([key,ok])=>`<p>${e(key)}: ${ok?'연결 확인':'연결 확인 필요'}</p>`).join(''):''}</div>
    <div role="status" aria-live="polite">${cloudCheckResult?.error?`<p class="notice warn">${e(cloudCheckResult.error)}</p>`:''}${(cloudCheckResult?.result||[]).map(item=>`<p class="notice ${item.ok?'':'warn'}"><strong>${item.ok?'✓':'!'} ${e(item.name)}</strong> · ${e(item.message)}</p>`).join('')}</div>
    <p class="mail-help">점검용 데이터와 파일만 만들고 삭제합니다. 기존 자료를 가져오거나 공개하지 않습니다.</p></section>
    <section class="admin-panel"><h2>현재 연결 범위</h2><p>배포된 홈페이지의 제품 정보는 D1, 제품 사진은 R2에 저장됩니다. 운영자 로그인 후 제품 등록 및 수정 메뉴를 사용하세요. 회원·견적·카테고리는 아직 서버 저장 전환 전이며 Gmail도 별도 연결이 필요합니다.</p></section>`;
}
document.addEventListener('submit', async event => {
  if(event.target.id !== 'cloud-check') return;
  event.preventDefault();
  if(cloudCheckBusy) return;
  cloudCheckBusy = true; cloudCheckResult = null; render();
  try {
    const response = await fetch('/api/cloud/check', { method:'POST',  signal:AbortSignal.timeout(30000) });
    if(!response.headers.get('content-type')?.includes('application/json')) throw Error('Unexpected response');
    cloudCheckResult = await response.json();
  } catch { cloudCheckResult = { error:'연결을 확인하지 못했습니다. 배포된 홈페이지에서 실행하고 Functions 배포 상태를 확인해 주세요.' }; }
  finally { cloudCheckBusy = false; if(location.hash === '#ops/cloud') render(); }
});
