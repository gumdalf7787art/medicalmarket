import {json,bodyJson,sameOrigin,mac,equal,authenticated,schema,safeHandler,failure} from '../../../server/cloud.js';
export const onRequestGet=safeHandler(async({request,env})=>json({authenticated:await authenticated(request,env),configured:!!env.ADMIN_PASSWORD&&env.ADMIN_PASSWORD.length>=12}));
export const onRequestPost=safeHandler(async({request,env})=>{
  sameOrigin(request);
  if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<12)throw failure('Cloudflare Secret에 ADMIN_PASSWORD를 12자 이상으로 설정해 주세요.',503);
  const {password}=await bodyJson(request,4096);await schema(env);
  const now=Date.now(),key=await mac('login:'+ (request.headers.get('CF-Connecting-IP')||'local'),env);
  await env.DB.prepare('DELETE FROM mm_login_attempts WHERE expires < ?').bind(now).run();
  await env.DB.prepare('INSERT INTO mm_login_attempts(key,attempts,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').bind(key,now+15*60000).run();
  const attempt=await env.DB.prepare('SELECT attempts FROM mm_login_attempts WHERE key=?').bind(key).first();
  if(attempt.attempts>5)throw failure('로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.',429);
  if(typeof password!=='string'||!await equal(password,env.ADMIN_PASSWORD))throw failure('운영자 비밀번호를 확인해 주세요.',401);
  await env.DB.prepare('DELETE FROM mm_login_attempts WHERE key=?').bind(key).run();
  const value=(now+8*3600000)+'.'+crypto.randomUUID(),token=value+'.'+await mac(value,env);
  return json({authenticated:true},200,{'Set-Cookie':`mm_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`});
});
export const onRequestDelete=safeHandler(async({request})=>{sameOrigin(request);return json({authenticated:false},200,{'Set-Cookie':'mm_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});});
