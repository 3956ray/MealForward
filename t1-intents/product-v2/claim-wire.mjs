import {Interface,Transaction} from 'ethers';
import {chainReference} from './funding-wire.mjs';
export const claimInterface=new Interface(['function claim(bytes32 requestId,bytes32 batchId,uint256 unitIndex,uint256 expectedGeneration,address recipient) returns (bytes32)']);
export function claimCalldata(intent){return claimInterface.encodeFunctionData('claim',[chainReference(intent.id),intent.batchId,BigInt(intent.unitIndex),BigInt(intent.expectedGeneration),intent.wallet]);}
export function validateClaimPacket(intent,target,packet){
  const tx=Transaction.from(packet.raw);
  if(!target || ![31337,10143].includes(target.chainId) || !tx.isSigned() || tx.hash?.toLowerCase()!==packet.hash?.toLowerCase() || tx.from?.toLowerCase()!==target.claimAuthority?.toLowerCase() || tx.to?.toLowerCase()!==target.escrow?.toLowerCase() || tx.chainId!==BigInt(target.chainId) || tx.value!==0n || tx.data.toLowerCase()!==claimCalldata(intent).toLowerCase() || tx.gasLimit<=0n || tx.gasLimit>5000000n)throw Error('CLAIM_PACKET_UNVERIFIED');
  const fee=tx.gasPrice??tx.maxFeePerGas;
  if(!/^[1-9][0-9]*$/.test(target.maxFeePerGas||'')||!/^[1-9][0-9]*$/.test(target.maxTransactionFee||'')||fee===null||fee>BigInt(target.maxFeePerGas)||tx.gasLimit*fee>BigInt(target.maxTransactionFee))throw Error('CLAIM_GAS_BUDGET_EXCEEDED');
  return {raw:tx.serialized,hash:tx.hash};
}
