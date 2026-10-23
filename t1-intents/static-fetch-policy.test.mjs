import test from 'node:test';
import assert from 'node:assert/strict';
import {allowStaticFetchSite,allowStaticQuery} from './static-fetch-policy.mjs';

const entry=(path='/',over={})=>({
 path,method:'GET',
 headers:{
  'sec-fetch-site':'cross-site',
  'sec-fetch-mode':'navigate',
  'sec-fetch-dest':'document',
  'sec-fetch-user':'?1',
  ...over
 }
});
test('public, unpersonalized document responds to all real browser link metadata',()=>{
 for(const path of ['/','/fund-testnet.html']){
  for(const site of ['cross-site','same-site','same-origin','none',undefined]){
   for(const mode of ['navigate','cors','no-cors',undefined]){
    for(const dest of ['document','iframe','empty',undefined]){
     const req=entry(path,{
      'sec-fetch-site':site,'sec-fetch-mode':mode,
      'sec-fetch-dest':dest,
      origin:'https://chatgpt.com'
     });
     assert.equal(allowStaticFetchSite(req),true,
      JSON.stringify({path,site,mode,dest}));
     assert.equal(allowStaticFetchSite({...req,method:'HEAD'}),true);
    }
   }
  }
 }
});
test('cross-site JS/CSS remain blocked, even with fake navigation headers',()=>{
 for(const path of ['/ui.mjs','/ui.css']){
  for(const site of ['cross-site','opaque']){
   assert.equal(allowStaticFetchSite(entry(path,{
    'sec-fetch-site':site
   })),false);
  }
  for(const site of ['none','same-origin','same-site',undefined]){
   assert.equal(allowStaticFetchSite(entry(path,{
    'sec-fetch-site':site
   })),true);
  }
 }
});
test('policy cannot turn non-document API or any write method into a static fetch',()=>{
 for(const path of ['/','/fund-testnet.html']){
  for(const method of ['POST','PUT','PATCH','DELETE']){
   assert.equal(allowStaticFetchSite({...entry(path),method}),false);
  }
 }
 for(const path of ['/v1/me','/v1/t1/status','/v1/t1/fund/quote']){
  assert.equal(allowStaticFetchSite(entry(path)),false);
 }
});

test('ChatGPT UTM and other tracking params to unpersonalized HTML cannot produce a 403',()=>{
 const safe=[
  '', '?utm_source=chatgpt.com',
  '?utm_source=chatgpt.com&utm_medium=referral',
  '?gclid=example-opaque-click-id',
  '?utm_source=chatgpt.com&fbclid=opaque',
  '?utm_source=%3Cscript%3E',
  '?unknown=untrusted'
 ];
 for(const path of ['/','/fund-testnet.html']){
  for(const search of safe){
   assert.equal(allowStaticQuery({path,search}),true,
    JSON.stringify({path,search}));
  }
 }
});
test('tracking URLs cannot relax JS/CSS, API or excessive-query policy',()=>{
 for(const path of ['/ui.mjs','/ui.css','/v1/me',
  '/v1/t1/status','/v1/t1/fund/quote']){
  assert.equal(allowStaticQuery({path,search:'?utm_source=chatgpt.com'}),false,path);
  assert.equal(allowStaticQuery({path,search:''}),true,path);
 }
 for(const path of ['/','/fund-testnet.html']){
  assert.equal(allowStaticQuery({path,search:'?'+ 'x'.repeat(2048)}),false);
  assert.equal(allowStaticQuery({path,search:null}),false);
  assert.equal(allowStaticQuery({path,search:'utm_source=chatgpt.com'}),false);
 }
});
