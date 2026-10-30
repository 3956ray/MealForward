/** Opt-in initial data for a NEW disposable local stack. No production config or secrets are loaded. */
import {randomUUID} from 'node:crypto';
import {parseSiweMessage} from 'viem/siwe';
import {makeProductSiwe} from './siwe.mjs';
import {validatePublicationTransaction} from './publication-wire.mjs';
import {validateFundingTransaction} from './funding-wire.mjs';
import {validateApprovalTransaction} from './approval-wire.mjs';
const active=new Set(),used=new Set();
const fail=code=>{throw Object.assign(Error(code),{code});};
const check=(ok,code)=>{if(!ok)fail(code);};
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n;
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const requestId=()=>`seed-${randomUUID()}`;

export async function seedAcceptance({origin,wallets}){
 check(typeof origin==='string'&&/^http:\/\/127\.0\.0\.1:([1-9][0-9]{1,4})$/.test(origin)&&Number(origin.slice(origin.lastIndexOf(':')+1))<=65535,'SEED_LOCAL_ORIGIN_REQUIRED');
 check(!active.has(origin)&&!used.has(origin),'SEED_ALREADY_ATTEMPTED');active.add(origin);
 try{
  async function request(path,{method='GET',body,session,headers={}}={}){
   let response,value;
   try{response=await fetch(origin+'/v1/product'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{origin,'content-type':'application/json',...headers,...(session?{cookie:session.cookie,'x-mf-product-v2-csrf':session.csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});value=await response.json();}
   catch{fail('SEED_HTTP_UNAVAILABLE');}
   check(response.ok,/^[A-Z_]{3,64}$/.test(value?.error||'')?value.error:'SEED_HTTP_REJECTED');
   return {value,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const configuration=(await request('/configuration')).value;
  check(configuration?.verified===true&&configuration.profile==='local-acceptance'&&configuration.chainId===31337&&address(configuration.escrow)&&address(configuration.asset),'SEED_LOCAL_CONFIGURATION_REQUIRED');
  const initial=(await request('/catalog')).value;
  check(initial?.verified===true&&Array.isArray(initial.stores)&&Array.isArray(initial.meals)&&initial.stores.length===0&&initial.meals.length===0&&initial.accounting?.funded==='0','SEED_REQUIRES_EMPTY_CATALOG');
  check(initial.asset?.symbol==='TEST'&&initial.asset.decimals===6,'SEED_TEST_ASSET_REQUIRED');
  for(const role of ['merchant','donor','recipient']){
   const w=wallets?.[role];check(address(w?.address)&&typeof w.signMessage==='function'&&typeof w.sendTransaction==='function'&&typeof w.provider?.getNetwork==='function','SEED_SYNTHETIC_WALLETS_REQUIRED');
   check((await w.provider.getNetwork()).chainId===31337n,'SEED_WALLET_CHAIN_MISMATCH');
  }
  check(new Set(['merchant','donor','recipient'].map(k=>wallets[k].address.toLowerCase())).size===3,'SEED_DISTINCT_WALLETS_REQUIRED');
  // A partially completed seed can only be inspected, never automatically restarted.
  used.add(origin);
  const siwe=makeProductSiwe({profile:'local-acceptance',origin});
  async function login(wallet){
   const pre=await request('/auth/pre-session',{method:'POST',body:{},headers:{'x-mf-product-v2-bootstrap':'1'}}),session={cookie:pre.cookie,csrf:pre.value.csrf};
   const challenge=(await request('/identity/wallet/challenge',{method:'POST',body:{address:wallet.address},session})).value;
   let parsed,message;try{parsed=parseSiweMessage(challenge.message);message=siwe.makeChallenge({wallet:wallet.address.toLowerCase(),origin,chainId:31337,nonce:parsed.nonce,challengeId:challenge.challengeId,issuedAt:Math.floor(parsed.issuedAt.getTime()/1000),expiresAt:Math.floor(parsed.expirationTime.getTime()/1000)}).message;}catch{fail('SEED_LOGIN_CHALLENGE_REJECTED');}
   check(message===challenge.message,'SEED_LOGIN_CHALLENGE_REJECTED');
   let signature;try{signature=await wallet.signMessage(message);}catch{fail('SEED_LOGIN_SIGNATURE_FAILED');}
   const logged=await request('/identity/wallet/login',{method:'POST',body:{challengeId:challenge.challengeId,signature},session});
   return {cookie:logged.cookie,csrf:logged.value.csrf};
  }
  const merchant=await login(wallets.merchant),donor=await login(wallets.donor);
  const get=async(session,path)=>(await request(path,{session})).value;
  const call=async(session,path,body,method='POST')=>(await request(path,{session,body,method})).value;
  for(const session of [merchant,donor]){
   check((await get(session,'/me')).stores.length===0,'SEED_REQUIRES_EMPTY_IDENTITY');
   for(const path of ['/orders','/catalog-operations','/approvals','/vouchers'])check((await get(session,path)).items.length===0,'SEED_REQUIRES_EMPTY_HISTORY');
  }
  async function send(session,wallet,operation){
   check(operation?.state==='PREPARED'&&same(operation.wallet,wallet.address),'SEED_OPERATION_REJECTED');
   const group={registration:'/catalog-operations',publication:'/catalog-operations',approval:'/approvals',support:'/intents'}[operation.kind];check(group,'SEED_OPERATION_REJECTED');
   const validator=operation.kind==='support'?validateFundingTransaction:operation.kind==='approval'?validateApprovalTransaction:validatePublicationTransaction;
   try{validator(operation,configuration,operation.transaction);}catch{fail('SEED_TRANSACTION_UNVERIFIED');}
   const path=group+'/'+encodeURIComponent(operation.id),admission=await call(session,path+'/attempt',{}),admitted=admission.operation??admission.intent;
   check(admission.allowed===true&&admitted?.id===operation.id&&admitted?.state==='SEND_UNKNOWN','SEED_SEND_DENIED');
   let transaction;try{transaction=await wallet.sendTransaction(operation.transaction);}catch{fail('SEED_TRANSACTION_SEND_UNKNOWN');}
   check(hash(transaction?.hash),'SEED_TRANSACTION_SEND_UNKNOWN');
   // Save the original hash BEFORE waiting for mining. Lost HTTP recording is
   // repaired only by writing this same hash; the wallet is never called again.
   let records=0;
   async function record(){records++;try{await call(session,path+'/hash',{txHash:transaction.hash});}catch{/* A GET below decides whether this original hash was saved. */}}
   await record();
   for(let attempt=0;attempt<120;attempt++){
    let original;try{original=await get(session,path);}catch{await sleep(250);continue;}
    check(original?.id===operation.id&&original.kind===operation.kind&&same(original.wallet,wallet.address),'SEED_RECOVERY_IDENTITY_MISMATCH');
    check(!original.txHash||same(original.txHash,transaction.hash),'SEED_RECOVERY_HASH_MISMATCH');
    if(original.state==='CONFIRMED')return original;
    if(original.state==='REVERTED')fail('SEED_TRANSACTION_REVERTED');
    check(['SEND_UNKNOWN','HASH_BOUND'].includes(original.state),'SEED_RECOVERY_STATE_MISMATCH');
    if(!original.candidateHash&&!original.txHash&&records<3)await record();
    await sleep(250);
   }
   fail('SEED_FINALITY_TIMEOUT');
  }
  const review=await call(merchant,'/registration-reviews',{name:'留膳验收厨房',requestId:requestId()});
  const registration=await call(merchant,'/registrations',{reviewId:review.id,requestId:requestId()});await send(merchant,wallets.merchant,registration);const storeId=registration.storeId;
  await call(merchant,'/kitchens/'+encodeURIComponent(storeId)+'/settings',{expectedRevision:0,requestId:requestId(),hours:[[0,1440]],announcement:'本机验收厨房，使用 TEST 测试资产。餐券可全天核销。',restToday:false},'PUT');
  const meals=[],deadline=Math.floor(Date.now()/1000)+86400,definitions=[['暖心家常饭','7000000','3'],['当日双拼餐','9000000','2'],['丰盛营养套餐','12000000','2']];
  for(const [name,unitPrice,funded] of definitions){
   const mealId='seed-meal-'+randomUUID(),draft=await call(merchant,'/drafts/'+mealId,{storeId,expectedRevision:0,requestId:requestId(),name,description:'仅供本机完整流程验收，TEST 资产不是真实餐款。',unitPrice,quantity:'20',fundingDeadline:deadline,windows:[[0,1440]]},'PUT');
   const reviewed=await call(merchant,'/publication-reviews',{draftId:mealId,revision:draft.revision,requestId:requestId()}),publication=await call(merchant,'/publications',{reviewId:reviewed.id,requestId:requestId()});await send(merchant,wallets.merchant,publication);
   const supportReview=await call(donor,'/support-reviews',{storeId,mealId,version:1,quantity:funded,requestId:requestId()}),approval=await call(donor,'/approvals',{reviewId:supportReview.id,requestId:requestId()});await send(donor,wallets.donor,approval);
   const support=await call(donor,'/support-intents',{reviewId:supportReview.id,requestId:requestId()});await send(donor,wallets.donor,support);
   meals.push({id:mealId,name,unitPrice,offered:'20',funded,supportId:support.id});
  }
  const final=await get(null,'/catalog');
  check(final.verified===true&&final.stores.length===1&&final.meals.length===3&&final.accounting.funded==='7'&&final.accounting.available==='7'&&final.accounting.claimed==='0','SEED_FINAL_CATALOG_MISMATCH');
  for(const meal of meals){const actual=final.meals.find(m=>m.id===meal.id&&m.storeId===storeId);check(actual?.version===1&&actual.unitPrice===meal.unitPrice&&actual.remaining===String(20-Number(meal.funded))&&actual.claimable===meal.funded,'SEED_FINAL_MEAL_MISMATCH');}
  return {result:'SEEDED',scope:'real HTTP + PostgreSQL + Anvil 31337; synthetic test identities only',store:{id:storeId,name:'留膳验收厨房'},meals,asset:'TEST',fundedQuantity:'7',fundedAmount:'63000000',recipientReady:true};
 }finally{active.delete(origin);}
}
