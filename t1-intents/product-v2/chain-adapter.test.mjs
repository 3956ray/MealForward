import test from 'node:test';
import assert from 'node:assert/strict';
import {AbiCoder,Wallet,Transaction,keccak256,toUtf8Bytes,toBeHex,zeroPadValue} from 'ethers';
import {makeProductChain,productChainInterface as ei,productAssetInterface as ai} from './chain-adapter.mjs';
import {chainReference,fundingTransaction} from './funding-wire.mjs';
import {approvalTransaction} from './approval-wire.mjs';
import {publicationTransaction} from './publication-wire.mjs';
import {claimCalldata} from './claim-wire.mjs';
const E='0x'+'a'.repeat(40),T='0x'+'b'.repeat(40),OWNER='0x'+'c'.repeat(40),PAYER='0x'+'d'.repeat(40),RECIPIENT='0x'+'e'.repeat(40);
const H='0x'+'1'.repeat(64),BH='0x'+'2'.repeat(64),BATCH='0x'+'3'.repeat(64),VOUCHER='0x'+'4'.repeat(64),TH='0x'+'5'.repeat(64);
const now=20000*86400+3*3600,platform=Wallet.createRandom(),verifier=Wallet.createRandom();
function fixture(){
 let state={publications:{},intents:{},claims:{},vouchers:{}},broadcasts=0;const calls=[],code='0x6001600055',tokenCode='0x6002600055';
 const manifest={chainId:31337,escrow:E,asset:T,escrowCodeHash:keccak256(code),assetCodeHash:keccak256(tokenCode),claimAuthority:platform.address,redemptionAuthority:verifier.address,policySeconds:7200,assetDecimals:6,deploymentBlock:1,maxFeePerGas:'100',maxTransactionFee:'100000000',claimGasLimit:'1000000'};
 const block={number:10,hash:BH,timestamp:now},chainState={network:31337n,block,code,tokenCode,issuer:platform.address,verifier:verifier.address,policy:7200n,decimals:6n,allowance:0n,balance:0n,closed:false,refunded:false,
   accounting:{fundedQuantity:0n,availableQuantity:0n,claimedQuantity:0n,handedOverQuantity:0n,settledQuantity:0n,fundedAmount:0n,availableAmount:0n,claimedAmount:0n,handedOverAmount:0n,settledAmount:0n,liability:0n,refundPendingQuantity:0n,refundPendingAmount:0n,refundedQuantity:0n,refundedAmount:0n},
   unit:{generation:0n,voucherId:'0x'+'0'.repeat(64),status:0n},nextEligibleAt:0n,fee:{maxFeePerGas:10n,maxPriorityFeePerGas:1n,gasPrice:10n},tx:null,receipt:null};
 const methods={asset:()=>T,claimAuthority:()=>chainState.issuer,redemptionAuthority:()=>chainState.verifier,policySeconds:()=>chainState.policy,decimals:()=>chainState.decimals,allowance:()=>chainState.allowance,balanceOf:()=>chainState.balance,accounting:()=>chainState.accounting,getStoreAccounting:()=>chainState.storeAccounting||chainState.accounting,storeOwner:()=>OWNER,storeClosed:()=>chainState.closed,batchRefunded:()=>chainState.refunded,getBatchAccounting:()=>chainState.accounting,currentVersion:()=>1n,getTerms:()=>chainState.terms,getOffer:()=>chainState.offer,requestKey:()=>BATCH,getRequest:()=>chainState.request,getBatch:()=>chainState.batch,getUnit:()=>chainState.unit,getVoucher:()=>chainState.voucher,nextEligibleAt:()=>chainState.nextEligibleAt};
 const provider={getNetwork:async()=>({chainId:chainState.network}),getBlock:async n=>n==='finalized'||n===10?{...chainState.block}:{number:n,hash:BH,timestamp:now},getCode:async(a,n)=>{calls.push({type:'code',blockTag:n});return a===E?chainState.code:chainState.tokenCode;},
   call:async tx=>{const iface=tx.to.toLowerCase()===E?ei:ai,parsed=iface.parseTransaction(tx);calls.push({type:parsed.name,blockTag:tx.blockTag,args:parsed.args});return iface.encodeFunctionResult(parsed.fragment,[methods[parsed.name](parsed.args)]);},
   getLogs:async()=>chainState.logs||[],getTransactionCount:async()=>2,getFeeData:async()=>chainState.fee,getTransaction:async()=>chainState.tx,getTransactionReceipt:async()=>chainState.receipt,
   broadcastTransaction:async raw=>{broadcasts++;return {hash:Transaction.from(raw).hash};}};
 const store={read:async()=>structuredClone(state),transact:async fn=>{const next=structuredClone(state);const result=await fn(next);state=next;return structuredClone(result);}};
 const options={provider,manifest,store,claimSigner:platform,redemptionSigner:verifier,profile:'local-acceptance'};
 const chain=makeProductChain(options);
 function funded(quantity=18n){const unitPrice=1n,name='Original meal',description='Original description',terms={unitPrice,bodyDigest:keccak256(toUtf8Bytes(JSON.stringify({name,description}))),imageDigest:H,windowCount:2n,startMinute0:660n,endMinute0:840n,startMinute1:1020n,endMinute1:1260n};
   state.publications={registration:{kind:'registration',state:'CONFIRMED',storeId:'kitchen',wallet:OWNER,name:'Kitchen',confirmedBlock:2},publication:{kind:'publication',state:'CONFIRMED',storeId:'kitchen',mealId:'meal',version:1,wallet:OWNER,name,description,unitPrice:'1',windows:[[660,840],[1020,1260]],termsHash:TH,terms:{...terms,unitPrice:'1'},confirmedBlock:3}};
   state.intents={fund:{id:'fund',kind:'support',state:'CONFIRMED',wallet:PAYER,storeId:'kitchen',mealId:'meal',version:1,unitPrice:'1',quantity:String(quantity),amount:String(quantity),termsHash:TH,confirmedBlock:4}};
   chainState.terms={value:terms,termsHash:TH};chainState.offer={offered:quantity,funded:quantity,fundingDeadline:now+86400,listed:true};chainState.batch={payer:PAYER,storeId:chainReference('kitchen'),mealId:chainReference('meal'),version:1n,termsHash:TH,quantity,unitPrice,amount:quantity,fundedAt:now-100};
   Object.assign(chainState.accounting,{fundedQuantity:quantity,availableQuantity:quantity,fundedAmount:quantity,availableAmount:quantity,liability:quantity});chainState.balance=quantity;
 }
 function transactionFor(op,tx){chainState.tx={hash:H,from:op.wallet,to:tx.to,chainId:31337n,nonce:Number(BigInt(tx.nonce)),value:0n,data:tx.data};chainState.receipt={hash:H,from:op.wallet,to:tx.to,blockNumber:10,blockHash:BH,status:1,logs:[]};}
 function log(iface,name,values,address){const encoded=iface.encodeEventLog(iface.getEvent(name),values);return {address,...encoded,blockNumber:10,blockHash:BH,transactionHash:H,removed:false};}
 return {chain,options,provider,manifest,store,chainState,calls,funded,transactionFor,log,state:()=>state,broadcasts:()=>broadcasts};
}
function indexedLogs(f,op){
 const request=ei.parseTransaction({data:op.transaction.data}).args[0],payload=keccak256(AbiCoder.defaultAbiCoder().encode(['bytes4',ei.getFunction('fund').inputs[0]],[ei.getFunction('fund').selector,request]));
 const complete=f.log(ei,'RequestCompleted',[BATCH,PAYER,payload,BATCH],E),transfer=f.log(ai,'Transfer',[PAYER,E,18],T),funded=f.log(ei,'Funded',[BATCH,chainReference('kitchen'),PAYER,chainReference('meal'),1,TH,18,1,18],E);[complete,transfer,funded].forEach((l,i)=>l.index=i);return {funded,complete,transfer,logs:[complete,transfer,funded]};
}
test('explicit local profile, pinned code and production asset are mandatory',async()=>{
 const f=fixture();assert.throws(()=>makeProductChain({...f.options,profile:undefined}),/CHAIN_PROFILE_MISMATCH/);
 assert.throws(()=>makeProductChain({...f.options,profile:'monad-testnet',manifest:{...f.manifest,chainId:10143}}),/CHAIN_ASSET_MISMATCH/);
 assert.throws(()=>makeProductChain({...f.options,manifest:{...f.manifest,escrowCodeHash:undefined}}),/CHAIN_MANIFEST_REQUIRED/);
 assert.equal((await f.chain.verifyTarget()).verified,true);assert.equal(f.broadcasts(),0);
 for(const [key,value,code] of [['network',10143n,'CHAIN_NETWORK_MISMATCH'],['code','0x6000','CHAIN_CODE_MISMATCH'],['issuer',OWNER,'CHAIN_TARGET_MISMATCH'],['policy',259200n,'CHAIN_TARGET_MISMATCH'],['decimals',18n,'CHAIN_TARGET_MISMATCH']]){const g=fixture();g.chainState[key]=value;await assert.rejects(g.chain.verifyTarget(),e=>e.code===code);}
});
test('all state reads use the pinned finalized block and canonical changes fail closed',async()=>{
 const f=fixture();await f.chain.fundingAllowance(PAYER);assert.ok(f.calls.length>0);assert.ok(f.calls.every(c=>c.blockTag===10));
 f.provider.getBlock=async n=>n==='finalized'?{number:10,hash:BH,timestamp:now}:{number:10,hash:H,timestamp:now};
 await assert.rejects(f.chain.verifyTarget(),e=>e.code==='CHAIN_REORG');
});
test('catalog and candidate handle huge uint quantity without unit scanning or public recipient data',async()=>{
 const f=fixture(),q=2n**200n;f.funded(q);const catalog=await f.chain.catalog();assert.equal(catalog.meals[0].claimable,String(q));assert.equal(catalog.accounting.funded,String(q));
 assert.equal(f.calls.filter(c=>c.type==='getUnit').length,0);const candidate=await f.chain.claimCandidate('kitchen','meal');assert.equal(candidate.unitIndex,'0');assert.equal(candidate.expectedGeneration,1);assert.equal(f.calls.filter(c=>c.type==='getUnit').length,1);
 assert.ok(!JSON.stringify(catalog).includes(RECIPIENT));assert.ok(!('vouchers' in catalog));
 f.state().publications.publication.name='Changed';await assert.rejects(f.chain.catalog(),e=>e.code==='CHAIN_METADATA_MISMATCH');
});
test('incomplete chain accounting and unknown occupied sparse units cannot invent available inventory',async()=>{
 const f=fixture();f.funded();f.chainState.accounting.claimedQuantity=1n;f.chainState.accounting.claimedAmount=1n;f.chainState.accounting.availableQuantity=17n;f.chainState.accounting.availableAmount=17n;
 assert.equal((await f.chain.catalog()).meals[0].claimable,'0');
 const g=fixture();g.funded();g.chainState.unit={generation:1n,status:1n,voucherId:VOUCHER};await assert.rejects(g.chain.claimCandidate('kitchen','meal'),e=>e.code==='CHAIN_PROJECTION_INCOMPLETE');
});
test('wallet identity remains recoverable while global funding/catalog projection awaits reconciliation',async()=>{
 const f=fixture();f.funded();delete f.state().intents.fund;
 assert.equal((await f.chain.catalog()).stores[0].syncPending,true);
 const own=await f.chain.identity(OWNER);assert.deepEqual(own,{verified:true,wallet:OWNER,stores:['kitchen']});
 assert.deepEqual((await f.chain.identity(PAYER)).stores,[]);
});
test('approval verification binds every transaction field, canonical finality, event and original-block allowance',async()=>{
 const f=fixture(),op={wallet:PAYER,asset:T,spender:E,amount:'18'};op.transaction=approvalTransaction(op,f.chain.target,2);f.transactionFor(op,op.transaction);f.chainState.allowance=18n;
 f.chainState.receipt.logs=[f.log(ai,'Approval',[PAYER,E,18n],T)];assert.equal((await f.chain.verifyApproval(op,H)).outcome,'CONFIRMED');
 for(const [key,value] of [['from',OWNER],['to',OWNER],['nonce',3],['value',1n],['chainId',10143n],['data','0x']]){const original=f.chainState.tx[key];f.chainState.tx[key]=value;assert.equal((await f.chain.verifyApproval(op,H)).verified,false);f.chainState.tx[key]=original;}
 f.chainState.receipt.blockHash=H;assert.equal((await f.chain.verifyApproval(op,H)).verified,false);f.chainState.receipt.blockHash=BH;
 f.chainState.receipt.logs[0].blockHash=H;await assert.rejects(f.chain.verifyApproval(op,H),e=>e.code==='CHAIN_EVENT_BLOCK_MISMATCH');f.chainState.receipt.logs[0].blockHash=BH;
 f.chainState.allowance=19n;await assert.rejects(f.chain.verifyApproval(op,H),e=>e.code==='CHAIN_EVIDENCE_MISMATCH');
 f.chainState.receipt.status=0;assert.equal((await f.chain.verifyApproval(op,H)).outcome,'REVERTED');
 f.chainState.receipt=null;assert.equal((await f.chain.verifyApproval(op,H)).finalized,false);
});
test('funding requires one exact batch and ERC20 transfer, not a successful unrelated receipt',async()=>{
 const f=fixture();f.funded();const op={...f.state().intents.fund,expiresAt:now+120};op.transaction=fundingTransaction(op,f.chain.target,2);f.transactionFor(op,op.transaction);
 f.chainState.receipt.logs=[f.log(ei,'Funded',[BATCH,chainReference('kitchen'),PAYER,chainReference('meal'),1,TH,18,1,18],E),f.log(ai,'Transfer',[PAYER,E,18],T)];
 assert.equal((await f.chain.verifyFunding(op,H)).batchId,BATCH);f.chainState.receipt.logs[1]=f.log(ai,'Transfer',[PAYER,OWNER,18],T);
 await assert.rejects(f.chain.verifyFunding(op,H),e=>e.code==='CHAIN_EVIDENCE_MISMATCH');
});
test('platform signing is bounded and never broadcasts; only admitted persisted packet broadcasts once',async()=>{
 const f=fixture();f.funded();const intent={id:'claim',state:'QUEUED',wallet:RECIPIENT,storeId:'kitchen',mealId:'meal',batchId:BATCH,unitIndex:'0',version:1,termsHash:TH,expectedGeneration:1,windows:[[660,840],[1020,1260]]};
 const signed=await f.chain.signClaim(intent);assert.equal(f.broadcasts(),0);const tx=Transaction.from(signed.raw);assert.equal(tx.from.toLowerCase(),platform.address.toLowerCase());assert.equal(tx.data,claimCalldata(intent));
 await assert.rejects(f.chain.broadcastClaim(signed.raw),e=>e.code==='CLAIM_OUTBOX_REQUIRED');
 f.state().claims.claim={...intent,state:'SEND_UNKNOWN',packet:signed.raw,txHash:signed.hash};assert.equal(await f.chain.broadcastClaim(signed.raw),signed.hash);assert.equal(f.broadcasts(),1);
 await assert.rejects(f.chain.broadcastClaim(signed.raw),e=>e.code==='CLAIM_ALREADY_BROADCAST');assert.equal(f.broadcasts(),1);
 const g=fixture();g.funded();g.chainState.fee.maxFeePerGas=101n;await assert.rejects(g.chain.signClaim(intent),e=>e.code==='CLAIM_GAS_BUDGET_EXCEEDED');assert.equal(g.broadcasts(),0);
 const h=fixture();h.funded();const tooSmall=makeProductChain({...h.options,manifest:{...h.manifest,maxTransactionFee:'1'}});await assert.rejects(tooSmall.signClaim(intent),e=>e.code==='CLAIM_GAS_BUDGET_EXCEEDED');
 const closed=fixture();closed.funded();closed.chainState.closed=true;assert.deepEqual(await closed.chain.signClaim(intent),{verified:true,finalized:true,unavailable:true,reason:'STORE_CLOSED',blockNumber:10,blockHash:BH,storeId:'kitchen',batchId:BATCH,unitIndex:'0',expectedGeneration:1});assert.equal(closed.broadcasts(),0);
});
test('nonfinal, wrong identity and expired redemption authorization cannot be signed',async()=>{
 const f=fixture();f.funded();f.chainState.voucher={batchId:BATCH,unitIndex:0n,generation:1n,recipient:RECIPIENT,termsHash:TH,claimedAt:now-1,expiresAt:now+7200,settlementAvailableAt:0n,status:1n};
 const permit={voucherId:VOUCHER,generation:1,owner:OWNER,issuedAt:now,deadline:now+120};assert.match(await f.chain.signRedemptionPermit(permit),/^0x/);assert.equal(f.broadcasts(),0);
 for(const patch of [{owner:PAYER},{generation:2},{deadline:now+121},{deadline:now},{issuedAt:now+1}])await assert.rejects(f.chain.signRedemptionPermit({...permit,...patch}),e=>e.code==='REDEMPTION_PERMIT_UNVERIFIED');
 const v=await f.chain.voucherState({id:VOUCHER,generation:1,termsHash:TH,wallet:RECIPIENT,storeId:'kitchen',mealId:'meal'});assert.equal(v.voucherId,VOUCHER);assert.equal(v.finalized,true);
});
test('closure stops new funding/claim projection and exact refunds return only to the original payer',async()=>{
 const f=fixture();f.funded();f.chainState.closed=true;Object.assign(f.chainState.accounting,{availableQuantity:0n,availableAmount:0n,refundPendingQuantity:18n,refundPendingAmount:18n});
 const catalog=await f.chain.catalog();assert.equal(catalog.stores[0].closed,true);assert.equal(catalog.meals[0].listed,false);assert.equal(catalog.meals[0].claimable,'0');assert.equal(catalog.accounting.refundPending,'18');
 await assert.rejects(f.chain.claimCandidate('kitchen','meal'),e=>e.code==='CLAIM_UNAVAILABLE');
 const refund=await f.chain.refundState(BATCH);assert.equal(refund.quantity,'18');assert.equal(refund.payer,PAYER);assert.equal(refund.storeId,'kitchen');
 assert.equal((await f.chain.refundableBatches('kitchen',OWNER)).items[0].batchId,BATCH);await assert.rejects(f.chain.refundableBatches('kitchen',PAYER),e=>e.code==='CHAIN_OWNER_MISMATCH');
 const close={id:'close',kind:'closure',storeId:'kitchen',wallet:OWNER};close.transaction=publicationTransaction(close,f.chain.target,2);f.transactionFor(close,close.transaction);f.chainState.receipt.logs=[f.log(ei,'StoreClosed',[chainReference('kitchen'),OWNER,18,18],E)];assert.equal((await f.chain.verifyPublication(close,H)).closed,true);
 const op={id:'refund',kind:'refund',storeId:'kitchen',wallet:OWNER,batchId:BATCH,payer:PAYER,quantity:'18',amount:'18'};op.transaction=publicationTransaction(op,f.chain.target,2);f.transactionFor(op,op.transaction);
 f.chainState.refunded=true;Object.assign(f.chainState.accounting,{refundPendingQuantity:0n,refundPendingAmount:0n,refundedQuantity:18n,refundedAmount:18n,liability:0n});f.chainState.balance=0n;
 f.chainState.receipt.logs=[f.log(ei,'BatchRefunded',[BATCH,chainReference('kitchen'),PAYER,18,18],E),f.log(ai,'Transfer',[E,PAYER,18],T)];
 const done=await f.chain.verifyPublication(op,H);assert.equal(done.refunded,true);assert.equal(done.receiver,PAYER);assert.equal((await f.chain.catalog()).accounting.refunded,'18');
 f.chainState.receipt.logs[1]=f.log(ai,'Transfer',[E,OWNER,18],T);await assert.rejects(f.chain.verifyPublication(op,H),e=>e.code==='CHAIN_EVIDENCE_MISMATCH');
});
test('refund list rejects a mined but unreconciled batch and uses one DB snapshot for completeness',async()=>{
 const f=fixture();f.funded();f.state().intents.fund.state='SEND_UNKNOWN';
 await assert.rejects(f.chain.refundableBatches('kitchen',OWNER),e=>e.code==='CHAIN_STORE_SYNC_PENDING');
 await assert.rejects(f.chain.refundState(BATCH),e=>e.code==='CHAIN_BATCH_NOT_INDEXED');
 const g=fixture();g.funded();const good=structuredClone(g.state()),bad=structuredClone(good);delete bad.intents.fund;let reads=0;g.store.read=async()=>structuredClone(++reads===1?bad:good);
 await assert.rejects(g.chain.refundableBatches('kitchen',OWNER),e=>e.code==='CHAIN_STORE_SYNC_PENDING');assert.equal(reads,1);
});
test('claim followed by closure in the same final block confirms the original claim as CANCELLED',async()=>{
 const f=fixture();f.funded();const intent={id:'same-block',state:'QUEUED',wallet:RECIPIENT,storeId:'kitchen',mealId:'meal',batchId:BATCH,unitIndex:'0',version:1,termsHash:TH,expectedGeneration:1,windows:[[660,840],[1020,1260]]};
 const packet=await f.chain.signClaim(intent),signed=Transaction.from(packet.raw);Object.assign(intent,{state:'SEND_UNKNOWN',packet:packet.raw,txHash:packet.hash});
 f.chainState.tx={hash:packet.hash,from:signed.from,to:E,chainId:31337n,nonce:signed.nonce,value:0n,data:signed.data};
 const log=f.log(ei,'Claimed',[VOUCHER,BATCH,RECIPIENT,0,1,TH,now+7200],E);log.transactionHash=packet.hash;
 f.chainState.receipt={hash:packet.hash,from:signed.from,to:E,blockNumber:10,blockHash:BH,status:1,logs:[log]};
 f.chainState.closed=true;f.chainState.voucher={batchId:BATCH,unitIndex:0n,generation:1n,recipient:RECIPIENT,termsHash:TH,claimedAt:now,expiresAt:now+7200,settlementAvailableAt:0n,status:5n};
 const result=await f.chain.verifyClaim(intent);assert.equal(result.outcome,'CONFIRMED');assert.equal(result.state,'CANCELLED');assert.equal(result.voucherId,VOUCHER);
 f.chainState.voucher.recipient=OWNER;await assert.rejects(f.chain.verifyClaim(intent),e=>e.code==='CHAIN_EVIDENCE_MISMATCH');
});

test('a competing original-payer refund permits only a proven completed original-request no-op',async()=>{
 const f=fixture();f.funded();f.chainState.closed=true;f.chainState.refunded=true;Object.assign(f.chainState.accounting,{availableQuantity:0n,availableAmount:0n,liability:0n,refundedQuantity:18n,refundedAmount:18n});
 const op={id:'refund-race',kind:'refund',wallet:OWNER,storeId:'kitchen',batchId:BATCH,payer:PAYER,quantity:'18',amount:'18'};op.transaction=publicationTransaction(op,f.chain.target,2);f.transactionFor(op,op.transaction);
 const payloadHash=keccak256(AbiCoder.defaultAbiCoder().encode(['bytes4','bytes32'],[ei.getFunction('refundBatch').selector,BATCH]));f.chainState.request={exists:true,payloadHash,result:zeroPadValue(toBeHex(18),32)};
 const evidence=await f.chain.verifyPublication(op,H);assert.equal(evidence.outcome,'CONFIRMED');assert.equal(evidence.alreadyRefunded,true);assert.equal(evidence.payer,PAYER);
 f.chainState.receipt.logs=[f.log(ei,'RequestCompleted',[BATCH,OWNER,payloadHash,f.chainState.request.result],E)];assert.equal((await f.chain.verifyPublication(op,H)).alreadyRefunded,true);
 for(const [field,bad]of [['exists',false],['payloadHash',TH],['result',zeroPadValue(toBeHex(17),32)]]){const original=f.chainState.request[field];f.chainState.request[field]=bad;await assert.rejects(f.chain.verifyPublication(op,H),e=>e.code==='CHAIN_REFUND_REQUEST_MISMATCH');f.chainState.request[field]=original;}
 f.chainState.receipt.logs=[f.log(ai,'Transfer',[E,OWNER,18],T)];await assert.rejects(f.chain.verifyPublication(op,H),e=>e.code==='CHAIN_REFUND_REQUEST_MISMATCH');
});

test('foreign store funding cannot freeze known-store catalog, claim or refunds',async()=>{
 const f=fixture();f.funded();f.chainState.storeAccounting=structuredClone(f.chainState.accounting);Object.assign(f.chainState.accounting,{fundedQuantity:19n,availableQuantity:19n,fundedAmount:19n,availableAmount:19n,liability:19n});f.chainState.balance=19n;
 const catalog=await f.chain.catalog();assert.equal(catalog.accounting.funded,'19');assert.equal(catalog.stores[0].syncPending,false);assert.equal(catalog.meals[0].claimable,'18');assert.equal((await f.chain.claimCandidate('kitchen','meal')).batchId,BATCH);assert.equal((await f.chain.refundableBatches('kitchen',OWNER)).items.length,1);
});
test('canonical external funding is indexed once and restores only its store inventory',async()=>{
 const f=fixture();f.funded();const original=structuredClone(f.state().intents.fund),op={...original,expiresAt:now+120};op.transaction=fundingTransaction(op,f.chain.target,2);f.transactionFor(op,op.transaction);f.chainState.batch.fundedAt=BigInt(now);
 const {funded,logs}=indexedLogs(f,op);f.chainState.receipt.logs=logs;f.chainState.logs=[funded];delete f.state().intents.fund;
 assert.equal((await f.chain.catalog()).stores[0].syncPending,true);await assert.rejects(f.chain.claimCandidate('kitchen','meal'),e=>e.code==='CHAIN_STORE_SYNC_PENDING');
 const sync=await f.chain.syncFundingIndex();assert.equal(sync.imported,1);assert.equal(f.state().indexedBatches[BATCH].wallet,PAYER);assert.equal((await f.chain.catalog()).meals[0].claimable,'18');
 f.state().intents.fund=original;assert.equal((await f.chain.catalog()).meals[0].claimable,'18');assert.equal((await f.chain.refundableBatches('kitchen',OWNER)).items.length,1);
});
test('funding index rejects a false asset transfer without persisting a cursor',async()=>{
 const f=fixture();f.funded();const op={...f.state().intents.fund,expiresAt:now+120};op.transaction=fundingTransaction(op,f.chain.target,2);f.transactionFor(op,op.transaction);f.chainState.batch.fundedAt=BigInt(now);const {funded,logs}=indexedLogs(f,op);f.chainState.logs=[funded];logs[1]=f.log(ai,'Transfer',[PAYER,OWNER,18],T);logs[1].index=1;f.chainState.receipt.logs=logs;
 await assert.rejects(f.chain.syncFundingIndex(),e=>e.code==='FUNDING_INDEX_RECEIPT');assert.equal(f.state().fundingIndex,undefined);
});
