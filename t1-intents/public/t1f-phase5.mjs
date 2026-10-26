/* T1-F Phase5 EIP-712 practice ONLY; NOT actual Recovery Release.
 * No persistent storage, sessions, token transfer, or automatic signer calls.
 */
const WALLET=Object.freeze({
 owner:'0xc4f8a468f10d5f98dcff3282516125e97f26433b',
 donor:'0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'
});
const DOMAIN='MealForward Phase5 Typed Wallet Practice';
const ESCROW='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58';
const REQUIRED_DOMAIN_FIELDS=[
 ['name','string'],['version','string'],
 ['chainId','uint256'],['verifyingContract','address']
];
const PURPOSE='PRACTICE ONLY - NO RECOVERY RELEASE, NO ISSUE, NO FUNDS';
const $=id=>document.getElementById(id);
let ready=false,busy=false,revision=0,account=null;
const passed={owner:false,donor:false};
function output(role,message,ok){
 const n=$(role+'-result');n.textContent=message;
 n.dataset.state=ok===undefined?'':ok?'ok':'bad';
}
function show(){
 for(const role of ['owner','donor'])$(role+'-wallet').textContent=account||'尚未连接';
}
function controls(){
 for(const role of ['owner','donor']){
  $(role+'-switch').disabled=!ready||busy;
  $(role+'-sign').disabled=!ready||busy;
 }
}
function summary(){
 $('phase5-status').textContent='PHASE5 EIP-712 PRACTICE · '+
   (Number(passed.owner)+Number(passed.donor))+'/2 PASS · NO RELEASE';
}
function provider(){
 if(window.ethereum?.isMetaMask!==true||!window.ethereum.request)
  throw Error('请安装并解锁 MetaMask。');
 return window.ethereum;
}
async function api(path,method='GET',data){
 const res=await fetch(path,{
  method,redirect:'error',cache:'no-store',credentials:'same-origin',
  headers:{Accept:'application/json',
   ...(method==='POST'?{'Content-Type':'application/json'}:{})},
  ...(data===undefined?{}:{body:JSON.stringify(data)}),
  signal:AbortSignal.timeout(20000)
 });
 const result=await res.json();
 if(!res.ok)throw Error((result.error||'HTTP_ERROR')+' · '+res.status);
 return result;
}
async function selectWallet(role){
 const p=provider();
 await p.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]});
 const [accounts,chain]=await Promise.all([
  p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})
 ]);
 account=accounts?.[0]?.toLowerCase()||null;show();
 if(BigInt(chain)!==10143n)throw Error('请切换到 Monad Testnet 10143。');
 if(account!==WALLET[role])throw Error('不是固定 '+role.toUpperCase()+' 钱包。');
 output(role,'钱包和网络正确。',true);
}
async function verifyCurrent(role){
 const p=provider();
 const [accounts,chain]=await Promise.all([
  p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})
 ]);
 if(accounts?.[0]?.toLowerCase()!==WALLET[role]||BigInt(chain)!==10143n)
  throw Error('钱包或网络错误，请重新选择。');
 account=WALLET[role];show();return p;
}
async function prove(role){
 const p=await verifyCurrent(role),version=revision;
 const ch=await api('/v1/t1f/phase5/challenge','POST',{
  role,address:WALLET[role]
 });
 const typed=ch.typedData;
 if(ch.status!=='T1F_PHASE5_TYPED_PRACTICE_CHALLENGE'||
  ch.role!==role||ch.address!==WALLET[role]||
  ch.chainId!==10143||ch.notRecoveryRelease!==true||
  ch.notTransaction!==true||typed?.domain?.name!==DOMAIN||
  typed.domain.version!=='0'||typed.domain.chainId!==10143||
  typed.domain.verifyingContract?.toLowerCase()!==ESCROW||
  !Array.isArray(typed.types?.EIP712Domain)||
  typed.types.EIP712Domain.length!==REQUIRED_DOMAIN_FIELDS.length||
  !typed.types.EIP712Domain.every((field,i)=>
   field?.name===REQUIRED_DOMAIN_FIELDS[i][0]&&
   field?.type===REQUIRED_DOMAIN_FIELDS[i][1])||
  typed.primaryType!=='PracticeControl'||
  typed.message?.role!==role.toUpperCase()||
  typed.message?.wallet!==WALLET[role]||
  typed.message?.purpose!==PURPOSE)
  throw Error('签名挑战不是安全的 EIP-712 练习格式。');
 output(role,'请核对签名弹窗中写有 PRACTICE ONLY。');
 // Only direct user click initiates a MetaMask typed-data request.
 const sig=await p.request({
  method:'eth_signTypedData_v4',
  params:[WALLET[role],JSON.stringify(typed)]
 });
 const [accounts,chain]=await Promise.all([
  p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})
 ]);
 if(version!==revision||accounts?.[0]?.toLowerCase()!==WALLET[role]||
  BigInt(chain)!==10143n)
  throw Error('签名前后账户或网络发生变化。');
 const answer=await api('/v1/t1f/phase5/verify','POST',{
  challengeId:ch.challengeId,signature:sig
 });
 if(answer.status!=='T1F_PHASE5_'+role.toUpperCase()+'_TYPED_PRACTICE_PASS'||
  answer.role!==role||answer.address!==WALLET[role]||
  answer.releaseApproved!==false||answer.signaturePersisted!==false||
  answer.noFundsOrChainWrites!==true||answer.sessionCreated!==false)
  throw Error('签名验证未满足无权限门禁。');
 passed[role]=true;
 output(role,'PASS · '+role.toUpperCase()+' EIP-712 练习签名验证成功\n'+
  WALLET[role]+'\nNO RELEASE · NO ISSUE · NO TRANSACTION',true);
 summary();
}
async function action(role,work){
 if(busy||!ready)return;busy=true;controls();
 try{await work()}catch(e){output(role,'未通过：'+String(e?.message||'未知错误'),false)}
 finally{busy=false;controls()}
}
window.ethereum?.on?.('accountsChanged',accounts=>{
 revision++;account=accounts?.[0]?.toLowerCase()||null;show();
});
window.ethereum?.on?.('chainChanged',()=>{revision++;account=null;show()});
for(const role of ['owner','donor']){
 $(role+'-switch').addEventListener('click',()=>action(role,()=>selectWallet(role)));
 $(role+'-sign').addEventListener('click',()=>action(role,()=>prove(role)));
}
(async()=>{
 try{
  const s=await api('/v1/t1f/phase5/status');
  if(s.status!=='T1F_PHASE5_TYPED_WALLET_PRACTICE_ONLY'||
   s.chainId!==10143||s.ownerWallet!==WALLET.owner||
   s.donorWallet!==WALLET.donor||
   s.typedDataDomain!==DOMAIN||s.typedDataVersion!=='0'||
   s.eip712PracticeOnly!==true||s.liveReleaseDomainMatch!==false||
   s.createsRecoveryApproval!==false||s.canIssue!==false||
   s.canFund!==false||s.canSettle!==false||
   s.databaseConnected!==false||s.hasSession!==false||
   s.storesSignature!==false)
   throw Error('练习阶段的安全门禁尚未开放。');
  ready=true;summary();
  try{
   const list=await provider().request({method:'eth_accounts'});
   account=list?.[0]?.toLowerCase()||null;show();
  }catch{/* No MetaMask permission or signature on page load. */}
 }catch(e){
  $('phase5-status').textContent='阶段未就绪：'+String(e?.message||'');
 }finally{controls()}
})();
