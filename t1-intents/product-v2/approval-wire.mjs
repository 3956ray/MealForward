import {Interface} from 'ethers';
export const approvalInterface=new Interface(['function approve(address spender,uint256 amount) returns (bool)']);
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n;
export function approvalTransaction(operation,target,nonce){
 if(!target||![31337,10143].includes(target.chainId)||!address(target.asset)||!address(target.escrow)||!address(operation.wallet)||!Number.isSafeInteger(nonce)||nonce<0)throw Error('INVALID_PRODUCT_TARGET');
 if(typeof operation.amount!=='string'||!/^[1-9][0-9]{0,77}$/.test(operation.amount)||BigInt(operation.amount)>=2n**256n-1n||operation.asset?.toLowerCase()!==target.asset.toLowerCase()||operation.spender?.toLowerCase()!==target.escrow.toLowerCase())throw Error('INVALID_APPROVAL_AMOUNT_OR_TARGET');
 return {from:operation.wallet,to:target.asset,chainId:'0x'+target.chainId.toString(16),nonce:'0x'+nonce.toString(16),value:'0x0',data:approvalInterface.encodeFunctionData('approve',[target.escrow,operation.amount])};
}
export function validateApprovalTransaction(operation,target,transaction){
 let expected;try{expected=approvalTransaction(operation,target,Number(BigInt(transaction.nonce)));}catch{throw Error('TRANSACTION_UNVERIFIED');}
 if(Object.keys(transaction).sort().join()!==Object.keys(expected).sort().join()||Object.keys(expected).some(k=>String(transaction[k]).toLowerCase()!==String(expected[k]).toLowerCase()))throw Error('TRANSACTION_UNVERIFIED');return expected;
}
