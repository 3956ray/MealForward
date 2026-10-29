import {createExecutionController} from './t1f-execution-controller.mjs';
const $=id=>document.getElementById(id);
let client=null,hashData=null,explicitProvider=false,cryptoFailed=false;
const providers=[];$('provider').innerHTML='<option value="">Select provider</option>';
const add=(provider,name)=>{if(!provider?.request||providers.some(p=>p.provider===provider))return;providers.push({provider,name});const o=document.createElement('option');o.value=String(providers.length-1);o.textContent=name;$('provider').append(o);if(providers.length===1&&!explicitProvider)$('provider').value='0';if(providers.length>1&&!explicitProvider){$('provider').value='';if(client)select();}};
const render=s=>{
 $('wallet').textContent=s.checked?'Issuer account / chain verified':'Wallet not checked';
 $('message').textContent=s.challenge||'No login message';
 const d=s.state;$('state').textContent=d?`Original Claim: ${d.originalClaimStage}\nSuccessor: ${d.operation?.stage||d.status}\nRound: ${d.round?.id||'—'}\nDigest: ${d.round?.digest||'—'}\nPrepare and send before: ${d.round?new Date(d.round.prepareBefore*1000).toISOString():'—'}\nPrepare/send time remaining: ${s.windowRemainingSeconds===null?'—':`${s.windowRemainingSeconds}s`}\nTarget: ${d.target}\nNonce: ${d.round?.nonce||'—'}\nCandidate deadline: ${d.round?.candidateDeadline||'—'}\nTransaction hash: ${d.operation?.txHash||s.receivedHash||'—'}`:'No state loaded';
 $('inspect').disabled=s.walletBusy;$('connect').disabled=s.busy||s.walletBusy;
 for(const id of ['challenge','refresh'])$(id).disabled=s.busy;
 $('provider').disabled=false;$('login').disabled=s.busy||!s.challenge;
 $('prepare').disabled=s.busy||!hashData||!s.canPrepare;
 $('send').disabled=s.busy||!s.canSend;$('bind').disabled=s.busy||!s.authenticated||!s.receivedHash;
 const recoverable=!s.busy&&s.authenticated&&s.recovery&&!!d?.operation&&!d.operation.txHash&&!s.canSend;
 $('original-hash').disabled=!recoverable;$('recover-hash').disabled=!recoverable;
 $('reconcile').disabled=s.busy||!s.authenticated||!d?.operation;
 const knownHash=d?.operation?.txHash||s.receivedHash;
 const progress=s.canSend?'Prepared. Click Send once in wallet now, then review and confirm in MetaMask. Do not pause to report, refresh, or switch accounts.':
  d?.operation?.stage==='ISSUED'?'Issue confirmed.':
  knownHash?'Transaction hash recorded. Bind if needed, then reconcile this same transaction. Never send again.':
  d?.operation?(s.windowExpired?'Send window closed. Reservation retained; no transaction hash recorded. Recovery review is required.':'Reservation retained; no transaction hash recorded. Recovery only; sending is unavailable.'):
  s.recovery?'Preparation outcome requires recovery. Never prepare or send again.':
  s.windowExpired?'Prepare/send window closed. Do not prepare this round.':
  s.canPrepare?'Ready to prepare. After preparation, immediately use the separate Send once in wallet button.':
  d?.status==='AWAIT_APPROVALS'?'Waiting for both approvals.':
  d?.status==='NO_ROUND'?'No approval round.':!s.authenticated?'Log in, then refresh status.':'Refresh status to check readiness.';
 $('result').textContent=[cryptoFailed?'Hash validation unavailable. Wallet read remains available; preparation disabled.':null,s.busy?'Working…':s.error?`${s.error}\n${progress}`:progress].filter(Boolean).join('\n');
};
const request=async(path,method,body,csrf)=>{const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),60000);try{const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',signal:ac.signal,headers:{'Content-Type':'application/json',...(path==='/v1/auth/pre-session'?{'X-C1-Bootstrap':'1'}:{}),...(csrf?{'X-C1-CSRF':csrf}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});const s=await r.json();if(!r.ok)throw Error('HTTP_'+r.status);return s;}finally{clearTimeout(timer)}};
const select=()=>{client?.invalidate();$('original-hash').value='';const p=$('provider').value===''?null:providers[Number($('provider').value)];client=createExecutionController({provider:p?.provider,request,hashData:data=>{if(!hashData)throw Error('HASH_UNAVAILABLE');return hashData(data)},origin:location.origin,render});render(client.snapshot());};
// Bind every action before loading the optional hashing dependency or contacting the backend.
for(const action of ['inspect','connect','challenge','login','refresh','prepare','send','bind','reconcile'])$(action).onclick=()=>{if(!client)select();void client[action]().catch(()=>{});};
$('recover-hash').onclick=()=>{if(client)void client.recoverHash($('original-hash').value.trim()).catch(()=>{});};
$('provider').onchange=()=>{explicitProvider=$('provider').value!=='';select();};
// Time updates only render local state; they never poll, request wallet access, or send.
const countdown=setInterval(()=>{if(client)render(client.snapshot())},1000);
addEventListener('pagehide',()=>{clearInterval(countdown);client?.invalidate()});
addEventListener('eip6963:announceProvider',e=>{add(e.detail.provider,e.detail.info.name);if(!client||providers.length===1)select();});
dispatchEvent(new Event('eip6963:requestProvider'));
for(const [i,p] of (globalThis.ethereum?.providers||[globalThis.ethereum]).entries())add(p,p?.isMetaMask?'MetaMask':`Injected wallet ${i+1}`);
if(providers.length)select();else{$('provider').innerHTML='<option>No injected wallet</option>';select();}
import('./t1f-execution-crypto.mjs').then(m=>{hashData=m.hashData;render(client.snapshot())}).catch(()=>{cryptoFailed=true;render(client.snapshot())});
