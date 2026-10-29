/** Synthetic RPC only; never produces or submits a real transaction. */
import {AbiCoder,keccak256,toUtf8Bytes} from 'ethers';
import {approvalRpcFixture,HEX} from './t1f-approval-test-fixture.mjs';
import {t0,erc20,FIXED,originalVoucherId} from './t1e-first-issue-readiness.mjs';
import {receiptABI} from './t1f-issue-operation.mjs';
import {CHAIN,ESCROW,TOKEN,MEAL,TERMS,PRICE,QUOTE} from './core.mjs';
export async function executionRpcFixture({row,now,onSend}={}){
 const base=await approvalRpcFixture();let tx=null,mode='ready';const calls=[];
 const signed=BigInt(row.value.observedBlockNumber),head=signed+10n,blockHash=HEX('7'),zero=HEX('0'),batch=HEX('f');
 const included=now+1,voucher=originalVoucherId(0,1n),abi=AbiCoder.defaultAbiCoder();
 const params=keccak256(abi.encode(['bytes32','uint8','uint256','bytes32','uint256'],[MEAL,0,1,TERMS,row.value.newDeadline]));
 const payload=keccak256(abi.encode(['bytes32','uint256','uint256','address','uint8','address','bytes32','bytes32'],[keccak256(toUtf8Bytes('MealForwardOperationV1')),1,CHAIN,ESCROW,5,FIXED.issuerAuthority,row.value.newOpId,params]));
 const event=(name,args)=>({address:ESCROW,...receiptABI.encodeEventLog(receiptABI.getEvent(name),args)});
 const rpc={async send(method,args=[]){calls.push([method,args]);await onSend?.(method,args);
  if(method==='eth_blockNumber')return '0x'+(mode==='ready'?head:head+2n).toString(16);
  if(method==='eth_getBlockByNumber')return {number:args[0],hash:mode==='noncanonical'?HEX('8'):BigInt(args[0])===signed?row.value.observedBlockHash:blockHash,timestamp:'0x'+(BigInt(args[0])===signed?Number(row.observed_block_time):mode==='ready'?now:included).toString(16)};
  if(method==='eth_getTransactionByHash')return tx;
  if(method==='eth_getTransactionReceipt'&&tx&&args[0]===tx.hash){if(mode==='pending')return null;return {transactionHash:tx.hash,from:tx.from,to:tx.to,blockHash,blockNumber:tx.blockNumber,status:mode==='reverted'?'0x0':'0x1',logs:mode==='wrongEvents'?[]:[event('Issued',[voucher,0,1,TERMS,included,included+259200]),event('OperationExecuted',[row.value.newOpId,5,FIXED.issuerAuthority,payload,voucher])]}}
  if(method==='eth_call'){
   const call=args[0];
   if(call.to===ESCROW&&call.data.startsWith(t0.getFunction('issue').selector))return t0.encodeFunctionResult('issue',[voucher]);
   if(mode!=='ready'){
    const iface=call.to===TOKEN?erc20:call.data.startsWith(receiptABI.getFunction('getOperation').selector)||call.data.startsWith(receiptABI.getFunction('getVoucher').selector)?receiptABI:t0;
    const name=iface.parseTransaction({data:call.data}).name;
    const values={getUnit:[[batch,0,QUOTE,MEAL,1,TERMS,PRICE,1,1,voucher]],getAccounting:[[1,PRICE,[0,1,0,0,0],[0,PRICE,0,0,0],mode==='accountingMismatch'?0:PRICE]],getVoucher:[[0,1,TERMS,included,included+259200,FIXED.issuerAuthority,zero,0,'0x'+'0'.repeat(40),'0x'+'0'.repeat(40),zero,0,0,zero,zero,false]],getOperation:[[5,FIXED.issuerAuthority,mode==='operationMismatch'?zero:payload,voucher,included]],quoteUses:[HEX('a'),batch],balanceOf:[PRICE]};
    if(values[name])return iface.encodeFunctionResult(name,values[name]);
   }
  }
  return base.rpc.send(method,args);
 }};
 return {rpc,calls,get tx(){return tx},setMode(value){mode=value},bind(transaction,hash){tx={...transaction,input:transaction.data,hash,blockHash,blockNumber:'0x'+head.toString(16)};mode='pending'}};
}
