import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('./public/t1e-claim.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('./public/t1e-claim.html',import.meta.url),'utf8');
const RECIPIENT='0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135';
const ISSUER='0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3';

function browser(initial,{choose=initial,chain='0x279f'}={}){
 const ids=[
  'connect','choose-account','login','who','logout','inspect','prepare',
  'renew','consent','server-mode','login-result','claim-result','consent-result',
  'issuer-result'
 ];
 const elements=Object.fromEntries(ids.map(id=>[id,{
  disabled:true,textContent:'',
  handlers:{},
  addEventListener(type,handler){this.handlers[type]=handler}
 }]));
 const listeners={},calls=[];
 let active=initial;
 const provider={
  isMetaMask:true,
  on(type,listener){listeners[type]=listener},
  async request({method}){
   calls.push(method);
   switch(method){
    case 'eth_requestAccounts': return active?[active]:[];
    case 'eth_accounts': return active?[active]:[];
    case 'eth_chainId': return chain;
    case 'wallet_requestPermissions':
     active=choose;
     listeners.accountsChanged?.(active?[active]:[]);
     return [{parentCapability:'eth_accounts'}];
    default: throw Error('Unexpected MetaMask RPC: '+method);
   }
  }
 };
 const safeStatus={
  chainId:10143,walletLoginEnabled:true,issuerIssueEnabled:false,
  fundEnabled:false,settleEnabled:false,originalCp30Connected:false,
  status:'T1E_ISOLATED_SIWE_READ_ONLY'
 };
 const sandbox={
  window:{ethereum:provider},
  document:{getElementById(id){
   if(!Object.hasOwn(elements,id))throw Error('Unexpected element '+id);
   return elements[id];
  }},
  AbortSignal,
  fetch:async path=>{
   assert.equal(path,'/v1/t1e/status');
   return {ok:true,status:200,json:async()=>safeStatus};
  }
 };
 runInNewContext(script,sandbox,{filename:'t1e-claim.mjs'});
 return {
  calls,elements,
  async ready(){await new Promise(resolve=>setImmediate(resolve))},
  async click(id){
   assert.equal(elements[id].disabled,false,'disabled button '+id);
   await elements[id].handlers.click();
  },
  changeAccount(next){
   active=next;
   listeners.accountsChanged?.(next?[next]:[]);
  }
 };
}

test('UI exposes an explicit user-click account chooser, never an automatic signature',()=>{
 assert.match(html,/id="choose-account" disabled/);
 assert.match(html,/id="connect" disabled/);
 assert.match(script,/wallet_requestPermissions/);
 for(const method of ['eth_sendTransaction','eth_sendRawTransaction','privateKeyToAccount'])
  assert.equal(script.includes(method),false,method);
});
test('unapproved MetaMask wallet never arms the SIWE login control',async()=>{
 const b=browser('0x'+'a'.repeat(40));
 await b.ready();
 await b.click('connect');
 assert.equal(b.elements.login.disabled,true);
 assert.equal(b.elements.who.disabled,true);
 assert.match(b.elements['login-result'].textContent,/重新选择钱包/);
 assert.equal(b.calls.includes('personal_sign'),false);
});
test('explicit account re-selection verifies current eth_accounts and ignores duplicate event',async()=>{
 const b=browser('0x'+'b'.repeat(40),{choose:RECIPIENT});
 await b.ready();
 await b.click('choose-account');
 assert.equal(b.elements.login.disabled,false);
 assert.equal(b.elements.who.disabled,true);
 assert.match(b.elements['login-result'].textContent,/Recipient 受助者/);
 assert.ok(b.calls.includes('wallet_requestPermissions'));
 assert.ok(b.calls.includes('eth_accounts'));
 b.changeAccount(RECIPIENT);
 assert.equal(b.elements.login.disabled,false,'same-account event must not erase selection');
 b.changeAccount(ISSUER);
 assert.equal(b.elements.login.disabled,true,'changed wallet clears pending login');
 assert.match(b.elements['login-result'].textContent,/重新完成 T1-E 登录/);
 assert.equal(b.calls.includes('personal_sign'),false);
});
test('unexpected network cannot arm a login even for the pinned recipient',async()=>{
 const b=browser(RECIPIENT,{chain:'0x1'});
 await b.ready();
 await b.click('connect');
 assert.equal(b.elements.login.disabled,true);
 assert.match(b.elements['login-result'].textContent,/Monad Testnet/);
});