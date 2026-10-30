/** Real disposable Anvil chain + synthetic identities + transactional MEMORY store.
 * Not a production chain adapter, SIWE/browser test, PostgreSQL test or deployment.
 * Never reads existing keys, environment RPC URLs or a cloud database.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHmac} from 'node:crypto';
import {ContractFactory,JsonRpcProvider,Wallet,Transaction,TypedDataEncoder,keccak256,parseEther,toUtf8Bytes} from 'ethers';
import {emptyState,makeProductService} from './service.mjs';
import {makeClaimService} from './claims.mjs';
import {fundingTransaction,chainReference} from './funding-wire.mjs';
import {claimCalldata,validateClaimPacket} from './claim-wire.mjs';
import {makeRedemptionService} from './redemption.mjs';
import {redemptionTransaction,redemptionDomain,redemptionTypes} from './redemption-wire.mjs';
import {makeApprovalService} from './approval.mjs';
import {approvalTransaction} from './approval-wire.mjs';
import {makePublicationService} from './publication.mjs';
import {publicationTransaction} from './publication-wire.mjs';

const start=20_000*86400+3*3600; // 11:00 Asia/Shanghai, original service window.
const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const child=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--slots-in-an-epoch','1','--timestamp',String(start),'--silent'],{stdio:'ignore'});
let provider, spawnError, stage='start';
child.on('error',error=>{spawnError=error;});
const checks=[];
const record=name=>checks.push(name);
const lower=value=>value.toLowerCase();
const artifact=async(name,file=name)=>JSON.parse(await readFile(new URL(`../../mvp-contracts/out/${file}.sol/${name}.json`,import.meta.url),'utf8'));

try {
  for(let i=0;;i++){
    if(spawnError)throw Error('LOCAL_ANVIL_START_FAILED');
    try{const r=await fetch(`http://127.0.0.1:${port}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});assert.equal((await r.json()).result,'0x7a69');break;}
    catch{if(i>=100)throw Error('LOCAL_ANVIL_NOT_READY');await new Promise(resolve=>setTimeout(resolve,20));}
  }
  provider=new JsonRpcProvider(`http://127.0.0.1:${port}`,31337,{cacheTimeout:-1,pollingInterval:10});
  // Anvil finality is synthetic. Advance two one-slot epochs before reads; this
  // is real canonical receipt validation, not evidence of public-chain finality.
  const finalize=()=>provider.send('anvil_mine',['0x2','0x0']);
  const owner=await provider.getSigner(0),donor=await provider.getSigner(1),recipient=await provider.getSigner(2),other=await provider.getSigner(3);
  stage='deploy';
  const ownerAddress=lower(await owner.getAddress()),donorAddress=lower(await donor.getAddress());
  const recipientAddress=lower(await recipient.getAddress()),otherAddress=lower(await other.getAddress());
  // Fresh ephemeral keys exist only in this process. No private material is logged.
  const platform=Wallet.createRandom().connect(provider),verifier=Wallet.createRandom();
  const platformAddress=lower(platform.address);
  const tokenArtifact=await artifact('EscrowTestAsset','ProductEscrow.t');
  const token=await new ContractFactory(tokenArtifact.abi,tokenArtifact.bytecode.object,owner).deploy();await token.waitForDeployment();
  const escrowArtifact=await artifact('ProductEscrow');
  const escrow=await new ContractFactory(escrowArtifact.abi,escrowArtifact.bytecode.object,owner)
    .deploy(await token.getAddress(),platform.address,verifier.address,7200);await escrow.waitForDeployment();
  const target={chainId:31337,escrow:lower(await escrow.getAddress()),asset:lower(await token.getAddress()),claimAuthority:platformAddress,redemptionAuthority:verifier.address,
    maxFeePerGas:'10000000000',maxTransactionFee:'20000000000000000'}; // Local-only 10 gwei / 0.02 synthetic ETH ceiling.
  let storeId,storeRef;
  const mealId='local-meal',mealRef=chainReference(mealId);
  stage='catalog setup';
  const price=7_000_000n,quantity=18n;
  await (await owner.sendTransaction({to:platform.address,value:parseEther('1')})).wait();
  await (await token.mint(donorAddress,price*100n)).wait();
  await finalize();
  let now=Number((await provider.getBlock('latest')).timestamp),batchId,nextUnit=0,broadcastCount=0;
  const updateNow=async()=>{now=Number((await provider.getBlock('latest')).timestamp);};
  // Serialized copy-on-commit memory storage, explicitly distinct from PG checks.
  let state=emptyState(),tail=Promise.resolve();
  const store={read:async()=>structuredClone(state),transact(fn){const run=tail.then(async()=>{const next=structuredClone(state);const result=await fn(next);state=next;return structuredClone(result);});tail=run.catch(()=>{});return run;}};
  const receiptProof=async(hash,expected)=>{
    const tx=await provider.getTransaction(hash),receipt=await provider.getTransactionReceipt(hash);
    if(!tx||!receipt)return null;
    assert.equal(lower(tx.hash),lower(hash));assert.equal(tx.chainId,31337n);
    assert.equal(lower(tx.from),lower(expected.from));assert.equal(lower(tx.to),lower(expected.to));
    assert.equal(tx.nonce,Number(BigInt(expected.nonce)));assert.equal(tx.value,BigInt(expected.value));
    assert.equal(lower(tx.data),lower(expected.data));
    const canonical=await provider.getBlock(receipt.blockNumber);
    const finalized=await provider.getBlock('finalized');
    assert.equal(canonical.hash,receipt.blockHash);assert.ok(finalized.number>=receipt.blockNumber);
    return {tx,receipt,canonical};
  };
  const event=(receipt,contract,name)=>{
    const events=receipt.logs.filter(log=>lower(log.address)===lower(contract.target))
      .map(log=>{try{return contract.interface.parseLog(log);}catch{return null;}}).filter(log=>log?.name===name);
    assert.equal(events.length,1,`one ${name} event required`);return events[0].args;
  };
  const chain={target,fundingEnabled:true,approvalEnabled:true,publicationEnabled:true,claimEnabled:true,redemptionEnabled:true,
    async catalog(){
      const block=await provider.getBlock('finalized'),options={blockTag:block.number};
      const base={verified:true,blockNumber:block.number,stores:[],meals:[]};
      if(!storeId)return base;
      const actualOwner=await escrow.storeOwner(storeRef,options);if(BigInt(actualOwner)===0n)return base;
      base.stores=[{id:storeId,name:state.kitchens[storeId].name,owner:lower(actualOwner)}];
      const version=await escrow.currentVersion(storeRef,mealRef,options);
      if(version===0n)return base;
      const terms=await escrow.getTerms(storeRef,mealRef,version,options),offer=await escrow.getOffer(storeRef,mealRef,version,options);
      const metadata=state.publishedMeals[`${storeId}:${mealId}:${version}`];
      assert.equal(terms.value.bodyDigest,keccak256(toUtf8Bytes(JSON.stringify({name:metadata.name,description:metadata.description}))));
      assert.equal(terms.value.imageDigest,metadata.imageDigest);
      return {...base,meals:[{id:mealId,storeId,name:metadata.name,version:Number(version),termsHash:terms.termsHash,
          unitPrice:String(terms.value.unitPrice),remaining:String(offer.offered-offer.funded),listed:offer.listed,
          fundingDeadline:Number(offer.fundingDeadline),windows:[[Number(terms.value.startMinute0),Number(terms.value.endMinute0)],[Number(terms.value.startMinute1),Number(terms.value.endMinute1)]]}]};
    },
    async preparePublicationOperation(op){return publicationTransaction(op,target,await provider.getTransactionCount(op.wallet,'pending'));},
    async verifyPublication(op,hash){
      const proof=await receiptProof(hash,op.transaction);if(!proof)return {verified:false};
      const {tx,receipt}=proof,options={blockTag:receipt.blockNumber};
      const result={verified:true,txHash:lower(hash),finalized:true,blockNumber:receipt.blockNumber,
        transaction:{from:lower(tx.from),to:lower(tx.to),chainId:'0x'+tx.chainId.toString(16),nonce:'0x'+tx.nonce.toString(16),value:'0x'+tx.value.toString(16),data:tx.data},
        outcome:receipt.status===1?'CONFIRMED':'REVERTED'};
      if(receipt.status===1){
        const name=({registration:'StoreRegistered',publication:'MealPublished',supplement:'InventorySupplemented',listing:'ListingChanged'})[op.kind];
        const emitted=event(receipt,escrow,name),sref=chainReference(op.storeId);
        assert.equal(emitted.storeId,sref);
        const actualOwner=lower(await escrow.storeOwner(sref,options));assert.equal(actualOwner,op.wallet);
        Object.assign(result,{kind:op.kind,storeId:op.storeId,owner:actualOwner});
        if(op.kind==='registration')assert.equal(lower(emitted.owner),op.wallet);
        else{
          const mref=chainReference(op.mealId),terms=await escrow.getTerms(sref,mref,op.version,options),offer=await escrow.getOffer(sref,mref,op.version,options);
          assert.equal(emitted.mealId,mref);assert.equal(emitted.version,BigInt(op.version));assert.equal(terms.termsHash,op.termsHash);
          Object.assign(result,{mealId:op.mealId,version:Number(emitted.version),termsHash:terms.termsHash});
          if(['publication','supplement'].includes(op.kind)){
            assert.equal(emitted.quantity,BigInt(op.quantity));assert.equal(emitted.fundingDeadline,BigInt(op.fundingDeadline));assert.equal(offer.fundingDeadline,emitted.fundingDeadline);
            Object.assign(result,{quantity:String(emitted.quantity),fundingDeadline:Number(emitted.fundingDeadline)});
          }
          if(op.kind==='publication'){assert.equal(emitted.termsHash,op.termsHash);assert.equal(terms.value.unitPrice,BigInt(op.unitPrice));}
          if(['publication','listing'].includes(op.kind)){assert.equal(offer.listed,op.listed);if(op.kind==='listing')assert.equal(emitted.listed,op.listed);result.listed=offer.listed;}
        }
      }return result;
    },
    async fundingAllowance(wallet){
      const block=await provider.getBlock('finalized');
      const allowance=await token.allowance(wallet,target.escrow,{blockTag:block.number});
      return {verified:true,finalized:true,blockNumber:block.number,owner:wallet,asset:target.asset,spender:target.escrow,allowance:String(allowance)};
    },
    async prepareApproval(op){return approvalTransaction(op,target,await provider.getTransactionCount(op.wallet,'pending'));},
    async verifyApproval(op,hash){
      const proof=await receiptProof(hash,op.transaction);if(!proof)return {verified:false};
      const {tx,receipt}=proof;
      const result={verified:true,txHash:lower(hash),finalized:true,blockNumber:receipt.blockNumber,
        transaction:{from:lower(tx.from),to:lower(tx.to),chainId:'0x'+tx.chainId.toString(16),nonce:'0x'+tx.nonce.toString(16),value:'0x'+tx.value.toString(16),data:tx.data},
        outcome:receipt.status===1?'CONFIRMED':'REVERTED'};
      if(receipt.status===1){
        const approved=event(receipt,token,'Approval');
        assert.equal(lower(approved.owner),op.wallet);assert.equal(lower(approved.spender),target.escrow);assert.equal(approved.value,BigInt(op.amount));
        const allowance=await token.allowance(op.wallet,target.escrow,{blockTag:receipt.blockNumber});
        assert.equal(allowance,approved.value);
        Object.assign(result,{owner:lower(approved.owner),asset:target.asset,spender:lower(approved.spender),amount:String(approved.value),allowance:String(allowance)});
      }return result;
    },
    async prepareFunding(intent){return fundingTransaction(intent,target,await provider.getTransactionCount(intent.wallet,'pending'));},
    async verifyFunding(intent,hash){
      const proof=await receiptProof(hash,intent.transaction);if(!proof)return {verified:false};
      const result={verified:true,txHash:lower(hash),finalized:true,blockNumber:proof.receipt.blockNumber,outcome:proof.receipt.status===1?'CONFIRMED':'REVERTED'};
      if(proof.receipt.status===1){
        const funded=event(proof.receipt,escrow,'Funded'),transfer=event(proof.receipt,token,'Transfer');
        assert.equal(funded.storeId,storeRef);assert.equal(funded.mealId,mealRef);assert.equal(lower(funded.payer),intent.wallet);
        assert.equal(funded.version,BigInt(intent.version));assert.equal(funded.quantity,BigInt(intent.quantity));
        assert.equal(funded.amount,BigInt(intent.amount));assert.equal(funded.termsHash,intent.termsHash);
        assert.equal(funded.batchId,await escrow.requestKey(intent.wallet,chainReference(intent.id)));
        assert.equal(lower(transfer.from),intent.wallet);assert.equal(lower(transfer.to),target.escrow);assert.equal(transfer.value,funded.amount);
        batchId=funded.batchId;
        Object.assign(result,{amount:String(funded.amount),quantity:String(funded.quantity),termsHash:funded.termsHash});
      }return result;
    },
    async claimCandidate(s,m){
      assert.equal(s,storeId);assert.equal(m,mealId);assert.ok(batchId);
      const batch=await escrow.getBatch(batchId),unit=await escrow.getUnit(batchId,nextUnit);
      const terms=await escrow.getTerms(batch.storeId,batch.mealId,batch.version);
      assert.equal(batch.storeId,storeRef);assert.equal(batch.mealId,mealRef);assert.ok(BigInt(nextUnit)<batch.quantity);
      assert.equal(Number(unit.status),0,'fixture selects a genuinely available unit');
      return {verified:true,storeId,mealId,batchId,unitIndex:String(nextUnit),expectedGeneration:Number(unit.generation)+1,
        version:Number(batch.version),termsHash:batch.termsHash,name:'Local synthetic meal',
        windows:[[Number(terms.value.startMinute0),Number(terms.value.endMinute0)],[Number(terms.value.startMinute1),Number(terms.value.endMinute1)]]};
    },
    async eligibility(wallet){return {verified:true,nextEligibleAt:Number(await escrow.nextEligibleAt(wallet)),policySeconds:Number(await escrow.policySeconds())};},
    async signClaim(intent){
      const raw=await platform.signTransaction({chainId:31337,to:target.escrow,nonce:await provider.getTransactionCount(platform.address,'pending'),
        data:claimCalldata(intent),value:0n,gasLimit:1_000_000n,gasPrice:10_000_000_000n,type:0});
      return {verified:true,raw,hash:keccak256(raw)};
    },
    async broadcastClaim(raw){broadcastCount++;return (await provider.broadcastTransaction(raw)).hash;},
    async verifyClaim(intent){
      const signed=Transaction.from(intent.packet);
      assert.equal(signed.hash,intent.txHash);assert.equal(lower(signed.from),platformAddress);
      assert.equal(signed.data,claimCalldata(intent));
      const proof=await receiptProof(intent.txHash,{from:platformAddress,to:target.escrow,nonce:signed.nonce,value:0,data:signed.data});
      if(!proof)return {verified:false};
      const result={verified:true,txHash:intent.txHash,finalized:true,outcome:proof.receipt.status===1?'CONFIRMED':'REVERTED'};
      if(proof.receipt.status===1){
        const claimed=event(proof.receipt,escrow,'Claimed'),voucher=await escrow.getVoucher(claimed.voucherId);
        assert.equal(claimed.batchId,intent.batchId);assert.equal(claimed.unitIndex,BigInt(intent.unitIndex));
        assert.equal(claimed.generation,BigInt(intent.expectedGeneration));assert.equal(lower(claimed.recipient),intent.wallet);
        assert.equal(claimed.termsHash,intent.termsHash);assert.equal(voucher.claimedAt,BigInt(proof.canonical.timestamp));
        assert.equal(voucher.recipient,claimed.recipient);assert.equal(voucher.expiresAt,claimed.expiresAt);
        assert.equal(voucher.termsHash,intent.termsHash);assert.equal(voucher.expiresAt-voucher.claimedAt,7200n);
        Object.assign(result,{voucherId:claimed.voucherId,batchId:claimed.batchId,unitIndex:String(claimed.unitIndex),
          generation:Number(claimed.generation),recipient:lower(claimed.recipient),termsHash:claimed.termsHash,
          claimedAt:Number(voucher.claimedAt),expiresAt:Number(voucher.expiresAt)});
      }return result;
    },
    async voucherState(saved){
      const block=await provider.getBlock('finalized'),options={blockTag:block.number};
      const v=await escrow.getVoucher(saved.id,options);assert.equal(v.termsHash,saved.termsHash);
      const batch=await escrow.getBatch(v.batchId,options),actualOwner=await escrow.storeOwner(batch.storeId,options);
      assert.equal(batch.storeId,chainReference(saved.storeId));
      return {verified:true,finalized:true,voucherId:saved.id,state:({1:'ISSUED',2:'HANDED_OVER',3:'SETTLED',4:'EXPIRED'})[Number(v.status)]||'UNAVAILABLE',
        recipient:lower(v.recipient),generation:Number(v.generation),storeId:saved.storeId,owner:lower(actualOwner),
        unitPrice:String(batch.unitPrice),chainTime:block.timestamp,settlementAvailableAt:Number(v.settlementAvailableAt)};
    },
    async signRedemptionPermit(permit){
      assert.equal(TypedDataEncoder.hash(redemptionDomain(target),redemptionTypes,permit),await escrow.redemptionDigest(permit));
      return verifier.signTypedData(redemptionDomain(target),redemptionTypes,permit);
    },
    async prepareHandover(op){return redemptionTransaction(op,target,await provider.getTransactionCount(op.wallet,'pending'));},
    async prepareSettlement(op){return redemptionTransaction(op,target,await provider.getTransactionCount(op.wallet,'pending'));},
    async verifyRedemption(op,hash){
      const proof=await receiptProof(hash,op.transaction);if(!proof)return {verified:false};
      const result={verified:true,txHash:lower(hash),finalized:true,blockNumber:proof.receipt.blockNumber,outcome:proof.receipt.status===1?'CONFIRMED':'REVERTED'};
      if(proof.receipt.status===1){
        const voucher=await escrow.getVoucher(op.voucherId,{blockTag:proof.receipt.blockNumber});
        assert.equal(voucher.generation,BigInt(op.generation));
        const originalBatch=await escrow.getBatch(voucher.batchId);
        assert.equal(originalBatch.unitPrice,BigInt(op.amount));assert.equal(originalBatch.storeId,chainReference(op.storeId));
        if(op.kind==='handover'){
          const handed=event(proof.receipt,escrow,'HandedOver');
          assert.equal(handed.voucherId,op.voucherId);assert.equal(lower(handed.owner),op.wallet);
          assert.equal(handed.settlementAvailableAt,BigInt(proof.canonical.timestamp+180));assert.equal(Number(voucher.status),2);
          Object.assign(result,{voucherId:op.voucherId,generation:Number(voucher.generation),owner:lower(handed.owner),state:'HANDED_OVER',handedOverAt:proof.canonical.timestamp,settlementAvailableAt:Number(handed.settlementAvailableAt)});
        }else{
          const settled=event(proof.receipt,escrow,'Settled'),transfer=event(proof.receipt,token,'Transfer');
          assert.equal(settled.voucherId,op.voucherId);assert.equal(lower(settled.owner),op.wallet);assert.equal(settled.amount,BigInt(op.amount));assert.equal(Number(voucher.status),3);
          assert.equal(lower(transfer.from),target.escrow);assert.equal(lower(transfer.to),op.wallet);assert.equal(transfer.value,settled.amount);
          Object.assign(result,{voucherId:op.voucherId,generation:Number(voucher.generation),owner:lower(settled.owner),state:'SETTLED',amount:String(settled.amount),receiver:lower(transfer.to)});
        }
      }return result;
    },
  };
  const service=makeProductService({store,chain,clock:()=>now});
  const approvals=makeApprovalService({store,chain,clock:()=>now});
  const publications=makePublicationService({store,chain,clock:()=>now,defaultImageDigest:chainReference('local image')});
  const pepper=randomBytes(32).toString('hex');
  const claims=makeClaimService({store,chain,policySeconds:7200,pepper,clock:()=>now});
  const merchant=makeRedemptionService({store,chain,pepper,clock:()=>now});

  const sendPublication=async op=>{
    await publications.attempt(ownerAddress,op.id);
    const tx=await owner.sendTransaction(op.transaction);await tx.wait();await finalize();await updateNow();
    await publications.recordHash(ownerAddress,op.id,tx.hash);
    assert.equal((await publications.reconcile(ownerAddress,op.id)).state,'CONFIRMED');
    await assert.rejects(chain.verifyPublication({...op,transaction:{...op.transaction,nonce:'0xffffff'}},tx.hash));
  };
  stage='catalog registration';
  const registrationReview=await publications.reviewRegistration(ownerAddress,{name:'Local synthetic kitchen',requestId:'register-review'});
  const registration=await publications.confirmRegistration(ownerAddress,{reviewId:registrationReview.id,requestId:'register'});
  storeId=registration.storeId;storeRef=chainReference(storeId);
  await sendPublication(registration);
  assert.equal((await publications.byRequest(ownerAddress,'register')).id,registration.id);
  stage='catalog publication';
  const draft=await service.saveDraft(ownerAddress,mealId,{storeId,name:'Local synthetic meal',description:'Original local food description',unitPrice:String(price),windows:[[660,840],[1020,1260]],quantity:'18',fundingDeadline:start+86400,expectedRevision:0,requestId:'draft'});
  const publicationReview=await service.reviewPublication(ownerAddress,{draftId:draft.id,revision:draft.revision,requestId:'publish-review'});
  const publication=await publications.confirmPublication(ownerAddress,{reviewId:publicationReview.id,requestId:'publish'});
  await sendPublication(publication);
  const supplement=await publications.supplement(ownerAddress,{storeId,mealId,version:1,quantity:'12',fundingDeadline:start+86400,requestId:'supplement'});
  await sendPublication(supplement);
  assert.equal((await chain.catalog()).meals[0].remaining,'30');
  record('real store registration and immutable first publication via domain reviews and wallet receipts, then 12-portion supplement; verified catalog metadata and original terms');

  stage='support';
  const review=await service.reviewSupport(donorAddress,{storeId,mealId,version:1,quantity:String(quantity),requestId:'support-review'});
  assert.equal((await chain.fundingAllowance(donorAddress)).allowance,'0');
  await assert.rejects(service.confirmSupport(donorAddress,{reviewId:review.id,requestId:'support-confirm'}),/INSUFFICIENT_ALLOWANCE/);
  const approval=await approvals.prepare(donorAddress,{reviewId:review.id,requestId:'support-approval'});
  assert.equal(approval.amount,String(quantity*price));assert.equal(approval.asset,target.asset);assert.equal(approval.spender,target.escrow);
  await approvals.attempt(donorAddress,approval.id);
  await assert.rejects(approvals.attempt(donorAddress,approval.id),/ALREADY_ATTEMPTED/);
  const authorization=await donor.sendTransaction(approval.transaction);await authorization.wait();await finalize();await updateNow();
  await approvals.recordHash(donorAddress,approval.id,authorization.hash);
  assert.equal((await approvals.reconcile(donorAddress,approval.id)).state,'CONFIRMED');
  assert.equal((await approvals.byRequest(donorAddress,'support-approval')).id,approval.id);
  assert.equal((await chain.fundingAllowance(donorAddress)).allowance,String(quantity*price));
  await assert.rejects(chain.verifyApproval({...approval,transaction:{...approval.transaction,nonce:'0xffffff'}},authorization.hash));
  record('real exact-amount ERC20 approval through original support review, explicit wallet attempt, finalized transaction/event/allowance verification');
  const intent=await service.confirmSupport(donorAddress,{reviewId:review.id,requestId:'support-confirm'});
  assert.equal((await service.catalog()).meals[0].remaining,'12');
  await service.attempt(donorAddress,intent.id);
  await assert.rejects(service.attempt(donorAddress,intent.id),/ALREADY_ATTEMPTED/);
  const payment=await donor.sendTransaction(intent.transaction);await payment.wait();await finalize();await updateNow();
  await service.recordHash(donorAddress,intent.id,payment.hash);
  assert.equal((await service.reconcile(donorAddress,intent.id)).state,'CONFIRMED');
  assert.equal((await service.confirmSupport(donorAddress,{reviewId:review.id,requestId:'support-confirm'})).id,intent.id);
  assert.equal((await service.catalog()).meals[0].remaining,'12');
  assert.equal(await token.balanceOf(target.escrow),quantity*price);
  assert.equal((await chain.fundingAllowance(donorAddress)).allowance,'0','exact approval is fully consumed by original funding');
  await assert.rejects(chain.verifyFunding({...intent,transaction:{...intent.transaction,nonce:'0xffffff'}},payment.hash));
  record('real 18-portion payment: review, reservation, one wallet attempt, exact receipt/event reconciliation and history');

  const recipientBalance=await provider.getBalance(recipientAddress),platformBalance=await provider.getBalance(platformAddress);
  stage='claim';
  const claimReview=await claims.review(recipientAddress,{storeId,mealId,requestId:'claim-review'});
  const claim=await claims.confirm(recipientAddress,{reviewId:claimReview.id,requestId:'claim-confirm'});
  const signed=await claims.signNext();assert.equal(signed.id,claim.id);
  assert.ok(!('packet' in signed)&&!('raw' in signed));
  const savedClaim=(await store.read()).claims[claim.id],originalPacket=Transaction.from(savedClaim.packet);
  for(const [gasLimit,gasPrice] of [[1_000_000n,11_000_000_000n],[3_000_000n,10_000_000_000n]]){
    const raw=await platform.signTransaction({chainId:31337,to:target.escrow,nonce:originalPacket.nonce,
      data:claimCalldata(savedClaim),value:0n,gasLimit,gasPrice,type:0});
    assert.throws(()=>validateClaimPacket(savedClaim,target,{raw,hash:keccak256(raw)}),/CLAIM_GAS_BUDGET_EXCEEDED/);
  }
  await claims.dispatch(claim.id);
  await provider.waitForTransaction(signed.txHash);await finalize();await updateNow();
  await assert.rejects(claims.dispatch(claim.id),/CLAIM_ALREADY_ATTEMPTED/);
  assert.equal(broadcastCount,1);
  const confirmed=await claims.reconcile(recipientAddress,claim.id);assert.equal(confirmed.state,'CONFIRMED');
  assert.equal(await provider.getBalance(recipientAddress),recipientBalance,'recipient pays no claim gas');
  assert.ok((await provider.getBalance(platformAddress))<platformBalance,'platform pays claim gas');
  const voucherId=confirmed.voucherId;
  assert.equal((await claims.voucher(recipientAddress,voucherId)).id,voucherId);
  await assert.rejects(claims.voucher(otherAddress,voucherId),/VOUCHER_NOT_FOUND/);
  nextUnit=1;
  await assert.rejects(claims.review(recipientAddress,{storeId,mealId,requestId:'claim-again'}),/CLAIM_COOLDOWN/);
  record('real platform-signed Claim sends once, gas-price/total-budget caps enforced, original-wallet voucher access, zero recipient gas, verified generation/expiry');

  const display=await claims.display(recipientAddress,voucherId);
  stage='handover';
  const storedDisplay=(await store.read()).displays[voucherId];
  assert.equal(storedDisplay.hash,createHmac('sha256',pepper).update(display.code).digest('hex'));
  const checked=await merchant.check(ownerAddress,'local-owner-session',{storeId,code:display.code});
  assert.ok(!JSON.stringify(checked).includes(recipientAddress));
  const rivalCheck=await merchant.check(ownerAddress,'other-cashier-session',{storeId,code:display.code});
  await assert.rejects(merchant.prepareHandover(ownerAddress,'local-owner-session',{handle:checked.handle,requestId:'without-lock',handedOver:true}),/HANDOVER_LOCK_REQUIRED/);
  const lock=await merchant.reserveHandover(ownerAddress,'local-owner-session',{handle:checked.handle,requestId:'handover-lock'});
  assert.equal(lock.state,'AWAITING_HANDOVER');assert.equal(lock.transaction,undefined);assert.equal(lock.canConfirmHandover,true);
  assert.equal((await merchant.operation(ownerAddress,lock.id,'other-cashier-session')).handle,undefined);
  await assert.rejects(merchant.reserveHandover(ownerAddress,'other-cashier-session',{handle:rivalCheck.handle,requestId:'rival-lock'}),/CHECK_HANDLE_INVALID|WALLET_OPERATION_PENDING/);
  await assert.rejects(claims.display(recipientAddress,voucherId),/PENDING|UNAVAILABLE|REDEMPTION/);
  await provider.send('evm_setNextBlockTimestamp',[now+121]);await provider.send('evm_mine',[]);await finalize();await updateNow();
  const recoveredLocks=await merchant.operations(ownerAddress,'new-owner-session');assert.equal(recoveredLocks.items[0].id,lock.id);assert.equal(recoveredLocks.items[0].handle,undefined);
  assert.ok(!JSON.stringify(recoveredLocks).includes(recipientAddress));
  const resumed=await merchant.resumeHandover(ownerAddress,lock.id,'new-owner-session',{previousDeviceStopped:true});
  assert.equal(resumed.id,lock.id);assert.equal(resumed.handle,checked.handle);assert.equal(resumed.canConfirmHandover,true);
  await assert.rejects(merchant.prepareHandover(ownerAddress,'local-owner-session',{handle:checked.handle,requestId:'old-session-handover',handedOver:true}),/HANDOVER_LOCK_REQUIRED/);
  const handoverOp=await merchant.prepareHandover(ownerAddress,'new-owner-session',{handle:checked.handle,requestId:'handover',handedOver:true});
  assert.equal(handoverOp.id,lock.id);
  assert.equal((await merchant.byRequest(ownerAddress,'handover-lock','local-owner-session')).id,handoverOp.id);
  assert.equal((await merchant.byRequest(ownerAddress,'handover')).id,handoverOp.id);
  await assert.rejects(claims.display(recipientAddress,voucherId),/PENDING|UNAVAILABLE|REDEMPTION/);
  await merchant.attempt(ownerAddress,handoverOp.id);
  const handover=await owner.sendTransaction(handoverOp.transaction);
  const handoverReceipt=await handover.wait();await finalize();
  await receiptProof(handover.hash,{from:ownerAddress,to:target.escrow,nonce:handover.nonce,value:0,data:handover.data});
  event(handoverReceipt,escrow,'HandedOver');
  await updateNow();await merchant.recordHash(ownerAddress,handoverOp.id,handover.hash);
  assert.equal((await merchant.reconcile(ownerAddress,handoverOp.id)).state,'CONFIRMED');
  const ready=Number((await escrow.getVoucher(voucherId)).settlementAvailableAt);
  await provider.send('evm_setNextBlockTimestamp',[ready-1]);await provider.send('evm_mine',[]);await finalize();await updateNow();
  await assert.rejects(merchant.reviewSettlement(ownerAddress,{voucherId,requestId:'settle-review'}),/SETTLEMENT_TOO_EARLY/);
  await provider.send('evm_setNextBlockTimestamp',[ready]);await provider.send('evm_mine',[]);await finalize();await updateNow();
  const beforeOwner=await token.balanceOf(ownerAddress);
  stage='settle';
  const settlementReview=await merchant.reviewSettlement(ownerAddress,{voucherId,requestId:'settle-review'});
  const payoutOp=await merchant.confirmSettlement(ownerAddress,{reviewId:settlementReview.id,requestId:'settle'});
  await merchant.attempt(ownerAddress,payoutOp.id);
  const payout=await owner.sendTransaction(payoutOp.transaction),payoutReceipt=await payout.wait();
  await finalize();
  await receiptProof(payout.hash,{from:ownerAddress,to:target.escrow,nonce:payout.nonce,value:0,data:payout.data});
  const transfer=event(payoutReceipt,token,'Transfer');
  assert.equal(lower(transfer.from),target.escrow);assert.equal(lower(transfer.to),ownerAddress);assert.equal(transfer.value,price);
  assert.equal(await token.balanceOf(ownerAddress),beforeOwner+price);
  await merchant.recordHash(ownerAddress,payoutOp.id,payout.hash);
  assert.equal((await merchant.reconcile(ownerAddress,payoutOp.id)).state,'CONFIRMED');
  assert.equal((await merchant.confirmSettlement(ownerAddress,{reviewId:settlementReview.id,requestId:'settle-again'})).id,payoutOp.id);
  await assert.rejects(merchant.attempt(ownerAddress,payoutOp.id),/ALREADY_ATTEMPTED/);
  assert.equal(await token.balanceOf(ownerAddress),beforeOwner+price,'no double payout');
  const payouts=await merchant.payouts(ownerAddress,storeId);assert.equal(payouts.items[0].state,'SETTLED');
  assert.ok(!JSON.stringify(payouts).includes(recipientAddress));
  const accounting=await escrow.accounting();
  assert.equal(accounting.fundedQuantity,accounting.availableQuantity+accounting.claimedQuantity+accounting.handedOverQuantity+accounting.settledQuantity);
  assert.equal(accounting.fundedAmount,accounting.availableAmount+accounting.claimedAmount+accounting.handedOverAmount+accounting.settledAmount);
  assert.equal(await token.balanceOf(target.escrow),accounting.liability);
  record('durable cashier lock before physical handover, explicit same-wallet session transfer beyond display expiry, real EIP712 permit, 179/180-second boundary, one payout and exact conservation');

  const unlisting=await publications.setListed(ownerAddress,{storeId,mealId,version:1,listed:false,requestId:'unlist'});
  await sendPublication(unlisting);nextUnit=1;
  stage='unlisted claim';
  const secondReview=await claims.review(otherAddress,{storeId,mealId,requestId:'unlisted-review'});
  const second=await claims.confirm(otherAddress,{reviewId:secondReview.id,requestId:'unlisted-confirm'});
  const secondSigned=await claims.signNext();assert.equal(secondSigned.id,second.id);
  await claims.dispatch(second.id);await provider.waitForTransaction(secondSigned.txHash);await finalize();await updateNow();
  const secondConfirmed=await claims.reconcile(otherAddress,second.id);assert.equal(secondConfirmed.state,'CONFIRMED');
  assert.equal((await chain.catalog()).meals[0].listed,false);
  assert.equal(await escrow.nextEligibleAt(otherAddress),BigInt(now+7200));
  const finalAccounting=await escrow.accounting();
  assert.equal(finalAccounting.availableQuantity,16n);assert.equal(finalAccounting.claimedQuantity,1n);assert.equal(finalAccounting.settledQuantity,1n);
  assert.equal(await token.balanceOf(target.escrow),finalAccounting.liability);
  record('already-funded portion remains claimable after unlisting');
  stage='expired locked unit recovery';
  const expiringDisplay=await claims.display(otherAddress,secondConfirmed.voucherId);
  const expiringCheck=await merchant.check(ownerAddress,'expiry-old-session',{storeId,code:expiringDisplay.code});
  const expiringLock=await merchant.reserveHandover(ownerAddress,'expiry-old-session',{handle:expiringCheck.handle,requestId:'expiry-lock'});
  const originalVoucher=await escrow.getVoucher(secondConfirmed.voucherId);
  await provider.send('evm_setNextBlockTimestamp',[Number(originalVoucher.expiresAt)]);await provider.send('evm_mine',[]);
  // Backend reservation cannot prevent the contract's public expiry operation.
  await (await escrow.connect(recipient).expire(secondConfirmed.voucherId)).wait();await finalize();await updateNow();
  const reclaimReview=await claims.review(recipientAddress,{storeId,mealId,requestId:'expired-unit-review'});
  await assert.rejects(claims.confirm(recipientAddress,{reviewId:reclaimReview.id,requestId:'expired-unit-confirm'}),/UNIT_RESERVED/);
  assert.equal((await merchant.cancel(ownerAddress,expiringLock.id,'expiry-new-session')).state,'CANCELLED');
  const reclaimed=await claims.confirm(recipientAddress,{reviewId:reclaimReview.id,requestId:'expired-unit-confirm'});
  const reclaimSigned=await claims.signNext();assert.equal(reclaimSigned.id,reclaimed.id);
  await claims.dispatch(reclaimed.id);await provider.waitForTransaction(reclaimSigned.txHash);await finalize();await updateNow();
  const reclaimedConfirmed=await claims.reconcile(recipientAddress,reclaimed.id);assert.equal(reclaimedConfirmed.state,'CONFIRMED');
  const nextVoucher=await escrow.getVoucher(reclaimedConfirmed.voucherId);assert.equal(nextVoucher.unitIndex,originalVoucher.unitIndex);assert.equal(nextVoucher.generation,originalVoucher.generation+1n);
  const afterReclaim=await escrow.accounting();assert.equal(afterReclaim.fundedQuantity,18n);assert.equal(afterReclaim.availableQuantity,16n);assert.equal(afterReclaim.claimedQuantity,1n);assert.equal(afterReclaim.settledQuantity,1n);
  assert.equal(await token.balanceOf(target.escrow),afterReclaim.liability);
  record('public expiry of backend-locked voucher requires finalized proof and explicit owner cancellation before same funded unit can be claimed at next generation');
  console.log(JSON.stringify({result:'PASS',scope:'disposable Anvil 31337; synthetic identities; memory domain store, not PostgreSQL or production adapter',checks},null,2));
} catch(error) {
  // Avoid leaking signed packets/private fixture material from provider errors.
  console.error('Product local-chain verification FAILED:',stage,error.code || error.name || 'Error',error.invocation?.method||'');
  if(error.shortMessage)console.error(error.shortMessage);
  if(error instanceof assert.AssertionError)console.error(String(error.message).slice(0,300));
  process.exitCode=1;
} finally {
  provider?.destroy();
  if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,2000).unref();});}
}
