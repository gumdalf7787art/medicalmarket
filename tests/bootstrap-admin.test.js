import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {authSchema,digest} from '../server/auth.js';
import {mac} from '../server/cloud.js';
import {onRequest} from '../functions/api/auth/[[path]].js';
test('first admin requires bootstrap credentials, is atomic and cannot reopen after demotion',async()=>{
 const db=new DatabaseSync(':memory:');
 const DB={prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}};},async batch(items){db.exec('BEGIN');try{const results=[];for(const item of items)results.push(await item.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const env={DB,ADMIN_PASSWORD:'test-only-bootstrap-password'};await authSchema(env);
 db.prepare("INSERT INTO mm_users(id,name,role,created_at,consent_at) VALUES ('one','same name','user','now','now'),('two','same name','user','now','now')").run();
 const token='a'.repeat(64);db.prepare('INSERT INTO mm_sessions VALUES (?,?,?)').run(await digest(token),'one',Date.now()+3600000);
 const value=(Date.now()+3600000)+'.test',admin='mm_admin='+value+'.'+await mac(value,env);
 const call=(id,cookies=admin,origin='https://example.test')=>onRequest({env,params:{path:['bootstrap-admin']},request:new Request('https://example.test/api/auth/bootstrap-admin',{method:'POST',headers:{Origin:origin,Cookie:cookies},body:JSON.stringify({id})})});
 assert.equal((await call('one','')).status,403);
 assert.equal((await call('one',admin,'https://evil.test')).status,403);
 assert.equal((await call('one',admin+'; mm_session='+token)).status,403);
 env.OWNER_USER_ID='owner';assert.equal((await call('one')).status,403);delete env.OWNER_USER_ID;
 assert.equal((await call('missing')).status,409);
 assert.equal((await call('one')).status,200);
 assert.equal(db.prepare("SELECT role FROM mm_users WHERE id='one'").get().role,'admin');
 assert.equal(db.prepare("SELECT role FROM mm_users WHERE id='two'").get().role,'user');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mm_sessions').get().n,0);
 assert.equal((await call('two')).status,409);
 db.prepare("UPDATE mm_users SET role='user'").run();assert.equal((await call('two')).status,409);
 db.close();
});

