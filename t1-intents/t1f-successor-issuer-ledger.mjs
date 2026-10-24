/**
 * SOURCE ONLY. NOT MOUNTED IN A WEB SERVER. No runtime PG grants.
 *
 * T1-F / Phase3 successor Issue. The old claim is permanently
 * ISSUE_UNKNOWN, the original op/nonce/deadline/hash may NEVER be rewritten.
 * New attempt is one independently approved, one-Unit, fresh immutable
 * operation in successor_issue_operations with automatic PG audit.
 *
 * Only Owner + Donor signatures on one EIP-712 release authorise constructing
 * the successor reservation in a REVIEWED future release. The server never
 * signs/broadcasts. A single sendable transaction is returned AFTER COMMIT;
 * any retries are RECOVERY ONLY with no transaction bytes.
 */
import {randomUUID} from 'node:crypto';
import {keccak256} from 'ethers';
import {CHAIN,ESCROW,MEAL,TERMS} from './core.mjs';
import {FIXED,t0,originalVoucherId,firstVoucherCandidate} from './t1e-first-issue-readiness.mjs';
import {inspectExpiredOriginalIssuer} from './t1f-expired-issuer-readonly.mjs';
import {
 buildSuccessorReleaseManifest,verifyPinnedSuccessorRelease,
 T1F_RELEASE_OWNER,T1F_RELEASE_DONOR
} from './t1f-successor-dual-approval.mjs';
import {
 ORIGINAL_CLAIM,ORIGINAL_OPERATION,ORIGINAL_DATA_HASH,ORIGINAL_DEADLINE,
 verifySuccessorReceiptReadOnly
} from './t1f-successor-issue-protocol.mjs';

const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const ok=(v,c)=>{if(!v)throw Error(c)};
const nat=x=>{try{
 const v=BigInt(x);ok(v>=0n,'T1F_PHASE3_UINT_NONNEGATIVE_REQUIRED');return v
}catch{throw Error('T1F_PHASE3_UINT_NONNEGATIVE_REQUIRED')}};
const HEX32=/^0x[0-9a-f]{64}$/i;
const ORIGINAL_INTENT='2b9ae6f1-2bb7-4096-8136-70f30f302eea';
const RECIPIENT='0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135';
const STATUS_COLS='successor_id,claim_id,slot_id,release_id,'+
 'chain_id,escrow,voucher_id,issuer_wallet,operation_id,issuer_nonce,'+
 'issuer_issue_deadline,calldata_hash,stage,revision,tx_hash,'+
 'receipt_block,receipt_block_hash';

function normalized(row){
 return Object.freeze({
  successorId:row.successor_id,claimId:row.claim_id,
  slotId:row.slot_id,releaseId:row.release_id,
  stage:row.stage,voucherId:row.voucher_id,operationId:row.operation_id,
  issuerNonce:String(row.issuer_nonce),issuerDeadline:String(row.issuer_issue_deadline),
  txHash:row.tx_hash,receiptBlock:row.receipt_block==null?null:String(row.receipt_block),
  canSendAgain:false,hasNoWalletAutoRetry:true,legacyClaimUnchanged:true
 });
}
function checkOriginal(row){
 ok(row?.claim_id===ORIGINAL_CLAIM&&row.stage==='ISSUE_UNKNOWN'&&
  nat(row.revision)===2n&&
  same(row.issuer_op_id,ORIGINAL_OPERATION)&&
  nat(row.issuer_tx_nonce)===0n&&
  nat(row.issuer_issue_deadline)===ORIGINAL_DEADLINE&&
  same(row.issuer_tx_data_hash,ORIGINAL_DATA_HASH)&&
  row.issuer_tx_hash==null&&row.receipt_block==null&&
  row.receipt_block_hash==null&&
  row.funding_intent===ORIGINAL_INTENT&&
  Number(row.chain_id)===CHAIN&&same(row.escrow,ESCROW)&&
  same(row.meal_id,MEAL)&&same(row.terms_hash,TERMS)&&
  Number(row.unit_seq)===0&&nat(row.generation)===1n&&
  same(row.beneficiary_wallet,RECIPIENT)&&
  HEX32.test(row.consent_digest||'')&&
  HEX32.test(row.consent_signature_fingerprint||'')&&
  same(row.issuer_wallet,FIXED.issuerAuthority)&&
  same(row.voucher_id,originalVoucherId(0,1n)),
  'T1F_PHASE3_ORIGINAL_ISSUE_UNKNOWN_IMMUTABLE');
}
const RELEASE_COLS='claim_id,slot_id,review_id,candidate_op_id,'+
 'candidate_issuer_nonce,candidate_issue_deadline,nonce_domain,'+
 'approval_expires_at,observed_block_number,observed_block_hash,'+
 'owner_wallet,donor_wallet,signed_payload_digest,'+
 'owner_signature_fingerprint,donor_signature_fingerprint,'+
 'signer_verification_version';

export function makeSuccessorIssuerLedger({pool,rpc,clock=()=>Math.floor(Date.now()/1000)}={}){
 ok(pool?.query&&pool?.connect&&typeof rpc?.send==='function'&&
  typeof clock==='function','T1F_PHASE3_PRIVATE_LEDGER_AND_READONLY_RPC_REQUIRED');
 const issuer=wallet=>ok(same(wallet,FIXED.issuerAuthority),
  'T1F_PHASE3_PINNED_ISSUER_SIWE_REQUIRED');
 const get=async (client,table,cols,where,val,lock='')=>{
  const r=await client.query(
   'SELECT '+cols+' FROM mf_t1e.'+table+' WHERE '+where+
   (lock?' FOR UPDATE':''),
   [val]
  );
  return r.rowCount===1?r.rows[0]:null;
 };
 const readOriginal=async(c)=>{
  const row=await get(c,'recipient_claims','*','claim_id=$1::uuid',ORIGINAL_CLAIM);
  checkOriginal(row);return row
 };
 const lookup=async(c,lock=false)=>get(
  c,'successor_issue_operations',STATUS_COLS,'claim_id=$1::uuid',
  ORIGINAL_CLAIM,lock?'update':''
 );
 const validateSuccessor=(row,claim)=>{
  ok(row?.claim_id===claim.claim_id&&
   row.chain_id===CHAIN&&same(row.escrow,ESCROW)&&
   same(row.issuer_wallet,FIXED.issuerAuthority)&&
   same(row.voucher_id,claim.voucher_id)&&
   !same(row.operation_id,ORIGINAL_OPERATION),
   'T1F_PHASE3_SUCCESSOR_LEDGER_IDENTITY_CHANGED');
 };
 async function chainSnapshot(){
  const chain=await inspectExpiredOriginalIssuer({rpc});
  ok(chain.status==='T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF'&&
   chain.originalOperationSeen===false&&
   chain.unitAvailable===true&&chain.issuerLatestNonce==='0'&&
   chain.issuerPendingNonce==='0',
   'T1F_PHASE3_ORIGINAL_CHAIN_UNCHANGED_REQUIRED');
  const block=await rpc.send('eth_getBlockByNumber',[
   '0x'+nat(chain.observedBlockNumber).toString(16),false
  ]);
  ok(same(block?.hash,chain.observedBlockHash)&&
   block.timestamp!=null,
   'T1F_PHASE3_CANONICAL_BLOCK_TIME_REQUIRED');
  return Object.freeze({...chain,observedBlockTime:Number(nat(block.timestamp))});
 }
 return Object.freeze({
  async state({issuerWallet}){
   issuer(issuerWallet);
   const claim=await readOriginal(pool);
   const row=await lookup(pool);
   if(!row)return Object.freeze({
    status:'T1F_PHASE3_NO_SUCCESSOR_OPERATION',
    originalClaimStage:'ISSUE_UNKNOWN',maySend:false
   });
   validateSuccessor(row,claim);
   return normalized(row);
  },
  async reserve({
   issuerWallet,manifest,ownerSignature,donorSignature,
   walletObservation='OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE'
  }={}){
   issuer(issuerWallet);
   // Recover existing reservation first, without returning any wallet bytes
   // and without generating a second new operation or EIP-712 nonce.
   const existing=await lookup(pool);
   if(existing){
    const original=await readOriginal(pool);
    validateSuccessor(existing,original);
    return Object.freeze({created:false,state:normalized(existing),
     recoveryOnly:true,issueTransaction:undefined});
   }
   const now=clock(),observed=await chainSnapshot();
   const ready=await firstVoucherCandidate({rpc});
   ok(ready.status==='T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS'&&
    ready.issueSimulatedWithoutSend===true&&ready.issuedOnchain===false&&
    ready.accounting?.availableUnits==='1'&&
    ready.accounting?.liabilityBaseUnits==='7000000'&&
    ready.accounting?.escrowBalanceBaseUnits==='7000000',
    'T1F_PHASE3_FRESH_ORIGINAL_FUNDED_ONE_UNIT_REQUIRED');
   ok(observed.observedBlockTime<=now&&now-observed.observedBlockTime<=120,
    'T1F_PHASE3_SIGNED_CANONICAL_BLOCK_TOO_OLD');
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const claim=await readOriginal(c);
    const review=await get(c,'expired_issue_reviews','*','claim_id=$1::uuid',ORIGINAL_CLAIM);
    // Lock the immutable Review slot across first-time reservations.
    // Two concurrent signed requests cannot each create their own release.
    const slot=await get(c,'issuer_issue_attempts','*',
     'claim_id=$1::uuid',ORIGINAL_CLAIM,'update');
    ok(review?.review_id&&slot?.review_id===review.review_id&&
     slot.stage==='REVIEW_HOLD','T1F_PHASE3_ADMIN_REVIEW_HOLD_REQUIRED');
    const already=await lookup(c,true);
    if(already){
     validateSuccessor(already,claim);
     await c.query('COMMIT');
     return Object.freeze({created:false,state:normalized(already),
      recoveryOnly:true,issueTransaction:undefined});
    }
    const m=manifest?.value;
    ok(m&&m.claimId===ORIGINAL_CLAIM&&
     m.reviewId===review.review_id&&m.slotId===slot.attempt_id,
     'T1F_PHASE3_MANIFEST_ANCHORED_TO_SQL_REVIEW_REQUIRED');
    const expected=buildSuccessorReleaseManifest({
     claim,review,slot,chain:observed,walletObservation,
     nonceDomain:m.nonceDomain,
     candidateOperationId:m.newOpId,
     candidateNonce:m.newNonce,
     candidateDeadline:m.newDeadline,
     approvalExpiresAt:m.approvalExpiresAt,
     now
    });
    ok(same(expected.digest,manifest.digest)&&
     same(m.observedBlockHash,expected.value.observedBlockHash)&&
     nat(m.observedBlockNumber)===nat(expected.value.observedBlockNumber),
     'T1F_PHASE3_SIGNED_MANIFEST_CHANGED');
    const proof=verifyPinnedSuccessorRelease({
     manifest:expected,ownerSignature,donorSignature,now
    });
    ok(proof.status==='T1F_DUAL_EIP712_SIGNATURES_VERIFIED_OFFCHAIN_ONLY'&&
     same(proof.ownerWallet,T1F_RELEASE_OWNER)&&
     same(proof.donorWallet,T1F_RELEASE_DONOR)&&
     !proof.newIssueAuthorized,
     'T1F_PHASE3_OWNER_DONOR_AUTHORITY_REQUIRED');
    const txData=t0.encodeFunctionData('issue',[
     m.newOpId,MEAL,0,1,TERMS,nat(m.newDeadline)
    ]);
    ok(same(keccak256(txData),expected.candidateCalldataHash),
     'T1F_PHASE3_EXACT_SIGNED_ISSUE_CALLDATA_REQUIRED');
    const releaseId=randomUUID(),successorId=randomUUID();
    const values=[
     ORIGINAL_CLAIM,slot.attempt_id,review.review_id,m.newOpId,
     nat(m.newNonce).toString(),nat(m.newDeadline).toString(),m.nonceDomain,
     nat(m.approvalExpiresAt).toString(),
     nat(m.observedBlockNumber).toString(),m.observedBlockHash,
     T1F_RELEASE_OWNER,T1F_RELEASE_DONOR,proof.digest,
     proof.ownerSignatureFingerprint,proof.donorSignatureFingerprint,
     'T1F_EIP712_TWO_INDEPENDENT_EOA_V1'
    ];
    await c.query(
     'INSERT INTO mf_t1e.successor_issue_releases(release_id,'+RELEASE_COLS+
      ') VALUES($1::uuid,'+Array.from({length:16},(_,i)=>'$'+(i+2)).join(',')+')',
     [releaseId,...values]
    );
    const inserted=await c.query(
     'INSERT INTO mf_t1e.successor_issue_operations('+
      'successor_id,claim_id,slot_id,release_id,chain_id,'+
      'escrow,voucher_id,issuer_wallet,operation_id,issuer_nonce,'+
      'issuer_issue_deadline,calldata_hash)'+
      ' VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,10143,'+
      '$5,$6,$7,$8,$9,$10,$11) RETURNING '+STATUS_COLS,
     [successorId,ORIGINAL_CLAIM,slot.attempt_id,releaseId,
      ESCROW,claim.voucher_id,FIXED.issuerAuthority,
      m.newOpId,nat(m.newNonce).toString(),
      nat(m.newDeadline).toString(),keccak256(txData)]
    );
    ok(inserted.rowCount===1,'T1F_PHASE3_SINGLE_SUCCESSOR_INSERT_FAILED');
    await c.query('COMMIT');
    // One-time human-owned wallet send bytes only after the UNIQUE committed
    // state. Nothing in this source signs/sends. First caller may use once.
    return Object.freeze({
     created:true,state:normalized(inserted.rows[0]),
     issueTransaction:Object.freeze({
      from:FIXED.issuerAuthority,to:ESCROW,chainId:'0x279f',
      nonce:'0x'+nat(m.newNonce).toString(16),
      value:'0x0',data:txData
     }),
     firstHumanWalletSendOnly:true,noServerBroadcaster:true
    });
   }catch(e){
    await c.query('ROLLBACK').catch(()=>{});
    throw e;
   }finally{c.release()}
  },
  async bind({issuerWallet,txHash}={}){
   issuer(issuerWallet);
   ok(HEX32.test(txHash||''),'T1F_PHASE3_ORIGINAL_TX_HASH_REQUIRED');
   const claim=await readOriginal(pool);
   const row=await lookup(pool);
   validateSuccessor(row,claim);
   if(row.stage!=='ISSUE_UNKNOWN'){
    ok(['ISSUE_HASH_BOUND','ISSUED'].includes(row.stage)&&
     same(row.tx_hash,txHash),
     'T1F_PHASE3_DIFFERENT_ORIGINAL_HASH_DENIED');
    return Object.freeze({alreadyBound:true,state:normalized(row)});
   }
   const [network,tx]=await Promise.all([
    rpc.send('eth_chainId',[]),
    rpc.send('eth_getTransactionByHash',[txHash])
   ]);
   ok(nat(network)===BigInt(CHAIN),'T1F_PHASE3_WRONG_CHAIN');
   ok(tx,'T1F_PHASE3_SUBMITTED_HASH_NOT_YET_INDEXED');
   const data=t0.encodeFunctionData('issue',[
    row.operation_id,MEAL,0,1,TERMS,nat(row.issuer_issue_deadline)
   ]);
   ok(same(keccak256(data),row.calldata_hash)&&
    same(tx.hash,txHash)&&same(tx.from,FIXED.issuerAuthority)&&
    same(tx.to,ESCROW)&&nat(tx.nonce)===nat(row.issuer_nonce)&&
    nat(tx.value??'0')===0n&&
    (tx.chainId==null||nat(tx.chainId)===BigInt(CHAIN))&&
    same(keccak256(tx.input??tx.data),row.calldata_hash),
    'T1F_PHASE3_ONLY_ORIGINAL_SUCCESSOR_TRANSACTION_ALLOWED');
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const locked=await lookup(c,true);
    ok(locked?.stage==='ISSUE_UNKNOWN'&&locked.revision===row.revision&&
     same(locked.operation_id,row.operation_id)&&
     same(locked.calldata_hash,row.calldata_hash),
     'T1F_PHASE3_SUCCESSOR_CAS_CONFLICT');
    const updated=await c.query(
     'UPDATE mf_t1e.successor_issue_operations SET '+
      "stage='ISSUE_HASH_BOUND',tx_hash=$2,revision=revision+1 "+
      'WHERE successor_id=$1::uuid AND revision=$3 '+
      "AND stage='ISSUE_UNKNOWN' AND tx_hash IS NULL RETURNING "+STATUS_COLS,
     [locked.successor_id,txHash.toLowerCase(),locked.revision]
    );
    ok(updated.rowCount===1,'T1F_PHASE3_SUCCESSOR_HASH_BIND_CAS_FAILED');
    await c.query('COMMIT');
    return Object.freeze({alreadyBound:false,state:normalized(updated.rows[0])});
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  },
  async reconcile({issuerWallet}={}){
   issuer(issuerWallet);
   const claim=await readOriginal(pool);
   const row=await lookup(pool);
   validateSuccessor(row,claim);
   if(row.stage==='ISSUED')return Object.freeze({
    alreadyIssued:true,state:normalized(row)
   });
   ok(row.stage==='ISSUE_HASH_BOUND',
    'T1F_PHASE3_ORIGINAL_SUCCESSOR_HASH_NOT_BOUND');
   const proof=await verifySuccessorReceiptReadOnly({
    claim,attempt:{
     ...row,attempt_id:row.successor_id,
     original_operation_id:claim.issuer_op_id,
     original_issuer_nonce:claim.issuer_tx_nonce,
     original_deadline:claim.issuer_issue_deadline,
     original_calldata_hash:claim.issuer_tx_data_hash,
     successor_operation_id:row.operation_id,
     successor_nonce:row.issuer_nonce,
     successor_issue_deadline:row.issuer_issue_deadline,
     successor_calldata_hash:row.calldata_hash,
     successor_tx_hash:row.tx_hash,
     security_release_id:row.release_id,
     legacy_claim_rewrite_allowed:false
    },
    rpc,now:clock()
   });
   if(proof.status!=='T1F_SUCCESSOR_RECEIPT_VERIFIED_SOURCE_ONLY')
    return Object.freeze({state:normalized(row),proof,
     canSendAgain:false,automaticRetryAllowed:false});
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const locked=await lookup(c,true);
    ok(locked?.stage==='ISSUE_HASH_BOUND'&&locked.revision===row.revision&&
     same(locked.tx_hash,row.tx_hash)&&same(locked.operation_id,row.operation_id),
     'T1F_PHASE3_RECEIPT_CAS_CONFLICT');
    const updated=await c.query(
     'UPDATE mf_t1e.successor_issue_operations SET '+
      "stage='ISSUED',receipt_block=$2,receipt_block_hash=$3,"+
      'revision=revision+1 WHERE successor_id=$1::uuid '+
      "AND revision=$4 AND stage='ISSUE_HASH_BOUND' RETURNING "+STATUS_COLS,
     [locked.successor_id,proof.blockNumber,proof.blockHash,locked.revision]
    );
    ok(updated.rowCount===1,'T1F_PHASE3_RECEIPT_PERSISTENCE_FAILED');
    await c.query('COMMIT');
    return Object.freeze({
     state:normalized(updated.rows[0]),proof,
     originalClaimStillIssueUnknown:true,
     merchantSettlementEnabled:false,canSendAgain:false
    });
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  }
 });
}
