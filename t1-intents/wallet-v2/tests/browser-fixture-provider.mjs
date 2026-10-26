// Loaded only by the loopback fixture, before the shipped bootstrap module.
const OWNER='0xc4f8a468f10d5f98dcff3282516125e97f26433b';
const DONOR='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952';
const OTHER='0x1111111111111111111111111111111111111111';
let account=OWNER,chainId='0x279f';
const listeners=new Map();
const provider={isMetaMask:true,on(name,callback){const set=listeners.get(name)||new Set();set.add(callback);listeners.set(name,set)},removeListener(name,callback){listeners.get(name)?.delete(callback)},async request({method}){
 if(method==='eth_accounts')return account?[account]:[];
 if(method==='eth_chainId')return chainId;
 if(method==='eth_requestAccounts')return account?[account]:[];
 throw Error('SYNTHETIC_METHOD_DENIED');
}};
window.ethereum=provider;
window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'synthetic-metamask',name:'Synthetic MetaMask'},provider}})));
function show(){document.getElementById('fixture-status').textContent=`Synthetic account: ${account||'none'} · chain: ${chainId}`}
function change(nextAccount,nextChain){account=nextAccount;chainId=nextChain;for(const fn of listeners.get('accountsChanged')||[])fn(account?[account]:[]);for(const fn of listeners.get('chainChanged')||[])fn(chainId);show()}
document.addEventListener('DOMContentLoaded',()=>{
 for(const [id,a,c] of [['fixture-owner',OWNER,'0x279f'],['fixture-donor',DONOR,'0x279f'],['fixture-other',OTHER,'0x279f'],['fixture-unauthorized',null,'0x279f'],['fixture-wrong-chain',OWNER,'0x1']])document.getElementById(id).addEventListener('click',()=>change(a,c));
 document.getElementById('fixture-api-pending').addEventListener('change',async event=>{
  const pending=event.currentTarget.checked;
  const response=await fetch('/fixture/pending',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pending})});
  document.getElementById('fixture-api-status').textContent=response.ok?`API pending: ${pending}`:'Fixture control failed';
 });
 show();
});
