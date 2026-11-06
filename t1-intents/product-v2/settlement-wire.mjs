import {Transaction} from 'ethers';
import {redemptionCalldata} from './redemption-wire.mjs';
export function validateSettlementPacket(op,target,packet){
 const tx=Transaction.from(packet.raw),fee=tx.gasPrice??tx.maxFeePerGas;
 if(target.automaticSettlement!==true||!tx.isSigned()||tx.hash?.toLowerCase()!==packet.hash?.toLowerCase()||tx.from?.toLowerCase()!==target.claimAuthority.toLowerCase()||tx.to?.toLowerCase()!==target.escrow.toLowerCase()||tx.chainId!==BigInt(target.chainId)||tx.value!==0n||tx.data!==redemptionCalldata({...op,kind:'settlement'})||tx.gasLimit<=0n||tx.gasLimit>5000000n)throw Error('SETTLEMENT_PACKET_UNVERIFIED');
 if(!/^[1-9][0-9]*$/.test(target.maxFeePerGas||'')||!/^[1-9][0-9]*$/.test(target.maxTransactionFee||'')||fee===null||fee<=0n||fee>BigInt(target.maxFeePerGas)||tx.gasLimit*fee>BigInt(target.maxTransactionFee))throw Error('SETTLEMENT_GAS_BUDGET_EXCEEDED');
 return tx;
}
