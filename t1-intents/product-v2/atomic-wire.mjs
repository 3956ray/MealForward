import {Interface,AbiCoder,keccak256,toUtf8Bytes} from 'ethers';
import {fundingInterface,fundingArguments} from './funding-wire.mjs';
import {approvalInterface} from './approval-wire.mjs';
export const atomicAccountInterface=new Interface(['function execute(bytes32 mode,bytes executionCalldata)']);
export function atomicCalls(op,target){return [{to:target.asset,value:'0x0',data:approvalInterface.encodeFunctionData('approve',[target.escrow,op.amount])},{to:target.escrow,value:'0x0',data:fundingInterface.encodeFunctionData('fund',[fundingArguments(op)])}];}
export const callsDigest=calls=>keccak256(toUtf8Bytes(JSON.stringify(calls)));
export const atomicCalldata=calls=>atomicAccountInterface.encodeFunctionData('execute',['0x01'+'00'.repeat(31),AbiCoder.defaultAbiCoder().encode(['tuple(address target,uint256 value,bytes callData)[]'],[calls.map(c=>[c.to,BigInt(c.value),c.data])])]);
