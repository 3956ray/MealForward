/* MealForward T1-E isolated SIWE and recipient EIP-712. No TX broadcaster. */
const $=id=>document.getElementById(id);
const RECIPIENT='0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135';
const ISSUER='0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3';
let wallet=null,sessionWallet=null,csrf=null,claim=null,consent=null;
let mode=null,locked=false;
function put(id,message){$(id).textContent=message}
function manage(){
 const eligible=wallet===RECIPIENT||wallet===ISSUER;
 const logged=eligible&&!!sessionWallet&&!!csrf&&sessionWallet===wallet;
 $('connect').disabled=!mode||locked;
 $('choose-account').disabled=!mode||locked;
 $('login').disabled=!eligible||logged||locked;
 $('who').disabled=!logged||locked;
 $('logout').disabled=!logged||locked;
 $('inspect').disabled=!logged||wallet!==RECIPIENT||locked;
 $('prepare').disabled=!logged||mode!=='CLAIM_CONSENT'||wallet!==RECIPIENT||locked||
  !!claim;
 $('renew').disabled=!logged||mode!=='CLAIM_CONSENT'||wallet!==RECIPIENT||
  !claim?.consentNeedsRenewal||locked;
 $('consent').disabled=!logged||mode!=='CLAIM_CONSENT'||wallet!==RECIPIENT||
  !consent||claim?.stage!=='PREPARED'||locked;
}
function guardProvider(){
 if(!window.ethereum?.request||window.ethereum.isMetaMask!==true)
  throw Error('需要 MetaMask 浏览器钱包。');
 return window.ethereum;
}
async function send(path,method='GET',body=null,headers={}){
 const res=await fetch(path,{
  method,redirect:'error',credentials:'same-origin',cache:'no-store',
  headers:{
   Accept:'application/json',
   ...(method==='POST'?{'Content-Type':'application/json'}:{}),
   ...headers
  },
  ...(method==='POST'?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(30000)
 });
 const data=await res.json();
 if(!res.ok)throw Error((data?.error||'HTTP_'+res.status)+' · HTTP '+res.status);
 return data;
}
async function checkWallet(expected){
 const p=guardProvider();
 const [accounts,chain]=await Promise.all([
  p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})
 ]);
 if(BigInt(chain)!==10143n)throw Error('请切换到 Monad Testnet（Chain 10143）');
 if(accounts?.[0]?.toLowerCase()!==expected)
  throw Error('签名过程中钱包或账户发生切换，请重新登录');
 return p;
}
async function perform(fn){
 if(locked)return;
 locked=true;manage();
 try{await fn()}catch(e){put('login-result','操作未通过：'+String(e?.message||'未知错误'))}
 finally{locked=false;manage()}
}
// Never arm SIWE for a rejected account. MetaMask may report a stale
// eth_requestAccounts result while the user is switching site permissions.
// Read the current connected account again before storing any UI identity.
async function connectSelected(choose=false){
 const p=guardProvider();
 wallet=null;sessionWallet=null;csrf=null;claim=null;consent=null;
 if(choose)await p.request({
  method:'wallet_requestPermissions',params:[{eth_accounts:{}}]
 });
 const requested=await p.request({method:'eth_requestAccounts'});
 const [selected,chain]=await Promise.all([
  p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})
 ]);
 const candidate=selected?.[0]?.toLowerCase();
 if(!requested?.[0]||requested[0].toLowerCase()!==candidate)
  throw Error('MetaMask 切换钱包期间连接状态已改变，请重新选择账户');
 if(BigInt(chain)!==10143n)throw Error('请切换到 Monad Testnet（10143）');
 if(candidate!==RECIPIENT&&candidate!==ISSUER)
  throw Error('实际连接账户 '+(candidate||'未知')+
   ' 不属于本次测试的独立受助者或 Issuer，请点击「重新选择钱包」');
 wallet=candidate;
 put('login-result','已连接：'+wallet+
  '\n测试角色：'+(wallet===RECIPIENT?'Recipient 受助者':'Issuer 发行者')+
  '\n下一步需要本人 SIWE 登录证明；不会发送链上交易。');
}
$('connect').addEventListener('click',()=>perform(()=>connectSelected()));
$('choose-account').addEventListener('click',()=>perform(()=>connectSelected(true)));
$('login').addEventListener('click',()=>perform(async()=>{
 if(!wallet)throw Error('请先连接 MetaMask');
 const p=await checkWallet(wallet);
 const pre=await send('/v1/auth/pre-session','POST',{},{
  'X-C1-Bootstrap':'1'
 });
 const challenge=await send('/v1/identity/wallet/challenge','POST',{
  address:wallet
 },{'X-C1-CSRF':pre.csrf});
 if(challenge.chainId!==10143||
  challenge.address!==wallet||
  !challenge.message.includes('Sign in to MealForward'))
  throw Error('登录挑战内容与当前钱包不一致');
 const signature=await p.request({
  method:'personal_sign',
  params:[challenge.message,wallet]
 });
 await checkWallet(wallet);
 const logged=await send('/v1/identity/wallet/login','POST',{
  challengeId:challenge.challengeId,signature
 },{'X-C1-CSRF':pre.csrf});
 if(typeof logged.csrf!=='string'||logged.csrf.length!==43)
  throw Error('服务端没有发放有效 CSRF');
 csrf=logged.csrf;
 const me=await send('/v1/t1e/me');
 if(me.walletAddress!==wallet||me.sessionScope!=='T1E_ISOLATED')
  throw Error('服务端身份与当前钱包不一致');
 sessionWallet=me.walletAddress;
 put('login-result','SIWE PASS · '+sessionWallet+
  '\nRole: '+me.role+'\nSession 使用独立 T1-E Auth，非 T1-D。');
}));
$('who').addEventListener('click',()=>perform(async()=>{
 const me=await send('/v1/t1e/me');
 if(me.walletAddress!==wallet)throw Error('当前钱包与 Session 不一致，请重新登录');
 sessionWallet=me.walletAddress;
 put('login-result','已认证：'+me.walletAddress+' · '+me.role);
 if(me.role==='issuer'){
  const ready=await send('/v1/t1e/issuer/readiness');
  put('issuer-result','Issuer 权限已认证；当前仅可读取 Claim 状态。\n'+
   '领取状态：'+(ready.issuance?.claimStage||'尚未创建')+
   '\n链上 issue 禁止，原资金未转移。');
 }
}));
$('logout').addEventListener('click',()=>perform(async()=>{
 if(!csrf)throw Error('缺少 CSRF，刷新页面后请先重新登录');
 await send('/v1/auth/logout','POST',{}, {'X-C1-CSRF':csrf});
 csrf=null;sessionWallet=null;claim=null;consent=null;
 put('login-result','本次 T1-E 登录已注销。');
 put('claim-result','本次登录已退出；领取记录仍安全保存在独立数据库。');
}));
$('inspect').addEventListener('click',()=>perform(async()=>{
 if(sessionWallet!==wallet)throw Error('当前钱包不是 Session 本人');
 const data=await send('/v1/t1e/claim/me');
 claim=data.claim;consent=data.consent;
 put('claim-result',claim?
  'Claim ID: '+claim.claimId+'\nStage: '+claim.stage+
  '\nUnit 0 / Generation 1\nVoucher: '+claim.voucherId+
  '\nConsent Round '+claim.consentRound+' / '+claim.maxConsentRounds+
  (claim.consentNeedsRenewal?'\n授权已过期，可恢复同一原始 Claim。':'\n不能创建第二份餐券。'):
  '尚未创建测试受助者 Claim。');
 if(consent)put('consent-result',
  '已准备独立受助者授权，尚未签名。\n截止时间：'+
  new Date(Number(consent.expiry)*1000).toLocaleString());
}));
$('prepare').addEventListener('click',()=>perform(async()=>{
 if(wallet!==RECIPIENT||sessionWallet!==wallet||!csrf)
  throw Error('只允许独立受助者测试钱包操作');
 await checkWallet(wallet);
 const data=await send('/v1/t1e/claim/prepare','POST',{},{
  'X-C1-CSRF':csrf
 });
 claim=data.claim;consent=data.consent;
 put('claim-result','原始 Claim 已持久创建：'+claim.claimId+
  '\nStage: '+claim.stage+' · Voucher: '+claim.voucherId+
  '\n再次点击不会创建第二份餐券。');
 put('consent-result',consent?
  'EIP-712 Consent 已准备（尚未签署）。截止：'+
  new Date(Number(consent.expiry)*1000).toLocaleString():
  claim?.consentNeedsRenewal?
   '上一轮授权过期。请点击「原 Claim 授权过期后恢复」，不能新建第二个 Claim。':
   '此 Claim 已进入 '+claim.stage+'，不能重复签署。');
}));
$('renew').addEventListener('click',()=>perform(async()=>{
 if(wallet!==RECIPIENT||sessionWallet!==wallet||!csrf||
  !claim?.consentNeedsRenewal||claim.stage!=='PREPARED')
  throw Error('原 Claim 尚未过期或不属于当前登录钱包');
 await checkWallet(wallet);
 const data=await send('/v1/t1e/claim/renew','POST',{}, {'X-C1-CSRF':csrf});
 if(data.originalClaimReused!==true||data.claim.claimId!==claim.claimId||
   data.claim.consentRound<=claim.consentRound)
  throw Error('原始 Claim 恢复证明未通过');
 claim=data.claim;consent=data.consent;
 put('claim-result','原始 Claim 不变：'+claim.claimId+
  '\n已建立第 '+claim.consentRound+' / '+claim.maxConsentRounds+
  ' 轮新授权窗口；旧 Nonce 永久失效。');
 put('consent-result','现在可以使用 MetaMask 签署新一轮 Consent。\n到期：'+
  new Date(Number(consent.expiry)*1000).toLocaleString());
}));
$('consent').addEventListener('click',()=>perform(async()=>{
 if(wallet!==RECIPIENT||sessionWallet!==wallet||!csrf||
   !claim||claim.stage!=='PREPARED'||!consent)
  throw Error('尚未拥有有效的原始 Claim');
 const p=await checkWallet(wallet);
 if(consent.domain.chainId!==10143||
  consent.metaMaskV4.primaryType!=='RecipientConsent'||
  consent.message.recipient.toLowerCase()!==wallet)
  throw Error('领取授权与当前钱包不符');
 const signature=await p.request({
  method:'eth_signTypedData_v4',
  params:[wallet,JSON.stringify(consent.metaMaskV4)]
 });
 await checkWallet(wallet);
 const result=await send('/v1/t1e/claim/consent','POST',{
  claimId:claim.claimId,signature
 },{'X-C1-CSRF':csrf});
 if(result.status!=='T1E_OFFCHAIN_CONSENT_DURABLY_VERIFIED')
  throw Error('领取签名未保存成功');
 claim=result.claim;consent=null;
 put('consent-result','PASS：独立 EIP-712 Consent 已验证并持久记录。\n'+
  'Stage: '+claim.stage+'\n链上尚未 Issued，无法核销或结算。');
}));
function switched(accounts){
 // Ignore a duplicate event for the very account just selected: MetaMask
 // sometimes emits accountsChanged after eth_requestAccounts resolves.
 const current=Array.isArray(accounts)&&typeof accounts[0]==='string'?
  accounts[0].toLowerCase():null;
 if(wallet&&current===wallet)return;
 wallet=null;sessionWallet=null;csrf=null;claim=null;consent=null;
 put('login-result','钱包账户或网络发生变化，请重新完成 T1-E 登录。');
 manage();
}
window.ethereum?.on?.('accountsChanged',switched);
window.ethereum?.on?.('chainChanged',()=>switched());
(async()=>{
 try{
  const status=await send('/v1/t1e/status');
  if(status.chainId!==10143||status.walletLoginEnabled!==true||
   status.issuerIssueEnabled!==false||status.fundEnabled!==false||
   status.settleEnabled!==false||status.originalCp30Connected!==false||
   !['T1E_ISOLATED_SIWE_READ_ONLY','T1E_RECIPIENT_CONSENT_ONLY'].includes(status.status))
   throw Error('服务安全配置不符合预期');
  mode=status.status==='T1E_RECIPIENT_CONSENT_ONLY'?'CLAIM_CONSENT':'CLAIM_SIWE_ONLY';
  $('server-mode').textContent=mode+' · 无链上资金或发券交易';
  put('login-result','服务安全门禁 PASS，请选择独立测试钱包登录。');
 }catch(e){
  $('server-mode').textContent='未能确认 T1-E 安全门禁：'+String(e?.message||'错误');
  $('connect').disabled=true;
 }finally{manage()}
})();
