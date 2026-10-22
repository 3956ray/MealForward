import test from 'node:test';
import assert from 'node:assert/strict';
import {allowStaticFetchSite} from './static-fetch-policy.mjs';

const entry=(path='/',over={})=>({
 path,method:'GET',
 headers:{
  'sec-fetch-site':'cross-site',
  'sec-fetch-mode':'navigate',
  'sec-fetch-dest':'document',
  'sec-fetch-user':'?1',...over
 }
});
test('offsite top-level GET navigation to public entry works, including browser link from ChatGPT',()=>{
 assert.equal(allowStaticFetchSite(entry('/')),true);
 assert.equal(allowStaticFetchSite(entry('/fund-testnet.html')),true);
 assert.equal(allowStaticFetchSite(entry('/',{'sec-fetch-user':undefined})),true);
 for(const site of ['none','same-origin',undefined]){
  assert.equal(allowStaticFetchSite(entry('/ui.css',{'sec-fetch-site':site})),true);
 }
});
test('foreign-site HTML frames, API requests, script/css loads or POST stay denied',()=>{
 const blocked=[
  entry('/ui.mjs'),entry('/ui.css'),
  entry('/v1/t1/status'),entry('/v1/me'),
  entry('/',{'sec-fetch-mode':'cors','sec-fetch-dest':'empty'}),
  entry('/',{'sec-fetch-mode':'no-cors','sec-fetch-dest':'image'}),
  entry('/',{'sec-fetch-mode':'navigate','sec-fetch-dest':'iframe'}),
  entry('/',{'sec-fetch-mode':'navigate','sec-fetch-dest':'frame'}),
  entry('/',{'sec-fetch-mode':'navigate','sec-fetch-dest':'script'}),
  entry('/',{origin:'https://chatgpt.com'}),
  entry('/',{'sec-fetch-site':'same-site'}),
  {...entry('/'),method:'POST'},
  {...entry('/fund-testnet.html'),method:'POST'}
 ];
 for(const item of blocked){
  assert.equal(allowStaticFetchSite(item),false,JSON.stringify(item));
 }
});
