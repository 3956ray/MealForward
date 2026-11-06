import {Interface,keccak256,toUtf8Bytes} from 'ethers';
export const fundingInterface=new Interface([
  'function fund((bytes32 requestId,bytes32 storeId,bytes32 mealId,uint256 version,bytes32 termsHash,uint256 quantity,uint256 expectedAmount,uint256 deadline) request) returns (bytes32)',
  'event Funded(bytes32 indexed batchId,bytes32 indexed storeId,address indexed payer,bytes32 mealId,uint256 version,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount)',
]);
export const chainReference=value => /^0x[0-9a-f]{64}$/i.test(value) ? value : keccak256(toUtf8Bytes(value));
export function fundingArguments(intent) {
  return [chainReference(intent.id),chainReference(intent.storeId),chainReference(intent.mealId),BigInt(intent.version),intent.termsHash,BigInt(intent.quantity),BigInt(intent.amount),BigInt(intent.expiresAt)];
}
export function fundingTransaction(intent,target,nonce) {
  if (!target || ![31337,10143].includes(target.chainId) || !/^0x[0-9a-f]{40}$/i.test(target.escrow) || BigInt(target.escrow)===0n || !Number.isSafeInteger(nonce) || nonce<0) throw Error('INVALID_PRODUCT_TARGET');
  return {from:intent.wallet,to:target.escrow,chainId:'0x'+target.chainId.toString(16),nonce:'0x'+nonce.toString(16),value:'0x0',data:fundingInterface.encodeFunctionData('fund',[fundingArguments(intent)])};
}
export function validateFundingTransaction(intent,target,transaction) {
  let expected;
  try {expected=fundingTransaction(intent,target,Number(BigInt(transaction.nonce)));} catch {throw Error('TRANSACTION_UNVERIFIED');}
  if (Object.keys(transaction).sort().join()!==Object.keys(expected).sort().join() || Object.keys(expected).some(key=>String(transaction[key]).toLowerCase()!==String(expected[key]).toLowerCase())) throw Error('TRANSACTION_UNVERIFIED');
  return expected;
}
