import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/t1f-issuer.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('./public/t1f-issuer.html',import.meta.url),'utf8');
const ISSUER='0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3';
function browser(account){
 const ids=['connect','choose','login','inspect','logout','reserve','send','bind',
 'reconcile','original-hash','identity','reservation','receipt','t1f-stage'];
 const buttons=Object.fromEntries(ids.map(id=>[id,{
  disabled:true,value:'',textContent:'',listeners:{},
  addEventListener(type,cb){this.listeners[type]=cb}
 }]));
 const calls=[],listeners={};
 let selected=account;
 const eth={
  isMetaMask:true,
  on(type,cb){listeners[type]=cb},
  async request({method}){
   calls.push(method);
   if(method==='eth_requestAccounts'||method==='eth_accounts')
    return selected?[selected]:[];
   if(method==='eth_chainId')return '0x279f';
   if(method==='wallet_requestPermissions')return [];
   throw Error('UNREVIEWED_WALLET_CALL_'+method);
  }
 };
 const fake={
  window:{ethereum:eth},
  document:{getElementById(id){
   assert.ok(buttons[id],'unexpected HTML id '+id);return buttons[id];
  }},
  AbortSignal,
  fetch:async path=>{
   assert.equal(path,'/v1/t1e/status');
   return {ok:true,json:async()=>({
    chainId:10143,issuerIssueEnabled:true,
    fundEnabled:false,settleEnabled:false,originalCp30Connected:false
   })};
  }
 };
 runInNewContext(source,fake,{filename:'t1f-issuer.mjs'});
 return {buttons,calls,listeners,
  ready:()=>new Promise(resolve=>setImmediate(resolve)),
  async click(id){assert.equal(buttons[id].disabled,false,id+' disabled');
   await buttons[id].listeners.click()}
 };
}
test('a wallet-controlled transaction is never fired automatically',async()=>{
 assert.match(html,/id="send" disabled/);
 assert.match(html,/id="reserve" disabled/);
 assert.match(html,/fbab3b22-965d-44e2-b144-d7307b7aa8ea/);
 assert.match(source,/\$\('send'\)\.addEventListener\('click'/);
 assert.match(source,/eth_sendTransaction/);
 assert.match(source,/reservedTransaction=null;submitted=true/);
 assert.equal(source.includes('eth_sendRawTransaction'),false);
 assert.equal(source.includes('privateKeyToAccount'),false);
 const b=browser(ISSUER);
 await b.ready();
 assert.equal(b.buttons.send.disabled,true);
 assert.equal(b.buttons.reserve.disabled,true);
 assert.equal(b.calls.includes('eth_sendTransaction'),false);
});
test('an unregistered account cannot arm Issuer SIWE or issue buttons',async()=>{
 const b=browser('0x'+'a'.repeat(40));
 await b.ready();
 await b.click('connect');
 assert.equal(b.buttons.login.disabled,true);
 assert.equal(b.buttons.reserve.disabled,true);
 assert.equal(b.buttons.send.disabled,true);
 assert.equal(b.calls.includes('personal_sign'),false);
 assert.equal(b.calls.includes('eth_sendTransaction'),false);
});
test('accountChanged event clears all wallet-owned Issuer abilities',async()=>{
 const b=browser(ISSUER);
 await b.ready();
 await b.click('connect');
 assert.equal(b.buttons.login.disabled,false);
 b.listeners.accountsChanged(['0x'+'b'.repeat(40)]);
 assert.equal(b.buttons.login.disabled,true);
 assert.equal(b.buttons.reserve.disabled,true);
 assert.equal(b.buttons.send.disabled,true);
});

test('original Issue send deadline fail-closes after expiration and with short remaining window',()=>{
 const declaration=source.match(/function issueWindowOpen\([\s\S]*?\n}/);
 assert.ok(declaration,'issuer issue-window guard must exist');
 const scope={SEND_WINDOW_MIN_SEC:90};
 runInNewContext(declaration[0],scope);
 const open=scope.issueWindowOpen;
 assert.equal(open({stage:'CONSENT_VERIFIED',issuerDeadline:'1000'},100),false);
 assert.equal(open({stage:'ISSUE_UNKNOWN',issuerDeadline:'1000'},850),true);
 assert.equal(open({stage:'ISSUE_UNKNOWN',issuerDeadline:'1000'},910),false);
 assert.equal(open({stage:'ISSUE_UNKNOWN',issuerDeadline:'1000'},1000),false);
 assert.equal(open({stage:'ISSUE_UNKNOWN',issuerDeadline:null},100),false);
 assert.equal(open({stage:'ISSUE_UNKNOWN',issuerDeadline:'99999999'},100),false);
 assert.match(source,/!issueWindowOpen\(claim\)/);
 assert.match(source,/!issueWindowOpen\(latestClaim,serverNow\)/);
 assert.match(source,/reservedTransaction=null;submitted=true/);
 assert.match(source,/latestClaim\.originalTxHash!==null/);
 assert.match(source,/answer\.created===false/);
});
