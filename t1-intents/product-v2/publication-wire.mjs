import {Interface,AbiCoder,keccak256,toUtf8Bytes} from 'ethers';
import {chainReference} from './funding-wire.mjs';
const termsType='tuple(uint256 unitPrice,bytes32 bodyDigest,bytes32 imageDigest,uint8 windowCount,uint16 startMinute0,uint16 endMinute0,uint16 startMinute1,uint16 endMinute1)';
export const publicationInterface=new Interface([
 'function closeStore(bytes32 requestId,bytes32 storeId)',
 'function refundBatch(bytes32 requestId,bytes32 batchId) returns(uint256 amount)',
 'function registerStore(bytes32 requestId,bytes32 storeId)',
 `function publish(bytes32 requestId,bytes32 storeId,bytes32 mealId,uint256 expectedVersion,${termsType} value,uint256 quantity,uint256 fundingDeadline) returns(uint256)`,
 'function supplement(bytes32 requestId,bytes32 storeId,bytes32 mealId,uint256 version,uint256 quantity,uint256 fundingDeadline)',
 'function setListed(bytes32 requestId,bytes32 storeId,bytes32 mealId,uint256 version,bool listed)',
]);
export function publicationTermsHash(target,op){if(!/^0x[0-9a-f]{40}$/i.test(target?.asset||'')||BigInt(target.asset)===0n)throw Error('INVALID_ASSET');return keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','address','bytes32','bytes32','uint256','uint256',termsType],[keccak256(toUtf8Bytes('MealForwardProductTermsV2')),target.chainId,target.escrow,target.asset,chainReference(op.storeId),chainReference(op.mealId),op.version,480,op.terms]));}
export function publicationData(op){
 const head=[chainReference(op.id),chainReference(op.storeId)];
 if(op.kind==='closure')return publicationInterface.encodeFunctionData('closeStore',head);
 if(op.kind==='refund')return publicationInterface.encodeFunctionData('refundBatch',[chainReference(op.id),chainReference(op.batchId)]);
 if(op.kind==='registration')return publicationInterface.encodeFunctionData('registerStore',head);
 head.push(chainReference(op.mealId));
 if(op.kind==='publication')return publicationInterface.encodeFunctionData('publish',[...head,op.expectedVersion,op.terms,op.quantity,op.fundingDeadline]);
 if(op.kind==='supplement')return publicationInterface.encodeFunctionData('supplement',[...head,op.version,op.quantity,op.fundingDeadline]);
 if(op.kind==='listing')return publicationInterface.encodeFunctionData('setListed',[...head,op.version,op.listed]);
 throw Error('INVALID_PUBLICATION_KIND');
}
export function publicationTransaction(op,target,nonce){
 if(!target||![31337,10143].includes(target.chainId)||!/^0x[0-9a-f]{40}$/i.test(target.escrow)||BigInt(target.escrow)===0n||!Number.isSafeInteger(nonce)||nonce<0)throw Error('INVALID_PRODUCT_TARGET');
 return {from:op.wallet,to:target.escrow,chainId:'0x'+target.chainId.toString(16),nonce:'0x'+nonce.toString(16),value:'0x0',data:publicationData(op)};
}
export function validatePublicationTransaction(op,target,tx){
 const expected=publicationTransaction(op,target,Number(BigInt(tx.nonce)));
 if(Object.keys(tx).sort().join()!==Object.keys(expected).sort().join()||Object.keys(expected).some(k=>String(tx[k]).toLowerCase()!==String(expected[k]).toLowerCase()))throw Error('TRANSACTION_UNVERIFIED');
 return expected;
}
