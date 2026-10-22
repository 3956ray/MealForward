/**
 * T1-D REAL Monad Testnet one 7 USDC meal.
 *
 * Only explicit button clicks request MetaMask signing/transfers.
 * Never holds private keys, never performs autosend, retries or
 * retries UNKNOWN financial transactions.
 */
const T0='0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58';
const TOKEN='0x534b2f3A21130d7a60830c2Df862319e593943A3';
const QUOTE='0xcc5C1ce846c0302ab27a4811cf2e0E6FC7282952';
const MEAL='0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b';
const TERMS='0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222';
const AMOUNT=7000000n,CHAIN=10143n;
const EIP_DOMAIN=[
 {name:'name',type:'string'},{name:'version',type:'string'},
 {name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}
];
const QUOTE_FIELDS=[
 {name:'quoteId',type:'bytes32'},{name:'payer',type:'address'},
 {name:'mealId',type:'bytes32'},{name:'currentVersion',type:'uint256'},
 {name:'termsHash',type:'bytes32'},{name:'quantity',type:'uint256'},
 {name:'unitPrice',type:'uint256'},{name:'amount',type:'uint256'},
 {name:'deadline',type:'uint256'}
];
const $=id=>document.getElementById(id);
const equals=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
let account=null,csrf=null,id=null,quote=null,signature=null,quoteAccepted=false;
let approveHash=null,fundHash=null,approveConfirmed=false,fundConfirmed=false,serviceReady=false;
let lock=false,epoch=0;
const STATE_IDS=['connect','login','readiness','prepare','sign','approve','confirmApprove',
 'fund','confirmFund','recoverApprove','recoverFund','reload'];
function state(id,msg,ok=null){
 const el=$(id);el.textContent=msg;el.dataset.state=ok===null?'':ok?'ok':'bad';
}
function controls(){
 const can=Boolean(account&&csrf&&serviceReady&&!lock&&equals(account,QUOTE));
 for(const key of STATE_IDS)$(key).disabled=lock;
 $('prepare').disabled=!can||Boolean(id);
 $('sign').disabled=!can||!quote||quoteAccepted;
 $('approve').disabled=!can||!quoteAccepted||Boolean(approveHash)||approveConfirmed;
 $('confirmApprove').disabled=!can||!id||approveConfirmed;
 $('fund').disabled=!can||!approveConfirmed||!signature||Boolean(fundHash)||fundConfirmed;
 $('confirmFund').disabled=!can||!id||!approveConfirmed||fundConfirmed;
 $('readiness').disabled=!account||lock;
 $('recoverApprove').disabled=!csrf||lock;
 $('recoverFund').disabled=!csrf||lock;
 $('reload').disabled=!csrf||lock;
}
function invalidate(reason){
 epoch++;
 account=null;csrf=null;id=null;quote=null;signature=null;quoteAccepted=false;
 approveHash=null;fundHash=null;approveConfirmed=false;fundConfirmed=false;serviceReady=false;
 state('identity',reason,false);
 state('quote','原账户的未提交签名及 Intent 显示已作废。',false);
 state('approveInfo','钱包切换：不允许原操作重发。',false);
 state('fundInfo','钱包切换：已停用交易按钮。',false);
 controls();
}
window.ethereum?.on?.('accountsChanged',()=>invalidate('MetaMask 切换了账户；请重新连接并登录。'));
window.ethereum?.on?.('chainChanged',()=>invalidate('MetaMask 切换了网络；仅限 Monad Testnet 10143。'));
const wallet=async(method,params=[])=>{
 const allowed=['eth_requestAccounts','eth_accounts','eth_chainId','personal_sign',
  'eth_signTypedData_v4','eth_getTransactionCount','eth_sendTransaction','eth_getBalance'];
 if(!allowed.includes(method))throw Error('WALLET_METHOD_NOT_ALLOWED');
 if(!window.ethereum?.request||window.ethereum.isMetaMask!==true)throw Error('请启用 MetaMask。');
 return window.ethereum.request({method,params});
};
async function requireWallet(){
 if(!account||!equals(account,QUOTE))throw Error('首轮资金测试必须使用已验证的 Quote Authority Account 2。');
 const [chain,accounts]=await Promise.all([wallet('eth_chainId'),wallet('eth_accounts')]);
 if(BigInt(chain)!==CHAIN||!equals(accounts?.[0],account))
  throw Error('账户或 Monad Testnet 网络变更，禁止签名与交易。');
}
const req=async(path,{body,method='GET'}={})=>{
 const r=await fetch(path,{
  method,credentials:'same-origin',redirect:'error',cache:'no-store',
  headers:{Accept:'application/json',
   ...(method==='POST'?{'Content-Type':'application/json','X-C1-CSRF':csrf??''}: {})
  },
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(22000)
 });
 if(!(r.headers.get('content-type')||'').startsWith('application/json'))
  throw Error('后端没有返回 JSON。');
 const json=await r.json();
 if(!r.ok){
  const code=typeof json?.error==='string'?json.error:'HTTP_'+r.status;
  throw Error(code+' ('+r.status+')');
 }
 return json;
};
const post=(action,body)=>req('/v1/t1/fund/'+action,{method:'POST',body});
const guard=fn=>async()=>{
 if(lock)return;
 lock=true;controls();
 try{await fn()}catch(e){
  // Never expose raw EIP712 signatures, cookies, secret keys or a
  // wallet's internal RPC payload in page status.
  const code=typeof e?.message==='string'?e.message.slice(0,140):'UNKNOWN';
  state('recoverInfo','操作尚未完成：'+code,false);
 }finally{lock=false;controls()}
};
const quoteFor=intent=>({
 quoteId:intent.quoteId,
 payer:intent.payer,
 mealId:MEAL,
 currentVersion:'1',
 termsHash:TERMS,
 quantity:'1',
 unitPrice:AMOUNT.toString(),
 amount:AMOUNT.toString(),
 deadline:intent.quoteDeadline
});
const typedData=msg=>({
 types:{EIP712Domain:EIP_DOMAIN,FundingQuote:QUOTE_FIELDS},
 primaryType:'FundingQuote',
 domain:{name:'MealForward C0 Funding',version:'1',chainId:10143,verifyingContract:T0},
 message:msg
});
async function loginWallet(){
 await requireWallet();
 const who=account,capture=epoch;
 const pre=await req('/v1/auth/pre-session',{
  method:'POST',body:{},headers:{'X-C1-Bootstrap':'1'}
 });
 // Normal request wrapper does not permit arbitrary headers. Call here
 // with original G0 SIWE headers explicitly, no raw signature logging.
}
const loginButton=guard(async()=>{
 await requireWallet();
 const current=account,originalEpoch=epoch;
 const p=await fetch('/v1/auth/pre-session',{
  method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json','X-C1-Bootstrap':'1'},
  body:'{}',cache:'no-store'
 });
 if(!p.ok)throw Error('PRE_SESSION_HTTP_'+p.status);
 const pre=await p.json();
 const challengeResp=await fetch('/v1/identity/wallet/challenge',{
  method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json','X-C1-CSRF':pre.csrf},
  body:JSON.stringify({address:current}),cache:'no-store'
 });
 if(!challengeResp.ok)throw Error('SIWE_CHALLENGE_HTTP_'+challengeResp.status);
 const challenge=await challengeResp.json();
 if(!equals(challenge.address,current)||challenge.chainId!==10143||
  challenge.domain!==location.host||challenge.uri!==location.origin)
  throw Error('SIWE_CHALLENGE_ORIGIN_MISMATCH');
 const proof=await wallet('personal_sign',[challenge.message,current]);
 await requireWallet();
 if(originalEpoch!==epoch)throw Error('WALLET_CHANGED_DURING_LOGIN');
 const resp=await fetch('/v1/identity/wallet/login',{
  method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json','X-C1-CSRF':pre.csrf},
  body:JSON.stringify({challengeId:challenge.challengeId,signature:proof}),cache:'no-store'
 });
 if(!resp.ok)throw Error('SIWE_LOGIN_HTTP_'+resp.status);
 const logged=await resp.json();
 if(logged.authPilot!==true||typeof logged.csrf!=='string')
  throw Error('SIWE_SESSION_REQUIRED');
 csrf=logged.csrf;
 state('identity','PASS：Monad Testnet SIWE 登录成功\n'+current,true);
});
$('connect').addEventListener('click',guard(async()=>{
 const chain=await wallet('eth_chainId');
 if(BigInt(chain)!==CHAIN)throw Error('请切换 MetaMask 到 Monad Testnet 10143。');
 const addresses=await wallet('eth_requestAccounts');
 if(!equals(addresses?.[0],QUOTE))throw Error('请选择 Quote Authority Account 2: '+QUOTE);
 account=addresses[0].toLowerCase();
 csrf=null;epoch++;
 state('identity','已连接 '+account+'\n请点击 SIWE 登录。',true);
}));
$('login').addEventListener('click',loginButton);
$('readiness').addEventListener('click',guard(async()=>{
 await requireWallet();
 if(!csrf)throw Error('请先 SIWE 登录。');
 const st=await req('/v1/t1/status');
 if(st.status!=='READY_TESTNET_7_USDC'||st.fundingEnabled!==true||
  st.transactionActionsEnabled!==true||st.testnetOnly!==true)
  throw Error('TESTNET_FUND_SERVICE_NOT_READY');
 const ready=await req('/v1/t1/fund/readiness');
 if(!equals(ready.payer,QUOTE)||!equals(ready.contract,T0)||
  !equals(ready.token,TOKEN)||ready.amountForOne!==AMOUNT.toString()||
  ready.unitsFunded!=='0')
  throw Error('REAL_T0_READINESS_CONFLICT');
 if(BigInt(ready.assets?.balance??'0')<AMOUNT)
  throw Error('INSUFFICIENT_TEST_USDC_7');
 const mon=await wallet('eth_getBalance',[account,'latest']);
 if(BigInt(mon)<=0n)throw Error('NO_TEST_MON_FOR_GAS');
 serviceReady=true;
 state('chain',
  'PASS：真实 Monad Testnet\n'+
  'Escrow: '+ready.contract+'\n'+
  'Token: '+ready.token+'\n'+
  'Test USDC: '+(Number(ready.assets.balance)/1e6).toFixed(6)+'\n'+
  'Allowance: '+(Number(ready.assets.allowance)/1e6).toFixed(6)+'\n'+
  'Lifetime funded units: '+ready.unitsFunded+'\n'+
  'Gas MON: '+(Number(BigInt(mon))/1e18).toFixed(4),true);
}));
$('prepare').addEventListener('click',guard(async()=>{
 await requireWallet();
 if(!csrf||!serviceReady)throw Error('先完成真实链上和登录验证。');
 const newId=crypto.randomUUID();
 const result=await post('prepare',{idempotencyKey:newId,quantity:1});
 if(result.stage!=='PREPARED'||result.quantity!==1||result.amount!==AMOUNT.toString()||
   !equals(result.payer,account))throw Error('ORIGINAL_QUOTE_INTENT_MISMATCH');
 id=result.intentId;
 quote=quoteFor(result);
 $('recoverId').value=id;
 state('quote','已持久 PREPARED：\nIntent ID: '+id+
  '\nQuote ID: '+quote.quoteId+
  '\nAmount: 7 Test USDC\nDeadline (Unix): '+quote.deadline+
  '\n接下来由本人签署 FundingQuote。',true);
}));
$('sign').addEventListener('click',guard(async()=>{
 await requireWallet();
 if(!id||!quote)throw Error('必须先持久化原 Quote。');
 const sentEpoch=epoch;
 const proof=await wallet('eth_signTypedData_v4',[account,JSON.stringify(typedData(quote))]);
 await requireWallet();
 if(sentEpoch!==epoch)throw Error('WALLET_CHANGED_DURING_QUOTE');
 const result=await post('quote',{intentId:id,signature:proof});
 if(result.stage!=='QUOTE_BOUND'||result.testnetQuoteSignatureAccepted!==true)
  throw Error('REAL_FUNDING_QUOTE_NOT_ACCEPTED');
 signature=proof;
 quoteAccepted=true;
 state('quote','PASS：真正 FundingQuote 已由 Quote Authority 签署\n'+
  'Intent ID: '+id+'\nQuote ID: '+quote.quoteId+
  '\nDigest: '+result.quoteDigest+'\n请下一步仅授权 7 Test USDC。',true);
}));
async function nonceFor(){
 const raw=await wallet('eth_getTransactionCount',[account,'pending']);
 const big=BigInt(raw);
 if(big<0n||big>BigInt(Number.MAX_SAFE_INTEGER))
  throw Error('WALLET_NONCE_INVALID');
 return Number(big);
}
const hex=x=>'0x'+BigInt(x).toString(16);
async function sendOriginal(kind,data,target){
 await requireWallet();
 const nonce=await nonceFor();
 const transaction={from:account,to:target,nonce,value:'0',data};
 const decision=await post('reserve',{intentId:id,kind,transaction});
 if(decision.stage!==(kind==='approve'?'APPROVE_UNKNOWN':'FUND_UNKNOWN')||
  decision.mustNotRetryOriginalOperation!==true)
  throw Error('DURABLE_ORIGINAL_NONCE_NOT_RESERVED');
 const surface=kind==='approve'?'approveInfo':'fundInfo';
 state(surface,'原始 '+kind+' 操作已提交数据库（UNKNOWN）\nNonce: '+
  nonce+'\n接下来会弹出 MetaMask，请你亲自确认。失败时不要重复发送。',true);
 // Exactly one user-triggered transfer. No auto retry, no substitution.
 let hashValue;
 try{
  hashValue=await wallet('eth_sendTransaction',[{
   from:account,to:target,value:'0x0',data,nonce:hex(nonce)
  }]);
 }catch{
  state(surface,'MetaMask 未提供交易 Hash；后端仍为 UNKNOWN。'+
   '\n如已经发送，请从 MetaMask Activity 获取原 Hash 恢复，严禁重发。',false);
  return;
 }
 if(!/^0x[0-9a-f]{64}$/i.test(hashValue))
  throw Error('METAMASK_TX_HASH_INVALID');
 if(kind==='approve')approveHash=hashValue;else fundHash=hashValue;
 $('recoverHash').value=hashValue;
 state(surface,'MetaMask 已返回原交易 Hash（尚未代表确认）：\n'+hashValue+
  '\n请点击下一步核对 Receipt。',true);
 try{
  await post('bind-hash',{intentId:id,kind,txHash:hashValue});
  state(surface,'已保存原 '+kind+' 交易 Hash（尚未表示资金已成功）：\n'+hashValue+
   '\n请核对 Receipt。',true);
 }catch{
  state(surface,'节点尚未找到原始交易，稍后点击 Receipt 核对或手动恢复原 Hash：\n'+hashValue,false);
 }
}
const APPROVE_SELECTOR='0x095ea7b3';
const pad=(x)=>x.toLowerCase().replace(/^0x/,'').padStart(64,'0');
$('approve').addEventListener('click',guard(async()=>{
 await requireWallet();
 if(!csrf||!quoteAccepted||!id||approveHash)throw Error('ORIGINAL_APPROVE_STAGE_DENIED');
 const data=APPROVE_SELECTOR+pad(T0)+AMOUNT.toString(16).padStart(64,'0');
 await sendOriginal('approve',data,TOKEN);
}));
async function reconcileKind(kind){
 await requireWallet();
 const existing=kind==='approve'?approveHash:fundHash;
 const txHash=existing||$('recoverHash').value.trim();
 const originalId=id||$('recoverId').value.trim();
 if(!/^0x[0-9a-f]{64}$/i.test(txHash)||!originalId)
  throw Error('原交易 Hash 与原 Intent ID 均不能为空。');
 await post('bind-hash',{intentId:originalId,kind,txHash});
 const proof=await post('reconcile',{intentId:originalId,kind});
 const place=kind==='approve'?'approveInfo':'fundInfo';
 if(proof.status==='UNKNOWN'){
  state(place,'原始交易仍然在等待链上确认。不要重发。\n'+txHash,false);
  return;
 }
 if(proof.status!=='CONFIRMED'){
  state(place,'原交易最终 REVERTED 或无法验证；请检查区块浏览器。\n'+txHash,false);
  return;
 }
 if(kind==='approve')approveConfirmed=true;else fundConfirmed=true;
 state(place,'PASS：原始 '+kind+' 的真实 Receipt 已确认\nTX: '+txHash+
  '\nStage: '+proof.stage+'\nBlock: '+proof.blockNumber+
  '\nHash: '+proof.blockHash,true);
}
$('confirmApprove').addEventListener('click',guard(async()=>{
 await reconcileKind('approve');
}));
$('fund').addEventListener('click',guard(async()=>{
 await requireWallet();
 if(!approveConfirmed||!signature||!id||fundHash)
  throw Error('必须先完成原 Approve 且保留签名。');
 const call=await post('build-call',{intentId:id,signature});
 if(!equals(call.to,T0)||call.amount!==AMOUNT.toString()||
  call.testnetOnly!==true)
  throw Error('WRONG_REAL_FUND_CALL');
 await sendOriginal('fund',call.data,T0);
}));
$('confirmFund').addEventListener('click',guard(async()=>{
 await reconcileKind('fund');
}));
$('recoverApprove').addEventListener('click',guard(async()=>{
 await reconcileKind('approve');
}));
$('recoverFund').addEventListener('click',guard(async()=>{
 await reconcileKind('fund');
}));
$('reload').addEventListener('click',guard(async()=>{
 await requireWallet();
 const originalId=id||$('recoverId').value.trim();
 if(!originalId)throw Error('请填入真实 Intent UUID。');
 const snapshot=await req('/v1/t1/intents/'+originalId);
 if(!equals(snapshot.payer,account))throw Error('INTENT_WALLET_OWNERSHIP_MISMATCH');
 id=originalId;
 $('recoverId').value=id;
 if(snapshot.stage==='APPROVED')approveConfirmed=true;
 if(snapshot.stage==='FUNDED'){approveConfirmed=true;fundConfirmed=true}
 state('recoverInfo','原始 Intent（来自独立 PostgreSQL）：\n'+
  JSON.stringify(snapshot,null,2),true);
}));
controls();
