/**
 * T1-F browser-only original Issuer EOA proof.
 *
 * Exactly ONE wallet prompt method may sign: personal_sign.
 * No transaction, typed FundingQuote, Issue/Settle, server credential,
 * contract RPC write, signature upload or persistent browser storage.
 */
import {
 ISSUER_ORIGIN,ISSUER_ADDRESS,ISSUER_CHAIN_HEX,
 buildIssuerControlChallenge,verifyIssuerControlChallenge
} from '/t1f-issuer-control.mjs';

const $=id=>document.getElementById(id);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const fail=(test,code)=>{if(!test)throw Error(code)};
const WHITELIST=new Set(['eth_requestAccounts','eth_accounts','eth_chainId','personal_sign']);
let account=null;
let busy=false;
let revision=0;
let passed=false;

function readout(id,value,success=null){
 const e=$(id);
 e.textContent=value;
 e.dataset.state=success===null?'':success?'ok':'bad';
}
function buttons(){
 $('t1f-connect').disabled=busy;
 $('t1f-prove').disabled=busy||!account||passed;
 $('t1f-check').disabled=busy;
 $('t1f-reset').disabled=busy;
}
function reset(reason){
 revision++;
 account=null;passed=false;
 readout('t1f-connect-result',reason||'请选择独立 Issuer 钱包，重新连接。');
 readout('t1f-proof-result','尚未签署独立 Issuer 控制权挑战。');
 buttons();
}
async function wallet(method,params=[]){
 fail(WHITELIST.has(method),'T1F_UNREVIEWED_WALLET_METHOD');
 fail(window.ethereum?.isMetaMask===true&&
  typeof window.ethereum?.request==='function','T1F_METAMASK_EXTENSION_REQUIRED');
 return window.ethereum.request({method,params});
}
async function assureIssuer(){
 fail(same(location.origin,ISSUER_ORIGIN),'T1F_UNREVIEWED_PUBLIC_ORIGIN');
 const [id,addresses]=await Promise.all([
  wallet('eth_chainId'),wallet('eth_accounts')
 ]);
 fail(BigInt(id)===BigInt(ISSUER_CHAIN_HEX),'T1F_WRONG_TESTNET_CHAIN');
 fail(same(addresses?.[0],ISSUER_ADDRESS)&&
  same(addresses[0],account),'T1F_REGISTERED_ISSUER_WALLET_REQUIRED');
}
const guarded=fn=>async()=>{
 if(busy)return;
 busy=true;buttons();
 try{await fn()}
 catch(error){
  const code=/^T1F_[A-Z0-9_]+$/.test(error?.message||'')?
   error.message:'T1F_METAMASK_ACTION_NOT_CONFIRMED';
  readout('t1f-proof-result','未通过本次验权：'+code,false);
 }finally{busy=false;buttons()}
};
window.ethereum?.on?.('accountsChanged',()=>reset('检测到 MetaMask 账户切换，所有旧结果已经失效。'));
window.ethereum?.on?.('chainChanged',()=>reset('检测到 MetaMask 网络切换，所有旧结果已经失效。'));

$('t1f-connect').addEventListener('click',guarded(async()=>{
 const chain=await wallet('eth_chainId');
 fail(BigInt(chain)===BigInt(ISSUER_CHAIN_HEX),'T1F_WRONG_TESTNET_CHAIN');
 const accounts=await wallet('eth_requestAccounts');
 fail(same(accounts?.[0],ISSUER_ADDRESS),'T1F_REGISTERED_ISSUER_WALLET_REQUIRED');
 account=accounts[0];
 passed=false;revision++;
 await assureIssuer();
 readout('t1f-connect-result',
  'PASS：已连接原 T0 Issuer EOA\n'+account+
  '\nMonad Testnet 10143。钱包持有权尚待签名验证。',true);
 readout('t1f-proof-result','已连接，尚未发起 EIP-191 本地验权。');
}));

$('t1f-prove').addEventListener('click',guarded(async()=>{
 fail(account!==null,'T1F_CONNECT_ISSUER_FIRST');
 await assureIssuer();
 fail(typeof globalThis.crypto?.getRandomValues==='function',
  'T1F_BROWSER_CRYPTO_NONCE_UNAVAILABLE');
 fail(typeof window.ethers?.verifyMessage==='function',
  'T1F_PINNED_LOCAL_EIP191_VERIFIER_UNAVAILABLE');
 const epoch=revision;
 const nonceBytes=new Uint8Array(32);
 globalThis.crypto.getRandomValues(nonceBytes);
 const nonce='0x'+Array.from(nonceBytes,b=>b.toString(16).padStart(2,'0')).join('');
 const start=Math.floor(Date.now()/1000);
 const challenge=buildIssuerControlChallenge({
  origin:location.origin,address:account,nonce,issuedAt:start
 });
 // EXACTLY one optional human-triggered EIP191 signing prompt.
 // Signature remains in local function scope, never logged or POSTed.
 const signature=await wallet('personal_sign',[challenge.text,account]);
 await assureIssuer();
 fail(revision===epoch,'T1F_WALLET_CHANGED_DURING_PROOF');
 const proof=verifyIssuerControlChallenge({
  challenge,signature,selectedAccount:account,
  chainId:ISSUER_CHAIN_HEX,origin:location.origin,
  now:Math.floor(Date.now()/1000),
  recover:window.ethers.verifyMessage
 });
 fail(proof.validForServerAuthorization===false&&
  proof.transactionsSent===0,'T1F_LOCAL_ONLY_ATTESTATION_REQUIRED');
 passed=true;
 readout('t1f-proof-result',
  'PASS：Issuer EIP-191 本地签名及恢复地址匹配\n'+
  proof.verifiedAddress+'\n'+
  '该证明只在本浏览器会话中显示，没有传给服务器。\n'+
  '未产生 Issue、Approve、Fund 或 Settle 交易。\n'+
  '下一步仍需独立受助者领取许可与 Issuer 原操作预留。',true);
}));

$('t1f-check').addEventListener('click',guarded(async()=>{
 fail(location.origin===ISSUER_ORIGIN,'T1F_ORIGIN_CHANGED');
 const response=await fetch('/v1/t1/status',{
  method:'GET',credentials:'omit',redirect:'error',cache:'no-store',
  headers:{Accept:'application/json'},signal:AbortSignal.timeout(22000)
 });
 fail(response.status===200,'T1F_READONLY_STATUS_HTTP_DENIED');
 const value=await response.json();
 fail(value.network===10143&&value.testnetOnly===true&&
  value.originalCp30DataConnected===false,
  'T1F_ORIGINAL_TESTNET_SERVICE_UNVERIFIED');
 readout('t1f-connect-result',
  'PASS：服务仍在 Monad Testnet 10143，原 CP30 未连接。\n'+
  '此查询是公开只读状态；它不授权 Issue 或其他链上资金操作。',true);
}));
$('t1f-reset').addEventListener('click',()=>reset('本地控制权证明已清除，无会话或签名被保存。'));
buttons();
