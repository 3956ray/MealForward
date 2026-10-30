/** Reviewed-target RPC adapter. No environment/key loading and no import-time IO.
 * The only broadcast is an already persisted SEND_UNKNOWN platform outbox packet.
 * Catalog projection is bounded by stored records, never by a uint256 quantity.
 */
import {makeFundingIndex} from './funding-index.mjs';
import {makeNonceCancellationVerifier} from './nonce-cancellation.mjs';
import {AbiCoder,Contract,Interface,Transaction,getCreateAddress,keccak256,toUtf8Bytes} from 'ethers';
import {chainReference,fundingInterface,fundingTransaction,validateFundingTransaction} from './funding-wire.mjs';
import {publicationInterface,publicationTransaction,validatePublicationTransaction} from './publication-wire.mjs';
import {approvalInterface,approvalTransaction,validateApprovalTransaction} from './approval-wire.mjs';
import {claimInterface,claimCalldata,validateClaimPacket} from './claim-wire.mjs';
import {redemptionInterface,redemptionTransaction,validateRedemptionTransaction,redemptionDomain,redemptionTypes,validatePermitSignature} from './redemption-wire.mjs';

const TERMS='tuple(uint256 unitPrice,bytes32 bodyDigest,bytes32 imageDigest,uint8 windowCount,uint16 startMinute0,uint16 endMinute0,uint16 startMinute1,uint16 endMinute1)';
export const productChainInterface=new Interface([
  ...fundingInterface.fragments,...publicationInterface.fragments,...redemptionInterface.fragments,...claimInterface.fragments,
  'function asset() view returns(address)','function claimAuthority() view returns(address)','function redemptionAuthority() view returns(address)',
  'function policySeconds() view returns(uint256)','function storeOwner(bytes32) view returns(address)',
  'function storeClosed(bytes32) view returns(bool)','function batchRefunded(bytes32) view returns(bool)',
  'function currentVersion(bytes32,bytes32) view returns(uint256)',
  `function getTerms(bytes32,bytes32,uint256) view returns(tuple(${TERMS} value,bytes32 termsHash))`,
  'function getOffer(bytes32,bytes32,uint256) view returns(tuple(uint256 offered,uint256 funded,uint256 fundingDeadline,bool listed))',
  'function requestKey(address,bytes32) view returns(bytes32)',
  'function getRequest(address,bytes32) view returns(tuple(bytes32 payloadHash,bytes32 result,bool exists))',
  'function getBatch(bytes32) view returns(tuple(address payer,bytes32 storeId,bytes32 mealId,uint256 version,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 fundedAt))',
  'function getUnit(bytes32,uint256) view returns(tuple(uint256 generation,bytes32 voucherId,uint8 status))',
  'function getVoucher(bytes32) view returns(tuple(bytes32 batchId,uint256 unitIndex,uint256 generation,address recipient,bytes32 termsHash,uint256 claimedAt,uint256 expiresAt,uint256 settlementAvailableAt,uint8 status))',
  'function nextEligibleAt(address) view returns(uint256)',
  'function getStoreAccounting(bytes32) view returns(tuple(uint256 fundedQuantity,uint256 availableQuantity,uint256 claimedQuantity,uint256 handedOverQuantity,uint256 settledQuantity,uint256 fundedAmount,uint256 availableAmount,uint256 claimedAmount,uint256 handedOverAmount,uint256 settledAmount,uint256 liability,uint256 refundPendingQuantity,uint256 refundPendingAmount,uint256 refundedQuantity,uint256 refundedAmount))',
  'function accounting() view returns(tuple(uint256 fundedQuantity,uint256 availableQuantity,uint256 claimedQuantity,uint256 handedOverQuantity,uint256 settledQuantity,uint256 fundedAmount,uint256 availableAmount,uint256 claimedAmount,uint256 handedOverAmount,uint256 settledAmount,uint256 liability,uint256 refundPendingQuantity,uint256 refundPendingAmount,uint256 refundedQuantity,uint256 refundedAmount))',
  'function getBatchAccounting(bytes32) view returns(tuple(uint256 claimedQuantity,uint256 claimedAmount,uint256 handedOverQuantity,uint256 handedOverAmount,uint256 settledQuantity,uint256 settledAmount,uint256 refundPendingQuantity,uint256 refundPendingAmount,uint256 refundedQuantity,uint256 refundedAmount))',
  'event StoreRegistered(bytes32 indexed storeId,address indexed owner)',
  'event RequestCompleted(bytes32 indexed requestKey,address indexed caller,bytes32 payloadHash,bytes32 result)',
  'event MealPublished(bytes32 indexed storeId,bytes32 indexed mealId,uint256 indexed version,bytes32 termsHash,uint256 quantity,uint256 fundingDeadline)',
  'event InventorySupplemented(bytes32 indexed storeId,bytes32 indexed mealId,uint256 indexed version,uint256 quantity,uint256 fundingDeadline)',
  'event ListingChanged(bytes32 indexed storeId,bytes32 indexed mealId,uint256 indexed version,bool listed)',
  'event Claimed(bytes32 indexed voucherId,bytes32 indexed batchId,address indexed recipient,uint256 unitIndex,uint256 generation,bytes32 termsHash,uint256 expiresAt)',
  'event HandedOver(bytes32 indexed voucherId,address indexed owner,uint256 settlementAvailableAt)',
  'event Settled(bytes32 indexed voucherId,address indexed owner,uint256 amount)',
  'event StoreClosed(bytes32 indexed storeId,address indexed owner,uint256 refundPendingQuantity,uint256 refundPendingAmount)',
  'event BatchRefunded(bytes32 indexed batchId,bytes32 indexed storeId,address indexed payer,uint256 quantity,uint256 amount)',
]);
export const productAssetInterface=new Interface([...approvalInterface.fragments,
  'function decimals() view returns(uint8)','function allowance(address,address) view returns(uint256)','function balanceOf(address) view returns(uint256)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const check=(ok,code='CHAIN_EVIDENCE_MISMATCH')=>{if(!ok)fail(code);};
const lower=x=>typeof x==='string'?x.toLowerCase():'';
const same=(a,b)=>lower(a)!==''&&lower(a)===lower(b);
const address=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&BigInt(x)!==0n;
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const uint=x=>{check(typeof x==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(x)&&BigInt(x)<2n**256n,'CHAIN_INVALID_UINT');return BigInt(x);};
const number=x=>{const n=Number(x);check(Number.isSafeInteger(n)&&n>=0,'CHAIN_INTEGER_OVERFLOW');return n;};
const options=ctx=>({blockTag:ctx.block.number});
const states={0:'AVAILABLE',1:'ISSUED',2:'HANDED_OVER',3:'SETTLED',4:'EXPIRED',5:'CANCELLED'};
const pending=c=>['QUEUED','SIGNED','SEND_UNKNOWN','HASH_BOUND'].includes(c.state);
const unitKey=(b,i)=>`${lower(b)}:${i}`;
const windows=t=>{const a=[[number(t.startMinute0),number(t.endMinute0)]];if(t.windowCount===2n)a.push([number(t.startMinute1),number(t.endMinute1)]);check([1n,2n].includes(t.windowCount)&&a.every(([s,e],i)=>s<e&&e<=1440&&(!i||s>=a[i-1][1])));return a;};
const windowEnd=(t,now)=>{const local=now+28800,minute=Math.floor(local%86400/60),start=Math.floor(local/86400)*86400-28800;const w=windows(t).find(([a,b])=>minute>=a&&minute<b);return w?start+w[1]*60:0;};

export function makeProductChain({provider,manifest,store,claimSigner,redemptionSigner,profile='monad-testnet',maxRecords=4096}){
  const m=structuredClone(manifest);
  check(m&&provider&&store?.read&&store?.transact,'CHAIN_CONFIGURATION_REQUIRED');
  check(['monad-testnet','local-acceptance'].includes(profile),'CHAIN_PROFILE_REQUIRED');
  check(m.chainId===(profile==='local-acceptance'?31337:10143),'CHAIN_PROFILE_MISMATCH');
  check(['escrow','asset','claimAuthority','redemptionAuthority'].every(k=>address(m[k])),'CHAIN_TARGET_REQUIRED');
  check(profile==='local-acceptance'||same(m.asset,'0x534b2f3a21130d7a60830c2df862319e593943a3'),'CHAIN_ASSET_MISMATCH');
  check(hash(m.escrowCodeHash)&&hash(m.assetCodeHash)&&m.assetDecimals===6&&[7200,259200].includes(m.policySeconds)&&Number.isSafeInteger(m.deploymentBlock)&&m.deploymentBlock>=0,'CHAIN_MANIFEST_REQUIRED');
  check(Number.isSafeInteger(maxRecords)&&maxRecords>0&&maxRecords<=10000,'CHAIN_RECORD_LIMIT_REQUIRED');
  check(uint(m.maxFeePerGas)>0n&&uint(m.maxTransactionFee)>0n&&uint(m.claimGasLimit)>0n&&uint(m.claimGasLimit)<=5000000n,'CHAIN_BUDGET_REQUIRED');
  const target=Object.freeze({chainId:m.chainId,escrow:lower(m.escrow),asset:lower(m.asset),claimAuthority:lower(m.claimAuthority),redemptionAuthority:lower(m.redemptionAuthority),maxFeePerGas:m.maxFeePerGas,maxTransactionFee:m.maxTransactionFee});
  const escrow=new Contract(target.escrow,productChainInterface,provider),asset=new Contract(target.asset,productAssetInterface,provider);
  const enabled=!!claimSigner&&!!redemptionSigner;
  const records=value=>{const result=Object.values(value||{});check(result.length<=maxRecords,'CHAIN_PROJECTION_LIMIT');return result;};
  const signerAddress=async signer=>lower(await signer.getAddress());
  async function canonical(block){check(block&&Number.isSafeInteger(block.number)&&hash(block.hash)&&Number.isSafeInteger(block.timestamp),'CHAIN_FINALITY_UNAVAILABLE');const again=await provider.getBlock(block.number);check(again&&same(again.hash,block.hash),'CHAIN_REORG');}
  async function context(){
    check((await provider.getNetwork()).chainId===BigInt(m.chainId),'CHAIN_NETWORK_MISMATCH');
    const block=await provider.getBlock('finalized');await canonical(block);check(block.number>=m.deploymentBlock,'CHAIN_DEPLOYMENT_NOT_FINAL');
    const ctx={block},o=options(ctx);
    const [code,tokenCode,token,issuer,verifier,policy,decimals]=await Promise.all([
      provider.getCode(target.escrow,block.number),provider.getCode(target.asset,block.number),escrow.asset(o),escrow.claimAuthority(o),escrow.redemptionAuthority(o),escrow.policySeconds(o),asset.decimals(o)]);
    check(code!=='0x'&&tokenCode!=='0x'&&same(keccak256(code),m.escrowCodeHash)&&same(keccak256(tokenCode),m.assetCodeHash),'CHAIN_CODE_MISMATCH');
    check(same(token,target.asset)&&same(issuer,target.claimAuthority)&&same(verifier,target.redemptionAuthority)&&policy===BigInt(m.policySeconds)&&decimals===BigInt(m.assetDecimals),'CHAIN_TARGET_MISMATCH');
    if(claimSigner)check(await signerAddress(claimSigner)===target.claimAuthority,'CHAIN_SIGNER_MISMATCH');
    if(redemptionSigner)check(await signerAddress(redemptionSigner)===target.redemptionAuthority,'CHAIN_SIGNER_MISMATCH');
    await canonical(block);return ctx;
  }
  async function finish(ctx,result){await canonical(ctx.block);return result;}
  const nonce=async wallet=>number(await provider.getTransactionCount(wallet,'pending'));
  function transaction(tx){return {from:lower(tx.from),to:tx.to===null?null:lower(tx.to),chainId:'0x'+BigInt(tx.chainId).toString(16),nonce:'0x'+BigInt(tx.nonce).toString(16),value:'0x'+BigInt(tx.value).toString(16),data:lower(tx.data)};}
  function equalTransaction(actual,expected){return Object.keys(expected).every(k=>String(actual[k]).toLowerCase()===String(expected[k]).toLowerCase());}
  async function receipt(hashValue,expected){
    check(hash(hashValue),'CHAIN_INVALID_HASH');const ctx=await context();
    const [tx,r]=await Promise.all([provider.getTransaction(hashValue),provider.getTransactionReceipt(hashValue)]);
    if(!tx||!same(tx.hash,hashValue)||BigInt(tx.chainId)!==BigInt(m.chainId)||!equalTransaction(transaction(tx),expected))return null;
    if(!r)return {ctx,tx,base:{verified:true,txHash:lower(hashValue),transaction:transaction(tx),finalized:false}};
    if(!same(r.hash||r.transactionHash,hashValue)||!same(r.from,tx.from)||!((r.to===null&&tx.to===null)||same(r.to,tx.to))||!Number.isSafeInteger(r.blockNumber))return null;
    const block=await provider.getBlock(r.blockNumber);if(!block||!same(block.hash,r.blockHash))return null;
    if(r.blockNumber>ctx.block.number)return {ctx,tx,base:{verified:true,txHash:lower(hashValue),transaction:transaction(tx),finalized:false}};
    check([0,1].includes(r.status));
    return {ctx,tx,receipt:r,block,o:{blockTag:r.blockNumber},base:{verified:true,txHash:lower(hashValue),transaction:transaction(tx),finalized:true,outcome:r.status===1?'CONFIRMED':'REVERTED',blockNumber:r.blockNumber,blockHash:r.blockHash}};
  }
  async function finishReceipt(p,result){if(p.block)await canonical(p.block);return finish(p.ctx,result);}
  function event(r,where,iface,name,optional=false){const all=r.logs.filter(log=>same(log.address,where)).map(log=>{let parsed;try{parsed=iface.parseLog(log);}catch{return null;}if(parsed?.name===name)check(log.removed!==true&&log.blockNumber===r.blockNumber&&same(log.blockHash,r.blockHash)&&same(log.transactionHash,r.hash||r.transactionHash),'CHAIN_EVENT_BLOCK_MISMATCH');return parsed;}).filter(e=>e?.name===name);check(all.length===1||(optional&&all.length===0),'CHAIN_EVENT_MISMATCH');return all[0]?.args;}
  async function batchCheck(intent,ctx){const key=intent.source==='chain-index'&&intent.id===null?intent.batchId:await escrow.requestKey(intent.wallet,chainReference(intent.id),options(ctx));check(hash(key),'CHAIN_BATCH_MISMATCH');const b=await escrow.getBatch(key,options(ctx));
    check(same(b.payer,intent.wallet)&&b.storeId===chainReference(intent.storeId)&&b.mealId===chainReference(intent.mealId)&&b.version===BigInt(intent.version)&&b.termsHash===intent.termsHash&&b.quantity===uint(intent.quantity)&&b.unitPrice===uint(intent.unitPrice)&&b.amount===uint(intent.amount),'CHAIN_BATCH_MISMATCH');return {id:key,b,intent};}
  async function metadata(op,ctx){const terms=await escrow.getTerms(chainReference(op.storeId),chainReference(op.mealId),op.version,options(ctx));
    check(terms.termsHash===op.termsHash&&terms.value.unitPrice===uint(op.unitPrice)&&terms.value.bodyDigest===keccak256(toUtf8Bytes(JSON.stringify({name:op.name,description:op.description})))&&terms.value.imageDigest===op.terms.imageDigest,'CHAIN_METADATA_MISMATCH');
    check(JSON.stringify(windows(terms.value))===JSON.stringify(op.windows),'CHAIN_METADATA_MISMATCH');return terms;}
  function conserved(a){
    check(a.fundedQuantity===a.availableQuantity+a.claimedQuantity+a.handedOverQuantity+a.settledQuantity+a.refundPendingQuantity+a.refundedQuantity&&a.fundedAmount===a.availableAmount+a.claimedAmount+a.handedOverAmount+a.settledAmount+a.refundPendingAmount+a.refundedAmount&&a.liability===a.availableAmount+a.claimedAmount+a.handedOverAmount+a.refundPendingAmount,'CHAIN_ACCOUNTING_MISMATCH');
  }
  async function knownBatches(ctx,s,storeId){
    const originals=Object.values(s.intents||{}).filter(i=>i.kind==='support'&&i.state==='CONFIRMED'&&i.storeId===storeId&&i.confirmedBlock<=ctx.block.number),indexed=Object.values(s.indexedBatches||{}).filter(i=>i.storeId===storeId&&i.confirmedBlock<=ctx.block.number),items=new Map();
    check(originals.length<=maxRecords&&indexed.length<=maxRecords,'CHAIN_STORE_PROJECTION_LIMIT');
    for(const intent of [...originals,...indexed]){const item=await batchCheck(intent,ctx);if(intent.batchId)check(same(item.id,intent.batchId),'CHAIN_BATCH_MISMATCH');if(!items.has(item.id))items.set(item.id,item);}
    return items;
  }
  async function projection(ctx,snapshot){
    const s=snapshot||await store.read(),pubs=records(s.publications).filter(p=>p.state==='CONFIRMED'&&p.confirmedBlock<=ctx.block.number),registrations=pubs.filter(p=>p.kind==='registration'),publications=pubs.filter(p=>p.kind==='publication');
    const stores=[],meals=[],versions=new Map(),batches=new Map(),units=new Map(),storeAccounts=new Map();
    const fields=['fundedQuantity','fundedAmount','claimedQuantity','claimedAmount','handedOverQuantity','handedOverAmount','settledQuantity','settledAmount','refundPendingQuantity','refundPendingAmount','refundedQuantity','refundedAmount'];
    for(const op of registrations){if(stores.some(x=>x.id===op.storeId))continue;const ref=chainReference(op.storeId),owner=await escrow.storeOwner(ref,options(ctx)),closed=await escrow.storeClosed(ref,options(ctx)),account=await escrow.getStoreAccounting(ref,options(ctx));check(same(owner,op.wallet),'CHAIN_OWNER_MISMATCH');conserved(account);const value={id:op.storeId,name:op.name,owner:lower(owner),closed,syncPending:false};stores.push(value);storeAccounts.set(op.storeId,account);}
    for(const op of publications){const storeValue=stores.find(x=>x.id===op.storeId);check(storeValue,'CHAIN_PROJECTION_INCOMPLETE');const t=await metadata(op,ctx),offer=await escrow.getOffer(chainReference(op.storeId),chainReference(op.mealId),op.version,options(ctx)),key=`${op.storeId}:${op.mealId}:${op.version}`;check(!versions.has(key),'CHAIN_PROJECTION_CONFLICT');
      const value={id:op.mealId,storeId:op.storeId,name:op.name,description:op.description,version:op.version,unitPrice:String(t.value.unitPrice),termsHash:t.termsHash,imageDigest:t.value.imageDigest,windows:windows(t.value),remaining:String(offer.offered-offer.funded),quantity:String(offer.offered),fundingDeadline:number(offer.fundingDeadline),listed:!storeValue.closed&&offer.listed,closed:storeValue.closed,claimable:'0'};versions.set(key,value);meals.push(value);
    }
    const currentKeys=new Map();for(const op of publications){const key=`${op.storeId}:${op.mealId}`;if(!currentKeys.has(key)||currentKeys.get(key).version<op.version)currentKeys.set(key,op);}
    for(const op of currentKeys.values()){const current=await escrow.currentVersion(chainReference(op.storeId),chainReference(op.mealId),options(ctx));if(current!==BigInt(op.version))for(const meal of meals.filter(x=>x.storeId===op.storeId&&x.id===op.mealId)){meal.listed=false;meal.metadataPending=true;meal.remaining='0';}}
    for(const storeValue of stores){const totals=Object.fromEntries(fields.map(f=>[f,0n]));
      for(const item of (await knownBatches(ctx,s,storeValue.id)).values()){
        const b=item.b,meal=meals.find(v=>v.storeId===storeValue.id&&chainReference(v.id)===b.mealId&&BigInt(v.version)===b.version&&v.termsHash===b.termsHash),account=await escrow.getBatchAccounting(item.id,options(ctx)),refunded=await escrow.batchRefunded(item.id,options(ctx));
        check(b.amount===b.quantity*b.unitPrice&&(!refunded||storeValue.closed),'CHAIN_BATCH_MISMATCH');const available=b.quantity-account.claimedQuantity-account.handedOverQuantity-account.settledQuantity-account.refundPendingQuantity-account.refundedQuantity;check(available>=0n,'CHAIN_BATCH_ACCOUNTING_MISMATCH');
        for(const prefix of ['claimed','handedOver','settled','refundPending','refunded'])check(account[prefix+'Amount']===account[prefix+'Quantity']*b.unitPrice,'CHAIN_BATCH_ACCOUNTING_MISMATCH');
        totals.fundedQuantity+=b.quantity;totals.fundedAmount+=b.amount;for(const field of fields.slice(2))totals[field]+=account[field];
        batches.set(item.id,{...item,intent:{...item.intent,mealId:meal?.id||b.mealId},meal,closed:storeValue.closed,refunded,account,knownClaimed:0n,knownHandedOver:0n,knownSettled:0n,claimable:storeValue.closed||!meal?0n:available});
      }
      const expected=storeAccounts.get(storeValue.id);storeValue.syncPending=fields.some(f=>totals[f]!==expected[f]);
    }
    const claims=records(s.claims),vouchers=records(s.vouchers),known=new Map();for(const v of [...claims,...vouchers]){if(!hash(v.batchId))continue;const index=uint(v.unitIndex);known.set(unitKey(v.batchId,index),{batchId:lower(v.batchId),index});}check(known.size<=maxRecords,'CHAIN_PROJECTION_LIMIT');
    for(const [key,k]of known){const entry=batches.get(k.batchId);if(!entry)continue;check(k.index<entry.b.quantity,'CHAIN_UNIT_MISMATCH');const u=await escrow.getUnit(k.batchId,k.index,options(ctx));let v=null;
      if(u.status===1n){v=await escrow.getVoucher(u.voucherId,options(ctx));check(v.batchId===k.batchId&&v.unitIndex===k.index&&v.generation===u.generation&&v.status===1n);entry.knownClaimed++;}if(u.status===2n)entry.knownHandedOver++;if(u.status===3n)entry.knownSettled++;
      check(entry.closed?[2n,3n,5n].includes(u.status):u.status<=3n);const blocked=claims.some(c=>unitKey(c.batchId,c.unitIndex)===key&&pending(c))||vouchers.some(v=>unitKey(v.batchId,v.unitIndex)===key&&v.pendingRedemptionId),expired=u.status===1n&&v.expiresAt<=BigInt(ctx.block.timestamp),available=!entry.closed&&(u.status===0n||expired)&&!blocked;
      if(!entry.closed&&entry.meal){if(expired)entry.claimable++;if(blocked&&(u.status===0n||expired))entry.claimable--;}units.set(key,{...k,u,v,available});
    }
    for(const entry of batches.values()){const storeValue=stores.find(x=>x.id===entry.intent.storeId);if(storeValue.syncPending||!entry.meal||entry.closed||entry.knownClaimed!==entry.account.claimedQuantity||entry.knownHandedOver!==entry.account.handedOverQuantity||entry.knownSettled!==entry.account.settledQuantity)entry.claimable=0n;check(entry.claimable>=0n);if(entry.meal)entry.meal.claimable=String(BigInt(entry.meal.claimable)+entry.claimable);}
    for(const meal of meals)if(stores.find(x=>x.id===meal.storeId).syncPending){meal.listed=false;meal.remaining='0';meal.claimable='0';meal.syncPending=true;}
    const a=await escrow.accounting(options(ctx));conserved(a);check((await asset.balanceOf(target.escrow,options(ctx)))>=a.liability,'CHAIN_INSOLVENT');
    const accounting={funded:String(a.fundedQuantity),available:String(a.availableQuantity),claimed:String(a.claimedQuantity),handedOver:String(a.handedOverQuantity),settled:String(a.settledQuantity),refundPending:String(a.refundPendingQuantity),refunded:String(a.refundedQuantity),fundedAmount:String(a.fundedAmount),settledAmount:String(a.settledAmount),refundPendingAmount:String(a.refundPendingAmount),refundedAmount:String(a.refundedAmount)};
    return {s,stores,meals,batches,units,accounting};
  }
  async function prepare(op,builder){const ctx=await context();const tx=builder(op,target,await nonce(op.wallet));return finish(ctx,tx);}
  async function refundInfo(batchId,ctx,state,knownIntent){
    check(hash(batchId),'CHAIN_INVALID_HASH');const s=state||await store.read();let original=knownIntent;
    if(!original){const indexed=s.indexedBatches?.[lower(batchId)];if(indexed&&indexed.confirmedBlock<=ctx.block.number)original=indexed;}
    if(!original)for(const intent of records(s.intents).filter(i=>i.kind==='support'&&i.state==='CONFIRMED'&&i.confirmedBlock<=ctx.block.number)){if(same(await escrow.requestKey(intent.wallet,chainReference(intent.id),options(ctx)),batchId)){original=intent;break;}}
    check(original,'CHAIN_BATCH_NOT_INDEXED');const item=await batchCheck(original,ctx),b=item.b,closed=await escrow.storeClosed(b.storeId,options(ctx)),refunded=await escrow.batchRefunded(batchId,options(ctx)),owner=await escrow.storeOwner(b.storeId,options(ctx)),a=await escrow.getBatchAccounting(batchId,options(ctx));
    check(!refunded||closed,'CHAIN_REFUND_STATE_MISMATCH');const quantity=closed?b.quantity-a.handedOverQuantity-a.settledQuantity:0n,amount=quantity*b.unitPrice;check(quantity>=0n,'CHAIN_REFUND_STATE_MISMATCH');
    if(closed)check(a.claimedQuantity===0n&&a.refundPendingQuantity===(refunded?0n:quantity)&&a.refundPendingAmount===(refunded?0n:amount)&&a.refundedQuantity===(refunded?quantity:0n)&&a.refundedAmount===(refunded?amount:0n),'CHAIN_REFUND_STATE_MISMATCH');
    const publication=records(s.publications).find(p=>p.kind==='publication'&&p.state==='CONFIRMED'&&p.confirmedBlock<=ctx.block.number&&p.storeId===original.storeId&&chainReference(p.mealId)===b.mealId&&BigInt(p.version)===b.version&&p.termsHash===b.termsHash);if(publication)await metadata(publication,ctx);
    return {verified:true,blockNumber:ctx.block.number,blockHash:ctx.block.hash,chainTime:ctx.block.timestamp,storeId:original.storeId,mealId:publication?.mealId||b.mealId,version:number(b.version),name:publication?.name,metadataPending:!publication,batchId:lower(batchId),owner:lower(owner),payer:lower(b.payer),closed,refunded,quantity:String(quantity),amount:String(amount),unitPrice:String(b.unitPrice)};
  }
  const fundingIndex=makeFundingIndex({provider,store,target,deploymentBlock:m.deploymentBlock,context,maxRecords,verifyLog:async(log,registration,ctx)=>{
    const e=fundingInterface.parseLog(log).args,tx=await provider.getTransaction(log.transactionHash);check(tx&&same(tx.hash,log.transactionHash)&&address(tx.from)&&(tx.to===null||address(tx.to))&&BigInt(tx.chainId)===BigInt(m.chainId),'FUNDING_INDEX_TRANSACTION');
    const envelope=transaction(tx),p=await receipt(log.transactionHash,envelope);check(p?.base.finalized&&p.base.outcome==='CONFIRMED'&&p.block.number===log.blockNumber&&same(p.block.hash,log.blockHash),'FUNDING_INDEX_RECEIPT');
    const parsed=p.receipt.logs.map((l,index)=>{check(l.removed!==true&&l.blockNumber===p.block.number&&same(l.blockHash,p.block.hash)&&same(l.transactionHash,log.transactionHash),'FUNDING_INDEX_RECEIPT');let event;try{event=same(l.address,target.escrow)?productChainInterface.parseLog(l):same(l.address,target.asset)?productAssetInterface.parseLog(l):null;}catch{}return {l,index,event};});
    const funded=parsed.filter(x=>same(x.l.address,target.escrow)&&x.event?.name==='Funded'&&x.event.args.batchId===e.batchId);check(funded.length===1,'FUNDING_INDEX_RECEIPT');const actual=funded[0];check((actual.l.index??actual.l.logIndex)===(log.index??log.logIndex)&&actual.l.data===log.data&&JSON.stringify(actual.l.topics)===JSON.stringify(log.topics),'FUNDING_INDEX_RECEIPT');
    const completed=parsed.filter(x=>x.index<actual.index&&same(x.l.address,target.escrow)&&x.event?.name==='RequestCompleted'&&x.event.args.requestKey===e.batchId&&x.event.args.result===e.batchId&&same(x.event.args.caller,e.payer));check(completed.length===1,'FUNDING_INDEX_REQUEST');const completion=completed[0];
    const transfers=parsed.filter(x=>x.index>completion.index&&x.index<actual.index&&same(x.l.address,target.asset)&&x.event?.name==='Transfer'&&same(x.event.args.from,e.payer)&&same(x.event.args.to,target.escrow)&&x.event.args.value===e.amount);check(transfers.length===1,'FUNDING_INDEX_RECEIPT');
    let id=null,expiresAt=null;const direct=same(tx.to,target.escrow);
    if(direct){const decoded=fundingInterface.parseTransaction(tx);check(decoded?.name==='fund'&&same(tx.from,e.payer)&&BigInt(tx.value)===0n,'FUNDING_INDEX_TRANSACTION');const r=decoded.args[0];check(r.storeId===chainReference(registration.storeId)&&r.storeId===e.storeId&&r.mealId===e.mealId&&r.version===e.version&&r.termsHash===e.termsHash&&r.quantity===e.quantity&&r.expectedAmount===e.amount,'FUNDING_INDEX_TRANSACTION');id=r.requestId;expiresAt=number(r.deadline);
      const payload=keccak256(AbiCoder.defaultAbiCoder().encode(['bytes4',fundingInterface.getFunction('fund').inputs[0]],[fundingInterface.getFunction('fund').selector,r]));check(completion.event.args.payloadHash===payload,'FUNDING_INDEX_REQUEST');
    }else if(tx.to===null)check(same(p.receipt.contractAddress,getCreateAddress({from:tx.from,nonce:tx.nonce})),'FUNDING_INDEX_TRANSACTION');
    const expected={id,kind:'support',state:'CONFIRMED',source:'chain-index',batchId:e.batchId,wallet:lower(e.payer),storeId:registration.storeId,mealId:e.mealId,version:number(e.version),termsHash:e.termsHash,quantity:String(e.quantity),unitPrice:String(e.unitPrice),amount:String(e.amount),expiresAt};
    if(direct)validateFundingTransaction(expected,target,envelope);const item=await batchCheck(expected,{block:p.block});check(item.id===e.batchId&&item.b.fundedAt===BigInt(p.block.timestamp)&&e.storeId===chainReference(registration.storeId),'FUNDING_INDEX_RECEIPT');
    check(same(await escrow.storeOwner(e.storeId,p.o),registration.wallet),'CHAIN_OWNER_MISMATCH');await canonical(p.block);await canonical(ctx.block);
    return {...expected,confirmedBlock:p.block.number,blockHash:p.block.hash,txHash:lower(log.transactionHash),transaction:envelope,requestPayloadHash:completion.event.args.payloadHash};
  }});
  const api={target,fundingEnabled:enabled,approvalEnabled:enabled,publicationEnabled:enabled,claimEnabled:enabled,redemptionEnabled:enabled,
    syncFundingIndex:()=>fundingIndex.sync(),
    async verifyTarget(){const ctx=await context();return finish(ctx,{verified:true,...target,policySeconds:m.policySeconds,blockNumber:ctx.block.number,blockHash:ctx.block.hash});},
    async identity(wallet){check(address(wallet),'CHAIN_INVALID_WALLET');const ctx=await context(),s=await store.read(),stores=[];
      for(const op of records(s.publications).filter(p=>p.kind==='registration'&&p.state==='CONFIRMED'&&p.confirmedBlock<=ctx.block.number&&same(p.wallet,wallet))){const owner=await escrow.storeOwner(chainReference(op.storeId),options(ctx));check(same(owner,wallet),'CHAIN_OWNER_MISMATCH');stores.push(op.storeId);}
      return finish(ctx,{verified:true,wallet:lower(wallet),stores:[...new Set(stores)]});
    },
    async catalog(){const ctx=await context(),p=await projection(ctx);return finish(ctx,{verified:true,blockNumber:ctx.block.number,blockHash:ctx.block.hash,chainTime:ctx.block.timestamp,asset:{address:target.asset,symbol:profile==='local-acceptance'?'TEST':'USDC',decimals:m.assetDecimals},stores:p.stores,meals:p.meals,accounting:p.accounting});},
    async fundingAllowance(wallet){const ctx=await context(),allowance=await asset.allowance(wallet,target.escrow,options(ctx));return finish(ctx,{verified:true,finalized:true,blockNumber:ctx.block.number,blockHash:ctx.block.hash,owner:lower(wallet),asset:target.asset,spender:target.escrow,allowance:String(allowance)});},
    async refundState(batchId){const ctx=await context();return finish(ctx,await refundInfo(batchId,ctx));},
    async refundableBatches(storeId,wallet){const ctx=await context(),s=await store.read(),storeRef=chainReference(storeId),owner=await escrow.storeOwner(storeRef,options(ctx));check(same(owner,wallet),'CHAIN_OWNER_MISMATCH');const closed=await escrow.storeClosed(storeRef,options(ctx)),items=[];
      // A partial DB list must never look like the complete refundable pool.
      // Original-wallet identity/history remain available independently.
      const p=await projection(ctx,s);check(p.stores.some(x=>x.id===storeId&&!x.syncPending),'CHAIN_STORE_SYNC_PENDING');
      for(const item of p.batches.values())if(item.intent.storeId===storeId)items.push(await refundInfo(item.id,ctx,s,item.intent));
      return finish(ctx,{verified:true,storeId,closed,items});
    },
    preparePublicationOperation:op=>prepare(op,publicationTransaction),prepareApproval:op=>prepare(op,approvalTransaction),prepareFunding:op=>prepare(op,fundingTransaction),
    prepareHandover:op=>prepare(op,redemptionTransaction),prepareSettlement:op=>prepare(op,redemptionTransaction),
    async verifyPublication(op,txHash){validatePublicationTransaction(op,target,op.transaction);const p=await receipt(txHash,op.transaction);if(!p)return {verified:false};const result={...p.base};
      if(p.base.outcome==='CONFIRMED'){const name={registration:'StoreRegistered',publication:'MealPublished',supplement:'InventorySupplemented',listing:'ListingChanged',closure:'StoreClosed',refund:'BatchRefunded'}[op.kind],e=event(p.receipt,target.escrow,productChainInterface,name,op.kind==='refund'),sref=chainReference(op.storeId);
        const owner=await escrow.storeOwner(sref,p.o);check((!e||e.storeId===sref)&&same(owner,op.wallet));Object.assign(result,{kind:op.kind,storeId:op.storeId,owner:lower(owner)});
        if(op.kind==='closure'){check(same(e.owner,op.wallet)&&await escrow.storeClosed(sref,p.o));Object.assign(result,{closed:true,refundPendingQuantity:String(e.refundPendingQuantity),refundPendingAmount:String(e.refundPendingAmount)});}
        else if(op.kind==='refund'){const info=await refundInfo(op.batchId,{block:p.block});check(info.closed&&info.refunded&&info.storeId===op.storeId&&same(info.payer,op.payer)&&info.quantity===op.quantity&&info.amount===op.amount);
          if(e){check(e.batchId===op.batchId&&same(e.payer,op.payer)&&e.quantity===uint(op.quantity)&&e.amount===uint(op.amount));if(e.amount>0n){const t=event(p.receipt,target.asset,productAssetInterface,'Transfer');check(same(t.from,target.escrow)&&same(t.to,op.payer)&&t.value===e.amount);}}
          else{const request=await escrow.getRequest(op.wallet,chainReference(op.id),p.o),payloadHash=keccak256(AbiCoder.defaultAbiCoder().encode(['bytes4','bytes32'],[productChainInterface.getFunction('refundBatch').selector,op.batchId]));
            // A competing payer can finish first. A fresh no-op completes this
            // exact request; an already-completed request emits nothing.
            check(request.exists&&request.payloadHash===payloadHash&&BigInt(request.result)===uint(op.amount)&&p.receipt.logs.length<=1,'CHAIN_REFUND_REQUEST_MISMATCH');
            if(p.receipt.logs.length){const log=p.receipt.logs[0];check(same(log.address,target.escrow)&&log.topics[0]===productChainInterface.getEvent('RequestCompleted').topicHash,'CHAIN_REFUND_REQUEST_MISMATCH');const completed=event(p.receipt,target.escrow,productChainInterface,'RequestCompleted'),key=await escrow.requestKey(op.wallet,chainReference(op.id),p.o);check(completed.requestKey===key&&same(completed.caller,op.wallet)&&completed.payloadHash===payloadHash&&completed.result===request.result,'CHAIN_REFUND_REQUEST_MISMATCH');}}
          Object.assign(result,{batchId:op.batchId,payer:info.payer,quantity:info.quantity,amount:info.amount,receiver:info.payer,refunded:true,alreadyRefunded:!e});}
        else if(op.kind==='registration')check(same(e.owner,op.wallet));else{const mref=chainReference(op.mealId),t=await escrow.getTerms(sref,mref,op.version,p.o),offer=await escrow.getOffer(sref,mref,op.version,p.o);check(e.mealId===mref&&e.version===BigInt(op.version)&&t.termsHash===op.termsHash);Object.assign(result,{mealId:op.mealId,version:number(e.version),termsHash:t.termsHash});
          if(['publication','supplement'].includes(op.kind)){check(e.quantity===uint(op.quantity)&&e.fundingDeadline===BigInt(op.fundingDeadline)&&offer.fundingDeadline===e.fundingDeadline);Object.assign(result,{quantity:String(e.quantity),fundingDeadline:number(e.fundingDeadline)});}
          if(op.kind==='publication'){await metadata(op,{block:p.block});check(e.termsHash===op.termsHash);}
          if(['publication','listing'].includes(op.kind)){check(offer.listed===op.listed&&(op.kind!=='listing'||e.listed===op.listed));result.listed=offer.listed;}
        }
      }return finishReceipt(p,result);
    },
    async verifyApproval(op,txHash){validateApprovalTransaction(op,target,op.transaction);const p=await receipt(txHash,op.transaction);if(!p)return {verified:false};const result={...p.base};
      if(p.base.outcome==='CONFIRMED'){const e=event(p.receipt,target.asset,productAssetInterface,'Approval'),allowance=await asset.allowance(op.wallet,target.escrow,p.o);check(same(e.owner,op.wallet)&&same(e.spender,target.escrow)&&e.value===uint(op.amount)&&allowance===e.value);Object.assign(result,{owner:lower(e.owner),asset:target.asset,spender:lower(e.spender),amount:String(e.value),allowance:String(allowance)});}return finishReceipt(p,result);
    },
    async verifyFunding(op,txHash){validateFundingTransaction(op,target,op.transaction);const p=await receipt(txHash,op.transaction);if(!p)return {verified:false};const result={...p.base};
      if(p.base.outcome==='CONFIRMED'){const e=event(p.receipt,target.escrow,productChainInterface,'Funded'),t=event(p.receipt,target.asset,productAssetInterface,'Transfer'),b=await batchCheck(op,{block:p.block});
        check(e.batchId===b.id&&e.storeId===b.b.storeId&&e.mealId===b.b.mealId&&same(e.payer,op.wallet)&&e.version===b.b.version&&e.termsHash===b.b.termsHash&&e.quantity===b.b.quantity&&e.unitPrice===b.b.unitPrice&&e.amount===b.b.amount&&same(t.from,op.wallet)&&same(t.to,target.escrow)&&t.value===b.b.amount);
        Object.assign(result,{batchId:b.id,amount:String(e.amount),quantity:String(e.quantity),termsHash:e.termsHash});}return finishReceipt(p,result);
    },
    async claimCandidate(storeId,mealId){const ctx=await context(),p=await projection(ctx);
      check(p.stores.some(x=>x.id===storeId&&!x.syncPending),'CHAIN_STORE_SYNC_PENDING');
      for(const entry of p.batches.values()){if(entry.intent.storeId!==storeId||entry.intent.mealId!==mealId||entry.claimable===0n)continue;
        const known=[...p.units.values()].filter(u=>u.batchId===entry.id).sort((a,b)=>a.index<b.index?-1:a.index>b.index?1:0);let chosen=known.find(u=>u.available),index=0n;
        if(!chosen){for(const k of known){if(k.index!==index)break;index++;}check(index<entry.b.quantity,'CHAIN_PROJECTION_INCOMPLETE');const u=await escrow.getUnit(entry.id,index,options(ctx));check(u.status===0n,'CHAIN_PROJECTION_INCOMPLETE');chosen={index,u};}
        return finish(ctx,{verified:true,blockNumber:ctx.block.number,storeId,mealId,batchId:entry.id,unitIndex:String(chosen.index),expectedGeneration:number(chosen.u.generation+1n),version:entry.meal.version,termsHash:entry.meal.termsHash,name:entry.meal.name,windows:entry.meal.windows});
      }fail('CLAIM_UNAVAILABLE');
    },
    async eligibility(wallet){const ctx=await context();return finish(ctx,{verified:true,nextEligibleAt:number(await escrow.nextEligibleAt(wallet,options(ctx))),policySeconds:m.policySeconds,chainTime:ctx.block.timestamp});},
    async signClaim(intent){check(claimSigner&&intent.state==='QUEUED','CLAIM_SIGNING_NOT_AUTHORIZED');const ctx=await context(),b=await escrow.getBatch(intent.batchId,options(ctx));
      check(b.quantity>uint(intent.unitIndex)&&b.storeId===chainReference(intent.storeId)&&b.mealId===chainReference(intent.mealId)&&b.version===BigInt(intent.version)&&b.termsHash===intent.termsHash,'CLAIM_STATE_CHANGED');
      if(await escrow.storeClosed(b.storeId,options(ctx)))return finish(ctx,{verified:true,finalized:true,unavailable:true,reason:'STORE_CLOSED',blockNumber:ctx.block.number,blockHash:ctx.block.hash,storeId:intent.storeId,batchId:intent.batchId,unitIndex:intent.unitIndex,expectedGeneration:intent.expectedGeneration});
      const u=await escrow.getUnit(intent.batchId,uint(intent.unitIndex),options(ctx));check(u.generation+1n===BigInt(intent.expectedGeneration),'CLAIM_STATE_CHANGED');
      const t=await escrow.getTerms(b.storeId,b.mealId,b.version,options(ctx));check(JSON.stringify(windows(t.value))===JSON.stringify(intent.windows),'CLAIM_TERMS_CHANGED');
      const expired=u.status===1n&&(await escrow.getVoucher(u.voucherId,options(ctx))).expiresAt<=BigInt(ctx.block.timestamp);check(u.status===0n||expired,'CLAIM_UNIT_UNAVAILABLE');check((await escrow.nextEligibleAt(intent.wallet,options(ctx)))<=BigInt(ctx.block.timestamp),'CLAIM_COOLDOWN');
      const fee=await provider.getFeeData(),gasLimit=uint(m.claimGasLimit),price=fee.maxFeePerGas??fee.gasPrice;
      check(price!==null&&price>0n&&price<=uint(m.maxFeePerGas)&&gasLimit*price<=uint(m.maxTransactionFee),'CLAIM_GAS_BUDGET_EXCEEDED');
      const fees=fee.maxFeePerGas!==null?{type:2,maxFeePerGas:price,maxPriorityFeePerGas:fee.maxPriorityFeePerGas??0n}:{type:0,gasPrice:price};
      check(fees.maxPriorityFeePerGas===undefined||fees.maxPriorityFeePerGas<=price,'CLAIM_FEE_UNVERIFIED');
      await canonical(ctx.block);const raw=await claimSigner.signTransaction({chainId:m.chainId,to:target.escrow,nonce:await nonce(target.claimAuthority),data:claimCalldata(intent),value:0n,gasLimit,...fees});
      const packet={raw,hash:keccak256(raw)};validateClaimPacket(intent,target,packet);return finish(ctx,{verified:true,...packet});
    },
    async broadcastClaim(raw){const ctx=await context(),tx=Transaction.from(raw);check(tx.isSigned(),'CLAIM_PACKET_UNVERIFIED');
      await store.transact(s=>{const matches=records(s.claims).filter(c=>c.state==='SEND_UNKNOWN'&&c.packet===raw&&same(c.txHash,tx.hash));check(matches.length===1,'CLAIM_OUTBOX_REQUIRED');const intent=matches[0];validateClaimPacket(intent,target,{raw,hash:tx.hash});check(!intent.adapterBroadcastHash,'CLAIM_ALREADY_BROADCAST');intent.adapterBroadcastHash=tx.hash;});
      await canonical(ctx.block);const sent=await provider.broadcastTransaction(raw);check(same(sent.hash,tx.hash),'CLAIM_BROADCAST_HASH_MISMATCH');return tx.hash;
    },
    async verifyClaim(intent){validateClaimPacket(intent,target,{raw:intent.packet,hash:intent.txHash});const tx=Transaction.from(intent.packet),p=await receipt(intent.txHash,transaction(tx));if(!p)return {verified:false};const result={...p.base};
      if(p.base.outcome==='CONFIRMED'){const e=event(p.receipt,target.escrow,productChainInterface,'Claimed'),v=await escrow.getVoucher(e.voucherId,p.o);check(e.batchId===intent.batchId&&e.unitIndex===uint(intent.unitIndex)&&e.generation===BigInt(intent.expectedGeneration)&&same(e.recipient,intent.wallet)&&e.termsHash===intent.termsHash&&v.batchId===e.batchId&&v.unitIndex===e.unitIndex&&v.generation===e.generation&&same(v.recipient,e.recipient)&&v.termsHash===e.termsHash&&[1n,5n].includes(v.status)&&v.claimedAt===BigInt(p.block.timestamp)&&v.expiresAt===e.expiresAt&&v.expiresAt-v.claimedAt===BigInt(m.policySeconds));
        if(v.status===5n){const b=await escrow.getBatch(v.batchId,p.o);check(await escrow.storeClosed(b.storeId,p.o),'CHAIN_VOUCHER_MISMATCH');}
        Object.assign(result,{voucherId:e.voucherId,batchId:e.batchId,unitIndex:String(e.unitIndex),generation:number(e.generation),recipient:lower(e.recipient),termsHash:e.termsHash,claimedAt:number(v.claimedAt),expiresAt:number(v.expiresAt),state:states[number(v.status)]});}return finishReceipt(p,result);
    },
    async voucherState(saved){const ctx=await context(),v=await escrow.getVoucher(saved.id,options(ctx)),b=await escrow.getBatch(v.batchId,options(ctx)),owner=await escrow.storeOwner(b.storeId,options(ctx));check(v.generation===BigInt(saved.generation)&&v.termsHash===saved.termsHash&&same(v.recipient,saved.wallet)&&b.storeId===chainReference(saved.storeId)&&b.mealId===chainReference(saved.mealId),'CHAIN_VOUCHER_MISMATCH');return finish(ctx,{verified:true,finalized:true,blockNumber:ctx.block.number,blockHash:ctx.block.hash,voucherId:saved.id,recipient:lower(v.recipient),generation:number(v.generation),storeId:saved.storeId,owner:lower(owner),unitPrice:String(b.unitPrice),state:states[number(v.status)],chainTime:ctx.block.timestamp,expiresAt:number(v.expiresAt),settlementAvailableAt:number(v.settlementAvailableAt)});},
    async signRedemptionPermit(permit){check(redemptionSigner,'REDEMPTION_SIGNING_UNAVAILABLE');const ctx=await context(),v=await escrow.getVoucher(permit.voucherId,options(ctx)),b=await escrow.getBatch(v.batchId,options(ctx)),owner=await escrow.storeOwner(b.storeId,options(ctx)),t=await escrow.getTerms(b.storeId,b.mealId,b.version,options(ctx));check(v.status===1n&&v.generation===BigInt(permit.generation)&&same(owner,permit.owner)&&Number.isSafeInteger(permit.issuedAt)&&Number.isSafeInteger(permit.deadline)&&permit.issuedAt<=ctx.block.timestamp&&permit.deadline>ctx.block.timestamp&&permit.deadline-permit.issuedAt<=120&&BigInt(permit.deadline)<=v.expiresAt&&permit.deadline<=windowEnd(t.value,ctx.block.timestamp),'REDEMPTION_PERMIT_UNVERIFIED');const sig=await redemptionSigner.signTypedData(redemptionDomain(target),redemptionTypes,permit);validatePermitSignature(permit,sig,target);return finish(ctx,sig);},
    async verifyRedemption(op,txHash){validateRedemptionTransaction(op,target,op.transaction);const p=await receipt(txHash,op.transaction);if(!p)return {verified:false};const result={...p.base};
      if(p.base.outcome==='CONFIRMED'){const v=await escrow.getVoucher(op.voucherId,p.o),b=await escrow.getBatch(v.batchId,p.o),owner=await escrow.storeOwner(b.storeId,p.o);check(v.generation===BigInt(op.generation)&&b.storeId===chainReference(op.storeId)&&b.unitPrice===uint(op.amount)&&same(owner,op.wallet));
        if(op.kind==='handover'){const e=event(p.receipt,target.escrow,productChainInterface,'HandedOver');check(e.voucherId===op.voucherId&&same(e.owner,op.wallet)&&v.status===2n&&e.settlementAvailableAt===BigInt(p.block.timestamp+180)&&v.settlementAvailableAt===e.settlementAvailableAt);Object.assign(result,{voucherId:op.voucherId,generation:number(v.generation),owner:lower(owner),state:'HANDED_OVER',handedOverAt:p.block.timestamp,settlementAvailableAt:number(v.settlementAvailableAt)});}
        else{const e=event(p.receipt,target.escrow,productChainInterface,'Settled'),t=event(p.receipt,target.asset,productAssetInterface,'Transfer');check(e.voucherId===op.voucherId&&same(e.owner,op.wallet)&&v.status===3n&&e.amount===b.unitPrice&&same(t.from,target.escrow)&&same(t.to,op.wallet)&&t.value===e.amount);Object.assign(result,{voucherId:op.voucherId,generation:number(v.generation),owner:lower(owner),state:'SETTLED',amount:String(e.amount),receiver:lower(t.to)});}}
      return finishReceipt(p,result);
    },
  };
  const cancellation=makeNonceCancellationVerifier({provider,chain:api});
  api.verifyOperationCancellation=(operation,hash)=>cancellation.verify(operation,hash);
  for(const [key,fn] of Object.entries(api))if(typeof fn==='function')api[key]=async(...args)=>{try{return await fn(...args);}catch(e){if(e?.status===503)throw e;fail('CHAIN_UNAVAILABLE');}};
  return api;
}
