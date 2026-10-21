/**
 * T1-A+B preflight UI. READ-ONLY plus a harmless owner-requested signature.
 *
 * IMPORTANT: no USDC approval, Fund, Issue, Lock, Settle, raw TX
 * or functional FundingQuote signature is possible from this page.
 */
import {Interface,formatUnits} from 'ethers';
import {
 CHAIN,TOKEN,CONTRACT,QUOTE,MEAL,PRICE,
 QUOTE_PROOF_DOMAIN,QUOTE_PROOF_TYPES,newQuoteProof,
 verifyQuoteControlProof,validateFundingReadOnlyState
} from './t1-proof.mjs';

const $=id=>document.getElementById(id);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const status=(id,text,ok=null)=>{
 const node=$(id);
 node.textContent=text;
 node.dataset.state=ok===true?'ok':ok===false?'error':'pending';
};
let walletAddress=null,busy=false;
const TOKEN_ABI=new Interface([
 'function balanceOf(address) view returns (uint256)',
 'function allowance(address,address) view returns (uint256)'
]);
const ESCROW_ABI=new Interface([
 'function quoteAuthority() view returns (address)',
 'function asset() view returns (address)',
 'function listed(bytes32) view returns (bool)',
 'function currentVersion(bytes32) view returns (uint256)',
 'function paused() view returns (bool)',
 'function closed() view returns (bool)',
 'function catalog(bytes32,uint256) view returns (uint256,bytes32)',
 'function availableUnits() view returns (uint256)',
 'function lifetimeFundedUnits() view returns (uint256)'
]);
async function wallet(method,params=[]){
 const safeMethods=[
  'eth_chainId','eth_accounts','eth_requestAccounts','eth_getBalance',
  'eth_call','eth_getCode','eth_signTypedData_v4'
 ];
 if(!safeMethods.includes(method))throw Error('T1_WALLET_WRITE_DISALLOWED');
 if(!window.ethereum?.request||window.ethereum.isMetaMask!==true)
  throw Error('此 T1 测试仅支持 MetaMask 钱包；请使用专用测试账号。');
 return window.ethereum.request({method,params});
}
async function assertChain(){
 const n=BigInt(await wallet('eth_chainId'));
 if(n!==BigInt(CHAIN))throw Error('请选择 Monad Testnet 10143');
 return n;
}
async function currentAccount(){
 await assertChain();
 const accounts=await wallet('eth_accounts');
 if(!walletAddress||!Array.isArray(accounts)||!same(accounts[0],walletAddress))
  throw Error('当前账号已切换；请重新连接并核对');
 return walletAddress;
}
let readTail=Promise.resolve();
async function read(to,abi,name,args=[]){
 // MetaMask-backed read calls are serialized so the injected RPC cannot
 // intermittently return 429 under a simultaneous ten-call burst.
 const task=readTail.then(async()=>{
  const out=await wallet('eth_call',[{
   to,data:abi.encodeFunctionData(name,args)
  },'latest']);
  return abi.decodeFunctionResult(name,out);
 });
 readTail=task.catch(()=>{});
 return task;
}
const guard=fn=>async()=>{
 if(busy)return;
 busy=true;
 try{await fn()}
 catch(error){status('actionStatus','未通过：'+String(error?.message||'UNKNOWN').slice(0,200),false)}
 finally{busy=false}
};
function invalidate(reason){
 walletAddress=null;
 status('walletInfo',reason,false);
 status('donorInfo','已清除旧钱包余额视图；需要重新连接。');
 status('quoteInfo','旧账号的 Quote Authority 验证已失效。');
}
$('connect').addEventListener('click',guard(async()=>{
 const a=await wallet('eth_requestAccounts');
 if(!a?.[0]||!/^0x[0-9a-f]{40}$/i.test(a[0]))throw Error('MetaMask 没有返回有效钱包地址');
 await assertChain();
 walletAddress=a[0];
 status('walletInfo','已连接 '+walletAddress+' · Chain ID 10143',true);
 status('actionStatus','此页面不会发起链上资金交易。',true);
}));
$('contract').addEventListener('click',guard(async()=>{
 await currentAccount();
 const code=await wallet('eth_getCode',[CONTRACT,'latest']);
 if(!code||code==='0x')throw Error('原 T0 合约没有链上字节码，停止');
 const [
  quote,asset,listed,paused,closed,version,menu,available,used,balance
 ]=await Promise.all([
  read(CONTRACT,ESCROW_ABI,'quoteAuthority').then(x=>x[0]),
  read(CONTRACT,ESCROW_ABI,'asset').then(x=>x[0]),
  read(CONTRACT,ESCROW_ABI,'listed',[MEAL]).then(x=>x[0]),
  read(CONTRACT,ESCROW_ABI,'paused').then(x=>x[0]),
  read(CONTRACT,ESCROW_ABI,'closed').then(x=>x[0]),
  read(CONTRACT,ESCROW_ABI,'currentVersion',[MEAL]).then(x=>x[0]),
  read(CONTRACT,ESCROW_ABI,'catalog',[MEAL,1n]),
  read(CONTRACT,ESCROW_ABI,'availableUnits').then(x=>x[0]),
  read(CONTRACT,ESCROW_ABI,'lifetimeFundedUnits').then(x=>x[0]),
  read(TOKEN,TOKEN_ABI,'balanceOf',[CONTRACT]).then(x=>x[0])
 ]);
 await currentAccount();
 if(version!==1n)throw Error('原餐品版本已经变化，停止');
 const result=validateFundingReadOnlyState({
  chainId:CHAIN,escrow:CONTRACT,asset,quoteAuthority:quote,
  listed,paused,closed,unitPrice:menu[0],termsHash:menu[1],
  available,capacity:10n-BigInt(used),escrowBalance:balance
 });
 status('chainInfo',[
  'PASS：真实 Monad 测试网合约',
  '合约：'+result.newTestEscrow,
  '单价：'+formatUnits(menu[0],6)+' 测试 USDC',
  '当前已资助份数：'+used,
  '剩余累计容量：'+(10n-BigInt(used)),
  '仍可领取份数：'+available,
  'Escrow 测试 USDC 余额：'+formatUnits(balance,6),
  '此处仅读取状态，不发起资金交易。'
 ].join('\n'),true);
 status('actionStatus','原 T0 链上状态核对通过。但资金 Intent 仍未放行。',true);
}));
$('donor').addEventListener('click',guard(async()=>{
 const account=await currentAccount();
 const [mon,usd,allowance]=await Promise.all([
  wallet('eth_getBalance',[account,'latest']).then(BigInt),
  read(TOKEN,TOKEN_ABI,'balanceOf',[account]).then(x=>x[0]),
  read(TOKEN,TOKEN_ABI,'allowance',[account,CONTRACT]).then(x=>x[0])
 ]);
 await currentAccount();
 const ready=usd>=PRICE&&mon>0n;
 status('donorInfo',[
  '测试付款地址：'+account,
  '测试 MON：'+formatUnits(mon,18),
  '测试 USDC：'+formatUnits(usd,6),
  '对新 Escrow 的已有 Allowance：'+formatUnits(allowance,6),
  ready?'测试资产余额满足至少一份 7 USDC 的基本要求。':
  '当前测试资产不足一份 7 USDC 或缺少测试 MON；先准备测试网资产。',
  '本页绝不会请求 Approve、转账或 Fund。'
 ].join('\n'),ready);
 status('actionStatus',ready?'钱包只读资产预检完成。':'钱包仍需准备测试资产。',ready);
}));
$('quote').addEventListener('click',guard(async()=>{
 const account=await currentAccount();
 if(!same(account,QUOTE))
  throw Error('当前 MetaMask 账户不是合约登记的 Quote Authority：'+QUOTE);
 const code=await wallet('eth_getCode',[QUOTE,'latest']);
 if(code!=='0x')throw Error('当前 Quote 地址为合约钱包，原 StoreEscrow 只接受 ECDSA EOA 报价签名');
 const message=newQuoteProof();
 const payload={domain:QUOTE_PROOF_DOMAIN,primaryType:'T1RoleControl',
  types:QUOTE_PROOF_TYPES,message};
 // The only signature call, on explicit user click. It is NOT a
 // FundingQuote and cannot be passed to the original StoreEscrow fund().
 const sig=await wallet('eth_signTypedData_v4',[account,JSON.stringify(payload)]);
 await currentAccount();
 const report=verifyQuoteControlProof({message,signature:sig});
 status('quoteInfo',[
  'PASS：Quote Authority 的 EOA 控制证明。',
  'Quote address：'+report.authority,
  '挑战有效期至：'+new Date(report.expiresAt*1000).toLocaleString(),
  '该签名不是 FundingQuote，不允许 Fund。',
  '签名不会上传、存储或复制到报告中。'
 ].join('\n'),true);
 status('actionStatus','Quote Authority 独立钱包签名控制证明通过。并未授权任何资助。',true);
}));
window.ethereum?.on?.('accountsChanged',()=>invalidate('MetaMask 账户变更：原测试结果已失效。'));
window.ethereum?.on?.('chainChanged',()=>invalidate('MetaMask 网络变更：请切回 Monad Testnet 10143。'));
status('actionStatus','T1 当前仅允许查看真实余额和主动签署无付款效力的权限挑战。');
