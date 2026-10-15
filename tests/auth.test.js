import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/auth/[[path]].js';
import {authenticated,mac} from '../server/cloud.js';
import {authSchema} from '../server/auth.js';

const db=new DatabaseSync(':memory:');
const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);},async all(){return {results:db.prepare(sql).all(...args)};}};},async batch(statements){db.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
const env={DB,OWNER_EMAIL:'owner@example.test',AUTH_MAIL_API_KEY:'test-only',AUTH_MAIL_FROM:'test@example.test',KAKAO_CLIENT_ID:'test-id',KAKAO_CLIENT_SECRET:'test-secret',NAVER_CLIENT_ID:'naver-id',NAVER_CLIENT_SECRET:'naver-secret',ADMIN_PASSWORD:'test-only-bootstrap-password'};
const mails=[];let providerId='12345';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(url==='https://api.resend.com/emails'){mails.push(JSON.parse(options.body));return Response.json({id:'mock'});}
 if(String(url).includes('/token'))return Response.json({access_token:'mock-provider-token'});
 if(String(url).includes('kapi.kakao'))return Response.json({id:providerId,properties:{nickname:'SNS tester'},kakao_account:{email:'owner@example.test'}});
 throw Error('Unexpected external request '+url);
};
let sequence=0;
async function call(path,data,cookie='',extra={}){return onRequest({params:{path:path.split('?')[0].split('/')},env,request:new Request('https://example.test/api/auth/'+path,{method:data?'POST':'GET',headers:{Origin:'https://example.test','CF-Connecting-IP':String(++sequence),Cookie:cookie,...extra},...(data?{body:JSON.stringify(data)}:{})})});}
const sessionCookie=response=>response.headers.get('set-cookie').split(';')[0];
const token=()=>mails.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
const signup=async email=>call('signup',{email,name:'테스트 회원',password:'Test-only-password123!',consent:true,role:'admin'});
test('email ownership, authorization, reset and OAuth identity isolation',async()=>{
 await authSchema(env);
 assert.equal((await signup('owner@example.test')).status,200);
 assert.equal((await call('login',{email:'owner@example.test',password:'Test-only-password123!'})).status,403);
 const verifyToken=token(),verified=await call('verify',{token:verifyToken});assert.equal(verified.status,200);
 const ownerCookie=sessionCookie(verified),owner=(await verified.json()).user;assert.equal(owner.role,'admin');assert.equal(owner.owner,true);
 assert.equal((await call('verify',{token:verifyToken})).status,400);
 assert(!JSON.stringify(owner).includes('password'));
 await signup('user@example.test');const userResponse=await call('verify',{token:token()}),userCookie=sessionCookie(userResponse),user=(await userResponse.json()).user;
 assert.equal(user.role,'user');assert.equal(await authenticated(new Request('https://example.test',{headers:{Cookie:userCookie}}),env),false);
 assert.equal((await call('members',null,userCookie)).status,403);
 assert.equal((await call('legacy-import',{members:[{email:'user@example.test',name:'이전 이름'}]},userCookie)).status,403);
 assert.equal((await call('legacy-import',{members:[{email:'user@example.test',name:'이전 이름',role:'admin',password:'ignored'}]},ownerCookie)).status,200);
 assert.equal((await (await call('session',null,userCookie)).json()).user.legacyName,'이전 이름');
 assert.equal((await call('role',{id:owner.id,role:'user'},userCookie)).status,403);
 assert.equal((await call('role',{id:user.id,role:'admin'},ownerCookie)).status,200);
 assert.equal((await (await call('session',null,userCookie)).json()).user,null,'promotion invalidates old sessions');
 const adminLogin=await call('login',{email:'user@example.test',password:'Test-only-password123!'}),adminCookie=sessionCookie(adminLogin);
 assert.equal(await authenticated(new Request('https://example.test',{headers:{Cookie:adminCookie}}),env),true);
 assert.equal((await call('role',{id:owner.id,role:'user'},adminCookie)).status,403,'ordinary admin cannot appoint admins');
 await call('forgot',{email:'user@example.test'});const resetToken=token();
 assert.equal((await call('reset',{token:resetToken,password:'Changed-test-password123!'})).status,200);
 assert.equal((await (await call('session',null,adminCookie)).json()).user,null);
 assert.equal((await call('login',{email:'user@example.test',password:'Test-only-password123!'})).status,401);
 assert.equal((await call('reset',{token:resetToken,password:'Changed-test-password123!'})).status,400);
 const cross=await call('logout',{},ownerCookie,{Origin:'https://other.test'});assert.equal(cross.status,403);
 const oldValue=(Date.now()+3600000)+'.test',legacyCookie='mm_admin='+oldValue+'.'+await mac(oldValue,env);assert.equal(await authenticated(new Request('https://example.test',{headers:{Cookie:legacyCookie}}),env),false);
 const start=await call('oauth/kakao/start'),state=new URL(start.headers.get('location')).searchParams.get('state'),oauthCookie=sessionCookie(start);
 const invalid=await call('oauth/kakao/callback?state='+state+'&code=mock');assert.match(invalid.headers.get('location'),/error=/);
 const start2=await call('oauth/kakao/start'),state2=new URL(start2.headers.get('location')).searchParams.get('state');
 // Route params do not contain query parameters in Pages.
 const callback=await onRequest({env,params:{path:['oauth','kakao','callback']},request:new Request('https://example.test/api/auth/oauth/kakao/callback?state='+state2+'&code=mock',{headers:{Cookie:sessionCookie(start2)}})});
 assert.equal(callback.headers.get('location'),'/#auth/social');
 const finish=await call('social',{name:'SNS tester',consent:true},sessionCookie(callback)),social=(await finish.json()).user;
 assert.equal(social.role,'user');assert.equal(social.email,'');assert.notEqual(social.id,owner.id,'provider email must not take over owner');
 assert.equal((await call('social',{name:'again',consent:true},sessionCookie(callback))).status,400);
 globalThis.fetch=originalFetch;
});
