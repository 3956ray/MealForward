/* No wallet transaction, token approval, contract call or storage access. */
import {classifyT1EWallet,walletSelectionHelp} from './t1e-wallet-roles.mjs';
const $=id=>document.getElementById(id);
const ORIGIN=location.origin,CHAIN=10143n;
let running=false,revision=0;
const STATE={issuer:null,recipient:null};
const display=(role,text,pass=null)=>{
 const el=$(role+'-result');
 el.textContent=text;el.dataset.state=pass===null?'':pass?'ok':'bad';
};
function preview(role,address){
 const result=classifyT1EWallet(role,address);
 const slot=$(role+'-current-wallet');
 if(slot)slot.textContent=result.wallet?
  result.wallet+' · '+(result.roleName||'钱包地址'):
  '尚未连接或授权 MetaMask';
 return result;
}
async function refreshConnectedWallet(){
 if(!window.ethereum?.request)return;
 const connected=await window.ethereum.request({method:'eth_accounts'});
 const address=connected?.[0]||null;
 preview('issuer',address);
 preview('recipient',address);
}
function invalid(){
 revision++;
 for(const role of ['issuer','recipient']){
  preview(role,null);
  if(STATE[role])display(role,
   'PASS：此前已验证钱包控制权（非当前连接会话）\n'+STATE[role],true);
  else display(role,'钱包或网络已切换，可重新发起独立证明。');
 }
 // Do not treat a historical PASS as the currently connected MetaMask account.
 void refreshConnectedWallet().catch(()=>{});
}
window.ethereum?.on?.('accountsChanged',invalid);
window.ethereum?.on?.('chainChanged',invalid);
function connectEthereum(){
 if(!window.ethereum?.request||window.ethereum.isMetaMask!==true)
  throw Error('请安装并启用 MetaMask。');
 return window.ethereum;
}
async function request(path,method='GET',body){
 const res=await fetch(path,{
  method,redirect:'error',credentials:'same-origin',cache:'no-store',
  headers:{
   Accept:'application/json',
   ...(method==='POST'?{'Content-Type':'application/json'}:{})
  },
  ...(method==='POST'?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(18000)
 });
 const ct=res.headers.get('content-type')||'';
 if(!ct.startsWith('application/json'))throw Error('服务端没有返回 JSON');
 const data=await res.json();
 if(!res.ok)throw Error((data?.error||'HTTP_'+res.status)+' ('+res.status+')');
 return data;
}
async function verify(role){
 if(running)return;
 running=true;
 const button=$(role+'-proof');button.disabled=true;
 display(role,'请核对 MetaMask 钱包与 Monad Testnet 网络…');
 try{
  const provider=connectEthereum();
  const accounts=await provider.request({method:'eth_requestAccounts'});
  const chain=await provider.request({method:'eth_chainId'});
  const version=revision; // freeze AFTER the initial wallet-selection popup
  if(BigInt(chain)!==CHAIN)throw Error('请先切换到 Monad Testnet（Chain ID 10143）');
  const wallet=accounts?.[0];
  if(typeof wallet!=='string'||!/^0x[a-fA-F0-9]{40}$/.test(wallet))
   throw Error('未能读取钱包地址');
  const check=preview(role,wallet);
  if(!check.ok){
   // Client-only explanation. The independent backend role restriction
   // remains unchanged and rejects a spoofed HTTP request as before.
   throw Error(walletSelectionHelp(check)+'\n本次实际连接地址：'+wallet);
  }
  const selected=await provider.request({method:'eth_accounts'});
  if(selected?.[0]?.toLowerCase()!==wallet.toLowerCase())
   throw Error('账户在准备挑战时发生切换，请重新选择受助者钱包');
  const challenge=await request('/v1/t1e/role/challenge','POST',{
   role,address:wallet
  });
  if(challenge.role!==role||
   challenge.address.toLowerCase()!==wallet.toLowerCase()||
   !challenge.message.includes('NOT A LOGIN. NOT A FUNDING QUOTE.')||
   challenge.noWalletTransaction!==true)
   throw Error('钱包挑战消息不符合预期');
  display(role,'MetaMask 即将打开签名弹窗。只能签署钱包控制证明，不能授权资金。');
  const signature=await provider.request({
   method:'personal_sign',params:[challenge.message,wallet]
  });
  const [afterChain,afterAccounts]=await Promise.all([
   provider.request({method:'eth_chainId'}),
   provider.request({method:'eth_accounts'})
  ]);
  if(version!==revision||BigInt(afterChain)!==CHAIN||
   afterAccounts?.[0]?.toLowerCase()!==wallet.toLowerCase())
   throw Error('钱包或网络在签名过程中切换，原挑战作废');
  const result=await request('/v1/t1e/role/verify','POST',{
   challengeId:challenge.challengeId,signature
  });
  if(result.role!==role||result.address.toLowerCase()!==wallet.toLowerCase()||
    result.noSessionCreated!==true||result.noOnchainIssue!==true)
   throw Error('证明响应未通过来源校验');
  STATE[role]=wallet;
  if(STATE.issuer&&STATE.recipient)
   $('cloud-status').textContent='两种独立测试钱包均已验证（仅历史控制证明；没有领取 Session）';
  display(role,'PASS：本次测试钱包控制权已验证。\n'+wallet+
   '\n未建立用户会话、未发行餐券、未转移 USDC。',true);
 }catch(e){
  display(role,'未通过：'+(e?.message||'未知错误'),false);
 }finally{running=false;button.disabled=false}
}
async function selectRecipientAccount(){
 if(running)return;
 running=true;
 const button=$('recipient-switch');
 button.disabled=true;
 display('recipient','请在 MetaMask 中仅选择独立的受助者测试账号（不可使用 Issuer/Quote/Owner）。');
 try{
  const provider=connectEthereum();
  if(typeof provider.request!=='function')throw Error('请启用 MetaMask');
  // Explicit owner click asks MetaMask to show connected-accounts permission.
  // This is NOT a signature, ERC20 approval, wallet transaction or login.
  await provider.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]});
  const [accounts,chain]=await Promise.all([
   provider.request({method:'eth_accounts'}),
   provider.request({method:'eth_chainId'})
  ]);
  if(BigInt(chain)!==CHAIN)throw Error('请先切换 Monad Testnet（Chain ID 10143）');
  const result=preview('recipient',accounts?.[0]);
  display('recipient',walletSelectionHelp(result)+
   (result.wallet?'\n实际连接地址：'+result.wallet:''),result.ok);
 }catch(e){
  display('recipient','无法自动重选账户：'+String(e?.message||'未知错误')+
   '\n你也可以在 MetaMask 的「已连接的网站」中断开本网站，重新只授权独立受助者账户。',false);
 }finally{running=false;button.disabled=false}
}
$('recipient-switch').addEventListener('click',selectRecipientAccount);
$('issuer-proof').addEventListener('click',()=>verify('issuer'));
$('recipient-proof').addEventListener('click',()=>verify('recipient'));
(async()=>{
 try{
  const status=await request('/v1/t1e/status');
  if(status.status!=='T1E_ISSUER_RECIPIENT_WALLET_PROOF_READY'||
    status.chainId!==10143||
    status.walletProofOnly!==true||
    status.claimWriteEnabled!==false||
    status.onchainIssueEnabled!==false||
    status.fundEnabled!==false||
    status.settleEnabled!==false)
   throw Error('安全模式未通过');
  $('cloud-status').textContent='ROLE_PROOF_ONLY · 无数据库写入 · 无资金交易';
  void refreshConnectedWallet().catch(()=>{});
 }catch(e){
  $('cloud-status').textContent='无法确认安全模式：'+(e?.message||'服务暂不可用');
  $('issuer-proof').disabled=true;$('recipient-proof').disabled=true;
 }
})();
