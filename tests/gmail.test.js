import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/mail/[[path]].js';
import {mac} from '../server/cloud.js';
import {unseal,seal} from '../server/gmail.js';
test('Gmail OAuth requires admin, binds state to session, encrypts tokens and refreshes without leaking credentials',async()=>{
 const db=new DatabaseSync(':memory:');
 const DB={prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}};},async batch(items){return Promise.all(items.map(x=>x.run()));}};
 const env={DB,ADMIN_PASSWORD:'test-only-admin-password',GMAIL_CLIENT_ID:'client-test',GMAIL_CLIENT_SECRET:'test-client-secret',SITE_URL:'https://member.example.test',GMAIL_SITE_URL:'https://example.test'};
 const value=(Date.now()+3600000)+'.test';const admin='mm_admin='+value+'.'+await mac(value,env);
 const request=(path,method='GET',cookies=admin,origin='https://example.test',body)=>onRequest({env,request:new Request('https://example.test/api/mail/'+path,{method,body,headers:{Cookie:cookies,Origin:origin,'CF-Connecting-IP':'test'}})});
 assert.equal((await request('status','GET','')).status,401);
 assert.equal((await request('oauth/start','POST',admin,'https://evil.test')).status,403);
 assert.equal((await (await request('status')).json()).connected,false);
 const original=globalThis.fetch;let refreshes=0;
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('/token')){const params=new URLSearchParams(options.body);if(params.get('grant_type')==='refresh_token')refreshes++;else assert.equal(params.get('code_verifier').length,64);return Response.json({access_token:'private-access',refresh_token:'private-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'});}
  assert.match(options.headers.Authorization,/private-access/);return Response.json({emailAddress:'sender@example.test'});
 };
 try{
  const start=await request('oauth/start','POST');const url=new URL((await start.json()).url),state=url.searchParams.get('state'),cookies=admin+'; '+start.headers.get('set-cookie').split(';')[0];
  assert.equal(url.searchParams.get('redirect_uri'),'https://example.test/api/mail/oauth/callback');assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const bridge=await request('oauth/callback?state='+state+'&code=test','GET','');assert.equal(bridge.status,200);assert.match(await bridge.text(),/document.forms\[0\].submit/);
  const finish=(cookies,origin='https://example.test')=>request('oauth/callback','POST',cookies,origin,new URLSearchParams({state,code:'test'}).toString());
  assert.equal((await finish('')).status,401);assert.equal((await finish(cookies,'https://evil.test')).status,403);
  assert.match((await finish(admin)).headers.get('location'),/gmail=failed/);
  assert.match((await finish(cookies)).headers.get('location'),/gmail=connected/);
  assert.match((await finish(cookies)).headers.get('location'),/gmail=failed/);
  const row=db.prepare('SELECT * FROM mm_gmail_connection').get();assert.ok(!row.tokens.includes('private-'));
  const tokens=await unseal(env,row.tokens);assert.equal(tokens.refresh_token,'private-refresh');
  await assert.rejects(unseal({...env,GMAIL_CLIENT_SECRET:'different'},row.tokens));
  tokens.expires=0;db.prepare('UPDATE mm_gmail_connection SET tokens=?').run(await seal(env,tokens));
  const status=await (await request('status')).text();assert.equal(JSON.parse(status).connected,true);assert.ok(!status.includes('private-'));assert.equal(refreshes,1);
  globalThis.fetch=async()=>new Response('',{status:401});assert.equal((await (await request('status')).json()).connected,false);
  assert.equal((await request('send','POST')).status,501);
 }finally{globalThis.fetch=original;db.close();}
});
