/** Read-only proof that a finalized, empty self-transfer consumed an operation's nonce.
 * The wallet submits the cancellation elsewhere; this module never signs or sends. */
import {Interface} from 'ethers';
import {chainReference} from './funding-wire.mjs';
const requests=new Interface(['function getRequest(address,bytes32) view returns(tuple(bytes32 payloadHash,bytes32 result,bool exists))']);
const address=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&BigInt(x)!==0n;
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const fail=reason=>({verified:false,reason});
const integer=x=>((typeof x==='number'&&Number.isSafeInteger(x)&&x>=0)||(typeof x==='bigint'&&x>=0n)||(typeof x==='string'&&/^(0x[0-9a-f]+|[0-9]+)$/i.test(x)))?BigInt(x):null;
const check=(condition,reason)=>{if(!condition)throw Object.assign(Error(reason),{cancellationReason:reason});};
const kinds=new Set(['approval','support','registration','publication','supplement','listing','closure','refund','handover','settlement']);
export function makeNonceCancellationVerifier({provider,chain}){
 if(!provider||!chain?.target||typeof chain.verifyTarget!=='function')throw Error('CANCELLATION_CONFIGURATION');
 const target=Object.freeze({...chain.target});
 if(![31337,10143].includes(target.chainId)||!address(target.escrow)||!address(target.asset))throw Error('CANCELLATION_CONFIGURATION');
 async function canonical(number,expected){const block=await provider.getBlock(number);check(block&&block.number===number&&hash(block.hash)&&same(block.hash,expected)&&Number.isSafeInteger(block.timestamp)&&block.timestamp>=0,'CANCELLATION_REORG');return block;}
 return {async verify(operation,txHash){
  try {
   const op=structuredClone(operation),original=op?.transaction;
   check(hash(txHash),'CANCELLATION_INVALID_HASH');
   check(op&&typeof op.id==='string'&&op.id.length>0&&kinds.has(op.kind)&&['SEND_UNKNOWN','HASH_BOUND'].includes(op.state)&&address(op.wallet)&&original&&same(op.wallet,original.from),'CANCELLATION_OPERATION_MISMATCH');
   const originalNonce=integer(original.nonce);check(originalNonce!==null&&originalNonce<=BigInt(Number.MAX_SAFE_INTEGER)&&integer(original.chainId)===BigInt(target.chainId),'CANCELLATION_OPERATION_MISMATCH');
   check(same(original.to,op.kind==='approval'?target.asset:target.escrow)&&integer(original.value)===0n&&typeof original.data==='string'&&/^0x[0-9a-f]+$/i.test(original.data)&&original.data.length>=10,'CANCELLATION_OPERATION_MISMATCH');
   const final=await chain.verifyTarget();
   check(final?.verified===true&&integer(final.chainId)===BigInt(target.chainId)&&same(final.escrow,target.escrow)&&same(final.asset,target.asset)&&Number.isSafeInteger(final.blockNumber)&&final.blockNumber>=0&&hash(final.blockHash),'CANCELLATION_TARGET_UNVERIFIED');
   for(const key of ['claimAuthority','redemptionAuthority'])if(target[key])check(same(final[key],target[key]),'CANCELLATION_TARGET_UNVERIFIED');
   check((await provider.getNetwork()).chainId===BigInt(target.chainId),'CANCELLATION_CHAIN_MISMATCH');
   const snapshot=await canonical(final.blockNumber,final.blockHash);
   const [tx,receipt]=await Promise.all([provider.getTransaction(txHash),provider.getTransactionReceipt(txHash)]);
   if(!tx||!receipt)return fail('CANCELLATION_PENDING');
   check(same(tx.hash,txHash)&&same(tx.from,op.wallet)&&same(tx.to,op.wallet)&&integer(tx.chainId)===BigInt(target.chainId)&&integer(tx.nonce)===originalNonce,'CANCELLATION_TRANSACTION_MISMATCH');
   check(integer(tx.value)===0n&&tx.data==='0x'&&[0,2].includes(tx.type),'CANCELLATION_NOT_EMPTY_SELF_TRANSFER');
   check(!tx.authorizationList?.length&&!tx.blobVersionedHashes?.length,'CANCELLATION_NOT_EMPTY_SELF_TRANSFER');
   check(same(receipt.hash||receipt.transactionHash,txHash)&&same(receipt.from,op.wallet)&&same(receipt.to,op.wallet)&&receipt.status===1&&Array.isArray(receipt.logs)&&receipt.logs.length===0&&receipt.contractAddress==null,'CANCELLATION_RECEIPT_MISMATCH');
   check(Number.isSafeInteger(receipt.blockNumber)&&receipt.blockNumber>=0&&hash(receipt.blockHash),'CANCELLATION_RECEIPT_MISMATCH');
   if(receipt.blockNumber>final.blockNumber)return fail('CANCELLATION_NOT_FINAL');
   check(tx.blockNumber===receipt.blockNumber&&same(tx.blockHash,receipt.blockHash),'CANCELLATION_RECEIPT_MISMATCH');
   const mined=await canonical(receipt.blockNumber,receipt.blockHash);
   check(mined.timestamp<=snapshot.timestamp,'CANCELLATION_RECEIPT_MISMATCH');
   if(op.kind==='handover')check(Number.isSafeInteger(op.expiresAt)&&snapshot.timestamp>op.expiresAt,'CANCELLATION_PERMIT_STILL_VALID');
   if(op.kind!=='approval'){
    const data=requests.encodeFunctionData('getRequest',[op.wallet,chainReference(op.id)]);
    const encoded=await provider.call({to:target.escrow,data,blockTag:final.blockNumber});
    const result=requests.decodeFunctionResult('getRequest',encoded)[0];
    if(result.exists)return fail('ORIGINAL_REQUEST_COMPLETED');
   }
   await canonical(receipt.blockNumber,receipt.blockHash);await canonical(final.blockNumber,final.blockHash);
   return {verified:true,finalized:true,invalidated:true,operationId:op.id,kind:op.kind,wallet:op.wallet.toLowerCase(),chainId:target.chainId,originalNonce:Number(originalNonce),txHash:txHash.toLowerCase(),blockNumber:receipt.blockNumber,blockHash:receipt.blockHash.toLowerCase(),finalizedBlockNumber:final.blockNumber,finalizedBlockHash:final.blockHash.toLowerCase(),chainTime:snapshot.timestamp};
  }catch(error){return fail(error.cancellationReason||'CANCELLATION_EVIDENCE_UNAVAILABLE');}
 }};
}
