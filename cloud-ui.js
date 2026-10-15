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
    <p>Variables and secrets에서 CLOUD_ADMIN_KEY를 Secret으로 추가한 뒤 재배포하세요. 키는 영문·숫자를 섞은 24자 이상의 별도 값으로 정하세요.</p>
    <form id="cloud-check"><label for="cloud-key">관리자 연결 키</label><input id="cloud-key" name="key" type="password" autocomplete="off" minlength="24" required placeholder="Cloudflare에 설정한 연결 키"><p class="mail-help">Gmail 앱 비밀번호가 아닙니다. 입력한 키는 브라우저에 저장하지 않습니다.</p>
    <button class="primary" ${cloudCheckBusy?'disabled':''}>${cloudCheckBusy?'연결 확인 중…':'D1·R2 연결 확인'}</button></form>
    <div role="status" aria-live="polite">${cloudCheckResult?.error?`<p class="notice warn">${e(cloudCheckResult.error)}</p>`:''}${(cloudCheckResult?.result||[]).map(item=>`<p class="notice ${item.ok?'':'warn'}"><strong>${item.ok?'✓':'!'} ${e(item.name)}</strong> · ${e(item.message)}</p>`).join('')}</div>
    <p class="mail-help">점검용 데이터와 파일만 만들고 삭제합니다. 기존 자료를 가져오거나 공개하지 않습니다.</p></section>
    <section class="admin-panel"><h2>현재 연결 범위</h2><p>이 페이지는 저장소 연결을 검증합니다. 제품·회원·견적의 실제 저장은 아직 브라우저 방식이며, 업무별 서버 저장과 로그인·권한 연결은 다음 작업입니다. Gmail 기능도 별도 서버 연결이 필요합니다.</p></section>`;
}
document.addEventListener('submit', async event => {
  if(event.target.id !== 'cloud-check') return;
  event.preventDefault();
  if(cloudCheckBusy) return;
  const key = String(new FormData(event.target).get('key') || '').trim();
  cloudCheckBusy = true; cloudCheckResult = null; render();
  try {
    const response = await fetch('/api/cloud/check', { method:'POST', headers:{Authorization:'Bearer '+key}, signal:AbortSignal.timeout(30000) });
    if(!response.headers.get('content-type')?.includes('application/json')) throw Error('Unexpected response');
    cloudCheckResult = await response.json();
  } catch { cloudCheckResult = { error:'연결을 확인하지 못했습니다. 배포된 홈페이지에서 실행하고 Functions 배포 상태를 확인해 주세요.' }; }
  finally { cloudCheckBusy = false; if(location.hash === '#ops/cloud') render(); }
});
