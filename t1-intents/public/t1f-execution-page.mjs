import {createExecutionController} from './t1f-execution-controller.mjs';
const $=id=>document.getElementById(id);
let client=null,hashData=null,explicitProvider=false;
const providers=[];$('provider').innerHTML='<option value="">Select provider</option>';
const add=(provider,name)=>{if(!provider?.request||providers.some(p=>p.provider===provider))return;providers.push({provider,name});const o=document.createElement('option');o.value=String(providers.length-1);o.textContent=name;$('provider').append(o);if(providers.length===1&&!explicitProvider)$('provider').value='0';if(providers.length>1&&!explicitProvider){$('provider').value='';if(client)select();}};
const render=s=>{
 $('wallet').textContent=s.checked?'Issuer account / chain verified':'Wallet not checked';
 $('message').textContent=s.challenge||'No login message';
 const d=s.state;$('state').textContent=d?`Original Claim: ${d.originalClaimStage}\nSuccessor: ${d.operation?.stage||d.status}\nRound: ${d.round?.id||'—'}\nDigest: ${d.round?.digest||'—'}\nPrepare before: ${d.round?new Date(d.round.prepareBefore*1000).toISOString():'—'}\nTarget: ${d.target}\nNonce: ${d.round?.nonce||'—'}\nCandidate deadline: ${d.round?.candidateDeadline||'—'}\nTransaction hash: ${d.operation?.txHash||s.receivedHash||'—'}`:'No state loaded';
 $('inspect').disabled=s.walletBusy;$('connect').disabled=s.busy||s.walletBusy;
 for(const id of ['challenge','refresh'])$(id).disabled=s.busy;
 $('provider').disabled=false;$('login').disabled=s.busy||!s.challenge;
 $('prepare').disabled=s.busy||!hashData||!s.authenticated||s.recovery||d?.status!=='READY_TO_PREPARE';
 $('send').disabled=s.busy||!s.canSend;$('bind').disabled=s.busy||!s.authenticated||!s.receivedHash;
 $('reconcile').disabled=s.busy||!s.authenticated||!d?.operation;
 $('result').textContent=s.error|| (s.busy?'Working…':s.recovery?'Recovery only. Never send again.':'Ready');
};
const request=async(path,method,body,csrf)=>{const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),60000);try{const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',signal:ac.signal,headers:{'Content-Type':'application/json',...(path==='/v1/auth/pre-session'?{'X-C1-Bootstrap':'1'}:{}),...(csrf?{'X-C1-CSRF':csrf}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});const s=await r.json();if(!r.ok)throw Error('HTTP_'+r.status);return s;}finally{clearTimeout(timer)}};
const select=()=>{client?.invalidate();const p=$('provider').value===''?null:providers[Number($('provider').value)];client=createExecutionController({provider:p?.provider,request,hashData:data=>{if(!hashData)throw Error('HASH_UNAVAILABLE');return hashData(data)},origin:location.origin,render});render(client.snapshot());};
// Bind every action before loading the optional hashing dependency or contacting the backend.
for(const action of ['inspect','connect','challenge','login','refresh','prepare','send','bind','reconcile'])$(action).onclick=()=>{if(!client)select();void client[action]().catch(()=>{});};
$('provider').onchange=()=>{explicitProvider=$('provider').value!=='';select();};
addEventListener('pagehide',()=>client?.invalidate());
addEventListener('eip6963:announceProvider',e=>{add(e.detail.provider,e.detail.info.name);if(!client||providers.length===1)select();});
dispatchEvent(new Event('eip6963:requestProvider'));
for(const [i,p] of (globalThis.ethereum?.providers||[globalThis.ethereum]).entries())add(p,p?.isMetaMask?'MetaMask':`Injected wallet ${i+1}`);
if(providers.length)select();else{$('provider').innerHTML='<option>No injected wallet</option>';select();}
import('./t1f-execution-crypto.mjs').then(m=>{hashData=m.hashData;render(client.snapshot())}).catch(()=>{$('result').textContent='Hash validation unavailable. Wallet read remains available; preparation disabled.'});
