import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync('cloud-products.js','utf8').split('function cloudLoginPanel()')[0];
const auth=readFileSync('auth-ui.js','utf8').split('function authConsent()')[0];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function setup(fetch){
  const context=vm.createContext({fetch,URLSearchParams,location:{hostname:'example.test',search:''},setTimeout:fn=>fn(),attachmentData:{},sessionStorage:{setItem(){}},applied:null});
  vm.runInContext(source+'\n'+auth+'\ncloudApplyRows=rows=>{applied=rows;};',context);
  return expression=>vm.runInContext(expression,context);
}
test('catalog recovers from transient 503 and clears its old error',async()=>{
  let calls=0;
  const run=setup(async url=>url.includes('attachments')?json({attachments:{}}):++calls===1?json({error:'temporary'},503):json({products:[{id:'one',published:true}],next:null}));
  run("cloudError='old error'");
  await run('cloudLoadProducts()');
  assert.equal(calls,2);
  assert.equal(run('cloudError'),'');
  assert.equal(run('applied[0].id'),'one');
});
test('persistent failure stays visible without replacing the catalog',async()=>{
  let calls=0;
  const run=setup(async url=>url.includes('attachments')?json({attachments:{}}):(calls++,json({error:'storage unavailable'},503)));
  run("cloudError='storage unavailable'");
  await assert.rejects(run('cloudLoadProducts()'),/storage unavailable/);
  assert.equal(calls,3);
  assert.equal(run('applied'),null);
  assert.equal(run('cloudError'),'storage unavailable');
});
test('session GET recovers from a network failure',async()=>{
  let calls=0;
  const run=setup(async()=>{if(++calls===1)throw new TypeError('network');return json({user:null});});
  assert.equal((await run("authFetch('session')")).user,null);
  assert.equal(calls,2);
});
test('login POST and unauthorized GET are never retried',async()=>{
  let calls=0;
  const run=setup(async()=>{calls++;return json({error:'failed'},503);});
  await assert.rejects(run("authFetch('login',{password:'test'})"),/failed/);
  assert.equal(calls,1);
  let denied=0;
  const check=setup(async()=>{denied++;return json({error:'denied'},401);});
  await assert.rejects(check("cloudRequest('session')"),/denied/);
  assert.equal(denied,1);
});
test('aborted requests are not retried',async()=>{
  let calls=0;
  const run=setup(async()=>{calls++;throw new DOMException('cancelled','AbortError');});
  await assert.rejects(run("cloudFetch('/test')"),{name:'AbortError'});
  assert.equal(calls,1);
});
