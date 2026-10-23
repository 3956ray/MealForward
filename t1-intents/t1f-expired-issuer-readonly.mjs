/**
 * T1-F ORIGINAL expired reservation: read-only forensic helper.
 * This does NOT infer that a missing hash means the wallet never broadcast.
 * A pending tx can be invisible to a public RPC. No signature, Claim write,
 * nonce reset, new operation, transaction broadcasting or settlement.
 */
import {makeReadOnlyPublicRpc} from './testnet-readonly-rpc.mjs';
import {FIXED,t0,originalVoucherId} from './t1e-first-issue-readiness.mjs';
import {receiptABI} from './t1f-issue-operation.mjs';
import {CHAIN,ESCROW,MEAL,TERMS,PRICE} from './core.mjs';

const ID='0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b';
const CLAIM='fbab3b22-965d-44e2-b144-d7307b7aa8ea';
const RESERVED_NONCE=0n,RESERVED_DEADLINE=1792765625n;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const requireProof=(v,c)=>{if(!v)throw Error(c)};
const uint=x=>{try{
 const v=BigInt(x);
 requireProof(v>=0n,'T1F_EXPIRED_RPC_UNSIGNED_VALUE_REQUIRED');
 return v
}catch{throw Error('T1F_EXPIRED_RPC_UNSIGNED_VALUE_REQUIRED')}};
const verifiedBlock=b=>{
 requireProof(b&&/^0x[0-9a-f]{64}$/i.test(b.hash||'')&&
  Number.isSafeInteger(Number(uint(b.number))),
  'T1F_EXPIRED_CANONICAL_BLOCK_REQUIRED');
 return b
};
async function readTuple(rpc,iface,fn,args,tag){
 const data=iface.encodeFunctionData(fn,args);
 const raw=await rpc.send('eth_call',[{to:ESCROW,data},tag]);
 requireProof(typeof raw==='string'&&/^0x[0-9a-f]+$/i.test(raw),
  'T1F_EXPIRED_RPC_CALL_INVALID');
 return iface.decodeFunctionResult(fn,raw)[0];
}
export async function inspectExpiredOriginalIssuer({
 rpc=makeReadOnlyPublicRpc()
}={}){
 requireProof(typeof rpc?.send==='function','T1F_EXPIRED_READONLY_RPC_REQUIRED');
 const chain=uint(await rpc.send('eth_chainId',[]));
 requireProof(chain===BigInt(CHAIN),'T1F_EXPIRED_WRONG_CHAIN');
 const tag=await rpc.send('eth_blockNumber',[]);
 const block=verifiedBlock(await rpc.send('eth_getBlockByNumber',[tag,false]));
 requireProof(uint(block.number)===uint(tag),'T1F_EXPIRED_BLOCK_NUMBER_CHANGED');
 const [latest, pending,op,unit]=await Promise.all([
  rpc.send('eth_getTransactionCount',[FIXED.issuerAuthority,'latest']),
  rpc.send('eth_getTransactionCount',[FIXED.issuerAuthority,'pending']),
  readTuple(rpc,receiptABI,'getOperation',[ID],tag),
  readTuple(rpc,t0,'getUnit',[0],tag)
 ]);
 const latestNonce=uint(latest),pendingNonce=uint(pending);
 requireProof(pendingNonce>=latestNonce,'T1F_EXPIRED_PENDING_NONCE_BEHIND_LATEST');
 requireProof(unit&&same(unit.mealId,MEAL)&&same(unit.termsHash,TERMS)&&
  uint(unit.unitPrice)===PRICE,'T1F_EXPIRED_ORIGINAL_UNIT_CHANGED');
 const expectedVoucher=originalVoucherId(0,1n);
 const originalOperationSeen=uint(op.kind)!==0n;
 const issuerNonceUsed=latestNonce>RESERVED_NONCE;
 const issuerNoncePending=pendingNonce>latestNonce;
 const unitIssued=uint(unit.bucket)===1n&&same(unit.voucherId,expectedVoucher);
 const unitAvailable=uint(unit.bucket)===0n;
 requireProof(unitAvailable||unitIssued,'T1F_EXPIRED_UNEXPECTED_UNIT_BUCKET');
 if(originalOperationSeen){
  requireProof(uint(op.kind)===5n&&same(op.caller,FIXED.issuerAuthority)&&
   same(op.result,expectedVoucher),'T1F_EXPIRED_ORIGINAL_OPERATION_UNKNOWN');
 }
 const finalBlock=verifiedBlock(await rpc.send('eth_getBlockByNumber',[tag,false]));
 requireProof(same(finalBlock.hash,block.hash),'T1F_EXPIRED_REORG_IN_READONLY_AUDIT');
 const observedUse=originalOperationSeen||issuerNonceUsed||issuerNoncePending||unitIssued;
 return Object.freeze({
  status:observedUse?'T1F_EXPIRED_CHAIN_ACTIVITY_MANUAL_INVESTIGATION_REQUIRED':
   'T1F_EXPIRED_NO_ISSUE_OBSERVED_NOT_ABSENCE_PROOF',
  claimId:CLAIM,originalOperationId:ID,
  chainId:CHAIN,issuer:FIXED.issuerAuthority,escrow:ESCROW,
  observedBlockNumber:uint(tag).toString(),
  observedBlockHash:block.hash,
  reservedOriginalNonce:RESERVED_NONCE.toString(),
  issuerLatestNonce:latestNonce.toString(),
  issuerPendingNonce:pendingNonce.toString(),
  originalOperationSeen,
  unitAvailable,unitIssued,
  issuerTransactionHashFound:false,
  noPendingTxProven:false,
  userWalletActivityMustBeChecked:true,
  canIssueOrResetAutomatically:false,
  originalImmutableDeadline:RESERVED_DEADLINE.toString(),
  sendOrWalletActionsPerformed:0
 });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await inspectExpiredOriginalIssuer())+'\n')}
 catch(e){
  const c=typeof e?.message==='string'&&
   /^T1F_EXPIRED_[A-Z0-9_]{4,90}$/.test(e.message)?
   e.message:'T1F_EXPIRED_READONLY_AUDIT_NOT_CONFIRMED';
  process.stderr.write(c+'\n');process.exitCode=1;
 }
}
