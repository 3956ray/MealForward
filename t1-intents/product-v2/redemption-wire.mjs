import {Interface,verifyTypedData} from 'ethers';
import {chainReference} from './funding-wire.mjs';
export const redemptionInterface=new Interface([
  'function redeem(bytes32 requestId,bytes32 voucherId,uint256 generation,(bytes32 voucherId,uint256 generation,address owner,uint256 issuedAt,uint256 deadline) permit,bytes signature)',
  'function settle(bytes32 requestId,bytes32 voucherId,uint256 generation)',
]);
export const redemptionTypes={RedemptionPermit:[{name:'voucherId',type:'bytes32'},{name:'generation',type:'uint256'},{name:'owner',type:'address'},{name:'issuedAt',type:'uint256'},{name:'deadline',type:'uint256'}]};
export function redemptionDomain(target){return {name:'MealForwardProductRedemption',version:'2',chainId:target.chainId,verifyingContract:target.escrow};}
export function validatePermitSignature(permit,signature,target){
  if(!target?.redemptionAuthority || verifyTypedData(redemptionDomain(target),redemptionTypes,permit,signature).toLowerCase()!==target.redemptionAuthority.toLowerCase())throw Error('REDEMPTION_SIGNATURE_UNVERIFIED');
}
export function redemptionCalldata(operation){
  if(operation.kind==='handover')return redemptionInterface.encodeFunctionData('redeem',[chainReference(operation.id),operation.voucherId,BigInt(operation.generation),operation.permit,operation.permitSignature]);
  if(operation.kind==='settlement')return redemptionInterface.encodeFunctionData('settle',[chainReference(operation.id),operation.voucherId,BigInt(operation.generation)]);
  throw Error('INVALID_REDEMPTION_KIND');
}
export function redemptionTransaction(operation,target,nonce){
  if(!target || ![31337,10143].includes(target.chainId) || !/^0x[0-9a-f]{40}$/i.test(target.escrow) || BigInt(target.escrow)===0n || !Number.isSafeInteger(nonce)||nonce<0)throw Error('INVALID_PRODUCT_TARGET');
  return {from:operation.wallet,to:target.escrow,chainId:'0x'+target.chainId.toString(16),nonce:'0x'+nonce.toString(16),value:'0x0',data:redemptionCalldata(operation)};
}
export function validateRedemptionTransaction(operation,target,transaction){
  let expected;try{expected=redemptionTransaction(operation,target,Number(BigInt(transaction.nonce)));}catch{throw Error('TRANSACTION_UNVERIFIED');}
  if(Object.keys(transaction).sort().join()!==Object.keys(expected).sort().join()||Object.keys(expected).some(k=>String(transaction[k]).toLowerCase()!==String(expected[k]).toLowerCase()))throw Error('TRANSACTION_UNVERIFIED');
  return expected;
}
