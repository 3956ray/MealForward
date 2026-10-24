/**
 * T1-F: no auto transaction. Wallet sends exactly once after DB reservation;
 * all recoveries use one original hash. No cookies/signatures in storage.
 */
const issuer='0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3';
const escrow='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58';
const $=id=>document.getElementById(id);
let wallet=null,csrf=null,session=null,mode=false,busy=false;
let claim=null,reservedTransaction=null,originalHash=null,submitted=false;
const h32=/^0x[0-9a-f]{64}$/i;
const SEND_WINDOW_MIN_SEC=90;
// This guard is intentionally duplicated at click time, not just used to
// disable a button. MetaMask can keep a page open past the transaction
// deadline, and a pre-expiry reservation cannot be unreserved or replayed.
function issueWindowOpen(row,now=Math.floor(Date.now()/1000)){
 const expiry=Number(row?.issuerDeadline);
 return row?.stage==='ISSUE_UNKNOWN'&&Number.isSafeInteger(now)&&
  Number.isSafeInteger(expiry)&&expiry>now+SEND_WINDOW_MIN_SEC&&
  expiry<=now+600;
}
const msg=(id,value)=>{$(id).textContent=value};
function enable(){
 const eligible=wallet===issuer,logged=eligible&&session===issuer&&!!csrf;
 $('connect').disabled=!mode||busy;
 $('choose').disabled=!mode||busy;
 $('login').disabled=!mode||!eligible||logged||busy;
 $('inspect').disabled=!logged||busy;
 $('logout').disabled=!logged||busy;
 $('reserve').disabled=!logged||busy||claim?.stage!=='CONSENT_VERIFIED'||
   reservedTransaction!==null||submitted;
 $('send').disabled=!logged||busy||!reservedTransaction||submitted||
  !issueWindowOpen(claim);
 $('bind').disabled=!logged||busy||!h32.test($('original-hash').value||'');
 $('reconcile').disabled=!logged||busy||claim?.stage!=='ISSUE_HASH_BOUND';
}
function provider(){
 if(window.ethereum?.isMetaMask!==true||!window.ethereum.request)
  throw Error('本次 Issuer 操作需要 MetaMask。');
 return window.ethereum;
}
async function api(path,method='GET',body,headers={}){
 const r=await fetch(path,{
  method,cache:'no-store',credentials:'same-origin',redirect:'error',
  headers:{Accept:'application/json',
   ...(method==='POST'?{'Content-Type':'application/json'}:{}),...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(45000)
 });
 const data=await r.json();
 if(!r.ok)throw Error((data?.error||'HTTP_ERROR')+' · HTTP '+r.status);
 return data;
}
async function checkWallet(){
 const p=provider();
 const [accounts,chain]=await Promise.all([
  p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})
 ]);
 if(accounts?.[0]?.toLowerCase()!==issuer||
    wallet!==issuer||BigInt(chain)!==10143n)
  throw Error('Issuer 钱包或 Monad Testnet 网络发生改变；禁止继续。');
 return p;
}
async function task(fn){
 if(busy)return;
 busy=true;enable();
 try{await fn()}catch(e){
  msg('identity','操作没有通过：'+String(e?.message||'未知错误'));
 }finally{busy=false;enable()}
}
async function connect(choose=false){
 wallet=null;session=null;csrf=null;claim=null;reservedTransaction=null;
 const p=provider();
 if(choose)await p.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]});
 const requested=await p.request({method:'eth_requestAccounts'});
 const [current,chain]=await Promise.all([
  p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})
 ]);
 if(!requested?.[0]||requested[0].toLowerCase()!==current?.[0]?.toLowerCase())
  throw Error('账户正在切换，请重新选择。');
 if(BigInt(chain)!==10143n)throw Error('请先切换到 Monad Testnet 10143。');
 if(current[0].toLowerCase()!==issuer)throw Error('此页面只允许原链上 Issuer 账户。');
 wallet=issuer;
 msg('identity','已连接原 Issuer：'+wallet+'。请完成 SIWE 登录。');
}
$('connect').addEventListener('click',()=>task(()=>connect(false)));
$('choose').addEventListener('click',()=>task(()=>connect(true)));
$('login').addEventListener('click',()=>task(async()=>{
 const p=await checkWallet();
 const pre=await api('/v1/auth/pre-session','POST',{}, {'X-C1-Bootstrap':'1'});
 const challenge=await api('/v1/identity/wallet/challenge','POST',{
  address:issuer
 },{'X-C1-CSRF':pre.csrf});
 if(challenge.chainId!==10143||challenge.address!==issuer||
  !challenge.message.includes('Sign in to MealForward'))
  throw Error('SIWE 登录挑战不符合固定原 Issuer。');
 const sig=await p.request({method:'personal_sign',params:[challenge.message,issuer]});
 await checkWallet();
 const done=await api('/v1/identity/wallet/login','POST',{
  challengeId:challenge.challengeId,signature:sig
 },{'X-C1-CSRF':pre.csrf});
 if(typeof done.csrf!=='string'||done.csrf.length!==43)
  throw Error('SIWE 服务未返回有效 CSRF。');
 csrf=done.csrf;
 const me=await api('/v1/t1e/me');
 if(me.walletAddress!==issuer||me.role!=='issuer'||me.sessionScope!=='T1E_ISOLATED')
  throw Error('服务器没有确认原 Issuer 身份。');
 session=issuer;
 msg('identity','SIWE PASS · issuer '+session+'。原 Recipient Consent 尚未链上使用。');
}));
async function inspect(){
 await checkWallet();
 const result=await api('/v1/t1f/issuer/status');
 claim=result.claim;
 if(!claim||claim.claimId!=='fbab3b22-965d-44e2-b144-d7307b7aa8ea'||
    result.fundedAgainAllowed!==false||result.merchantSettlementEnabled!==false)
  throw Error('原 Claim 身份或资金保护不符合预期。');
 if(claim.originalTxHash){
  originalHash=claim.originalTxHash;
  $('original-hash').value=originalHash;
 }
 const expired=claim.stage==='ISSUE_UNKNOWN'&&!issueWindowOpen(claim);
 if(expired){reservedTransaction=null;submitted=true;}
 msg('reservation','唯一 Claim：'+claim.claimId+
  '\nStage：'+claim.stage+
  '\nVoucher：'+claim.voucherId+
  '\n预留的 Nonce：'+(claim.originalNonce??'未预留')+
  (expired?'\n原 Issue 交易截止时间已过：禁止发送或重新预留。':'')+
  '\n已预留后绝不再次发券。');
 return claim;
}
$('inspect').addEventListener('click',()=>task(inspect));
$('reserve').addEventListener('click',()=>task(async()=>{
 if(!claim||claim.stage!=='CONSENT_VERIFIED'||reservedTransaction)
  throw Error('请先读取并核验未发券的原始 Claim。');
 const p=await checkWallet();
 const pending=await p.request({
  method:'eth_getTransactionCount',params:[issuer,'pending']
 });
 const answer=await api('/v1/t1f/issuer/prepare','POST',{
  issuerPendingNonce:String(BigInt(pending))
 },{'X-C1-CSRF':csrf});
 if(answer.created===false){
  claim=answer.state;reservedTransaction=null;submitted=true;
  msg('reservation','此 Claim 已存在唯一原始 Issue 预留（'+
   claim?.stage+'）。第二次点击不会创建新 Nonce 或新交易；只能恢复原交易。');
  return;
 }
 if(answer.created!==true||answer.firstWalletSendPermitted!==true||
   answer.state?.stage!=='ISSUE_UNKNOWN')
  throw Error('无法确认首次原始 Issue 预留，禁止发送。');
 const tx=answer.issueTransaction;
 if(!tx||tx.from?.toLowerCase()!==issuer||tx.to?.toLowerCase()!==escrow||
    BigInt(tx.chainId)!==10143n||BigInt(tx.value)!==0n||
    !/^0x[0-9a-f]+$/i.test(tx.data||''))
  throw Error('原始交易字节预检失败；数据库已经预留，请勿重试。');
 // The server's ISSUE_UNKNOWN is now committed. Keep one wallet-send payload
 // in ephemeral memory only, not localStorage or an auto-resend queue.
 claim=answer.state;
 if(!issueWindowOpen(claim)){
  reservedTransaction=null;submitted=true;
  msg('reservation','原始 Issue 已永久预留，但是剩余有效时间不足。'+
   '\n为避免过期交易，已锁定发送；不可重试预留。');
  return;
 }
 reservedTransaction=tx;
 msg('reservation','已永久保存原始 Operation、Nonce 和发券截止时间。'+
  '\nNonce：'+answer.state.originalNonce+
  '\n截止时间：'+new Date(Number(answer.state.issuerDeadline)*1000).toLocaleString()+
  '\n下一步仅可本人点击一次「MetaMask 发送唯一 Issue」。');
}));
$('send').addEventListener('click',()=>task(async()=>{
 if(!reservedTransaction||submitted||claim?.stage!=='ISSUE_UNKNOWN')
  throw Error('没有待发送的唯一已预留交易。');
 if(!issueWindowOpen(claim)){
  reservedTransaction=null;submitted=true;
  throw Error('原始 Issue 截止时间已过或太近，禁止发送，保留 ISSUE_UNKNOWN 待核验。');
 }
 const p=await checkWallet();
 const latest=await api('/v1/t1f/issuer/status');
 const latestClaim=latest.claim;
 const serverNow=latest.serverTimeUnix;
 // Query the independent server clock immediately before the one permitted
 // wallet action. Reject stale or changed reservation without broadcasting.
 if(!Number.isSafeInteger(serverNow)||!issueWindowOpen(latestClaim,serverNow)||
  !issueWindowOpen(latestClaim)||
  latestClaim.claimId!==claim.claimId||
  latestClaim.originalOperationId!==claim.originalOperationId||
  latestClaim.originalNonce!==claim.originalNonce||
  latestClaim.issuerDeadline!==claim.issuerDeadline||
  latestClaim.originalTxHash!==null){
  reservedTransaction=null;submitted=true;
  throw Error('原始 Issue 预留已过期或链下记录改变，已停止发送，请只恢复原交易。');
 }
 await checkWallet();
 const tx=reservedTransaction;
 // Clear the ONLY sendable payload BEFORE invoking MetaMask. Rejections,
 // timeouts, and ambiguous errors must never re-arm this transaction.
 reservedTransaction=null;submitted=true;
 msg('reservation','正在由 Issuer 自行确认唯一 Issue；如断线，不要再次发送！');
 const hash=await p.request({method:'eth_sendTransaction',params:[tx]});
 if(!h32.test(hash||''))throw Error('MetaMask 未返回有效原交易 Hash。请从活动记录找回。');
 originalHash=hash.toLowerCase();$('original-hash').value=originalHash;
 msg('receipt','原交易 Hash：'+originalHash+
  '\n下一步只验证/绑定这笔原交易；不重发。');
 // If the RPC has not indexed it yet, keep the hash in the input for user
 // to retry BIND (not transaction submission).
 try{
  const bound=await api('/v1/t1f/issuer/bind','POST',{
   transactionHash:originalHash
  },{'X-C1-CSRF':csrf});
  claim=bound.state;
  msg('receipt','原交易 Hash 绑定完成。请检查真正的链上 Receipt。');
 }catch(e){
  msg('receipt','已从钱包取得原始 Hash：'+originalHash+
   '\n网络可能尚未索引。稍后点击「验证并绑定原交易」，不要重新发券。'+
   '\n'+String(e?.message||''));
 }
}));
$('original-hash').addEventListener('input',enable);
$('bind').addEventListener('click',()=>task(async()=>{
 await checkWallet();
 const hash=$('original-hash').value.trim().toLowerCase();
 if(!h32.test(hash))throw Error('需要原始 0x 交易 Hash。');
 const result=await api('/v1/t1f/issuer/bind','POST',{
  transactionHash:hash
 },{'X-C1-CSRF':csrf});
 claim=result.state;originalHash=hash;
 msg('receipt','原始交易已独立验证并绑定：'+hash+
  '\n点击「检查原始 Receipt」，本页不会重发。');
}));
$('reconcile').addEventListener('click',()=>task(async()=>{
 await checkWallet();
 const result=await api('/v1/t1f/issuer/reconcile','POST',{},{
  'X-C1-CSRF':csrf
 });
 claim=result.state;
 msg('receipt',result.state.stage==='ISSUED'?
  'PASS：唯一餐券已链上发行，原始 Receipt 已验证。'+
  '\nHash：'+result.state.originalTxHash:
  '原交易仍处于 '+result.state.stage+'；'+
  (result.proof?.status||'等待真实 Receipt')+
  '。不可再次发送 issue()。');
}));
$('logout').addEventListener('click',()=>task(async()=>{
 await api('/v1/auth/logout','POST',{}, {'X-C1-CSRF':csrf});
 wallet=null;session=null;csrf=null;claim=null;reservedTransaction=null;
 msg('identity','已安全注销。已预留的链上操作仍不可重复。');
}));
function changed(accounts){
 const newAccount=Array.isArray(accounts)&&accounts[0]?.toLowerCase();
 if(newAccount===wallet)return;
 wallet=null;csrf=null;session=null;claim=null;reservedTransaction=null;
 msg('identity','钱包已变化，原交易不可再次发送；请重新登录。');
 enable();
}
window.ethereum?.on?.('accountsChanged',changed);
window.ethereum?.on?.('chainChanged',()=>changed());
(async()=>{
 try{
  const status=await api('/v1/t1e/status');
  if(status.chainId!==10143||status.issuerIssueEnabled!==true||
    status.fundEnabled!==false||status.settleEnabled!==false||
    status.originalCp30Connected!==false)
   throw Error('Issuer Issue 专用安全门禁未开放。');
  mode=true;
  msg('t1f-stage','T1-F · Issuer wallet only · NO SETTLE');
  msg('identity','公网授权门禁通过，请选择原 Issuer 钱包。');
 }catch(e){
  msg('t1f-stage','ISSUE HOLD · '+String(e?.message||''));
  msg('identity','未开放发券，请保留唯一 Claim，等待安全验收。');
 }finally{enable()}
})();