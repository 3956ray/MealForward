import {createHash} from 'node:crypto';
import {makePilotHandler} from '../auth/core.mjs';
import {makeProductSiwe} from './siwe.mjs';
import {productAuthStore} from './auth-store.mjs';
import {productStore} from './store.mjs';
import {verifyProductPermissions} from './permissions.mjs';
import {makeProductService} from './service.mjs';
import {makeClaimService} from './claims.mjs';
import {makePublicationService} from './publication.mjs';
import {makeRedemptionService} from './redemption.mjs';
import {makeProductHttp} from './http.mjs';
import {makeApprovalService} from './approval.mjs';
import {makeKitchenSettingsService} from './kitchen-settings.mjs';
import {chainReference} from './funding-wire.mjs';
import {makeOperationCancellations} from './operation-cancellations.mjs';

const namespace={prefix:'/v1/product',sessionCookie:'__Host-mf_product_v2_session',preCookie:'__Host-mf_product_v2_pre',csrfHeader:'x-mf-product-v2-csrf',bootstrapHeader:'x-mf-product-v2-bootstrap'};
const hash=v=>createHash('sha256').update(v).digest('hex');
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n;
const authPaths=new Set(['/identity/setup','/auth/pre-session','/identity/wallet/challenge','/identity/wallet/login','/auth/logout']);

/** Explicit new-runtime composition. Does not mount itself, install a schema,
 * read a signer, start a timer, or change the live MVP. A reviewed chain adapter
 * must verify deployed code/roles before returning a verified target. */
export async function makeProductRuntime({pool,chain,origin,pepper,policySeconds,defaultImageDigest,enabled=false,profile='monad-testnet',clock=()=>Math.floor(Date.now()/1000)}){
  if(!enabled)return {handler:makeProductHttp({service:null,authorize:async()=>null,origin,enabled:false})};
  const local=profile==='local-acceptance';
  if(!['local-acceptance','monad-testnet'].includes(profile)||local&&!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin))throw Error('PRODUCT_PROFILE_REJECTED');
  const chainId=local?31337:10143,siwe=makeProductSiwe({profile,origin});
  await verifyProductPermissions(pool);
  const verified=await chain.verifyTarget();
  if(![7200,259200].includes(policySeconds)||verified?.policySeconds!==policySeconds)throw Error('PRODUCT_POLICY_MISMATCH');
  if(verified?.verified!==true||verified.chainId!==chainId||!address(verified.escrow)||!address(verified.redemptionAuthority)||!address(verified.claimAuthority)||!address(verified.asset)||!local&&verified.asset.toLowerCase()!=='0x534b2f3a21130d7a60830c2df862319e593943a3')throw Error('PRODUCT_TARGET_UNVERIFIED');
  for(const key of ['chainId','escrow','asset','claimAuthority','redemptionAuthority'])if(String(chain.target?.[key]).toLowerCase()!==String(verified[key]).toLowerCase())throw Error('PRODUCT_TARGET_MISMATCH');
  if(chain.claimEnabled===true&&['maxFeePerGas','maxTransactionFee'].some(k=>!(typeof chain.target[k]==='string'&&/^[1-9][0-9]{0,77}$/.test(chain.target[k])&&BigInt(chain.target[k])<2n**256n)))throw Error('PRODUCT_CLAIM_BUDGET_REQUIRED');
  if(chain.fundingEnabled===true){
    if([chain.approvalEnabled,chain.claimEnabled,chain.redemptionEnabled].some(v=>v!==true))throw Error('PRODUCT_FULFILLMENT_REQUIRED');
    const required=['catalog','fundingAllowance','prepareApproval','verifyApproval','prepareFunding','verifyFunding','claimCandidate','eligibility','signClaim','broadcastClaim','verifyClaim','voucherState','signRedemptionPermit','prepareHandover','prepareSettlement','verifyRedemption'];
    if(required.some(k=>typeof chain[k]!=='function'))throw Error('PRODUCT_FULFILLMENT_REQUIRED');
  }
  const configuration={verified:true,profile,chainId:verified.chainId,escrow:verified.escrow,asset:verified.asset,claimAuthority:verified.claimAuthority,redemptionAuthority:verified.redemptionAuthority,policySeconds};
  const store=productStore(pool),authStore=productAuthStore(pool);
  if(!await authStore.health())throw Error('PRODUCT_AUTH_NOT_INITIALIZED');
  const service=makeProductService({store,chain,clock}),claims=makeClaimService({store,chain,pepper,policySeconds,clock}),publications=makePublicationService({store,chain,clock,defaultImageDigest}),redemptions=makeRedemptionService({store,chain,pepper,clock});
  const authorize=async(req,{write})=>{
    const entries=(req.headers.cookie||'').split(';').map(p=>p.trim().split(/=(.*)/s).slice(0,2)).filter(([name])=>name===namespace.sessionCookie);
    if(entries.length!==1||!/^[-_a-zA-Z0-9]{43}$/.test(entries[0][1]||''))return null;
    const sessionHash=hash(entries[0][1]),csrf=req.headers[namespace.csrfHeader];
    if(write&&!(typeof csrf==='string'&&/^[-_a-zA-Z0-9]{43}$/.test(csrf)))return null;
    const identity=write?await authStore.getSessionWithCsrf(sessionHash,hash(csrf),clock()):await authStore.getSession(sessionHash,clock());
    return identity?{wallet:identity.wallet,csrfVerified:write,sessionScope:sessionHash}:null;
  };
  const approvals=makeApprovalService({store,chain,clock});
  const settings=makeKitchenSettingsService({store,chain,clock});
  const cancellations=makeOperationCancellations({store,chain,clock});
  const auth=makePilotHandler({store:authStore,siwe,origin,clock,namespace,walletLoginChainId:chainId}),product=makeProductHttp({service,claims,publications,redemptions,approvals,settings,cancellations,configuration,authorize,origin,enabled:true});
  let workerBusy=false;
  return {
    async handler(req,res){
      const u=new URL(req.url,origin),path=u.pathname.slice('/v1/product'.length);
      if(u.pathname.startsWith('/v1/product/')&&authPaths.has(path)){await auth(req,res);return true;}
      return product(req,res);
    },
    // Invoke from an explicitly configured worker. Only prior user-confirmed
    // QUEUED requests can sign; unknown broadcasts are queried, never resent.
    async tickClaims(){
      if(workerBusy)return;workerBusy=true;
      try{
        const snapshot=await store.read();
        // Recovery only verifies saved hashes. It never prepares or repeats a
        // user transaction, and one unavailable record cannot starve the rest.
        for(const [domain,items] of [[publications,snapshot.publications],[approvals,snapshot.approvals],[service,snapshot.intents],[redemptions,snapshot.redemptions]]){
          for(const op of Object.values(items||{}))if(['SEND_UNKNOWN','HASH_BOUND'].includes(op.state)&&(op.txHash||op.candidateHash)){
            try{await domain.reconcile(op.wallet,op.id);}catch{/* Original unknown state remains durable. */}
          }
        }
        for(const group of ['intents','approvals','publications','redemptions'])for(const op of Object.values(snapshot[group]||{}))if(['SEND_UNKNOWN','HASH_BOUND'].includes(op.state)&&op.cancellationHash){
          try{await cancellations.get(op.wallet,group,op.id);}catch{/* Only final cancellation evidence can release the original operation. */}
        }
        if(typeof chain.syncFundingIndex==='function'){
          try{await chain.syncFundingIndex();}catch{/* One store must not block other independently verified claims. */}
          const indexed=await store.read(),batches=Object.values(indexed.indexedBatches||{});
          for(const op of Object.values(indexed.intents||{}))if(op.kind==='support'&&op.state==='SEND_UNKNOWN'&&!op.txHash&&!op.candidateHash){
            const original=batches.find(b=>b.wallet===op.wallet&&b.id===chainReference(op.id));
            if(original)try{await service.recordHash(op.wallet,op.id,original.txHash);await service.reconcile(op.wallet,op.id);}catch{/* Original transaction validation remains authoritative. */}
          }
        }
        for(const intent of Object.values(snapshot.claims||{})){
          if(['SEND_UNKNOWN','HASH_BOUND'].includes(intent.state))await claims.reconcile(intent.wallet,intent.id);
          else if(intent.state==='SIGNED')await claims.dispatch(intent.id);
        }
        const signed=await claims.signNext();if(signed?.state==='SIGNED')await claims.dispatch(signed.id);
      }finally{workerBusy=false;}
    },
  };
}
