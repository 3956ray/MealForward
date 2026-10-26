/* One-shot Issuer state. No storage, permissions request, auto-sign or auto-send. */
export const ISSUER='0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3';
export const TARGET='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58';
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===k.slice().sort().join();
const check=x=>{if(!x)throw Error('EXECUTION_CONTEXT_UNCONFIRMED')};
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x);
const uint=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x);
const qty=x=>typeof x==='string'&&/^0x(0|[1-9a-f][0-9a-f]*)$/.test(x);
export function validateExecution(s,{now=Math.floor(Date.now()/1000),prepare=false}={}){
 const keys=['status','originalClaimStage','serverTime','chainId','issuer','target','serverMayBroadcast','settlementEnabled','sendAgainPermitted','round','operation'];
 check(exact(s,keys)||prepare&&(exact(s,[...keys,'created'])||exact(s,[...keys,'created','transaction']))||exact(s,[...keys,'receiptStatus']));
 check(s.originalClaimStage==='ISSUE_UNKNOWN'&&s.chainId===10143&&s.issuer===ISSUER&&s.target===TARGET&&s.serverMayBroadcast===false&&s.settlementEnabled===false&&s.sendAgainPermitted===false&&Number.isSafeInteger(s.serverTime)&&Math.abs(s.serverTime-now)<=30);
 check(['NO_ROUND','AWAIT_APPROVALS','READY_TO_PREPARE','PREPARE_WINDOW_CLOSED','RECOVERY_ONLY'].includes(s.status));
 if(s.round!==null){const r=s.round;check(exact(r,['id','digest','expiresAt','prepareBefore','candidateDeadline','nonce','roles'])&&uuid(r.id)&&hash(r.digest)&&[r.expiresAt,r.prepareBefore,r.candidateDeadline].every(Number.isSafeInteger)&&r.prepareBefore===r.expiresAt-90&&r.candidateDeadline===r.expiresAt+180&&uint(r.nonce)&&exact(r.roles,['owner','donor'])&&Object.values(r.roles).every(v=>typeof v==='boolean'));}else check(s.status==='NO_ROUND'&&s.operation===null);
 if(s.operation!==null){const o=s.operation;check(s.round&&exact(o,['id','operationId','stage','revision','nonce','deadline','calldataHash','txHash','receiptBlock','receiptBlockHash'])&&uuid(o.id)&&hash(o.operationId)&&['ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED'].includes(o.stage)&&Number.isSafeInteger(o.revision)&&o.revision>=0&&o.nonce===s.round.nonce&&o.deadline===s.round.candidateDeadline&&hash(o.calldataHash)&&(o.txHash===null||hash(o.txHash))&&(o.receiptBlock===null||uint(o.receiptBlock)||Number.isSafeInteger(o.receiptBlock)&&o.receiptBlock>=0)&&(o.receiptBlockHash===null||hash(o.receiptBlockHash))&&s.status==='RECOVERY_ONLY');}
 if(s.status==='READY_TO_PREPARE')check(s.operation===null&&s.round?.roles.owner&&s.round.roles.donor&&s.serverTime<s.round.prepareBefore);
 if(s.status==='RECOVERY_ONLY')check(s.operation!==null);
 if(prepare){check(typeof s.created==='boolean');check(s.created?Object.hasOwn(s,'transaction')&&s.operation?.stage==='ISSUE_UNKNOWN'&&!s.operation.txHash:!Object.hasOwn(s,'transaction'));}
 return s;
}
export function validateChallenge(c,{origin,now,address=ISSUER}){
 check(exact(c,['challengeId','address','chainId','nonce','domain','uri','issuedAt','expiresAt','message'])&&uuid(c.challengeId)&&c.address===address&&c.chainId===10143&&/^[0-9a-f]{64}$/.test(c.nonce)&&c.domain===new URL(origin).host&&c.uri===origin&&Number.isSafeInteger(c.issuedAt)&&Number.isSafeInteger(c.expiresAt)&&c.issuedAt<=now&&now-c.issuedAt<=30&&c.expiresAt===c.issuedAt+180&&now<c.expiresAt);
 const expected=`${c.domain} wants you to sign in with your Ethereum account:\n${c.message.split('\n')[1]}\n\nSign in to MealForward with your test wallet.\n\nURI: ${origin}\nVersion: 1\nChain ID: 10143\nNonce: ${c.nonce}\nIssued At: ${new Date(c.issuedAt*1000).toISOString()}\nExpiration Time: ${new Date(c.expiresAt*1000).toISOString()}\nRequest ID: ${c.challengeId}`;
 check(typeof c.message==='string'&&c.message===expected&&c.message.split('\n')[1].toLowerCase()===address);return c;
}
export function createExecutionController({provider,request,hashData,origin,clock=()=>Math.floor(Date.now()/1000),render=()=>{},timeoutMs=60000}={}){
 let preparationDispatched=false,disposed=false,revision=0,busy=false,walletBusy=false,state=null,payload=null,challenge=null,csrf=null,preCsrf=null,checked=false,recovery=false,received=null,error=null;
 // Once a prepare leaves this controller, a lost response cannot prove no reservation.
 const hasReservationRisk=()=>preparationDispatched||!!state?.operation||!!payload||!!received;
 const snapshot=()=>({busy,walletBusy,state,checked,authenticated:!!csrf,challenge:challenge?.message||null,canSend:!!payload&&!recovery, recovery,receivedHash:received?.hash||null,error});
 const notify=()=>{if(!disposed)render(snapshot())};
 const discard=()=>{recovery=hasReservationRisk();revision++;payload=null;challenge=null;checked=false;csrf=null;preCsrf=null;notify()};
 for(const e of ['accountsChanged','chainChanged','disconnect'])provider?.on?.(e,discard);
 const invalidate=()=>{disposed=true;discard()};
 const stable=v=>check(!disposed&&v===revision);
 const wait=async(p,v)=>{let timer;try{const out=await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('EXECUTION_TIMEOUT_RECOVERY_ONLY')),timeoutMs)})]);stable(v);return out;}finally{clearTimeout(timer)}};
 const wallet=async v=>{check(provider?.request);const a=await wait(provider.request({method:'eth_accounts'}),v);check(Array.isArray(a)&&a[0]?.toLowerCase()===ISSUER);const c=await wait(provider.request({method:'eth_chainId'}),v);check(qty(c)&&BigInt(c)===10143n);stable(v);};
 const api=(path,method,body,token=csrf)=>request(path,method,body,token);
 const run=async fn=>{check(!busy);busy=true;error=null;notify();const v=revision;try{return await fn(v)}catch(e){recovery=hasReservationRisk();payload=null;challenge=null;error=e.message==='ORIGINAL_TRANSACTION_HASH_INVALID'?e.message:recovery?(e.message==='EXECUTION_TIMEOUT_RECOVERY_ONLY'?e.message:'EXECUTION_UNCERTAIN_REFRESH_RECOVERY'):'EXECUTION_ACTION_FAILED_RETRY';throw e;}finally{busy=false;notify()}};
 const read=async v=>{const s=validateExecution(await wait(api('/v1/t1f/successor/status','GET'),v),{now:clock()});state=s;if(s.operation){preparationDispatched=true;recovery=true;}return s};
 const sameOperation=(s,b)=>check(s.round?.id===b.roundId&&s.operation?.id===b.successorId);
 const bind=async v=>{check(received&&csrf);const b={...received,revision:state.operation.revision};sameOperation(state,b);await wallet(v);const s=validateExecution(await wait(api('/v1/t1f/successor/bind','POST',{roundId:b.roundId,successorId:b.successorId,revision:b.revision,txHash:b.hash}),v),{now:clock()});await wallet(v);sameOperation(s,b);check(s.operation.txHash===b.hash);state=s;};
 return Object.freeze({snapshot,invalidate,
 connect:()=>run(async()=>{check(!disposed&&provider?.request);const consumed=hasReservationRisk();payload=null;challenge=null;csrf=null;recovery=true;let timer;try{await Promise.race([provider.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('EXECUTION_TIMEOUT_RECOVERY_ONLY')),timeoutMs)})]);}finally{clearTimeout(timer)}check(!disposed);await wallet(revision);checked=true;recovery=consumed;}),
 inspect:async()=>{check(!walletBusy);walletBusy=true;notify();const v=revision;try{await wallet(v);checked=true;}catch{checked=false;error='WALLET_CHECK_UNCONFIRMED';throw Error(error)}finally{walletBusy=false;notify()}},
 challenge:()=>run(async v=>{await wallet(v);const p=await wait(api('/v1/auth/pre-session','POST',{},null),v);check(exact(p,['csrf'])&&/^[A-Za-z0-9_-]{43}$/.test(p.csrf));preCsrf=p.csrf;const c=await wait(api('/v1/identity/wallet/challenge','POST',{address:ISSUER},preCsrf),v);await wallet(v);challenge=validateChallenge(c,{origin,now:clock()});}),
 login:()=>run(async v=>{check(challenge&&preCsrf);await wallet(v);const c=validateChallenge(challenge,{origin,now:clock()});challenge=null;const signature=await wait(provider.request({method:'personal_sign',params:[c.message,ISSUER]}),v);await wallet(v);const r=await wait(api('/v1/identity/wallet/login','POST',{challengeId:c.challengeId,signature},preCsrf),v);check(exact(r,['csrf','authPilot'])&&r.authPilot===true&&/^[A-Za-z0-9_-]{43}$/.test(r.csrf));csrf=r.csrf;preCsrf=null;checked=true;}),
 refresh:()=>run(async v=>{recovery=hasReservationRisk();payload=null;await read(v);}),
 prepare:()=>run(async v=>{check(csrf&&!recovery&&!payload);await wallet(v);const before=await read(v);check(before.status==='READY_TO_PREPARE'&&clock()<before.round.prepareBefore);preparationDispatched=true;recovery=true;const s=validateExecution(await wait(api('/v1/t1f/successor/prepare','POST',{roundId:before.round.id,digest:before.round.digest}),v),{now:clock(),prepare:true});check(s.round.id===before.round.id&&s.round.digest===before.round.digest);const {transaction,created,...safe}=s;state=safe;recovery=true;if(!created)return;const t=transaction;check(exact(t,['from','to','chainId','value','nonce','data'])&&t.from===ISSUER&&t.to===TARGET&&qty(t.chainId)&&BigInt(t.chainId)===10143n&&t.value==='0x0'&&qty(t.nonce)&&BigInt(t.nonce)===BigInt(s.operation.nonce)&&typeof t.data==='string'&&/^0x([0-9a-f]{2})+$/.test(t.data)&&hashData(t.data)===s.operation.calldataHash);await wallet(v);check(clock()<s.round.prepareBefore);payload={...t};recovery=false;}),
 send:()=>run(async v=>{check(payload&&!recovery&&csrf);const tx=payload;payload=null;recovery=true;notify();await wallet(v);check(clock()<state.round.prepareBefore);const op={roundId:state.round.id,successorId:state.operation.id};const h=await wait(provider.request({method:'eth_sendTransaction',params:[tx]}),v);check(hash(h));received={...op,hash:h};await wallet(v);await bind(v);}),
 bind:()=>run(bind),
 recoverHash:originalHash=>run(async v=>{
  if(typeof originalHash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(originalHash))throw Error('ORIGINAL_TRANSACTION_HASH_INVALID');
  check(csrf&&state?.operation&&state.operation.txHash===null&&!payload);
  const b={roundId:state.round.id,successorId:state.operation.id,revision:state.operation.revision,hash:originalHash.toLowerCase()};
  recovery=true;await wallet(v);
  const s=validateExecution(await wait(api('/v1/t1f/successor/bind','POST',{roundId:b.roundId,successorId:b.successorId,revision:b.revision,txHash:b.hash}),v),{now:clock()});
  await wallet(v);sameOperation(s,b);check(s.operation.txHash===b.hash);state=s;received=b;
 }),
 reconcile:()=>run(async v=>{check(csrf&&state?.operation);payload=null;recovery=true;const b={roundId:state.round.id,successorId:state.operation.id,revision:state.operation.revision};const s=validateExecution(await wait(api('/v1/t1f/successor/reconcile','POST',b),v),{now:clock()});sameOperation(s,b);state=s;})
 });
}
