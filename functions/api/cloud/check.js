import { authenticated } from '../../../server/cloud.js';
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export async function onRequestPost({ request, env }) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: '같은 홈페이지에서 실행해 주세요.' }, 403);
  if (!await authenticated(request,env)) return json({ error: '운영자 로그인이 필요합니다.' },401);
  const result = [];
  const id = crypto.randomUUID();
  if (!env.DB) result.push({ name: 'D1 데이터베이스', ok: false, message: 'DB 바인딩이 없습니다.' });
  else {
    let error;
    try {
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_connection_checks (id TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
      await env.DB.prepare('INSERT INTO mm_connection_checks (id, value) VALUES (?, ?)').bind(id, 'connection-ok').run();
      const row = await env.DB.prepare('SELECT value FROM mm_connection_checks WHERE id = ?').bind(id).first();
      if (row?.value !== 'connection-ok') throw Error();
    } catch { error = '읽기·쓰기 확인에 실패했습니다. 바인딩과 D1 상태를 확인해 주세요.'; }
    finally {
      try { await env.DB.prepare('DELETE FROM mm_connection_checks WHERE id = ?').bind(id).run(); }
      catch { error = '점검 데이터 정리에 실패했습니다. D1 상태를 확인해 주세요.'; }
    }
    result.push({ name: 'D1 데이터베이스', ok: !error, message: error || '저장·조회·점검 데이터 삭제 완료' });
  }
  for (const [binding, name] of [['MEDIA', 'R2 제품 자료'], ['PRIVATE_FILES', 'R2 비공개 자료']]) {
    const bucket = env[binding];
    if (!bucket) { result.push({ name, ok: false, message: binding + ' 바인딩이 없습니다.' }); continue; }
    const key = '_connection-checks/' + id + '.txt';
    let error;
    try {
      await bucket.put(key, 'connection-ok', { httpMetadata: { contentType: 'text/plain' } });
      const object = await bucket.get(key);
      if (!object || await object.text() !== 'connection-ok') throw Error();
    } catch { error = '읽기·쓰기 확인에 실패했습니다. R2 연결을 확인해 주세요.'; }
    finally {
      try { await bucket.delete(key); } catch { error = '점검 파일 정리에 실패했습니다. R2 상태를 확인해 주세요.'; }
    }
    result.push({ name, ok: !error, message: error || '파일 저장·읽기·점검 파일 삭제 완료' });
  }
  return json({ ok: result.every(item => item.ok), result });
}

export function onRequestGet() { return json({ error: '운영 화면의 클라우드 연결 메뉴에서 확인해 주세요.' }, 405); }
