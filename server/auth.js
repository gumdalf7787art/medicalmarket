import {json,failure,bodyJson,sameOrigin,equal,authenticated} from './cloud.js';

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
  env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_legacy_members(email TEXT PRIMARY KEY,name TEXT NOT NULL,claimed_by TEXT,imported_at TEXT NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_legacy_credentials(email TEXT PRIMARY KEY,password_hash TEXT NOT NULL,imported_at TEXT NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_social_contacts(user_id TEXT NOT NULL,provider TEXT NOT NULL,email TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,provider))')
  ,env.DB.prepare("CREATE TABLE IF NOT EXISTS mm_role_owners(singleton TEXT PRIMARY KEY CHECK(singleton='owner'),user_id TEXT NOT NULL,created_at TEXT NOT NULL)")
 ]);
}
export function publicUser(user,env){if(!user)return null;const owner=user.role==='admin'&&(env.OWNER_USER_ID?user.id===env.OWNER_USER_ID:user.recordedOwnerId?user.id===user.recordedOwnerId:Number(user.adminCount)===1);return {id:user.id,email:user.email||'',socialEmail:user.socialEmail||'',displayEmail:user.email||user.socialEmail||'',name:user.name,role:user.role,legacyName:user.legacyName||'',owner};}
export async function currentUser(request,env){
 const token=readCookie(request,'mm_session');if(!/^[a-f0-9]{64}$/.test(token))return null;await authSchema(env);
 return env.DB.prepare("SELECT u.*,l.name AS legacyName,(SELECT email FROM mm_social_contacts c WHERE c.user_id=u.id ORDER BY updated_at DESC LIMIT 1) AS socialEmail,(SELECT user_id FROM mm_role_owners WHERE singleton='owner') AS recordedOwnerId,(SELECT COUNT(*) FROM mm_users WHERE role='admin' AND disabled=0) AS adminCount FROM mm_sessions s JOIN mm_users u ON u.id=s.user_id LEFT JOIN mm_legacy_members l ON l.claimed_by=u.id WHERE s.hash=? AND s.expires>? AND u.disabled=0").bind(await digest(token),Date.now()).first();
}
export async function userRequired(request,env){const user=await currentUser(request,env);if(!user)throw failure('로그인이 필요합니다.',401);return user;}
export async function limit(request,env,scope,max=8){
 const now=Date.now(),key=await digest(scope+':'+(request.headers.get('CF-Connecting-IP')||'local'));
 await env.DB.prepare('DELETE FROM mm_auth_limits WHERE expires<?').bind(now).run();
 const row=await env.DB.prepare('INSERT INTO mm_auth_limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,now+15*60000).first();
 if(row.count>max)throw failure('시도가 많습니다. 15분 후 다시 시도해 주세요.',429);
}
export async function hashPassword(password,salt=random(),allowExisting=false){
 if(typeof password!=='string'||password.length>(allowExisting?255:128)||(!allowExisting&&password.length<12))throw failure('비밀번호는 12~128자로 입력해 주세요.');
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 // Workers Web Crypto permits at most 100,000 iterations. Version the format for future upgrades.
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},key,256);
 return 'pbkdf2-sha256:100000:'+salt+':'+Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
const legacyHashPattern=/^sha256:12000:[A-Za-z0-9+/]{32}:[A-Za-z0-9+/]{32}$/;
export async function verifyLegacyPassword(password,hash){
 if(typeof password!=='string'||!password||password.length>255||!legacyHashPattern.test(hash||''))return false;
 const [,iterations,salt,encodedHash]=hash.split(':'),expected=Uint8Array.from(atob(encodedHash),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 const actual=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:Number(iterations)},key,expected.length*8));
 return actual.reduce((diff,byte,index)=>diff|(byte^expected[index]),0)===0;
}
export async function sessionResponse(user,env){const token=random();await env.DB.prepare('DELETE FROM mm_sessions WHERE expires<?').bind(Date.now()).run();await env.DB.prepare('INSERT INTO mm_sessions(hash,user_id,expires) VALUES (?,?,?)').bind(await digest(token),user.id,Date.now()+86400000).run();const owner=await env.DB.prepare("SELECT (SELECT user_id FROM mm_role_owners WHERE singleton='owner') AS recordedOwnerId,(SELECT COUNT(*) FROM mm_users WHERE role='admin' AND disabled=0) AS adminCount").first();return json({user:publicUser({...user,...owner},env)},200,{'Set-Cookie':cookie('mm_session',token,86400)});}
export async function putToken(env,kind,payload,minutes=30){const token=random();await env.DB.prepare('DELETE FROM mm_auth_tokens WHERE expires<?').bind(Date.now()).run();await env.DB.prepare('INSERT INTO mm_auth_tokens(hash,kind,payload,expires) VALUES (?,?,?,?)').bind(await digest(token),kind,JSON.stringify(payload),Date.now()+minutes*60000).run();return token;}
export async function takeToken(env,token,kind){if(!/^[a-f0-9]{64}$/.test(token||''))throw failure('유효하지 않은 인증 요청입니다.');const row=await env.DB.prepare('DELETE FROM mm_auth_tokens WHERE hash=? AND kind=? AND expires>? RETURNING payload').bind(await digest(token),kind,Date.now()).first();if(!row)throw failure('인증 시간이 지났거나 이미 사용한 링크입니다. 다시 요청해 주세요.');return JSON.parse(row.payload);}
export function siteOrigin(request,env){const origin=env.SITE_URL?new URL(env.SITE_URL).origin:new URL(request.url).origin;if(!origin.startsWith('https://')&&!origin.startsWith('http://127.0.0.1:'))throw failure('SITE_URL 설정을 확인해 주세요.',503);return origin;}
export async function mailLink(request,env,email,token,kind){
 if(!env.AUTH_MAIL_API_KEY||!env.AUTH_MAIL_FROM)throw failure('인증메일 발신 설정이 필요합니다. 운영자에게 문의해 주세요.',503);
 const url=siteOrigin(request,env)+'/#auth/'+kind+'?token='+token;
 const label=kind==='legacy-activate'?'기존 회원 계정 연결':kind==='verify'?'이메일 확인':'비밀번호 재설정';
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.AUTH_MAIL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.AUTH_MAIL_FROM,to:[email],subject:'메디컬마켓 '+label,text:`메디컬마켓 요청을 완료하려면 아래 링크를 열어 주세요. 링크는 30분간 유효합니다.\n${url}\n직접 요청하지 않았다면 무시해 주세요.`,html:`<div style="font-family:sans-serif;line-height:1.8"><h2>메디컬마켓</h2><p>아래 버튼을 눌러 ${label}을 진행해 주세요.</p><a href="${url}">인증 진행하기</a><p>30분 이내에 사용해 주세요. 직접 요청하지 않았다면 무시해 주세요.</p></div>`})});
 if(!response.ok)throw failure('인증메일을 보내지 못했습니다. 잠시 후 다시 요청해 주세요.',503);
}
export async function authAction({request,env,params}){
 await authSchema(env);const path=(Array.isArray(params.path)?params.path.join('/'):params.path)||'';
 if(request.method==='GET'&&path==='session')return json({user:publicUser(await currentUser(request,env),env),providers:{kakao:!!(env.KAKAO_CLIENT_ID&&env.KAKAO_CLIENT_SECRET),naver:!!(env.NAVER_CLIENT_ID&&env.NAVER_CLIENT_SECRET)},emailReady:!!(env.AUTH_MAIL_API_KEY&&env.AUTH_MAIL_FROM)});
 if(request.method==='GET'&&path==='members'){
  const user=await currentUser(request,env);if(!await authenticated(request,env))throw failure('운영자 권한이 필요합니다.',403);
  const url=new URL(request.url),offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0)),q=(url.searchParams.get('q')||'').slice(0,100);
  if(url.searchParams.get('legacy')==='1'){
   const result=await env.DB.prepare('SELECT email,name,claimed_by,imported_at FROM mm_legacy_members WHERE email LIKE ? OR name LIKE ? ORDER BY email LIMIT 51 OFFSET ?').bind('%'+q+'%','%'+q+'%',offset).all();
   const total=await env.DB.prepare('SELECT COUNT(*) AS count FROM mm_legacy_members').first();
   return json({members:result.results.slice(0,50),next:result.results.length>50?offset+50:null,total:total.count,legacy:true});
  }
  const filter="FROM mm_users u WHERE u.email LIKE ? OR u.name LIKE ? OR EXISTS (SELECT 1 FROM mm_social_contacts c WHERE c.user_id=u.id AND c.email LIKE ?)";
  const terms=['%'+q+'%','%'+q+'%','%'+q+'%'];
  const rows=await env.DB.prepare('SELECT u.id,u.email,u.name,u.role,u.verified,u.created_at,(SELECT email FROM mm_social_contacts c WHERE c.user_id=u.id ORDER BY updated_at DESC LIMIT 1) AS socialEmail '+filter+' ORDER BY u.created_at DESC,u.id DESC LIMIT 51 OFFSET ?').bind(...terms,offset).all();
  const total=await env.DB.prepare('SELECT COUNT(*) AS count '+filter).bind(...terms).first();
  return json({members:rows.results.slice(0,50),next:rows.results.length>50?offset+50:null,total:total.count,offset,owner:publicUser(user,env)?.owner||false,bootstrapAvailable:!env.OWNER_USER_ID&&!user&&!await env.DB.prepare("SELECT id FROM mm_users WHERE role='admin' UNION ALL SELECT id FROM mm_auth_audit WHERE action='bootstrap:admin' LIMIT 1").first()});
 }
 if(request.method!=='POST')throw failure('지원하지 않는 요청입니다.',405);
 sameOrigin(request);const data=await bodyJson(request,path==='legacy-credentials-import'?32768:8192);
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
  if(user){
   const candidate=await hashPassword(data.password,user.password?.split(':')[2]||'00000000000000000000000000000000',true);
   if(!user.password||!await equal(candidate,user.password)||user.disabled)throw failure('이메일 또는 비밀번호를 확인해 주세요.',401);
   return sessionResponse(user,env);
  }
  const legacy=await env.DB.prepare('SELECT l.name,c.password_hash FROM mm_legacy_members l JOIN mm_legacy_credentials c ON c.email=l.email WHERE l.email=? AND l.claimed_by IS NULL').bind(email).first();
  if(!legacy||!await verifyLegacyPassword(data.password,legacy.password_hash))throw failure('이메일 또는 비밀번호를 확인해 주세요.',401);
  const id=crypto.randomUUID(),at=new Date().toISOString(),password=await hashPassword(data.password,random(),true);
  await env.DB.batch([
   env.DB.prepare("INSERT INTO mm_users(id,email,name,password,role,verified,created_at,consent_at) SELECT ?,l.email,l.name,?,'user',1,?,'' FROM mm_legacy_members l JOIN mm_legacy_credentials c ON c.email=l.email WHERE l.email=? AND l.claimed_by IS NULL AND c.password_hash=? ON CONFLICT(email) DO NOTHING").bind(id,password,at,email,legacy.password_hash),
   env.DB.prepare('UPDATE mm_legacy_members SET claimed_by=? WHERE email=? AND claimed_by IS NULL AND EXISTS (SELECT 1 FROM mm_users WHERE id=? AND email=?)').bind(id,email,id,email),
   env.DB.prepare('DELETE FROM mm_legacy_credentials WHERE email=? AND EXISTS (SELECT 1 FROM mm_legacy_members WHERE email=? AND claimed_by=?)').bind(email,email,id),
   env.DB.prepare("INSERT INTO mm_auth_audit(id,actor,target,action,at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM mm_legacy_members WHERE email=? AND claimed_by=?)").bind(crypto.randomUUID(),id,id,'legacy:password-migrated',at,email,id)
  ]);
  const migrated=await env.DB.prepare('SELECT u.*,l.name AS legacyName FROM mm_users u JOIN mm_legacy_members l ON l.claimed_by=u.id WHERE u.id=? AND u.role=? AND u.disabled=0').bind(id,'user').first();
  if(!migrated)throw failure('이메일 또는 비밀번호를 확인해 주세요.',401);
  return sessionResponse(migrated,env);
 }
 if(path==='verify')throw failure('이메일 인증 없이 로그인할 수 있습니다. 이메일과 비밀번호로 로그인해 주세요.',410);
 if(path==='legacy'){
  await limit(request,env,'legacy',5);const email=emailValue(data.email);
  if(!env.AUTH_MAIL_API_KEY||!env.AUTH_MAIL_FROM)throw failure('기존 회원 연결 메일을 준비 중입니다. 운영자에게 문의해 주세요.',503);
  const legacy=await env.DB.prepare('SELECT * FROM mm_legacy_members WHERE email=?').bind(email).first();
  const user=await env.DB.prepare('SELECT id,role,disabled FROM mm_users WHERE email=?').bind(email).first();
  if(legacy&&(!user||(!user.disabled&&user.role==='user'))&&(!legacy.claimed_by||legacy.claimed_by===user?.id)){
   const token=await putToken(env,'legacy-activate',{email});await mailLink(request,env,email,token,'legacy-activate');
  }
  return json({message:'연결 가능한 기존 회원 정보가 있으면 등록된 이메일로 링크를 보냈습니다. 받은메일함과 스팸함을 확인해 주세요. 운영자 계정은 비밀번호 찾기를 이용해 주세요.'});
 }
 if(path==='legacy-activate'){
  await limit(request,env,'legacy-activate');if(data.consent!==true)throw failure('개인정보 수집·이용 동의가 필요합니다.');
  const password=await hashPassword(data.password),payload=await takeToken(env,data.token,'legacy-activate');
  const email=emailValue(payload.email),id=crypto.randomUUID(),at=new Date().toISOString();
  const legacy=await env.DB.prepare('SELECT * FROM mm_legacy_members WHERE email=?').bind(email).first();
  const existing=await env.DB.prepare('SELECT * FROM mm_users WHERE email=?').bind(email).first();
  if(!legacy||existing?.disabled||(existing&&existing.role!=='user')||(legacy.claimed_by&&legacy.claimed_by!==existing?.id))throw failure('이 계정은 자동 연결할 수 없습니다. 운영자에게 문의해 주세요.',409);
  // D1 batch is transactional. Recheck role/status inside writes to prevent a concurrent promotion bypass.
  await env.DB.batch([
   env.DB.prepare("INSERT INTO mm_users(id,email,name,password,role,verified,created_at,consent_at) SELECT ?,email,name,?,'user',1,?,? FROM mm_legacy_members WHERE email=? AND claimed_by IS NULL ON CONFLICT(email) DO NOTHING").bind(id,password,at,at,email),
   env.DB.prepare("UPDATE mm_users SET password=?,verified=1,consent_at=? WHERE email=? AND role='user' AND disabled=0 AND EXISTS (SELECT 1 FROM mm_legacy_members l WHERE l.email=mm_users.email AND (l.claimed_by IS NULL OR l.claimed_by=mm_users.id))").bind(password,at,email),
   env.DB.prepare("UPDATE mm_legacy_members SET claimed_by=(SELECT id FROM mm_users WHERE email=? AND role='user' AND disabled=0) WHERE email=? AND (claimed_by IS NULL OR claimed_by=(SELECT id FROM mm_users WHERE email=?)) AND EXISTS (SELECT 1 FROM mm_users WHERE email=? AND password=? AND role='user' AND disabled=0)").bind(email,email,email,email,password),
   env.DB.prepare('DELETE FROM mm_sessions WHERE user_id IN (SELECT id FROM mm_users WHERE email=? AND password=?)').bind(email,password),
   env.DB.prepare("DELETE FROM mm_auth_tokens WHERE (kind='legacy-activate' AND json_extract(payload,'$.email')=?) OR (kind IN ('reset','verify') AND json_extract(payload,'$.id') IN (SELECT id FROM mm_users WHERE email=? AND password=?))").bind(email,email,password)
  ]);
  await env.DB.prepare('DELETE FROM mm_legacy_credentials WHERE email=? AND EXISTS (SELECT 1 FROM mm_legacy_members WHERE email=? AND claimed_by IS NOT NULL)').bind(email,email).run();
  const user=await env.DB.prepare('SELECT u.*,l.name AS legacyName FROM mm_users u JOIN mm_legacy_members l ON l.claimed_by=u.id WHERE u.email=? AND u.password=? AND u.disabled=0').bind(email,password).first();
  if(!user||user.role!=='user')throw failure('계정 상태가 변경되었습니다. 다시 요청해 주세요.',409);
  await env.DB.prepare('INSERT INTO mm_auth_audit VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),user.id,user.id,'legacy:email-verified',at).run();
  return sessionResponse(user,env);
 }
 if(path==='forgot'){
  await limit(request,env,'forgot',5);const email=emailValue(data.email);if(!env.AUTH_MAIL_API_KEY||!env.AUTH_MAIL_FROM)throw failure('인증메일 발신 설정이 필요합니다.',503);
  const user=await env.DB.prepare('SELECT id FROM mm_users WHERE email=? AND disabled=0').bind(email).first();
  if(user){const token=await putToken(env,'reset',{id:user.id});await mailLink(request,env,email,token,'reset');}return json({message:'해당 이메일로 이용 가능한 계정이 있으면 재설정 링크를 보냈습니다.'});
 }
 if(path==='reset'){
  await limit(request,env,'reset');const password=await hashPassword(data.password),payload=await takeToken(env,data.token,'reset');
  await env.DB.batch([env.DB.prepare('UPDATE mm_users SET password=?,verified=1 WHERE id=? AND disabled=0').bind(password,payload.id),env.DB.prepare('DELETE FROM mm_sessions WHERE user_id=?').bind(payload.id),env.DB.prepare("DELETE FROM mm_auth_tokens WHERE kind IN ('reset','verify') AND json_extract(payload,'$.id')=?").bind(payload.id)]);return json({message:'비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.'});
 }
 if(path==='bootstrap-admin'){
  if(env.OWNER_USER_ID||await currentUser(request,env)||!await authenticated(request,env))throw failure('기존 운영자 연결에서만 최초 지정할 수 있습니다.',403);
  const id=String(data.id||''),audit=crypto.randomUUID(),at=new Date().toISOString();
  await env.DB.batch([
   env.DB.prepare("UPDATE mm_users SET role='admin' WHERE id=? AND disabled=0 AND role='user' AND NOT EXISTS (SELECT 1 FROM mm_users WHERE role='admin') AND NOT EXISTS (SELECT 1 FROM mm_auth_audit WHERE action='bootstrap:admin')").bind(id),
   env.DB.prepare("INSERT INTO mm_auth_audit(id,actor,target,action,at) SELECT ?,'bootstrap-admin',?,'bootstrap:admin',? WHERE changes()=1").bind(audit,id,at),
   env.DB.prepare('DELETE FROM mm_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM mm_auth_audit WHERE id=?)').bind(id,audit)
  ]);
  if(!await env.DB.prepare('SELECT id FROM mm_auth_audit WHERE id=?').bind(audit).first())throw failure('최초 지정이 이미 완료됐거나 지정할 수 없는 회원입니다.',409);
  return json({ok:true});
 }
 if(path==='role'){
  const actor=await userRequired(request,env);if(!publicUser(actor,env).owner)throw failure('최초 운영자 본인만 권한을 변경할 수 있습니다.',403);
  if(!['user','admin'].includes(data.role)||data.id===actor.id)throw failure('변경할 계정과 권한을 확인해 주세요.');
  const target=await env.DB.prepare('SELECT id,role FROM mm_users WHERE id=? AND disabled=0').bind(String(data.id)).first();if(!target)throw failure('이용 가능한 회원만 지정할 수 있습니다.');
  if(target.role===data.role)return json({ok:true});
  const at=new Date().toISOString(),audit=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO mm_role_owners(singleton,user_id,created_at) SELECT 'owner',?,? WHERE NOT EXISTS (SELECT 1 FROM mm_role_owners) AND (SELECT COUNT(*) FROM mm_users WHERE role='admin' AND disabled=0)=1 AND EXISTS (SELECT 1 FROM mm_users WHERE id=? AND role='admin' AND disabled=0) ON CONFLICT(singleton) DO NOTHING").bind(actor.id,at,actor.id),
   env.DB.prepare(env.OWNER_USER_ID?'UPDATE mm_users SET role=? WHERE id=? AND disabled=0 AND role<>?':'UPDATE mm_users SET role=? WHERE id=? AND disabled=0 AND role<>? AND EXISTS (SELECT 1 FROM mm_role_owners WHERE user_id=?)').bind(...(env.OWNER_USER_ID?[data.role,target.id,data.role]:[data.role,target.id,data.role,actor.id])),
   env.DB.prepare("INSERT INTO mm_auth_audit(id,actor,target,action,at) SELECT ?,?,?,?,? WHERE changes()=1").bind(audit,actor.id,target.id,'role:'+data.role,at),
   env.DB.prepare('DELETE FROM mm_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM mm_auth_audit WHERE id=?)').bind(target.id,audit)
  ]);
  if(!await env.DB.prepare('SELECT id FROM mm_auth_audit WHERE id=?').bind(audit).first())throw failure('권한 변경 상태가 달라졌습니다. 다시 시도해 주세요.',409);
  return json({ok:true});
 }
 if(path==='legacy-import'){
  const actor=await currentUser(request,env);if(!(publicUser(actor,env)?.owner||(!env.OWNER_USER_ID&&!actor&&await authenticated(request,env))))throw failure('최초 운영자 또는 기존 운영자 연결이 필요합니다.',403);
  if(!Array.isArray(data.members)||data.members.length>20)throw failure('최대 20명씩 가져올 수 있습니다.');
  const rows=data.members.map(row=>({email:emailValue(row.email),name:String(row.name||'').trim().slice(0,80)}));if(rows.some(row=>!row.name))throw failure('회원 이름을 확인해 주세요.');
  const at=new Date().toISOString();await env.DB.batch([...rows.map(row=>env.DB.prepare('INSERT INTO mm_legacy_members(email,name,imported_at) VALUES (?,?,?) ON CONFLICT(email) DO NOTHING').bind(row.email,row.name,at)),env.DB.prepare('INSERT INTO mm_auth_audit VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor?.id||'bootstrap-admin','legacy','import:'+rows.length,at)]);return json({count:rows.length});
 }
 if(path==='legacy-credentials-import'){
  const actor=await userRequired(request,env);if(!publicUser(actor,env).owner)throw failure('최초 운영자 본인만 기존 비밀번호를 이전할 수 있습니다.',403);
  if(!Array.isArray(data.members)||data.members.length>20)throw failure('최대 20명씩 가져올 수 있습니다.');
  const rows=data.members.map(row=>({email:emailValue(row.email),hash:String(row.hash||'')}));
  if(rows.some(row=>!legacyHashPattern.test(row.hash)))throw failure('기존 비밀번호 형식을 확인해 주세요.');
  const at=new Date().toISOString();
  await env.DB.batch(rows.map(row=>env.DB.prepare('INSERT INTO mm_legacy_credentials(email,password_hash,imported_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM mm_legacy_members WHERE email=? AND claimed_by IS NULL) AND NOT EXISTS (SELECT 1 FROM mm_users WHERE email=?) ON CONFLICT(email) DO NOTHING').bind(row.email,row.hash,at,row.email,row.email)));
  return json({count:rows.length});
 }
 throw failure('요청 경로를 확인해 주세요.',404);
}
