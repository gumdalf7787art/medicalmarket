import {json,failure,bodyJson,sameOrigin,equal} from './cloud.js';

const enc=new TextEncoder();
export const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export const cookie=(name,value,seconds)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
export const readCookie=(request,name)=>request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
export function emailValue(value){const email=String(value||'').trim().toLowerCase();if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw failure('이메일 주소를 확인해 주세요.');return email;}
export async function authSchema(env){
 if(!env.DB)throw failure('회원 데이터베이스 연결이 필요합니다.',503);
 await env.DB.batch([
  env.DB.prepare(`CREATE TABLE IF NOT EXISTS mm_users(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT NOT NULL,password TEXT,role TEXT NOT NULL DEFAULT 'user',verified INTEGER NOT NULL DEFAULT 0,disabled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,consent_at TEXT NOT NULL)`),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_sessions_user ON mm_sessions(user_id)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(provider,subject))'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_auth_tokens(hash TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,expires INTEGER NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_auth_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_auth_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,target TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_legacy_members(email TEXT PRIMARY KEY,name TEXT NOT NULL,claimed_by TEXT,imported_at TEXT NOT NULL)')
 ]);
}
export function publicUser(user,env){if(!user)return null;return {id:user.id,email:user.email||'',name:user.name,role:user.role,legacyName:user.legacyName||'',owner:user.role==='admin'&&!!env.OWNER_USER_ID&&user.id===env.OWNER_USER_ID};}
export async function currentUser(request,env){
 const token=readCookie(request,'mm_session');if(!/^[a-f0-9]{64}$/.test(token))return null;await authSchema(env);
 return env.DB.prepare('SELECT u.*,l.name AS legacyName FROM mm_sessions s JOIN mm_users u ON u.id=s.user_id LEFT JOIN mm_legacy_members l ON l.claimed_by=u.id WHERE s.hash=? AND s.expires>? AND u.disabled=0').bind(await digest(token),Date.now()).first();
}
export async function userRequired(request,env){const user=await currentUser(request,env);if(!user)throw failure('로그인이 필요합니다.',401);return user;}
export async function limit(request,env,scope,max=8){
 const now=Date.now(),key=await digest(scope+':'+(request.headers.get('CF-Connecting-IP')||'local'));
 await env.DB.prepare('DELETE FROM mm_auth_limits WHERE expires<?').bind(now).run();
 const row=await env.DB.prepare('INSERT INTO mm_auth_limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,now+15*60000).first();
 if(row.count>max)throw failure('시도가 많습니다. 15분 후 다시 시도해 주세요.',429);
}
export async function hashPassword(password,salt=random()){
 if(typeof password!=='string'||password.length<12||password.length>128)throw failure('비밀번호는 12~128자로 입력해 주세요.');
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 // Workers Web Crypto permits at most 100,000 iterations. Version the format for future upgrades.
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},key,256);
 return 'pbkdf2-sha256:100000:'+salt+':'+Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function sessionResponse(user,env){const token=random();await env.DB.prepare('DELETE FROM mm_sessions WHERE expires<?').bind(Date.now()).run();await env.DB.prepare('INSERT INTO mm_sessions(hash,user_id,expires) VALUES (?,?,?)').bind(await digest(token),user.id,Date.now()+86400000).run();return json({user:publicUser(user,env)},200,{'Set-Cookie':cookie('mm_session',token,86400)});}
export async function putToken(env,kind,payload,minutes=30){const token=random();await env.DB.prepare('DELETE FROM mm_auth_tokens WHERE expires<?').bind(Date.now()).run();await env.DB.prepare('INSERT INTO mm_auth_tokens(hash,kind,payload,expires) VALUES (?,?,?,?)').bind(await digest(token),kind,JSON.stringify(payload),Date.now()+minutes*60000).run();return token;}
export async function takeToken(env,token,kind){if(!/^[a-f0-9]{64}$/.test(token||''))throw failure('유효하지 않은 인증 요청입니다.');const row=await env.DB.prepare('DELETE FROM mm_auth_tokens WHERE hash=? AND kind=? AND expires>? RETURNING payload').bind(await digest(token),kind,Date.now()).first();if(!row)throw failure('인증 시간이 지났거나 이미 사용한 링크입니다. 다시 요청해 주세요.');return JSON.parse(row.payload);}
export function siteOrigin(request,env){const origin=env.SITE_URL?new URL(env.SITE_URL).origin:new URL(request.url).origin;if(!origin.startsWith('https://')&&!origin.startsWith('http://127.0.0.1:'))throw failure('SITE_URL 설정을 확인해 주세요.',503);return origin;}
export async function mailLink(request,env,email,token,kind){
 if(!env.AUTH_MAIL_API_KEY||!env.AUTH_MAIL_FROM)throw failure('인증메일 발신 설정이 필요합니다. 운영자에게 문의해 주세요.',503);
 const url=siteOrigin(request,env)+'/#auth/'+kind+'?token='+token;
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.AUTH_MAIL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.AUTH_MAIL_FROM,to:[email],subject:kind==='verify'?'메디컬마켓 이메일 확인':'메디컬마켓 비밀번호 재설정',text:`메디컬마켓 요청을 완료하려면 아래 링크를 열어 주세요. 링크는 30분간 유효합니다.\n${url}\n직접 요청하지 않았다면 무시해 주세요.`,html:`<div style="font-family:sans-serif;line-height:1.8"><h2>메디컬마켓</h2><p>아래 버튼을 눌러 ${kind==='verify'?'이메일 확인':'비밀번호 재설정'}을 진행해 주세요.</p><a href="${url}">인증 진행하기</a><p>30분 이내에 사용해 주세요. 직접 요청하지 않았다면 무시해 주세요.</p></div>`})});
 if(!response.ok)throw failure('인증메일을 보내지 못했습니다. 잠시 후 다시 요청해 주세요.',503);
}
export async function authAction({request,env,params}){
 await authSchema(env);const path=(Array.isArray(params.path)?params.path.join('/'):params.path)||'';
 if(request.method==='GET'&&path==='session')return json({user:publicUser(await currentUser(request,env),env),providers:{kakao:!!(env.KAKAO_CLIENT_ID&&env.KAKAO_CLIENT_SECRET),naver:!!(env.NAVER_CLIENT_ID&&env.NAVER_CLIENT_SECRET)},emailReady:!!(env.AUTH_MAIL_API_KEY&&env.AUTH_MAIL_FROM)});
 if(request.method==='GET'&&path==='members'){
  const user=await userRequired(request,env);if(user.role!=='admin')throw failure('운영자 권한이 필요합니다.',403);
  const url=new URL(request.url),offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0)),q=(url.searchParams.get('q')||'').slice(0,100);
  const rows=await env.DB.prepare('SELECT id,email,name,role,verified,created_at FROM mm_users WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 51 OFFSET ?').bind('%'+q+'%','%'+q+'%',offset).all();return json({members:rows.results.slice(0,50),next:rows.results.length>50?offset+50:null,owner:publicUser(user,env).owner});
 }
 if(request.method!=='POST')throw failure('지원하지 않는 요청입니다.',405);
 sameOrigin(request);const data=await bodyJson(request,8192);
 if(path==='logout'){const token=readCookie(request,'mm_session');await env.DB.prepare('DELETE FROM mm_sessions WHERE hash=?').bind(await digest(token)).run();return json({user:null},200,{'Set-Cookie':cookie('mm_session','',0)});}
 if(path==='signup'){
  await limit(request,env,'signup',5);if(data.consent!==true)throw failure('개인정보 수집·이용 동의가 필요합니다.');
  const email=emailValue(data.email),name=String(data.name||'').trim().slice(0,80);if(!name)throw failure('이름을 입력해 주세요.');
  const password=await hashPassword(data.password),id=crypto.randomUUID(),at=new Date().toISOString();
  // A duplicate signup never replaces credentials or signs into the existing account.
  const inserted=await env.DB.prepare("INSERT INTO mm_users(id,email,name,password,role,verified,created_at,consent_at) VALUES (?,?,?,?,'user',0,?,?) ON CONFLICT(email) DO NOTHING RETURNING id").bind(id,email,name,password,at,at).first();
  if(!inserted)throw failure('이미 가입된 이메일입니다. 로그인 또는 비밀번호 찾기를 이용해 주세요.',409);
  return sessionResponse(await env.DB.prepare('SELECT * FROM mm_users WHERE id=?').bind(id).first(),env);
 }
 if(path==='login'){
  await limit(request,env,'login');const email=emailValue(data.email),user=await env.DB.prepare('SELECT * FROM mm_users WHERE email=?').bind(email).first();
  const candidate=await hashPassword(data.password,user?.password?.split(':')[2]||'00000000000000000000000000000000');
  if(!user||!user.password||!await equal(candidate,user.password)||user.disabled)throw failure('이메일 또는 비밀번호를 확인해 주세요.',401);
  return sessionResponse(user,env);
 }
 if(path==='verify')throw failure('이메일 인증 없이 로그인할 수 있습니다. 이메일과 비밀번호로 로그인해 주세요.',410);
 if(path==='forgot'){
  await limit(request,env,'forgot',5);const email=emailValue(data.email);if(!env.AUTH_MAIL_API_KEY||!env.AUTH_MAIL_FROM)throw failure('인증메일 발신 설정이 필요합니다.',503);
  const user=await env.DB.prepare('SELECT id FROM mm_users WHERE email=? AND disabled=0').bind(email).first();
  if(user){const token=await putToken(env,'reset',{id:user.id});await mailLink(request,env,email,token,'reset');}return json({message:'해당 이메일로 이용 가능한 계정이 있으면 재설정 링크를 보냈습니다.'});
 }
 if(path==='reset'){
  await limit(request,env,'reset');const password=await hashPassword(data.password),payload=await takeToken(env,data.token,'reset');
  await env.DB.batch([env.DB.prepare('UPDATE mm_users SET password=?,verified=1 WHERE id=? AND disabled=0').bind(password,payload.id),env.DB.prepare('DELETE FROM mm_sessions WHERE user_id=?').bind(payload.id),env.DB.prepare("DELETE FROM mm_auth_tokens WHERE kind IN ('reset','verify') AND json_extract(payload,'$.id')=?").bind(payload.id)]);return json({message:'비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.'});
 }
 if(path==='role'){
  const actor=await userRequired(request,env);if(!publicUser(actor,env).owner)throw failure('최초 운영자 본인만 권한을 변경할 수 있습니다.',403);
  if(!['user','admin'].includes(data.role)||data.id===actor.id)throw failure('변경할 계정과 권한을 확인해 주세요.');
  const target=await env.DB.prepare('SELECT id FROM mm_users WHERE id=? AND disabled=0').bind(String(data.id)).first();if(!target)throw failure('이용 가능한 회원만 지정할 수 있습니다.');
  await env.DB.batch([env.DB.prepare('UPDATE mm_users SET role=? WHERE id=?').bind(data.role,target.id),env.DB.prepare('DELETE FROM mm_sessions WHERE user_id=?').bind(target.id),env.DB.prepare('INSERT INTO mm_auth_audit VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,target.id,'role:'+data.role,new Date().toISOString())]);return json({ok:true});
 }
 if(path==='legacy-import'){
  const actor=await userRequired(request,env);if(!publicUser(actor,env).owner)throw failure('최초 운영자만 기존 회원을 가져올 수 있습니다.',403);
  if(!Array.isArray(data.members)||data.members.length>20)throw failure('최대 20명씩 가져올 수 있습니다.');
  const rows=data.members.map(row=>({email:emailValue(row.email),name:String(row.name||'').trim().slice(0,80)}));if(rows.some(row=>!row.name))throw failure('회원 이름을 확인해 주세요.');
  const at=new Date().toISOString();await env.DB.batch([...rows.map(row=>env.DB.prepare('INSERT INTO mm_legacy_members(email,name,imported_at) VALUES (?,?,?) ON CONFLICT(email) DO NOTHING').bind(row.email,row.name,at)),env.DB.prepare('INSERT INTO mm_auth_audit VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,'legacy','import:'+rows.length,at)]);return json({count:rows.length});
 }
 throw failure('요청 경로를 확인해 주세요.',404);
}
