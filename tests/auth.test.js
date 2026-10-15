import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/auth/[[path]].js';
import {authenticated,mac} from '../server/cloud.js';
import {authSchema} from '../server/auth.js';

const db=new DatabaseSync(':memory:');
const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);},async all(){return {results:db.prepare(sql).all(...args)};}};},async batch(statements){db.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
const env={DB,OWNER_EMAIL:'owner@example.test',AUTH_MAIL_API_KEY:'test-only',AUTH_MAIL_FROM:'test@example.test',KAKAO_CLIENT_ID:'test-id',KAKAO_CLIENT_SECRET:'test-secret',NAVER_CLIENT_ID:'naver-id',NAVER_CLIENT_SECRET:'naver-secret',ADMIN_PASSWORD:'test-only-bootstrap-password'};
const mails=[];let providerId='12345',naverNickname='네이버 별명';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(url==='https://api.resend.com/emails'){mails.push(JSON.parse(options.body));return Response.json({id:'mock'});}
 if(String(url).includes('/token'))return Response.json({access_token:'mock-provider-token'});
 if(String(url).includes('openapi.naver.com'))return Response.json({resultcode:'00',response:{id:providerId,nickname:naverNickname,email:'owner@example.test',name:'Not the nickname'}});
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
 const first=await signup('owner@example.test');assert.equal(first.status,200);
 const firstUser=(await first.clone().json()).user;
 assert.equal(firstUser.role,'user');assert.equal(firstUser.owner,false,'OWNER_EMAIL cannot grant privileges');
 assert.equal(mails.length,0,'signup must not send mail');
 const ownerCookie=sessionCookie(first),owner=firstUser;
 assert.equal((await call('members',null,ownerCookie)).status,403);
 // Explicit operator designation is independent of the supplied email address.
 env.OWNER_USER_ID=owner.id;db.prepare("UPDATE mm_users SET role='admin' WHERE id=?").run(owner.id);
 const duplicate=await signup('owner@example.test');assert.equal(duplicate.status,409);assert.equal(duplicate.headers.get('set-cookie'),null);
 const originalKey=env.AUTH_MAIL_API_KEY;delete env.AUTH_MAIL_API_KEY;
 const userResponse=await signup('user@example.test');assert.equal(userResponse.status,200);
 env.AUTH_MAIL_API_KEY=originalKey;
 const userCookie=sessionCookie(userResponse),user=(await userResponse.json()).user;
 assert.equal(user.role,'user');assert.equal(await authenticated(new Request('https://example.test',{headers:{Cookie:userCookie}}),env),false);
 assert.equal((await (await call('session',null,userCookie)).json()).user.id,user.id);
 assert.equal((await call('login',{email:'user@example.test',password:'Test-only-password123!'})).status,200);
 assert.equal((await call('verify',{token:'a'.repeat(64)})).status,410);
 assert.equal((await call('members',null,userCookie)).status,403);
 assert.equal((await call('legacy-import',{members:[{email:'user@example.test',name:'이전 이름'}]},userCookie)).status,403);
 assert.equal((await call('legacy-import',{members:[{email:'user@example.test',name:'이전 이름'}]},ownerCookie)).status,200);
 assert.equal((await (await call('session',null,userCookie)).json()).user.legacyName,'','unverified email never claims existing member data');
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
 assert.equal(callback.headers.get('location'),'/#home');
 const social=(await (await call('session',null,sessionCookie(callback))).json()).user;
 assert.equal(social.name,'SNS tester');assert.equal(social.role,'user');assert.equal(social.email,'');assert.notEqual(social.id,owner.id,'provider email must not take over owner');
 const kakaoLogin=async()=>{const start=await call('oauth/kakao/start'),state=new URL(start.headers.get('location')).searchParams.get('state');return onRequest({env,params:{path:['oauth','kakao','callback']},request:new Request('https://example.test/api/auth/oauth/kakao/callback?state='+state+'&code=mock',{headers:{Cookie:sessionCookie(start)}})});};
 db.prepare('UPDATE mm_users SET name=? WHERE id=?').run('Previously entered name',social.id);
 const repeat=await kakaoLogin();assert.equal(repeat.headers.get('location'),'/#home');
 const again=(await (await call('session',null,sessionCookie(repeat))).json()).user;
 assert.equal(again.id,social.id);assert.equal(again.name,'SNS tester');
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mm_identities WHERE provider='kakao' AND subject=?").get(providerId).n,1);
 db.prepare('UPDATE mm_users SET disabled=1 WHERE id=?').run(social.id);
 const blocked=await kakaoLogin();assert.match(blocked.headers.get('location'),/error=/);assert(!blocked.headers.get('set-cookie').startsWith('mm_session='));
 db.prepare('UPDATE mm_users SET disabled=0 WHERE id=?').run(social.id);
 const naverLogin=async()=>{const start=await call('oauth/naver/start'),state=new URL(start.headers.get('location')).searchParams.get('state');return onRequest({env,params:{path:['oauth','naver','callback']},request:new Request('https://example.test/api/auth/oauth/naver/callback?state='+state+'&code=mock',{headers:{Cookie:sessionCookie(start)}})});};
 const naverResponse=await naverLogin();assert.equal(naverResponse.headers.get('location'),'/#home');
 const naverUser=(await (await call('session',null,sessionCookie(naverResponse))).json()).user;
 assert.equal(naverUser.name,'네이버 별명');assert.equal(naverUser.role,'user');assert.equal(naverUser.email,'');assert.notEqual(naverUser.id,social.id);assert.notEqual(naverUser.id,owner.id);
 naverNickname='바뀐 별명';const naverAgain=await naverLogin();
 const naverUpdated=(await (await call('session',null,sessionCookie(naverAgain))).json()).user;
 assert.equal(naverUpdated.id,naverUser.id);assert.equal(naverUpdated.name,naverNickname);
 db.prepare('UPDATE mm_users SET disabled=1 WHERE id=?').run(naverUser.id);
 assert.match((await naverLogin()).headers.get('location'),/error=/);
 providerId='missing-nickname';naverNickname='';const noNickname=await naverLogin();
 assert.equal((await (await call('session',null,sessionCookie(noNickname))).json()).user.name,'네이버 회원');
 const ownerId=env.OWNER_USER_ID;delete env.OWNER_USER_ID;
 assert.equal((await call('legacy-import',{members:[{email:'legacy@example.test',name:'이전 회원'}]},legacyCookie)).status,200);
 const previous=await call('members?legacy=1',null,legacyCookie);assert.equal(previous.status,200);assert.equal((await previous.json()).total,2);
 assert.equal((await call('members?legacy=1')).status,403);
 assert.equal((await call('members?legacy=1',null,userCookie)).status,403);
 env.OWNER_USER_ID=ownerId;
 // Legacy claim requires a mail token, never just an email or a signup.
 const beforeMail=mails.length;
 assert.equal((await call('legacy',{email:'legacy@example.test'})).status,200);
 assert.equal(mails.length,beforeMail+1);const claimToken=token();
 assert.equal((await call('legacy-activate',{token:'0'.repeat(64),password:'New-legacy-password123!',consent:true})).status,400);
 const claim=await call('legacy-activate',{token:claimToken,password:'New-legacy-password123!',consent:true});assert.equal(claim.status,200);
 const claimed=(await claim.clone().json()).user;assert.equal(claimed.role,'user');assert.equal(claimed.legacyName,'이전 회원');
 assert.equal(db.prepare('SELECT claimed_by FROM mm_legacy_members WHERE email=?').get('legacy@example.test').claimed_by,claimed.id);
 assert.equal((await call('legacy-activate',{token:claimToken,password:'New-legacy-password123!',consent:true})).status,400);
 assert.equal((await call('login',{email:'legacy@example.test',password:'New-legacy-password123!'})).status,200);
 assert.equal((await call('members',null,sessionCookie(claim))).status,403);
 // Existing ordinary account is reused, old sessions invalidated, no duplicate account.
 const same=await signup('same@example.test'),sameCookie=sessionCookie(same),sameId=(await same.json()).user.id;
 await call('legacy-import',{members:[{email:'same@example.test',name:'기존 이름'}]},ownerCookie);
 await call('legacy',{email:'same@example.test'});const sameToken=token();
 const linked=await call('legacy-activate',{token:sameToken,password:'Linked-password123!',consent:true});assert.equal(linked.status,200);assert.equal((await linked.json()).user.id,sameId);
 assert.equal((await (await call('session',null,sameCookie)).json()).user,null);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mm_users WHERE email=?').get('same@example.test').n,1);
 assert.equal((await call('login',{email:'same@example.test',password:'Test-only-password123!'})).status,401);
 // Missing email and privileged accounts reveal no membership; do not send claim links.
 const noMail=mails.length;
 assert.equal((await call('legacy',{email:'missing@example.test'})).status,200);
 assert.equal((await call('legacy',{email:'user@example.test'})).status,200);assert.equal(mails.length,noMail);
 // A role change after issuing the token must not reset an administrator password.
 await call('legacy',{email:'same@example.test'});const promotedToken=token();
 db.prepare("UPDATE mm_users SET role='admin' WHERE id=?").run(sameId);
 assert.equal((await call('legacy-activate',{token:promotedToken,password:'No-reset-password123!',consent:true})).status,409);
 // Expired tokens, disabled accounts, and absent mail configuration.
 await call('legacy',{email:'legacy@example.test'});const expiredToken=token();
 db.prepare("UPDATE mm_auth_tokens SET expires=0 WHERE kind='legacy-activate'").run();
 assert.equal((await call('legacy-activate',{token:expiredToken,password:'Expired-password123!',consent:true})).status,400);
 delete env.AUTH_MAIL_API_KEY;assert.equal((await call('legacy',{email:'legacy@example.test'})).status,503);
 env.AUTH_MAIL_API_KEY=originalKey;
 globalThis.fetch=originalFetch;
});
