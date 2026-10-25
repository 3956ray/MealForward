/* T1-F Phase4: only ephemeral SIWE EIP-191 wallet possession proof.
 * Never ask for any recovery release, token authorization or Issue call.
 * No browser persistence, secrets, transaction methods or sessions.
 */
const EXPECTED=Object.freeze({
 owner:'0xc4f8a468f10d5f98dcff3282516125e97f26433b',
 donor:'0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'
});
const $=id=>document.getElementById(id);
let ready=false,busy=false,revision=0,connected=null;
const history={owner:null,donor:null};
function provider(){
 if(window.ethereum?.isMetaMask!==true||
   typeof window.ethereum.request!=='function')
  throw Error('请在浏览器中安装并解锁 MetaMask。');
 return window.ethereum;
}
function show(role,message,ok=null){
 const el=$(role+'-result');
 el.textContent=message;
 el.dataset.state=ok===null?'':ok?'ok':'bad';
}
function controls(){
 for(const role of ['owner','donor']){
  $(role+'-proof').disabled=!ready||busy;
  $(role+'-switch').disabled=!ready||busy;
 }
}
function current(){
 for(const role of ['owner','donor']){
  $(role+'-wallet').textContent=connected??'尚未连接';
 }
}
function refreshSummary(){
 const done=Number(!!history.owner)+Number(!!history.donor);
 $('phase4-status').textContent=done===2?
  '两把独立钱包控制证明均已通过（仅当前浏览器内的结果；无恢复授权或数据库记录）':
  'PHASE4 PROOF ONLY · '+done+'/2 完成 · 无 EIP-712 恢复签名';
}
async function requestJson(path,method='GET',body){
 const response=await fetch(path,{
  method,cache:'no-store',credentials:'same-origin',redirect:'error',
  headers:{Accept:'application/json',
   ...(method==='POST'?{'Content-Type':'application/json'}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(20000)
 });
 if(!(response.headers.get('content-type')||'').startsWith('application/json'))
  throw Error('服务端没有返回 JSON，请检查网络连接');
 const data=await response.json();
 if(!response.ok)throw Error((data?.error||'HTTP_ERROR')+' (HTTP '+response.status+')');
 return data;
}
async function ensureWallet(role){
 const p=provider();
 const accounts=await p.request({method:'eth_requestAccounts'});
 const chain=await p.request({method:'eth_chainId'});
 const actual=await p.request({method:'eth_accounts'});
 if(BigInt(chain)!==10143n)throw Error('请先切换至 Monad Testnet（Chain ID 10143）。');
 if(!accounts?.[0]||accounts[0].toLowerCase()!==actual?.[0]?.toLowerCase())
  throw Error('MetaMask 正在切换账户，请重新选择。');
 connected=actual[0].toLowerCase();current();
 if(connected!==EXPECTED[role])
  throw Error('目前连的是 '+connected+'，不是固定的 '+role.toUpperCase()+
    '。请先点「重新选择钱包」。');
 return p;
}
async function action(fn){
 if(busy)return;
 busy=true;controls();
 try{await fn()}catch(e){
  const code=typeof e?.message==='string'?e.message:'钱包控制证明未完成';
  const role=window.__phase4ActiveRole;
  if(role)show(role,'未通过：'+code,false);
 }finally{busy=false;window.__phase4ActiveRole=null;controls()}
}
async function switchWallet(role){
 window.__phase4ActiveRole=role;
 const p=provider();
 await p.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]});
 const [list,chain]=await Promise.all([
  p.request({method:'eth_accounts'}),
  p.request({method:'eth_chainId'})
 ]);
 connected=list?.[0]?.toLowerCase()??null;
 current();
 if(BigInt(chain)!==10143n)throw Error('请切换至 Monad Testnet 10143。');
 show(role,connected===EXPECTED[role]?
  '正确钱包已选中：'+connected+'。现在可以点击「本人 SIWE 控制证明」。':
  '当前连接钱包：'+(connected||'未授权')+'。请在 MetaMask 中选中固定 '+role+' 钱包。',
  connected===EXPECTED[role]);
}
async function prove(role){
 window.__phase4ActiveRole=role;
 const p=await ensureWallet(role);
 const version=revision;
 const challenge=await requestJson('/v1/t1f/phase4/challenge','POST',{
  role,address:EXPECTED[role]
 });
 if(challenge.status!=='T1F_PHASE4_WALLET_PROOF_CHALLENGE'||
  challenge.role!==role||challenge.address!==EXPECTED[role]||
  challenge.chainId!==10143||
  challenge.noSessionCreated!==true||
  challenge.noEip712Release!==true||
  !challenge.message.includes('WALLET CONTROL PROOF ONLY')||
  !challenge.message.includes('Not an EIP-712 release'))
  throw Error('返回的 SIWE 挑战不是本阶段的安全钱包证明。');
 show(role,'请在 MetaMask 中核对：只证明 '+role+' 钱包控制权；不批准恢复发券。');
 const signature=await p.request({
  method:'personal_sign',params:[challenge.message,EXPECTED[role]]
 });
 const [accounts,chain]=await Promise.all([
  p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})
 ]);
 if(revision!==version||BigInt(chain)!==10143n||
  accounts?.[0]?.toLowerCase()!==EXPECTED[role])
  throw Error('签名前后钱包或网络发生变化，请重新验证。');
 const verified=await requestJson('/v1/t1f/phase4/verify','POST',{
  challengeId:challenge.challengeId,signature
 });
 if(verified.role!==role||verified.address!==EXPECTED[role]||
   verified.noSessionCreated!==true||
   verified.noEip712Release!==true||
   verified.noOnchainIssue!==true||
   verified.noFundsTransaction!==true||
   verified.noSettlement!==true)
  throw Error('服务端证明结果未符合安全门槛。');
 history[role]=verified.address;
 show(role,'PASS · '+role.toUpperCase()+' 钱包控制权已验证\n'+verified.address+
  '\n仅当前会话结果；未创建恢复签名、Session 或交易。',true);
 refreshSummary();
}
function changed(accounts){
 revision++;
 connected=Array.isArray(accounts)?accounts[0]?.toLowerCase()??null:null;
 current();
 if(ready){
  for(const role of ['owner','donor']){
   if(history[role])
    show(role,'此前 '+role.toUpperCase()+' 钱包已通过控制证明（历史结果）。当前连接的钱包可能不同；如需复验请重新签署。',true);
   else show(role,'MetaMask 钱包已切换；请确认角色后进行 SIWE 控制证明。');
  }
 }
}
window.ethereum?.on?.('accountsChanged',changed);
window.ethereum?.on?.('chainChanged',()=>changed(null));
for(const role of ['owner','donor']){
 $(role+'-switch').addEventListener('click',()=>action(()=>switchWallet(role)));
 $(role+'-proof').addEventListener('click',()=>action(()=>prove(role)));
}
(async()=>{
 try{
  const s=await requestJson('/v1/t1f/phase4/status');
  if(s.status!=='T1F_PHASE4_OWNER_DONOR_SIWE_PROOF_ONLY'||
    s.ownerWallet!==EXPECTED.owner||s.donorWallet!==EXPECTED.donor||
    s.chainId!==10143||s.walletControlOnly!==true||
    s.noPersistentSessions!==true||s.databaseConnected!==false||
    s.eip712RecoveryReleaseEnabled!==false||
    s.successorIssueEnabled!==false||s.fundEnabled!==false||
    s.settleEnabled!==false||s.originalClaimPreserved!==true)
   throw Error('钱包证明服务未达到安全运行状态。');
  ready=true;
  refreshSummary();
  try{
   const list=await provider().request({method:'eth_accounts'});
   connected=list?.[0]?.toLowerCase()??null;
   current();
  }catch{/* Only lazy-read MetaMask; no account request on page load. */}
 }catch(e){
  $('phase4-status').textContent='安全模式未就绪，按钮保持禁用：'+
   String(e?.message||'未知错误');
 }finally{controls()}
})();
