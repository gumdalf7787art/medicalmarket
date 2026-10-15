import {json,failure,requireAdmin,sameOrigin} from './cloud.js';
import {authSchema,putToken,takeToken,random,digest,cookie,readCookie,siteOrigin,limit} from './auth.js';

const scopes=['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send'];
const callbackPath='/api/mail/oauth/callback';
const gmailOrigin=(request,env)=>siteOrigin(request,{...env,SITE_URL:env.GMAIL_SITE_URL||env.SITE_URL});
const enc=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const un64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const configured=env=>Boolean(env.GMAIL_CLIENT_ID&&env.GMAIL_CLIENT_SECRET);
async function schema(env){await authSchema(env);await env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_gmail_connection(id INTEGER PRIMARY KEY,email TEXT NOT NULL,tokens TEXT NOT NULL,updated_at TEXT NOT NULL)').run();}
// Client-secret rotation requires reconnecting Gmail. Tokens never leave the server.
async function key(env){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode('medicalmarket:gmail:v1:'+env.GMAIL_CLIENT_SECRET)),'AES-GCM',false,['encrypt','decrypt']);}
export async function seal(env,value){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('mm_gmail_connection:1')},await key(env),enc.encode(JSON.stringify(value)));return b64(iv)+'.'+b64(data);}
export async function unseal(env,value){const [iv,data]=value.split('.');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(iv),additionalData:enc.encode('mm_gmail_connection:1')},await key(env),un64(data))));}
async function google(url,options={}){const response=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});if(!response.ok)throw failure('Google 연결을 확인하지 못했습니다. 계정을 다시 연결해 주세요.',502);return response.json();}
async function exchange(env,values){return google('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GMAIL_CLIENT_ID,client_secret:env.GMAIL_CLIENT_SECRET,...values})});}
async function save(env,email,tokens){await env.DB.prepare('INSERT INTO mm_gmail_connection(id,email,tokens,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,tokens=excluded.tokens,updated_at=excluded.updated_at').bind(email,await seal(env,tokens),new Date().toISOString()).run();}
export async function gmailAccess(env){const row=await env.DB.prepare('SELECT * FROM mm_gmail_connection WHERE id=1').first();if(!row)throw failure('Gmail 계정을 먼저 연결해 주세요.',409);let tokens;try{tokens=await unseal(env,row.tokens);}catch{throw failure('Gmail 키가 변경되었습니다. 계정을 다시 연결해 주세요.',409);}if(tokens.expires<Date.now()+60000){const next=await exchange(env,{grant_type:'refresh_token',refresh_token:tokens.refresh_token});if(!next.access_token)throw failure('Gmail 계정을 다시 연결해 주세요.',409);tokens={...tokens,access_token:next.access_token,refresh_token:next.refresh_token||tokens.refresh_token,expires:Date.now()+Number(next.expires_in||3600)*1000};await save(env,row.email,tokens);}return {email:row.email,access_token:tokens.access_token};}
const sessionBinding=request=>digest(readCookie(request,'mm_session')||readCookie(request,'mm_admin'));
export async function gmailAction({request,env}){
 const path=new URL(request.url).pathname.replace('/api/mail/','');
 await requireAdmin(request,env);await schema(env);
 if(request.method==='GET'&&path==='status'){
  let connected=false,email='',error='';
  if(configured(env)&&await env.DB.prepare('SELECT id FROM mm_gmail_connection WHERE id=1').first())try{const access=await gmailAccess(env);const profile=await google('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+access.access_token}});email=profile.emailAddress;connected=email===access.email;}catch(e){error=e.status?e.message:'Gmail 연결을 확인하지 못했습니다. 다시 연결해 주세요.';}
  return json({provider:'gmail-api',configured:configured(env),connected,email,error,attachment:null,workflowReady:false,redirectUri:gmailOrigin(request,env)+callbackPath});
 }
 if(request.method==='POST')sameOrigin(request);
 if(request.method==='POST'&&path==='oauth/start'){
  if(!configured(env))throw failure('Cloudflare에 GMAIL_CLIENT_ID와 GMAIL_CLIENT_SECRET을 등록해 주세요.',503);
  if(new URL(request.url).origin!==gmailOrigin(request,env))throw failure('정식 홈페이지 주소에서 연결해 주세요.',400);
  await limit(request,env,'gmail-connect',10);
  const verifier=random(),binding=await sessionBinding(request),state=await putToken(env,'gmail-oauth',{verifier,binding},10);
  const challenge=b64(await crypto.subtle.digest('SHA-256',enc.encode(verifier))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:env.GMAIL_CLIENT_ID,redirect_uri:gmailOrigin(request,env)+callbackPath,response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent select_account',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  return json({url:url.href},200,{'Set-Cookie':cookie('mm_gmail_oauth',state,600)});
 }
 if(request.method==='GET'&&path==='oauth/callback'){
  let result='failed';try{
   if(!configured(env))throw Error();const query=new URL(request.url).searchParams,state=query.get('state');
   if(!state||state!==readCookie(request,'mm_gmail_oauth'))throw Error();
   const pending=await takeToken(env,state,'gmail-oauth');if(pending.binding!==await sessionBinding(request))throw Error();
   if(query.get('error'))result='cancelled';else{
    if(!query.get('code'))throw Error();
    const tokens=await exchange(env,{grant_type:'authorization_code',code:query.get('code'),redirect_uri:gmailOrigin(request,env)+callbackPath,code_verifier:pending.verifier});
    if(!tokens.access_token||!tokens.refresh_token||!scopes.every(s=>String(tokens.scope||'').split(' ').includes(s)))throw Error();
    const profile=await google('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+tokens.access_token}});
    if(!profile.emailAddress)throw Error();
    await save(env,profile.emailAddress,{access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires:Date.now()+Number(tokens.expires_in||3600)*1000});result='connected';
   }
  }catch{/* Never reflect authorization codes, provider errors or tokens into the page. */}
  return new Response(null,{status:303,headers:{Location:gmailOrigin(request,env)+'/?gmail='+result+'#ops/mail','Set-Cookie':cookie('mm_gmail_oauth','',0),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }
 throw failure('이 메일 기능은 아직 클라우드 연결 작업 중입니다.',501);
}
