import {currentUser} from './auth.js';
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export function failure(message, status = 400) { return Object.assign(new Error(message), {status}); }
export async function limitedBody(request, limit) {
  if(Number(request.headers.get('Content-Length')) > limit) throw failure('파일 또는 내용이 너무 큽니다.',413);
  const reader=request.body?.getReader(); if(!reader)return new Uint8Array();
  let size=0; const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw failure('파일 또는 내용이 너무 큽니다.',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function bodyJson(request, limit=500000){try{return JSON.parse(new TextDecoder().decode(await limitedBody(request,limit)));}catch(e){if(e.status)throw e;throw failure('입력 형식을 확인해 주세요.');}}
export function sameOrigin(request){if(request.headers.get('Origin')!==new URL(request.url).origin)throw failure('같은 홈페이지에서 실행해 주세요.',403);}
const secret=env=>env.ADMIN_PASSWORD;
export async function mac(value,env){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret(env)),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function equal(a,b){const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const x=await hash(a),y=await hash(b);return x.reduce((v,n,i)=>v|(n^y[i]),0)===0;}
export async function authenticated(request,env){
  const member=await currentUser(request,env);
  if(member)return member.role==='admin';
  // Setting OWNER_USER_ID retires the shared password, including already-issued cookies.
  if(env.OWNER_USER_ID)return false;
  if(!secret(env)||secret(env).length<12)return false;
  const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)mm_admin=([^;]+)/)?.[1]||'';
  const [expires,nonce,signature]=token.split('.');
  if(!/^\d+$/.test(expires||'')||Number(expires)<Date.now()||Number(expires)>Date.now()+8*3600000||!nonce||!signature)return false;
  return equal(signature,await mac(expires+'.'+nonce,env));
}
export async function requireAdmin(request,env){if(!await authenticated(request,env))throw failure('운영자 로그인이 필요합니다.',401);}
export async function schema(env){
  if(!env.DB)throw failure('DB 바인딩을 확인해 주세요.',503);
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_products (id TEXT PRIMARY KEY, payload TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_products_visible ON mm_products(published, deleted, id)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)')
  ]);
}
export function safeHandler(fn){return async context=>{try{return await fn(context);}catch(e){return json({error:e.status?e.message:'서버 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'},e.status||503);}};}
