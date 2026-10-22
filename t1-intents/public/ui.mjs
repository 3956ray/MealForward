/**
 * Standalone T1-C ACCEPTANCE UI. Same-origin SIWE auth only.
 * Financial wallet transactions and EIP712 FundingQuote signatures ABSENT.
 * Session stays exclusively inside a server-issued HttpOnly SameSite cookie.
 * CSRF is held only in ephemeral page memory and wiped at reload/logout.
 */
const el=id=>document.getElementById(id);
const ui=(id,value,state='')=>{
 const item=el(id);
 item.textContent=value;
 item.dataset.state=state;
};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
let account=null,sessionWallet=null,sessionCsrf=null,busy=false,epoch=0;
const wallet=async(method,params=[])=>{
 if(!['eth_requestAccounts','eth_accounts','eth_chainId','personal_sign'].includes(method))
  throw Error('WALLET_METHOD_FORBIDDEN');
 if(!window.ethereum?.request||window.ethereum.isMetaMask!==true)
  throw Error('需要使用 MetaMask 专用测试钱包。');
 return window.ethereum.request({method,params});
};
const network=async()=>{
 const id=await wallet('eth_chainId');
 if(BigInt(id)!==10143n)throw Error('请在 MetaMask 中选择 Monad Testnet (10143)。');
};
const verifyAccount=async()=>{
 await network();
 const list=await wallet('eth_accounts');
 if(!account||!Array.isArray(list)||!same(list[0],account))
  throw Error('钱包或链已更换：必须重新登录确认新身份。');
};
function buttons(){
 el('login').disabled=busy||!account;
 el('my').disabled=busy||!account||!same(sessionWallet,account);
 el('logout').disabled=busy||!sessionCsrf||!same(sessionWallet,account);
 el('connect').disabled=busy;
 el('check').disabled=busy;
 el('me').disabled=busy;
}
const guarded=fn=>async()=>{
 if(busy)return;
 busy=true;buttons();
 try{await fn()}
 catch(e){
  // Do not print user signatures, cookies, SIWE challenge, or raw errors.
  const reason=typeof e?.message==='string'?e.message.slice(0,150):'UNKNOWN';
  ui('wallet','未通过：'+reason,'bad');
 }finally{busy=false;buttons()}
};
async function api(path,{method='GET',body,headers={}}={}){
 const response=await fetch(path,{
  method,credentials:'same-origin',cache:'no-store',redirect:'error',
  headers:{
   ...(method==='POST'?{'Content-Type':'application/json'}:{}),...headers
  },
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(13000)
 });
 const type=response.headers.get('content-type')||'';
 if(!type.startsWith('application/json'))
  throw Error('服务器未返回预期 JSON。');
 const data=await response.json();
 if(!response.ok)throw Error(data?.error||'SERVICE_UNAVAILABLE');
 return data;
}
function resetWallet(message){
 ++epoch;
 account=null;sessionWallet=null;sessionCsrf=null;
 ui('wallet',message,'bad');
 ui('identity','钱包或网络已变化：原身份不再用于本页面。','bad');
 ui('results','当前钱包尚未登录；禁止展示上个账户的 Intent。','bad');
 buttons();
}
el('connect').addEventListener('click',guarded(async()=>{
 await network();
 const addresses=await wallet('eth_requestAccounts');
 if(!Array.isArray(addresses)||!/^0x[0-9a-f]{40}$/i.test(addresses[0]||''))
  throw Error('MetaMask 未提供有效地址。');
 account=addresses[0].toLowerCase();
 sessionWallet=null;sessionCsrf=null;
 ++epoch;
 ui('wallet','已连接测试网钱包：'+account,'ok');
 ui('identity','此账户还没有完成本站 SIWE 登录。');
 ui('results','请先执行 SIWE 登录，再读取个人 Intent。');
}));
el('check').addEventListener('click',guarded(async()=>{
 const status=await api('/v1/t1/status');
 if(status.status!=='READY_NO_FUNDS'||status.transactionActionsEnabled!==false||
    status.fundingEnabled!==false||status.quoteSigningEnabled!==false||
    status.originalCp30DataConnected!==false)
  throw Error('服务不处于预期 NO FUNDS 安全模式。');
 ui('service',
  'READY_NO_FUNDS · Monad Testnet 10143\n认证与 Intent 数据源可用，但资金功能已关闭。','ok');
}));
el('login').addEventListener('click',guarded(async()=>{
 await verifyAccount();
 const current=account,createdEpoch=epoch;
 // Each challenge is minted by the server, bound to this new HTTPS origin.
 const pre=await api('/v1/auth/pre-session',{
  method:'POST',body:{},headers:{'X-C1-Bootstrap':'1'}
 });
 const challenge=await api('/v1/identity/wallet/challenge',{
  method:'POST',body:{address:current},headers:{'X-C1-CSRF':pre.csrf}
 });
 if(!same(challenge.address,current)||challenge.chainId!==10143||
    challenge.domain!==location.host||challenge.uri!==location.origin)
  throw Error('服务器返回的 SIWE 挑战域名、网络或地址不匹配。');
 // SIWE is EIP-191 personal_sign; does not authorize any payment.
 const signature=await wallet('personal_sign',[challenge.message,current]);
 await verifyAccount();
 if(createdEpoch!==epoch)throw Error('签名过程中钱包发生变化；登录结果作废。');
 const result=await api('/v1/identity/wallet/login',{
  method:'POST',body:{challengeId:challenge.challengeId,signature},
  headers:{'X-C1-CSRF':pre.csrf}
 });
 if(result.authPilot!==true||typeof result.csrf!=='string')
  throw Error('服务器没有返回受保护的 SIWE Session。');
 sessionWallet=current;
 sessionCsrf=result.csrf;
 ui('identity','PASS：真实 SIWE 登录成功。\n'+'钱包：'+current+
   '\nSession 存储在本站 HttpOnly Cookie；与原 CP30 身份隔离。','ok');
 ui('results','登录完成，可读取本账户的私有 Intent。');
}));
el('me').addEventListener('click',guarded(async()=>{
 const result=await api('/v1/me');
 if(!account||!same(result.walletAddress,account))
  throw Error('当前 MetaMask 地址与 Cookie 的授权账户不同，请重新登录。');
 sessionWallet=account;
 ui('identity','PASS：真实服务端 Session 有效。\n钱包：'+account+
  '\n若页面刷新后未保存 CSRF，需重新登录才能注销。','ok');
}));
el('my').addEventListener('click',guarded(async()=>{
 await verifyAccount();
 if(!sessionWallet||!same(sessionWallet,account))
  throw Error('没有当前账户的有效 SIWE 登录证明。');
 const data=await api('/v1/t1/my-intents');
 if(!Array.isArray(data.items)||data.fundingEnabled!==false||
    data.scope!=='NEW_TESTNET_ORIGINAL_SIWE_ONLY')
  throw Error('Intent 返回数据未满足只读源约束。');
 ui('results',data.items.length===0?
  'PASS：已从独立 Supabase 数据库读取。\n我的 Intents：0 条\n新项目尚无真实资助订单，空列表正确。':
  'PASS：仅显示当前登录钱包的测试网 Intent。\n'+JSON.stringify(data.items,null,2),
 'ok');
}));
el('logout').addEventListener('click',guarded(async()=>{
 if(!sessionCsrf)throw Error('当前页面缺少 CSRF，请重新登录后注销。');
 await api('/v1/auth/logout',{
  method:'POST',body:{},headers:{'X-C1-CSRF':sessionCsrf}
 });
 sessionWallet=null;sessionCsrf=null;
 ui('identity','已注销本站 SIWE Session；原钱包中的签名和资产未变化。','ok');
 ui('results','已清空旧账户显示。');
}));
window.ethereum?.on?.('accountsChanged',()=>resetWallet('MetaMask 已切换账户，旧钱包结果失效。'));
window.ethereum?.on?.('chainChanged',()=>resetWallet('MetaMask 已切换网络，请先核对 Chain ID 10143。'));
buttons();
guarded(async()=>{
 const status=await api('/v1/t1/status');
 if(status.status==='READY_NO_FUNDS'&&status.fundingEnabled===false)
  ui('service','READY_NO_FUNDS · 独立 Supabase 连接已就绪。','ok');
 else ui('service','服务未通过只读门禁。','bad');
})().catch(()=>ui('service','服务暂时不可用，请稍后重试。','bad'));
