import {failure,sameOrigin} from './cloud.js';
import {authSchema,random,digest,cookie,readCookie,takeToken,limit,siteOrigin,sessionResponse,emailValue} from './auth.js';

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
  return redirect(url.href,{'Set-Cookie':cookie('mm_oauth',binding,600),'X-MM-Auth-Flow':'direct-home-v2'});
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
   const nickname=String(provider==='naver'?(profile.nickname||''):(profile.kakao_account?.profile?.nickname||profile.properties?.nickname||'')).trim().slice(0,80);
   let contactEmail='';try{contactEmail=emailValue(provider==='naver'?profile.email:profile.kakao_account?.email);}catch{}
   const session=await completeSocial(env,provider,String(profile.id),nickname,contactEmail);
   return redirect('/#home',{'Set-Cookie':session.headers.get('Set-Cookie')});
  }catch(error){return redirect('/#auth/login?error='+encodeURIComponent(error.status?error.message:'SNS 로그인 연결을 확인해 주세요.'),{'Set-Cookie':cookie('mm_oauth','',0)});}
 }
 throw failure('요청 경로를 확인해 주세요.',404);
}
async function completeSocial(env,provider,subject,nickname,contactEmail=''){
 config(provider,env);
 let identity=await env.DB.prepare('SELECT u.* FROM mm_identities i JOIN mm_users u ON u.id=i.user_id WHERE i.provider=? AND i.subject=?').bind(provider,subject).first();
   if(identity?.disabled)throw failure('이용이 제한된 계정입니다. 운영자에게 문의해 주세요.',403);
   {
    if(!identity){
     const id=crypto.randomUUID(),at=new Date().toISOString();
     // Provider approval completes social signup. Never match an account by its email.
     try{await env.DB.batch([
      env.DB.prepare("INSERT INTO mm_users(id,email,name,role,verified,created_at,consent_at) VALUES (?,NULL,?,'user',1,?,?)").bind(id,nickname||(provider==='kakao'?'카카오 회원':'네이버 회원'),at,at),
      env.DB.prepare('INSERT INTO mm_identities(provider,subject,user_id) VALUES (?,?,?)').bind(provider,subject,id),
      env.DB.prepare('INSERT INTO mm_auth_audit VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),id,id,'signup:'+provider+'-oauth',at)
     ]);}catch(error){
      // A concurrent callback may already have created this identity; the batch rolls back its unused user.
      const existing=await env.DB.prepare('SELECT user_id FROM mm_identities WHERE provider=? AND subject=?').bind(provider,subject).first();if(!existing)throw error;
     }
     identity=await env.DB.prepare('SELECT u.* FROM mm_identities i JOIN mm_users u ON u.id=i.user_id WHERE i.provider=? AND i.subject=?').bind(provider,subject).first();
    }
    if(!identity||identity.disabled)throw failure('이용이 제한된 계정입니다. 운영자에게 문의해 주세요.',403);
    if(nickname&&identity.name!==nickname){await env.DB.prepare('UPDATE mm_users SET name=? WHERE id=? AND disabled=0').bind(nickname,identity.id).run();identity.name=nickname;}
   }
   if(contactEmail){
    await env.DB.prepare('INSERT INTO mm_social_contacts(user_id,provider,email,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET email=excluded.email,updated_at=excluded.updated_at').bind(identity.id,provider,contactEmail,new Date().toISOString()).run();
    identity.socialEmail=contactEmail;
   }else{
    identity.socialEmail=(await env.DB.prepare('SELECT email FROM mm_social_contacts WHERE user_id=? ORDER BY updated_at DESC LIMIT 1').bind(identity.id).first())?.email||'';
   }

 return sessionResponse(identity,env);
}
export async function finishSocial({request,env}){
 sameOrigin(request);await authSchema(env);await limit(request,env,'social-finish',10);
 // Compatibility with an OAuth login begun before the direct-signup deployment.
 // Only the server-issued, expiring cookie supplies identity; ignore submitted names/roles.
 const payload=await takeToken(env,readCookie(request,'mm_social'),'social');
 if(!payload.subject)throw failure('SNS 로그인을 다시 진행해 주세요.');
 return completeSocial(env,payload.provider,String(payload.subject),String(payload.name||'').trim().slice(0,80));
}
