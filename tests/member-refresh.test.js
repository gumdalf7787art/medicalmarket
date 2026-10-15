import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
test('repeating a member search discards stale results and in-flight responses',()=>{
 const dom=new JSDOM('<form data-member-search="#ops/customerRequests"><input name="q" value=""><input name="stage" value=""></form>',{url:'https://example.test/#ops/customerRequests?q=&stage='});
 let renders=0;
 const context=vm.createContext({document:dom.window.document,FormData:dom.window.FormData,URLSearchParams,location:dom.window.location,authUser:null,render:()=>renders++,queueMicrotask:()=>{}});
 vm.runInContext(readFileSync('member-ui.js','utf8'),context);
 vm.runInContext("memberCache.set('admin?q=&stage=',{total:0});memberLoading.add('admin?q=&stage=')",context);
 dom.window.document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(vm.runInContext('memberCache.size',context),0);
 assert.equal(vm.runInContext('memberLoading.size',context),0);
 assert.equal(vm.runInContext('memberEpoch',context),1);
 assert.equal(renders,1);
});
