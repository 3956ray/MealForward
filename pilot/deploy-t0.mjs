/**
 * Intentionally the ONLY transaction-sending path of the isolated T0 page.
 * User must review the whole new role-separated constructor AND approve
 * deployment in MetaMask. Fund / Issue / Lock / Settle are absent by design.
 */
import {
 CHAIN_ID,TEST_USDC,SOURCE_SHA,CREATION_SHA,PRICE,REQUIRED_ROLES,
 freshId,validateArtifact,makeDeploymentPlan,verifyDeployment
} from './escrow-t0-proof.mjs';
import {Interface} from 'ethers';

const $=id=>document.getElementById(id);
const H='https://testnet-rpc.monad.xyz';
const KEY='mf-monad-t0-role-separated-public-receipt-v1';
const TOKEN=new Interface(['function decimals() view returns (uint8)']);
let artifact=null,account=null,prepared=null,pending=null,verified=null;
let rpcSeq=0,busy=false,storageBlocked=false;
const title=(msg,ok)=>{const el=$('status');el.textContent=msg;el.dataset.state=ok===true?'ok':ok===false?'fail':'neutral';};
const details=msg=>{$('details').textContent=msg};
const matches=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const limit=fn=>async()=>{
 if(busy)return;
 busy=true;
 try{await fn()}catch(e){
  title('未完成：'+String(e?.message||'UNKNOWN').slice(0,180),false);
 }finally{busy=false;enable()}
};
async function wallet(method,params=[]){
 if(!window.ethereum?.request||window.ethereum.isMetaMask!==true||window.ethereum.isPhantom===true)
  throw Error('此页面仅支持 MetaMask，不能输入助记词或私钥');
 return window.ethereum.request({method,params});
}
async function publicRpc(method,params=[]){
 const id=++rpcSeq;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch(H,{
   method:'POST',headers:{'Content-Type':'application/json'},
   redirect:'error',cache:'no-store',
   body:JSON.stringify({jsonrpc:'2.0',id,method,params}),
   signal:controller.signal
  });
  if(!response.ok)throw Error('MONAD_RPC_HTTP_ERROR');
  const result=await response.json();
  if(result.jsonrpc!=='2.0'||result.id!==id||result.error)
   throw Error('MONAD_RPC_REJECTED_'+method);
  return result.result;
 }finally{clearTimeout(timeout)}
}
const readRpc={send:publicRpc};
function enable(){
 $('prepare').disabled=busy||!artifact||!account||!!pending||storageBlocked;
 $('deploy').disabled=busy||!prepared||!!pending||!artifact||!account||storageBlocked;
 $('verify').disabled=busy||!pending?.txHash||!artifact;
 $('recover').disabled=busy||!pending||!!pending.txHash||!artifact;
 $('copy').disabled=!verified;
 $('artifactStatus').textContent=artifact?
  '已验证原始 Source SHA-256、Creation Bytecode SHA-256、ABI 和 Immutable References。':
  '尚未载入经审查的 StoreEscrow Artifact';
 $('owner').value=account||'';
 $('tx').textContent=pending?.txHash||(pending?'原钱包结果 UNKNOWN；请从 MetaMask 找回原 Hash':'尚无部署交易');
}
function resetPreparation(reason){
 prepared=null;verified=null;
 details(reason);
 enable();
}
function loadSaved(){
 try{
  const raw=localStorage.getItem(KEY);
  if(!raw)return;
  const value=JSON.parse(raw);
  if(!value||typeof value!=='object'||
     !(value.txHash===null||/^0x[0-9a-f]{64}$/i.test(value.txHash))||
     !value.manifest||value.manifest.mode!=='role-separated-e2e'||
     value.manifest.chainId!==CHAIN_ID||
     !matches(value.manifest.asset,TEST_USDC)){
   storageBlocked=true;
   title('原交易记录损坏；阻止再次部署。请先查 MetaMask 历史，再人工排查。',false);
   return;
  }
  pending=value;
  if(value.txHash)
   title('已找回原部署 Hash；重新上传编译 Artifact，点击只读验证。不要重复部署。');
  else
   title('钱包操作结果 UNKNOWN：从 MetaMask 历史找到原 Hash，并在下方恢复。',false);
 }catch{
  storageBlocked=true;
  title('无法读取原部署记录；阻止再次部署，先检查 MetaMask 历史。',false);
 }
}
async function verifyNetwork(){
 const [chain,code,decimals]=await Promise.all([
  publicRpc('eth_chainId'),
  publicRpc('eth_getCode',[TEST_USDC,'latest']),
  publicRpc('eth_call',[{to:TEST_USDC,data:TOKEN.encodeFunctionData('decimals')},'latest'])
 ]);
 if(BigInt(chain)!==BigInt(CHAIN_ID))throw Error('实际 RPC 并非 Monad Testnet 10143');
 if(!/^0x(?:[0-9a-f]{2})+$/i.test(code))throw Error('官方 Test USDC 地址无合约');
 if(TOKEN.decodeFunctionResult('decimals',decimals)[0]!==6n)throw Error('USDC 精度异常');
}
async function checkActiveOwner(){
 if(!account)throw Error('先连接专用的部署钱包');
 const [chain,accounts]=await Promise.all([wallet('eth_chainId'),wallet('eth_accounts')]);
 if(BigInt(chain)!==BigInt(CHAIN_ID))throw Error('MetaMask 网络必须为 Monad Testnet 10143');
 if(!Array.isArray(accounts)||!matches(accounts[0],account))
  throw Error('MetaMask 账户已更换，请重新连接并重新准备');
 return account;
}
$('artifact').addEventListener('change',limit(async()=>{
 artifact=null;prepared=null;verified=null;enable();
 const file=$('artifact').files?.[0];
 if(!file||file.size>350000)throw Error('Artifact 文件不存在或过大');
 const data=JSON.parse(await file.text());
 validateArtifact(data);
 artifact=data;enable();
 title('原始编译产物已通过指纹检查；下一步连接钱包并填写五个不同的角色地址。',true);
}));
$('connect').addEventListener('click',limit(async()=>{
 const addresses=await wallet('eth_requestAccounts');
 if(!Array.isArray(addresses)||!/^0x[0-9a-f]{40}$/i.test(addresses[0]||''))throw Error('MetaMask 未提供测试地址');
 const chain=await wallet('eth_chainId');
 if(BigInt(chain)!==BigInt(CHAIN_ID))throw Error('请在 MetaMask 中先选择 Monad Testnet 10143');
 account=addresses[0];
 if(pending && !matches(pending.manifest.owner,account))
  title('当前账户不是原部署者；只读核验仍可继续，但不能重复部署。');
 else title('已连接 Monad Testnet 专用钱包。只允许 owner 本人部署全新测试合约。',true);
 resetPreparation('当前部署 Owner：'+account);
}));
$('prepare').addEventListener('click',limit(async()=>{
 if(pending)throw Error('存在未核实的原交易，不得再次生成部署');
 await checkActiveOwner();
 await verifyNetwork();
 if(!artifact)throw Error('请先上传原审核过的合约 Artifact');
 const roles={owner:account};
 for(const name of REQUIRED_ROLES.filter(x=>x!=='owner'))
  roles[name]=$(name).value.trim();
 const storeId=freshId(),mealId=freshId();
 const plan=makeDeploymentPlan({artifact,roles,ownerSigner:account,storeId,mealId});
 const gas=await wallet('eth_estimateGas',[{from:account,data:plan.data}]);
 if(BigInt(gas)<=0n)throw Error('新合约 Gas 估算异常');
 const balance=BigInt(await wallet('eth_getBalance',[account,'latest']));
 if(balance<=0n)throw Error('部署钱包没有 Monad 测试 MON 用于 Gas');
 prepared=plan;
 verified=null;
 details([
  '仅允许用户亲自确认的单笔新合约 Deploy；不会转出测试 USDC。',
  'Chain ID：10143   Token：'+TEST_USDC,
  '商家：留膳社区厨房   餐品：暖心盖饭',
  '链上测试餐价：7 Test USDC / 份',
  '五个角色地址互不相同：',
  ...REQUIRED_ROLES.map(n=>n+' = '+roles[n]),
  'Store ID：'+storeId,
  'Meal ID：'+mealId,
  '服务窗口：UTC+8 全天；图片仅为占位 Digest，非实物照片。',
  'Gas 估算：'+BigInt(gas).toString()+' units',
  'Bytecode SHA-256：'+CREATION_SHA,
  '注意：原 StoreEscrow 未在链上强制 180 秒结算冷却，后续资金动作在本页完全禁用。'
 ].join('\n'));
 title('部署内容准备完毕。请逐项核对角色地址，再由 Owner 钱包主动点击部署。',true);
}));
$('deploy').addEventListener('click',limit(async()=>{
 if(!prepared||!artifact||pending)throw Error('必须先完成准备和审查，且没有原交易待处理');
 await checkActiveOwner();
 await verifyNetwork();
 // Ensure role text has not changed since the actual human review.
 for(const name of REQUIRED_ROLES.filter(x=>x!=='owner')){
  if(!matches($(name).value.trim(),prepared.manifest[name]))
   throw Error('角色地址在准备之后发生变化；必须重新审核');
 }
 // Persist an UNKNOWN intent before opening MetaMask. A lost RPC reply
 // must not enable a second deployment with a new Store/Meal identifier.
 const reviewed=prepared;
 const reserved={txHash:null,manifest:reviewed.manifest,stage:'AWAITING_WALLET_RESULT'};
 localStorage.setItem(KEY,JSON.stringify(reserved));
 pending=reserved;prepared=null;verified=null;enable();
 let txHash;
 try{
  // The only user-triggered transaction primitive in this T0 page.
  txHash=await wallet('eth_sendTransaction',[{from:account,data:reviewed.data}]);
 }catch(error){
  if(error?.code===4001){
   // EIP-1193 explicit user rejection is the only unambiguous no-broadcast.
   try{localStorage.removeItem(KEY);pending=null}
   catch{storageBlocked=true}
   title('MetaMask 已明确拒绝交易。请重新准备后再进行新部署。');
   return;
  }
  title('钱包广播结果 UNKNOWN；禁止第二次部署，请从钱包历史找回原 Hash。',false);
  details('原 Store ID：'+reviewed.manifest.storeId+
   '\n不要另建 Store，也不要再次发送新交易。');
  return;
 }
 if(!/^0x[0-9a-f]{64}$/i.test(txHash)){
  title('钱包未返回有效 Hash；保留 UNKNOWN 状态并阻止重复部署。',false);
  return;
 }
 pending={txHash,manifest:reviewed.manifest,stage:'TX_LOCATED'};
 try{localStorage.setItem(KEY,JSON.stringify(pending))}
 catch{
  storageBlocked=true;
  details('钱包返回原 TX Hash：'+txHash+'\n本地保存失败，请立即人工复制原 Hash。');
  title('原交易已发送但保存 Hash 失败；绝不可重新部署。',false);
  return;
 }
 title('已提交原部署交易；现在只可核验原 Hash，不要再次 Deploy。');
 details('部署交易 Hash：'+txHash+'\n至少两个区块确认之后才算验证通过。');
}));
$('recover').addEventListener('click',limit(async()=>{
 if(!pending||pending.txHash||!artifact)
  throw Error('没有 UNKNOWN 原意图，或者尚未核验原始编译产物');
 await verifyNetwork();
 const hash=$('recoverHash').value.trim();
 if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('请输入 MetaMask 历史中的原交易 Hash');
 const tx=await publicRpc('eth_getTransactionByHash',[hash]);
 if(!tx)throw Error('Monad RPC 尚未查询到原交易，不能重复部署');
 const plan=makeDeploymentPlan({
  roles:pending.manifest,ownerSigner:pending.manifest.owner,
  storeId:pending.manifest.storeId,mealId:pending.manifest.mealId,artifact
 });
 if(!matches(tx.hash,hash)||tx.to!==null||
    !matches(tx.from,pending.manifest.owner)||!matches(tx.input??tx.data,plan.data))
  throw Error('此 Hash 不属于原 Owner、原角色与原 Store/Meal 部署');
 pending={txHash:hash,manifest:pending.manifest,stage:'TX_LOCATED'};
 localStorage.setItem(KEY,JSON.stringify(pending));
 title('已核对并绑定原始交易，后续只有只读核验，不会发第二笔交易。',true);
 details('原始 TX Hash：'+hash);
}));
$('verify').addEventListener('click',limit(async()=>{
 if(!pending||!artifact)throw Error('没有可核验的原交易，或缺少固定编译产物');
 await verifyNetwork();
 const receipt=await publicRpc('eth_getTransactionReceipt',[pending.txHash]);
 if(!receipt)throw Error('Receipt 尚未生成；保留原 Hash，稍后点击“只读验证”。不要重发交易。');
 if(BigInt(receipt.status)!==1n)throw Error('原交易已失败。保存 Hash 分析原因，勿自动重发。');
 if(!/^0x[0-9a-f]{40}$/i.test(receipt.contractAddress||''))
  throw Error('Receipt 缺少新部署合约地址');
 const m={...pending.manifest,contract:receipt.contractAddress,deploymentTx:pending.txHash};
 const evidence=await verifyDeployment({rpc:readRpc,artifact,manifest:m});
 verified={manifest:m,evidence};
 title('PASS：全新角色分离 StoreEscrow 已经在 Monad Testnet 部署并完成独立只读验证。',true);
 details(JSON.stringify(evidence,null,2)+
  '\n\n资金操作继续禁用。此结果不构成 G3 Journal 或链上 180 秒冷却门禁通过。');
}));
$('copy').addEventListener('click',limit(async()=>{
 if(!verified)throw Error('只有经过只读验证的部署证据可以导出');
 const text=JSON.stringify(verified,null,2);
 await navigator.clipboard.writeText(text);
 title('已复制非敏感部署 Manifest 和验证报告，不含任何私钥、签名或钱包 Cookie。',true);
}));
window.ethereum?.on?.('accountsChanged',()=>{
 account=null;resetPreparation('钱包账户已变化；原待核实交易 Hash 仍保留。必须重新确认。');
 title('钱包账户已变化，停止新的交易。原 Hash 仍可只读核验。',false);
});
window.ethereum?.on?.('chainChanged',()=>{
 account=null;resetPreparation('网络已变化，停止新交易。原待核实交易 Hash 仍保留。');
 title('网络已变化；切回 Monad Testnet 后重新连接。',false);
});
loadSaved();enable();
