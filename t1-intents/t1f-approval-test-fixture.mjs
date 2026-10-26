/** Synthetic protocol context, never a live database or wallet. */
import {CHAIN,ESCROW} from './core.mjs';
import {FIXED,originalVoucherId} from './t1e-first-issue-readiness.mjs';
import {ORIGINAL_CLAIM,ORIGINAL_OPERATION,ORIGINAL_DATA_HASH,ORIGINAL_DEADLINE} from './t1f-successor-issue-protocol.mjs';
import {APPROVAL_WALLETS} from './t1f-approval-protocol.mjs';
import {buildSuccessorReleaseManifest} from './t1f-successor-dual-approval.mjs';
export const NOW=1792792000,HEX=n=>'0x'+n.repeat(64),ROUND='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export function fixture(){
 const claim={claim_id:ORIGINAL_CLAIM,funding_intent:'2b9ae6f1-2bb7-4096-8136-70f30f302eea',stage:'ISSUE_UNKNOWN',revision:2,chain_id:CHAIN,escrow:ESCROW,unit_seq:0,generation:1,voucher_id:originalVoucherId(0,1n),issuer_wallet:FIXED.issuerAuthority,issuer_op_id:ORIGINAL_OPERATION,issuer_tx_nonce:'0',issuer_issue_deadline:String(ORIGINAL_DEADLINE),issuer_tx_data_hash:ORIGINAL_DATA_HASH,issuer_tx_hash:null,receipt_block:null,receipt_block_hash:null,consent_digest:HEX('2'),consent_signature_fingerprint:HEX('3'),beneficiary_wallet:'PRIVATE_BENEFICIARY'};
 const review={review_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',claim_id:ORIGINAL_CLAIM,review_state:'MANUAL_REVIEW_ONLY_NO_NEW_ISSUE',wallet_observation:'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE',observed_block_number:'73688844',observed_issuer_latest_nonce:'0',observed_issuer_pending_nonce:'0',may_create_second_operation:false,may_broadcast_transaction:false,may_modify_original_claim:false};
 const slot={attempt_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',claim_id:ORIGINAL_CLAIM,review_id:review.review_id,attempt_sequence:2,stage:'REVIEW_HOLD',original_operation_id:ORIGINAL_OPERATION,original_issuer_nonce:'0',original_deadline:String(ORIGINAL_DEADLINE),original_calldata_hash:ORIGINAL_DATA_HASH,successor_operation_id:null,successor_nonce:null,successor_issue_deadline:null,successor_calldata_hash:null,successor_tx_hash:null,receipt_block:null,receipt_block_hash:null,security_release_id:null,may_prepare_wallet_tx:false,may_sign_or_broadcast:false,may_mark_issued:false,legacy_claim_rewrite_allowed:false};
 const context={claim,review,slot};
 const chain={status:'T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF',chainId:CHAIN,issuer:FIXED.issuerAuthority,escrow:ESCROW,originalOperationId:ORIGINAL_OPERATION,reservedOriginalNonce:'0',originalImmutableDeadline:String(ORIGINAL_DEADLINE),observedBlockNumber:'73688845',observedBlockHash:HEX('4'),observedBlockTime:NOW-10,issuerLatestNonce:'0',issuerPendingNonce:'0',originalOperationSeen:false,unitAvailable:true,unitIssued:false,issuerTransactionHashFound:false,noPendingTxProven:false,userWalletActivityMustBeChecked:true,canIssueOrResetAutomatically:false};
 const manifest=buildSuccessorReleaseManifest({...context,chain,walletObservation:review.wallet_observation,nonceDomain:HEX('5'),candidateOperationId:HEX('6'),candidateNonce:0,candidateDeadline:NOW+480,approvalExpiresAt:NOW+300,now:NOW});
 const row={round_id:ROUND,value:manifest.value,digest:manifest.digest,created_at_epoch:NOW,observed_block_time:NOW-10,candidate_calldata_hash:manifest.candidateCalldataHash,approvals:[]};
 return {context,chain,manifest,row};
}

/** Entire real read-only probe surface; only public code is copied from chain. */
export async function approvalRpcFixture({pending=0,blockTime=NOW-10,reorg=false,onSend}={}){
 const {readFile}=await import('node:fs/promises');
 const {t0,erc20,ORIGINAL_FUND}=await import('./t1e-first-issue-readiness.mjs');
 const {receiptABI}=await import('./t1f-issue-operation.mjs');
 const {TOKEN,MEAL,TERMS,PRICE,QUOTE}=await import('./core.mjs');
 const runtime=JSON.parse(await readFile(new URL('./t1f-approval-public-code.fixture.json',import.meta.url),'utf8')).code;
 const calls=[],head=73688845,zero=HEX('0'),batch=HEX('f');let heads=0,blockReads=0;
 const rpc={async send(method,params){
  calls.push([method,params]);await onSend?.(method,params);
  if(method==='eth_chainId')return '0x279f';
  if(method==='eth_blockNumber')return '0x'+(head+heads++).toString(16);
  if(method==='eth_getBlockByNumber'){blockReads++;return {number:params[0],hash:reorg&&blockReads>1?HEX('8'):HEX('4'),timestamp:'0x'+blockTime.toString(16)}}
  if(method==='eth_getCode')return params[0]===ESCROW?runtime:'0x';
  if(method==='eth_getTransactionReceipt'){if(params[0]!==ORIGINAL_FUND)throw Error('unexpected receipt');return {status:'0x1',to:ESCROW,from:QUOTE,blockNumber:'0x'+(73410628).toString(16)}}
  if(method==='eth_getTransactionCount')return '0x'+(params[1]==='pending'?pending:0).toString(16);
  if(method==='eth_call'){
   const tx=params[0];
   if(tx.to===TOKEN)return erc20.encodeFunctionResult('balanceOf',[PRICE]);
   if(tx.to!==ESCROW)throw Error('unexpected target');
   if(tx.data.slice(0,10)===receiptABI.getFunction('getOperation').selector)return receiptABI.encodeFunctionResult('getOperation',[[0,'0x'+'0'.repeat(40),zero,zero,0]]);
   const name=t0.parseTransaction({data:tx.data}).name;
   const values={asset:[TOKEN],owner:[FIXED.owner],quoteAuthority:[QUOTE],issuerAuthority:[FIXED.issuerAuthority],operatorAuthority:[FIXED.operatorAuthority],catalogAuthority:[FIXED.catalogAuthority],currentVersion:[1],listed:[true],paused:[false],closed:[false],lifetimeFundedUnits:[1],availableUnits:[1],nextCandidate:[[true,0,1,TERMS,false]],getAccounting:[[1,PRICE,[1,0,0,0,0],[PRICE,0,0,0,0],PRICE]],quoteUses:[HEX('a'),batch],getUnit:[[batch,0,QUOTE,MEAL,1,TERMS,PRICE,0,0,zero]],getBatch:[[QUOTE,MEAL,1,TERMS,PRICE,1,0,0]]};
   if(!values[name])throw Error('unexpected method '+name);return t0.encodeFunctionResult(name,values[name]);
  }
  throw Error('unexpected RPC');
 }};
 return {rpc,calls};
}

export function consumed(){const f=fixture();f.row.approvals=Object.entries(APPROVAL_WALLETS).map(([role,wallet])=>({role,wallet,fingerprint:HEX('a')}));const c={consumption_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',version:'T1F_CONSUMPTION_V1',round_id:ROUND,digest:f.row.digest,claim_id:f.context.claim.claim_id,slot_id:f.context.slot.attempt_id,release_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',successor_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',consumed_at_epoch:NOW,no_release:true,can_issue:false,may_broadcast_by_server:false,approved_for_settlement:false};f.context.consumption=c;f.row.consumption=c;return f;}
