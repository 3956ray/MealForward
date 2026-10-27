import {createPhase8Controller} from './t1f-phase8-controller.mjs';
const $=id=>document.getElementById(id),providers=[];
let client=null,crypto=null,cryptoFailed=false,explicitProvider=false;
$('provider').innerHTML='<option value="">选择钱包</option>';
const render=s=>{
 const i=s.issuer,d=s.state,r=d?.round,o=d?.operation,issuer=s.role==='issuer'&&s.chainId===10143,working=s.busy||i?.busy;
 $('wallet').textContent=s.account?`${s.account}\n网络：${s.chainId} · 角色：${s.role||'不匹配'}`:'尚未读取授权账户';
 $('previous').textContent=d?`上一笔：${d.predecessor.id}\n操作：${d.predecessor.operationId}\n原状态：${d.predecessor.stage}\n哈希：${d.predecessor.txHash||'—'}\n历史记录保留，不重新发送。`:'尚未读取';
 const remaining=i?.windowRemainingSeconds;
 $('state').textContent=d?`原 Claim：${d.originalClaimStage}\n本次状态：${o?.stage||d.status}\n轮次：${r?.id||'—'}\n摘要：${r?.digest||'—'}\n准备/发送剩余：${remaining===null||remaining===undefined?'—':`${remaining}s`}\n准备/发送截止：${r?new Date(r.prepareBefore*1000).toLocaleString():'—'}\n合约截止：${r?new Date(r.candidateDeadline*1000).toLocaleString():'—'}\n目标：${d.target}\nNonce：${r?.nonce||'—'}\n本次操作：${o?.id||'—'}\n交易哈希：${o?.txHash||i?.receivedHash||'—'}`:'尚未读取';
 $('typed').textContent=r?JSON.stringify(r.typedData,null,2):'尚无内容';
 $('approvals').textContent=`Owner：${r?.roles.owner?'已记录':'未记录'} · Donor：${r?.roles.donor?'已记录':'未记录'}`;
 $('message').textContent=i?.challenge||'尚无登录消息';$('auth').textContent=i?.authenticated?'Issuer 已登录':'Issuer 尚未登录';
 $('inspect').disabled=s.walletBusy;$('connect').disabled=working||s.walletBusy;$('refresh').disabled=working;
 $('approve').disabled=!s.canApprove;$('challenge').disabled=working||!issuer;$('login').disabled=working||!issuer||!i?.challenge;
 $('prepare').disabled=working||!issuer||!crypto||!i?.canPrepare;$('send').disabled=working||!issuer||!i?.canSend;
 $('bind').disabled=working||!issuer||!i?.authenticated||!i?.receivedHash;
 const recoverable=!working&&issuer&&i?.authenticated&&i?.recovery&&!!o&&!o.txHash&&!i?.canSend;
 $('original-hash').disabled=!recoverable;$('recover-hash').disabled=!recoverable;
 $('reconcile').disabled=working||!issuer||!i?.authenticated||!o?.txHash;
 let progress=working?'操作进行中，请查看钱包或等待服务响应。':o?.stage==='ISSUED'?'链上发券已核验通过。':
  o?.txHash?'交易哈希已绑定，请核验链上结果。':i?.receivedHash?'钱包已返回哈希；请绑定同一哈希，勿再次发送。':
  i?.canSend?'准备成功：现在点击 Send once in wallet，再在 MetaMask 核对并确认。':
  o?(i?.windowExpired?'Send window closed · 发送窗口已关闭。已预留且未记录哈希，需要恢复审查。':'本次已预留，未记录交易哈希；发送不可用，请核对原交易。'):
  i?.recovery?'准备结果不确定，需要恢复审查；不要再次准备或发送。':
  i?.windowExpired?'Prepare/send window closed · 本轮准备/发送窗口已关闭。':
  s.canApprove?'请核对本轮完整内容，然后明确签署当前角色批准。':
  i?.canPrepare?'可以准备。准备成功后立即进行单独的 Send 操作。':
  !r?'尚无新轮次。':r.roles.owner&&r.roles.donor?'双签已记录。切换 Issuer、检查钱包、登录并刷新状态。':'等待 Owner 和 Donor 完成本轮批准。';
 $('result').textContent=[cryptoFailed?'签名校验组件不可用；准备和批准已关闭，钱包读取仍可用。':null,s.error,i?.error,progress].filter(Boolean).join('\n');
};
const request=async(path,method,body,csrf)=>{const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),60000);try{const response=await fetch(path,{method,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:ac.signal,headers:{'Content-Type':'application/json',...(path==='/v1/auth/pre-session'?{'X-C1-Bootstrap':'1'}:{}),...(path==='/v1/t1f/phase8/approval'?{'X-Phase8-Intent':'signed-approval'}:{}),...(csrf?{'X-C1-CSRF':csrf}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('PHASE8_HTTP_'+response.status);return await response.json();}finally{clearTimeout(timer)}};
const proxy=Object.fromEntries(['validatePhase8','executionDTO','hashData','recoverApproval'].map(k=>[k,(...args)=>{if(!crypto)throw Error('PHASE8_CRYPTO_UNAVAILABLE');return crypto[k](...args)}]));
const select=()=>{client?.invalidate();$('original-hash').value='';const p=$('provider').value===''?null:providers[Number($('provider').value)];client=createPhase8Controller({provider:p?.provider,request,crypto:proxy,cryptoReady:()=>!!crypto,origin:location.origin,render});render(client.snapshot());};
const add=(provider,name)=>{if(!provider?.request||providers.some(p=>p.provider===provider))return;providers.push({provider,name});const option=document.createElement('option');option.value=String(providers.length-1);option.textContent=name;$('provider').append(option);if(!explicitProvider){$('provider').value=providers.length===1?'0':'';if(client)select();}};
for(const action of ['inspect','connect','refresh','approve'])$(action).onclick=()=>{if(!client)select();void client[action]().catch(()=>{})};
for(const action of ['challenge','login','prepare','send','bind','reconcile'])$(action).onclick=()=>{if(client&&!client.snapshot().busy)void client.issuer[action]().catch(()=>{})};
$('recover-hash').onclick=()=>{if(client&&!client.snapshot().busy)void client.issuer.recoverHash($('original-hash').value.trim()).catch(()=>{})};
$('provider').onchange=()=>{explicitProvider=$('provider').value!=='';select()};
const countdown=setInterval(()=>{if(client)render(client.snapshot())},1000);
addEventListener('pagehide',()=>{clearInterval(countdown);client?.invalidate()});
addEventListener('eip6963:announceProvider',e=>{add(e.detail.provider,e.detail.info.name);if(!client)select()});dispatchEvent(new Event('eip6963:requestProvider'));
for(const [index,p] of (globalThis.ethereum?.providers||[globalThis.ethereum]).entries())add(p,p?.isMetaMask?'MetaMask':`Injected wallet ${index+1}`);
select();import('./t1f-phase8-crypto.mjs').then(module=>{crypto=module;render(client.snapshot())}).catch(()=>{cryptoFailed=true;render(client.snapshot())});
