/* No wallet transaction, token approval, contract call or storage access. */
const $=id=>document.getElementById(id);
const ORIGIN=location.origin,CHAIN=10143n;
let running=false,revision=0;
const STATE={issuer:null,recipient:null};
const display=(role,text,pass=null)=>{
 const el=$(role+'-result');
 el.textContent=text;el.dataset.state=pass===null?'':pass?'ok':'bad';
};
function invalid(){
 revision++;
 for(const role of ['issuer','recipient']){STATE[role]=null;display(role,'钱包或网络已切换，需要重新证明。',false)}
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
 const version=revision;
 display(role,'请核对 MetaMask 钱包与 Monad Testnet 网络…');
 try{
  const provider=connectEthereum();
  const accounts=await provider.request({method:'eth_requestAccounts'});
  const chain=await provider.request({method:'eth_chainId'});
  if(BigInt(chain)!==CHAIN)throw Error('请先切换到 Monad Testnet（Chain ID 10143）');
  const wallet=accounts?.[0];
  if(typeof wallet!=='string'||!/^0x[a-fA-F0-9]{40}$/.test(wallet))
   throw Error('未能读取钱包地址');
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
  display(role,'PASS：本次测试钱包控制权已验证。\n'+wallet+
   '\n未建立用户会话、未发行餐券、未转移 USDC。',true);
 }catch(e){
  display(role,'未通过：'+(e?.message||'未知错误'),false);
 }finally{running=false;button.disabled=false}
}
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
 }catch(e){
  $('cloud-status').textContent='无法确认安全模式：'+(e?.message||'服务暂不可用');
  $('issuer-proof').disabled=true;$('recipient-proof').disabled=true;
 }
})();
