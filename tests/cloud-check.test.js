import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/cloud/check.js';
const secret = 'test-only-key-not-for-deployment';
function request(key = secret, origin = 'https://example.com') {
  return new Request('https://example.com/api/cloud/check', { method:'POST', headers:{Origin:origin, Authorization:'Bearer '+key} });
}
function database() {
  const rows = new Map();
  return { rows, prepare(sql) {
    let args;
    return {
      bind(...values){args=values;return this;},
      async run(){if(sql.startsWith('INSERT')) rows.set(args[0],args[1]); if(sql.startsWith('DELETE')) rows.delete(args[0]);},
      async first(){return {value:rows.get(args[0])};}
    };
  }};
}
function bucket(fail = false) {
  const files = new Map();
  return {files,async put(k,v){files.set(k,v);},async get(k){if(fail)throw Error('Internal secret must not leak');return {text:async()=>files.get(k)};},async delete(k){files.delete(k);}};
}
test('rejects missing secret, wrong credentials and cross-origin before storage access', async()=>{
  assert.equal((await onRequestPost({request:request(),env:{}})).status,503);
  assert.equal((await onRequestPost({request:request('wrong'),env:{CLOUD_ADMIN_KEY:secret}})).status,401);
  assert.equal((await onRequestPost({request:request(secret,'https://other.example'),env:{CLOUD_ADMIN_KEY:secret}})).status,403);
});
test('writes, reads and cleans up all three bound stores',async()=>{
  const env={CLOUD_ADMIN_KEY:secret,DB:database(),MEDIA:bucket(),PRIVATE_FILES:bucket()};
  const response=await onRequestPost({request:request(),env});
  assert.equal((await response.json()).ok,true);
  assert.equal(env.DB.rows.size+env.MEDIA.files.size+env.PRIVATE_FILES.files.size,0);
});
test('reports missing bindings and cleans up files after read failure',async()=>{
  const env={CLOUD_ADMIN_KEY:secret,MEDIA:bucket(true)};
  const data=await (await onRequestPost({request:request(),env})).json();
  assert.equal(data.ok,false);assert.equal(data.result.length,3);assert.equal(env.MEDIA.files.size,0);
  assert.equal(JSON.stringify(data).includes('Internal secret'),false);
});
