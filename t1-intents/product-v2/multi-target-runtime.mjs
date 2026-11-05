import {makeImpactService} from './impact.mjs';
import {targetIdOf} from './target-registry.mjs';
import {makeTargetStore} from './target-store.mjs';
import {makeProductRuntime} from './runtime.mjs';
/** All targets share auth and the root transaction lock, never a substituted escrow. */
export async function makeMultiTargetRuntime({registry,store,chains,pool,origin,pepper,defaultImageDigest,profile='monad-testnet',newFundingEnabled=true,clock=()=>Math.floor(Date.now()/1000)}){
 const runtimes=new Map(),scopes=new Map(),ids=registry.ids();
 for(const id of ids){if(!chains.get(id))throw Error('TARGET_ADAPTER_REQUIRED');if(targetIdOf(chains.get(id).target)!==id)throw Error('TARGET_ADAPTER_MISMATCH');const verified=await chains.get(id).verifyTarget();if(targetIdOf(verified)!==id||verified.policySeconds!==registry.get(id).policySeconds||verified.verified!==true)throw Error('TARGET_POLICY_MISMATCH');scopes.set(id,makeTargetStore({store,registry,targetId:id,clock}));}
 const targets=ids.map(id=>({id,chainId:registry.get(id).chainId,escrow:registry.get(id).escrow,automaticSettlement:registry.get(id).contractVersion===3,acceptingFunding:newFundingEnabled&&id===registry.activeTargetId,label:id===registry.activeTargetId?'新版业务':'历史餐券与订单'}));
 for(const id of ids){const chain=chains.get(id),scope=scopes.get(id);
  const admitting=newFundingEnabled&&id===registry.activeTargetId;
  const wrapped={...chain,approvalEnabled:admitting&&chain.approvalEnabled,atomicFundingEnabled:admitting&&chain.atomicFundingEnabled,async identity(wallet){return {...await chain.identity(wallet),targetId:id,legacyTarget:id===registry.legacyTargetId};},fundingEnabled:newFundingEnabled&&id===registry.activeTargetId&&chain.fundingEnabled,
   async eligibility(wallet){
    let result=null,nextEligibleAt=0;
    for(const other of ids){const e=await chains.get(other).eligibility(wallet);if(e?.verified!==true)throw Error('GLOBAL_POLICY_UNVERIFIED');if(other===id)result=e;nextEligibleAt=Math.max(nextEligibleAt,e.nextEligibleAt);
     const otherStore=scopes.get(other),vouchers=Object.values((await otherStore.read()).vouchers||{}).filter(v=>v.wallet===wallet.toLowerCase()&&v.state==='ISSUED');
     for(const v of vouchers){const status=await chains.get(other).voucherState(v);if(status?.verified===true&&status.finalized===true&&status.state==='CANCELLED'&&status.voucherId===v.id&&status.generation===v.generation&&status.recipient?.toLowerCase()===wallet.toLowerCase())await otherStore.transact(s=>{const original=s.vouchers[v.id];if(original?.generation===v.generation&&original.state==='ISSUED'){original.state='CANCELLED';delete s.displays?.[v.id];}});}
    }return {...result,nextEligibleAt};
   }};
  runtimes.set(id,await makeProductRuntime({pool,chain:wrapped,stateStore:scope,origin,pepper,policySeconds:registry.get(id).policySeconds,defaultImageDigest,enabled:true,profile,clock,configurationExtra:{targetId:id,activeTargetId:registry.activeTargetId,targets}}));
 }
 const impact=makeImpactService({store,chains,registry,clock});
 let busy=false,next=0;
 return {scopes,targetIds:ids,tickImpact:()=>impact.refresh(),
  async handler(req,res){if(!req.url.startsWith('/v1/product/'))return false;
   const url=new URL(req.url,origin);
   if(url.pathname==='/v1/product/impact'){
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    if(req.method!=='GET') {send(405,{error:'METHOD_NOT_ALLOWED'});return true;}
    if(req.headers.host!==new URL(origin).host||url.origin!==origin||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'){send(403,{error:'ORIGIN_DENIED'});return true;}
    const query=[...url.searchParams],days=url.searchParams.get('days')||'30';
    if(query.length>1||query.some(([k])=>k!=='days')||!['7','30','90'].includes(days)){send(422,{error:'IMPACT_RANGE_INVALID'});return true;}
    try{send(200,await impact.read(Number(days)));}catch{send(503,{error:'IMPACT_UNAVAILABLE'});}return true;
   }
   const requested=req.headers['x-mf-product-target'],id=requested===undefined?registry.activeTargetId:requested;
   if(typeof id!=='string'||!runtimes.has(id)){res.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'UNKNOWN_TARGET'}));return true;}
   return runtimes.get(id).handler(req,res);
  },
  async tickClaims(){if(busy)return;busy=true;try{const order=[...ids.slice(next),...ids.slice(0,next)];next=(next+1)%ids.length;for(const id of order){try{await runtimes.get(id).tickClaims();}catch{/* A target outage must not stop other recovery queues. */}}}finally{busy=false;}}
 };
}
