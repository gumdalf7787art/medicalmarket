import {json,failure,bodyJson,sameOrigin} from './cloud.js';
import {authSchema,random,digest,cookie,readCookie,putToken,takeToken,limit,siteOrigin,sessionResponse} from './auth.js';

function config(provider,env){
 if(provider==='kakao')return {id:env.KAKAO_CLIENT_ID,secret:env.KAKAO_CLIENT_SECRET,authorize:'https://kauth.kakao.com/oauth/authorize',token:'https://kauth.kakao.com/oauth/token',profile:'https://kapi.kakao.com/v2/user/me'};
 if(provider==='naver')return {id:env.NAVER_CLIENT_ID,secret:env.NAVER_CLIENT_SECRET,authorize:'https://nid.naver.com/oauth2.0/authorize',token:'https://nid.naver.com/oauth2.0/token',profile:'https://openapi.naver.com/v1/nid/me'};
 throw failure('지원하지 않는 로그인 방식입니다.');
}
const redirect=(url,headers={})=>new Response(null,{status:303,headers:{Location:url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}});
export async function oauthAction({request,env,params}){
 await authSchema(env);const path=Array.isArray(params.path)?params.path:params.path.split('/');const [,provider,action]=path;const cfg=config(provider,env);
 if(!cfg.id||!cfg.secret)throw failure('이 로그인 방식은 운영자 설정 후 사용할 수 있습니다.',503);
 const callback=siteOrigin(request,env)+'/api/auth/oauth/'+provider+'/callback';
 if(action==='start'&&request.method==='GET'){
  await limit(request,env,'oauth',30);const state=random(),binding=random();
  await env.DB.prepare('INSERT INTO mm_auth_tokens(hash,kind,payload,expires) VALUES (?,?,?,?)').bind(await digest(state),'oauth',JSON.stringify({provider,binding:await digest(binding)}),Date.now()+600000).run();
  const url=new URL(cfg.authorize);url.search=new URLSearchParams({response_type:'code',client_id:cfg.id,redirect_uri:callback,state}).toString();
  return redirect(url.href,{'Set-Cookie':cookie('mm_oauth',binding,600)});
 }
 if(action==='callback'&&request.method==='GET'){
  try{
   const url=new URL(request.url),state=url.searchParams.get('state'),payload=await takeToken(env,state,'oauth');
   if(payload.provider!==provider||payload.binding!==await digest(readCookie(request,'mm_oauth')))throw failure('로그인 요청이 일치하지 않습니다. 다시 시작해 주세요.');
   const code=url.searchParams.get('code');if(!code||url.searchParams.get('error'))throw failure('로그인을 취소했습니다.');
   const response=await fetch(cfg.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:cfg.id,client_secret:cfg.secret,redirect_uri:callback,code,state})});
   const tokens=await response.json();if(!response.ok||!tokens.access_token)throw failure('로그인 인증에 실패했습니다.');
   const profileResponse=await fetch(cfg.profile,{headers:{Authorization:'Bearer '+tokens.access_token}}),raw=await profileResponse.json();
   const profile=provider==='naver'?raw.response:raw;if(!profileResponse.ok||!profile?.id)throw failure('회원 정보를 확인하지 못했습니다.');
   const subject=String(profile.id);let identity=await env.DB.prepare('SELECT u.* FROM mm_identities i JOIN mm_users u ON u.id=i.user_id WHERE i.provider=? AND i.subject=?').bind(provider,subject).first();
   if(identity?.disabled)throw failure('이용이 제한된 계정입니다. 운영자에게 문의해 주세요.',403);
   if(provider==='kakao'){
    const nickname=String(profile.kakao_account?.profile?.nickname||profile.properties?.nickname||'').trim().slice(0,80);
    if(!identity){
     const id=crypto.randomUUID(),at=new Date().toISOString();
     // Provider approval completes Kakao signup. Never match an account by its email.
     try{await env.DB.batch([
      env.DB.prepare("INSERT INTO mm_users(id,email,name,role,verified,created_at,consent_at) VALUES (?,NULL,?,'user',1,?,?)").bind(id,nickname||'카카오 회원',at,at),
      env.DB.prepare('INSERT INTO mm_identities(provider,subject,user_id) VALUES (?,?,?)').bind(provider,subject,id),
      env.DB.prepare('INSERT INTO mm_auth_audit VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),id,id,'signup:kakao-oauth',at)
     ]);}catch(error){
      // A concurrent callback may already have created this identity; the batch rolls back its unused user.
      const existing=await env.DB.prepare('SELECT user_id FROM mm_identities WHERE provider=? AND subject=?').bind(provider,subject).first();if(!existing)throw error;
     }
     identity=await env.DB.prepare('SELECT u.* FROM mm_identities i JOIN mm_users u ON u.id=i.user_id WHERE i.provider=? AND i.subject=?').bind(provider,subject).first();
    }
    if(!identity||identity.disabled)throw failure('이용이 제한된 계정입니다. 운영자에게 문의해 주세요.',403);
    if(nickname&&identity.name!==nickname){await env.DB.prepare('UPDATE mm_users SET name=? WHERE id=? AND disabled=0').bind(nickname,identity.id).run();identity.name=nickname;}
   }
   if(identity){const session=await sessionResponse(identity,env);return redirect('/#home',{'Set-Cookie':session.headers.get('Set-Cookie')});}
   const ticket=await putToken(env,'social',{provider,subject,name:String(provider==='naver'?profile.name||profile.nickname||'회원':profile.properties?.nickname||'회원').slice(0,80)},10);
   return redirect('/#auth/social',{'Set-Cookie':cookie('mm_social',ticket,600)});
  }catch(error){return redirect('/#auth/login?error='+encodeURIComponent(error.status?error.message:'SNS 로그인 연결을 확인해 주세요.'),{'Set-Cookie':cookie('mm_oauth','',0)});}
 }
 throw failure('요청 경로를 확인해 주세요.',404);
}
export async function finishSocial({request,env}){
 sameOrigin(request);await authSchema(env);await limit(request,env,'social-finish',10);const data=await bodyJson(request,4096);if(data.consent!==true)throw failure('개인정보 수집·이용 동의가 필요합니다.');
 const payload=await takeToken(env,readCookie(request,'mm_social'),'social'),name=String(data.name||payload.name).trim().slice(0,80);if(!name)throw failure('이름을 입력해 주세요.');
 const id=crypto.randomUUID(),at=new Date().toISOString();
 // Provider subject is the identity. An unverified provider email never claims a local account or owner role.
 await env.DB.batch([env.DB.prepare("INSERT INTO mm_users(id,email,name,role,verified,created_at,consent_at) VALUES (?,NULL,?,'user',1,?,?)").bind(id,name,at,at),env.DB.prepare('INSERT INTO mm_identities(provider,subject,user_id) VALUES (?,?,?)').bind(payload.provider,payload.subject,id)]);
 return sessionResponse(await env.DB.prepare('SELECT * FROM mm_users WHERE id=?').bind(id).first(),env);
}
