/**
 * T1-F: wallet-owned ORIGINAL Issue calldata + independent receipt proof.
 *
 * Source-only, NEVER signs, sends, retries, builds wallets or changes DB.
 * A trusted server must re-derive the chain preflight and recipient consent
 * from independent sources before persisting ISSUE_UNKNOWN in mf_t1e.
 *
 * IMPORTANT: the already-deployed original StoreEscrow.issue does NOT bind
 * the recipient address or its consent. This layer does NOT protect against
 * malicious Issuer/Operator/Owner collusion, grant eligibility or authorize
 * Settle. It is intentionally scoped to ONE already funded Testnet voucher.
 */
import {Interface,keccak256,toUtf8Bytes,AbiCoder} from 'ethers';
import {
 CHAIN,ESCROW,TOKEN,MEAL,TERMS,PRICE,QUOTE
} from './core.mjs';
import {t0,erc20,originalVoucherId,FIXED,QUOTE_ID} from './t1e-first-issue-readiness.mjs';

const ORIGINAL='2b9ae6f1-2bb7-4096-8136-70f30f302eea';
const RECIPIENT='0x2539fefe77a5ce4d09d2225c2e8a7517b22b9135';
const HEX32=/^0x[0-9a-f]{64}$/i;
const HEX=/^0x[0-9a-f]+$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZERO='0x'+'0'.repeat(64);
const OP_DOMAIN=keccak256(toUtf8Bytes('MealForwardOperationV1'));
const abi=AbiCoder.defaultAbiCoder();
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const check=(ok,reason)=>{if(!ok)throw Error(reason)};
const u=x=>{
 check((typeof x==='string'&&
    (/^(0|[1-9][0-9]*)$/.test(x)||/^0x[0-9a-f]+$/i.test(x)))||
  (typeof x==='number'&&Number.isSafeInteger(x)&&x>=0)||
  (typeof x==='bigint'&&x>=0n),'T1F_UNSIGNED_INTEGER_REQUIRED');
 return BigInt(x);
};
const hex=x=>'0x'+u(x).toString(16);
const receiptABI=new Interface([
 'event Issued(bytes32 indexed voucherId,uint8 unitSeq,uint256 generation,bytes32 termsHash,uint256 issuedAt,uint256 expiresAt)',
 'event OperationExecuted(bytes32 indexed opId,uint8 kind,address caller,bytes32 payloadHash,bytes32 result)',
 'event Settled(bytes32 indexed voucherId,bytes32 opId,address indexed receiver,uint256 amount)',
 'function getVoucher(bytes32) view returns ((uint8 unitSeq,uint256 generation,bytes32 termsHash,uint256 issuedAt,uint256 expiresAt,address issuer,bytes32 lockId,uint256 lockedAt,address operator,address processor,bytes32 markerId,uint256 handoverRecordedAt,uint256 handoverBlock,bytes32 reportId,bytes32 settleId,bool expired))',
 'function getOperation(bytes32) view returns ((uint8 kind,address caller,bytes32 payloadHash,bytes32 result,uint256 executedAt))'
]);

function assertClaim(claim,stage,now,{freshConsent=true}={}){
 check(claim&&typeof claim==='object'&&claim.stage===stage,
  'T1F_ISSUER_CLAIM_STAGE_NOT_ALLOWED');
 check(typeof claim.claim_id==='string'&&UUID.test(claim.claim_id),
  'T1F_ORIGINAL_CLAIM_UUID_REQUIRED');
 check(claim.funding_intent===ORIGINAL &&
  u(claim.chain_id)===BigInt(CHAIN)&&eq(claim.escrow,ESCROW)&&
  eq(claim.meal_id,MEAL)&&eq(claim.terms_hash,TERMS),
  'T1F_NOT_ORIGINAL_DONOR_FUNDED_CLAIM');
 check(u(claim.unit_seq)===0n&&u(claim.generation)===1n&&
  eq(claim.voucher_id,originalVoucherId(0,1n)),
  'T1F_FIRST_VOUCHER_IDENTITY_CONFLICT');
 check(eq(claim.issuer_wallet,FIXED.issuerAuthority)&&
  eq(claim.beneficiary_wallet,RECIPIENT)&&
  ![...Object.values(FIXED),QUOTE].some(r=>eq(r,claim.beneficiary_wallet)),
  'T1F_BENEFICIARY_OR_ISSUER_ROLE_INVALID');
 check(HEX32.test(claim.consent_nonce||'')&&!eq(claim.consent_nonce,ZERO)&&
  HEX32.test(claim.consent_digest||'')&&
  HEX32.test(claim.consent_signature_fingerprint||''),
  'T1F_DURABLE_CONSENT_EVIDENCE_REQUIRED');
 if(freshConsent)check(u(claim.consent_deadline)>BigInt(now),
  'T1F_RECIPIENT_CONSENT_EXPIRED');
 return u(claim.consent_deadline);
}
function verifyFreshChain(fresh){
 check(fresh&&fresh.status==='T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS'&&
  fresh.chainId===CHAIN&&eq(fresh.escrow,ESCROW)&&eq(fresh.mealId,MEAL)&&
  fresh.firstUnitSequence===0&&fresh.nextGeneration===1&&
  fresh.unitPrice===PRICE.toString()&&
  eq(fresh.originalIssuerAuthority,FIXED.issuerAuthority)&&
  fresh.originalQuoteUsed===true&&fresh.verifiedFirstBatch===true&&
  fresh.issuedOnchain===false&&fresh.issueSimulatedWithoutSend===true&&
  fresh.accounting?.availableUnits==='1'&&
  fresh.accounting?.liabilityBaseUnits===PRICE.toString()&&
  u(fresh.accounting.escrowBalanceBaseUnits)>=PRICE,
  'T1F_FRESH_PINNED_READONLY_CHAIN_PROOF_REQUIRED');
}
function construct({claim,opId,nonce}){
 const deadline=u(claim.issuer_issue_deadline);
 // Recipient Consent's deadline is for INITIAL signature verification.
 // Once verified in DB, that one-unit authorization is durable. An
 // independent fresh issuer_issue_deadline is saved with the original
 // nonce before showing the Issuer transaction to the user's wallet.
 // Recovery uses this immutable deadline, not the expired Consent window.
 const data=t0.encodeFunctionData('issue',[
  opId,MEAL,0,1,TERMS,deadline
 ]);
 return Object.freeze({
  from:FIXED.issuerAuthority,to:ESCROW,chainId:hex(CHAIN),
  value:'0x0',nonce:hex(nonce),data
 });
}
export function proposeOriginalIssuerOperation({
 claim,operationId,issuerPendingNonce,chainProof,issuerDeadline,
 now=Math.floor(Date.now()/1000)
}={}){
 check(Number.isSafeInteger(now)&&now>0,'T1F_VALID_SERVER_CLOCK_REQUIRED');
 assertClaim(claim,'CONSENT_VERIFIED',now,{freshConsent:false});
 // Consent has already been validated in its original bounded window.
 // Do NOT recreate its nonce or extend its original signed deadline.
 const deadline=u(issuerDeadline);
 check(deadline>=BigInt(now+120)&&deadline<=BigInt(now+600),
  'T1F_FRESH_ISSUER_DEADLINE_OUTSIDE_WINDOW');
 check(claim.issuer_issue_deadline==null,
  'T1F_ALREADY_HAS_ISSUER_DEADLINE');
 check(claim.issuer_op_id==null&&claim.issuer_tx_nonce==null&&
  claim.issuer_tx_data_hash==null&&claim.issuer_tx_hash==null,
  'T1F_ORIGINAL_ISSUER_OPERATION_ALREADY_RESERVED');
 check(typeof operationId==='string'&&HEX32.test(operationId)&&
  !eq(operationId,ZERO),'T1F_ORIGINAL_OPERATION_ID_REQUIRED');
 const nonce=u(issuerPendingNonce);
 check(nonce<=BigInt(Number.MAX_SAFE_INTEGER),
  'T1F_ISSUER_NONCE_UNSAFE');
 verifyFreshChain(chainProof);
 const tx=construct({
  claim:{...claim,issuer_issue_deadline:deadline.toString()},
  opId:operationId,nonce
 });
 return Object.freeze({
  status:'T1F_ORIGINAL_ISSUE_PROPOSAL_ONLY',
  claimId:claim.claim_id,
  originalFundingIntent:ORIGINAL,
  operationId:operationId.toLowerCase(),
  issuerNonce:nonce.toString(),
  issuerCalldataHash:keccak256(tx.data),
  expiry:deadline.toString(),
  durableRecipientConsentAlreadyVerified:true,
  recipientConsentSigningDeadline:String(claim.consent_deadline),
  issuerIssueDeadline:deadline.toString(),
  expectedVoucherId:originalVoucherId(0,1n),
  transaction:tx,
  persistISSUE_UNKNOWNBeforeWallet:true,
  mustNotBroadcastBeforeDbCommit:true,
  serverMaySignOrBroadcast:false,
  noRecipientBoundInContract:true
 });
}
export function inspectReservedIssuerOperation({
 claim,now=Math.floor(Date.now()/1000)
}={}){
 check(Number.isSafeInteger(now)&&now>0,'T1F_VALID_SERVER_CLOCK_REQUIRED');
 // A reserved nonce means any MetaMask timeout/rejection/connection loss
 // MUST be resolved from the original Activity/txHash, never re-sent.
 assertClaim(claim,'ISSUE_UNKNOWN',now,{freshConsent:false});
 check(HEX32.test(claim.issuer_op_id||'')&&!eq(claim.issuer_op_id,ZERO)&&
  claim.issuer_issue_deadline!=null,
  'T1F_RESERVED_OPERATION_ID_MISSING');
 const nonce=u(claim.issuer_tx_nonce);
 check(nonce<=BigInt(Number.MAX_SAFE_INTEGER),'T1F_ISSUER_NONCE_UNSAFE');
 const tx=construct({claim,opId:claim.issuer_op_id,nonce});
 check(eq(keccak256(tx.data),claim.issuer_tx_data_hash),
  'T1F_IMMUTABLE_RESERVED_CALLDATA_HASH_MISMATCH');
 return Object.freeze({
  status:'ISSUE_UNKNOWN_ORIGINAL_ONLY_DO_NOT_RESEND',
  issuer:FIXED.issuerAuthority,
  operationId:claim.issuer_op_id,
  reservedNonce:nonce.toString(),
  expectedCalldataHash:claim.issuer_tx_data_hash,
  predictedVoucherId:originalVoucherId(0,1n),
  sendAgainPermitted:false,
  recommendedAction:'RECOVER_EXISTING_TX_HASH_FROM_METAMASK_ACTIVITY'
 });
}
/**
 * Server-side transaction identity proof for an already reserved operation.
 * Never return these bytes to the browser after the original ISSUE_UNKNOWN
 * reservation: this function exists only for independent tx-hash matching.
 */
export function rebuildReservedIssuerTransaction({claim}={}){
 check(['ISSUE_UNKNOWN','ISSUE_HASH_BOUND','ISSUED'].includes(claim?.stage),
  'T1F_RESERVED_OPERATION_REQUIRED');
 assertClaim(claim,claim.stage,Math.floor(Date.now()/1000),{freshConsent:false});
 check(HEX32.test(claim.issuer_op_id||'')&&claim.issuer_issue_deadline!=null,
  'T1F_ORIGINAL_OP_OR_DEADLINE_MISSING');
 const nonce=u(claim.issuer_tx_nonce);
 const transaction=construct({claim,opId:claim.issuer_op_id,nonce});
 check(eq(keccak256(transaction.data),claim.issuer_tx_data_hash),
  'T1F_ORIGINAL_IMMUTABLE_TX_HASH_DIFFERENT');
 return Object.freeze(transaction);
}
async function at(rpc,to,iface,fn,args,blockTag){
 const output=await rpc.send('eth_call',[{
  to,data:iface.encodeFunctionData(fn,args)
 },blockTag]);
 check(typeof output==='string'&&HEX.test(output),'T1F_CHAIN_READ_INVALID');
 return iface.decodeFunctionResult(fn,output)[0];
}
function decodedEvents(logs,name){
 return logs.flatMap(log=>{
  if(!eq(log.address,ESCROW))return [];
  try{
   const ev=receiptABI.parseLog(log);
   return ev?.name===name?[ev.args]:[];
  }catch{return []}
 });
}
export async function verifyOriginalIssuerReceipt({
 claim,rpc,now=Math.floor(Date.now()/1000)
}={}){
 check(Number.isSafeInteger(now)&&now>0,'T1F_VALID_SERVER_CLOCK_REQUIRED');
 check(claim?.stage==='ISSUE_HASH_BOUND','T1F_ORIGINAL_ISSUE_HASH_NOT_BOUND');
 // A chain receipt may finalize AFTER the signed deadline; it only had
 // to be valid at the actual Issue inclusion block.
 assertClaim(claim,'ISSUE_HASH_BOUND',now,{freshConsent:false});
 check(typeof claim.issuer_op_id==='string'&&HEX32.test(claim.issuer_op_id)&&
  typeof claim.issuer_tx_data_hash==='string'&&HEX32.test(claim.issuer_tx_data_hash)&&
  typeof claim.issuer_tx_hash==='string'&&HEX32.test(claim.issuer_tx_hash)&&
  !eq(claim.issuer_tx_hash,ZERO),
  'T1F_ORIGINAL_ISSUER_HASH_UNTRUSTED');
 check(claim.issuer_issue_deadline!=null,
  'T1F_ORIGINAL_ISSUER_DEADLINE_UNTRUSTED');
 const expected=construct({
  claim,opId:claim.issuer_op_id,nonce:claim.issuer_tx_nonce
 });
 check(eq(keccak256(expected.data),claim.issuer_tx_data_hash),
  'T1F_ORIGINAL_RESERVED_ISSUE_BYTES_CHANGED');
 check(rpc&&typeof rpc.send==='function','T1F_READONLY_RPC_REQUIRED');
 const [chain,tx,receipt,head]=await Promise.all([
  rpc.send('eth_chainId',[]),
  rpc.send('eth_getTransactionByHash',[claim.issuer_tx_hash]),
  rpc.send('eth_getTransactionReceipt',[claim.issuer_tx_hash]),
  rpc.send('eth_blockNumber',[])
 ]);
 check(u(chain)===BigInt(CHAIN),'T1F_WRONG_CHAIN');
 check(tx&&eq(tx.hash,claim.issuer_tx_hash),'T1F_ORIGINAL_ISSUE_TX_NOT_FOUND');
 check(eq(tx.from,FIXED.issuerAuthority)&&eq(tx.to,ESCROW)&&
  u(tx.nonce)===u(claim.issuer_tx_nonce)&&
  u(tx.value??'0')===0n&&eq(keccak256(tx.input??tx.data),claim.issuer_tx_data_hash),
  'T1F_ORIGINAL_ISSUE_TX_BYTES_MISMATCH');
 if(tx.chainId!==null&&tx.chainId!==undefined)
  check(u(tx.chainId)===BigInt(CHAIN),'T1F_ORIGINAL_ISSUE_CHAINID_MISMATCH');
 if(receipt===null)return Object.freeze({
  status:'PENDING_NO_REBROADCAST',originalTxHash:claim.issuer_tx_hash
 });
 check(eq(receipt.transactionHash,claim.issuer_tx_hash)&&
  eq(receipt.from,FIXED.issuerAuthority)&&eq(receipt.to,ESCROW)&&
  eq(tx.blockHash,receipt.blockHash)&&u(tx.blockNumber)===u(receipt.blockNumber),
  'T1F_ORIGINAL_ISSUE_RECEIPT_IDENTITY_MISMATCH');
 check(u(head)>=u(receipt.blockNumber)+1n,'T1F_INSUFFICIENT_CONFIRMATIONS');
 const tag=hex(receipt.blockNumber);
 const block=await rpc.send('eth_getBlockByNumber',[tag,false]);
 check(block&&eq(block.hash,receipt.blockHash),
  'T1F_ORIGINAL_ISSUE_BLOCK_NOT_CANONICAL');
 check(u(receipt.status)===0n||u(receipt.status)===1n,
  'T1F_UNKNOWN_RECEIPT_STATUS');
 if(u(receipt.status)===0n)return Object.freeze({
  status:'REVERTED_NO_AUTORETRY',originalTxHash:claim.issuer_tx_hash,
  blockNumber:u(receipt.blockNumber).toString()
 });
 check(Array.isArray(receipt.logs),'T1F_ISSUED_RECEIPT_LOGS_REQUIRED');
 const decoded=t0.parseTransaction({data:tx.input??tx.data});
 check(decoded?.name==='issue'&&
  eq(decoded.args[0],claim.issuer_op_id)&&
  eq(decoded.args[1],MEAL)&&u(decoded.args[2])===0n&&
  u(decoded.args[3])===1n&&eq(decoded.args[4],TERMS)&&
  u(decoded.args[5])===u(claim.issuer_issue_deadline),
  'T1F_ORIGINAL_ISSUE_FUNCTION_ARGS_MISMATCH');
 const voucherId=originalVoucherId(0,1n);
 const issued=decodedEvents(receipt.logs,'Issued');
 const ops=decodedEvents(receipt.logs,'OperationExecuted');
 const payout=decodedEvents(receipt.logs,'Settled');
 check(issued.length===1&&ops.length===1&&payout.length===0,
  'T1F_ISSUER_ONCHAIN_EVENTS_UNEXPECTED');
 const i=issued[0],op=ops[0];
 const paramsHash=keccak256(abi.encode(
  ['bytes32','uint8','uint256','bytes32','uint256'],
  [MEAL,0,1,TERMS,u(claim.issuer_issue_deadline)]
 ));
 const operationHash=keccak256(abi.encode(
  ['bytes32','uint256','uint256','address','uint8','address','bytes32','bytes32'],
  [OP_DOMAIN,1,CHAIN,ESCROW,5,FIXED.issuerAuthority,claim.issuer_op_id,paramsHash]
 ));
 check(eq(i.voucherId,voucherId)&&u(i.unitSeq)===0n&&
  u(i.generation)===1n&&eq(i.termsHash,TERMS)&&
  u(i.issuedAt)===u(block.timestamp)&&
  u(i.issuedAt)<u(claim.issuer_issue_deadline)&&
  u(i.expiresAt)===u(i.issuedAt)+259200n,
  'T1F_ORIGINAL_ISSUED_EVENT_MISMATCH');
 check(eq(op.opId,claim.issuer_op_id)&&u(op.kind)===5n&&
  eq(op.caller,FIXED.issuerAuthority)&&eq(op.result,voucherId)&&
  eq(op.payloadHash,operationHash),
  'T1F_ISSUER_OPERATION_AUDIT_EVENT_MISMATCH');
 const [unit,accounting,voucher,balance,savedOperation,usedQuote]=await Promise.all([
  at(rpc,ESCROW,t0,'getUnit',[0],tag),
  at(rpc,ESCROW,t0,'getAccounting',[],tag),
  at(rpc,ESCROW,receiptABI,'getVoucher',[voucherId],tag),
  at(rpc,TOKEN,erc20,'balanceOf',[ESCROW],tag),
  at(rpc,ESCROW,receiptABI,'getOperation',[claim.issuer_op_id],tag),
  rpc.send('eth_call',[{
   to:ESCROW,data:t0.encodeFunctionData('quoteUses',[QUOTE_ID])
  },tag]).then(result=>t0.decodeFunctionResult('quoteUses',result))
 ]);
 check(eq(unit.batchId,usedQuote[1])&&usedQuote[1]!==ZERO&&
  savedOperation.kind===5n&&eq(savedOperation.caller,FIXED.issuerAuthority)&&
  eq(savedOperation.payloadHash,operationHash)&&eq(savedOperation.result,voucherId)&&
  savedOperation.executedAt===u(i.issuedAt),
  'T1F_STORED_ORIGINAL_OPERATION_MISMATCH');
 check(unit.bucket===1n&&unit.generation===1n&&eq(unit.voucherId,voucherId)&&
  eq(unit.mealId,MEAL)&&eq(unit.termsHash,TERMS)&&
  unit.unitPrice===PRICE&&
  accounting.fundedUnits===1n&&accounting.fundedAmount===PRICE&&
  accounting.counts[0]===0n&&accounting.counts[1]===1n&&
  accounting.counts.slice(2).every(x=>x===0n)&&
  accounting.amounts[0]===0n&&accounting.amounts[1]===PRICE&&
  accounting.amounts.slice(2).every(x=>x===0n)&&
  accounting.liability===PRICE&&balance>=PRICE,
  'T1F_POST_ISSUE_ACCOUNTING_INCONSISTENT');
 check(voucher.unitSeq===0n&&voucher.generation===1n&&
  eq(voucher.termsHash,TERMS)&&eq(voucher.issuer,FIXED.issuerAuthority)&&
  voucher.issuedAt===i.issuedAt&&voucher.expiresAt===i.expiresAt&&
  eq(voucher.lockId,ZERO)&&eq(voucher.markerId,ZERO)&&
  eq(voucher.reportId,ZERO)&&eq(voucher.settleId,ZERO)&&
  voucher.expired===false,
  'T1F_ORIGINAL_VOUCHER_STATE_MISMATCH');
 const last=await rpc.send('eth_getBlockByNumber',[tag,false]);
 check(eq(last?.hash,receipt.blockHash),'T1F_ISSUE_REORG_DURING_VERIFICATION');
 return Object.freeze({
  status:'T1F_ORIGINAL_ISSUED_RECEIPT_INDEPENDENTLY_CONFIRMED',
  originalTxHash:claim.issuer_tx_hash,
  voucherId,operationId:claim.issuer_op_id,
  blockNumber:u(receipt.blockNumber).toString(),
  blockHash:receipt.blockHash,
  originalIssuerKeyUsedOnchain:true,
  escrowBaseUnits:balance.toString(),
  escrowLiabilityBaseUnits:accounting.liability.toString(),
  onchainRecipientBinding:false,
  humanFoodDeliveryVerified:false,
  merchantSettlementAllowed:false,
  additionalTransactionsSent:0
 });
}
export {receiptABI,ORIGINAL as FIRST_FUNDED_INTENT};
