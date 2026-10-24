import test from 'node:test';
import assert from 'node:assert/strict';
import {safeStaticQuery} from './t1e-claim-server.mjs';

test('static Issuer HTML permits harmless ChatGPT and referral query parameters',()=>{
 for(const q of [
  '?utm_source=chatgpt.com',
  '?utm_source=chatgpt.com&utm_medium=referral',
  '?utm_campaign=t1f-test&umedium=x'.replace('umedium=x','utm_medium=x'),
  ''
 ])assert.equal(safeStaticQuery('/t1f-issuer.html',q),true,q);
});
test('query never supplies account, claim, redirect or script routing',()=>{
 for(const q of [
  '?wallet=0x123','?claimId=fbab3b22-965d-44e2-b144-d7307b7aa8ea',
  '?next=https://attacker.invalid',
  '?utm_source=chatgpt.com&utm_source=evil.com',
  '?utm_source=','?utm_source=%3Cscript%3E',
  '?utm_source=chatgpt.com&wallet=0x123',
  '?utm_source='+('a'.repeat(401))
 ])assert.equal(safeStaticQuery('/t1f-issuer.html',q),false,q.slice(0,50));
 for(const path of ['/t1f-issuer.mjs','/t1e-claim.mjs',
  '/v1/t1f/issuer/status','/v1/t1e/status']){
  assert.equal(safeStaticQuery(path,'?utm_source=chatgpt.com'),false,path);
 }
});
test('keep original no-store root URL compatibility and query length limit',()=>{
 assert.equal(safeStaticQuery('/','?utm_source=chatgpt.com'),true);
 assert.equal(safeStaticQuery('/t1f-issuer.html',''),true);
 assert.equal(safeStaticQuery('/','?'+'a'.repeat(401)),false);
});
