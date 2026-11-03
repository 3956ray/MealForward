/** Conservative EIP-7702 policy. An empty implementation pin list disables new atomic funding. */
import {AbiCoder,Interface,keccak256,verifyAuthorization} from 'ethers';
import {atomicCalls,atomicCalldata} from './atomic-wire.mjs';
import {chainReference,fundingArguments,fundingInterface} from './funding-wire.mjs';
const abi=AbiCoder.defaultAbiCoder(),requestType='tuple(bytes32,bytes32,bytes32,uint256,bytes32,uint256,uint256,uint256)';
export const atomicEvidenceInterface=new Interface([
 'function requestKey(address,bytes32) view returns(bytes32)',
 'function getRequest(address,bytes32) view returns(tuple(bytes32 payloadHash,bytes32 result,bool exists))',
 'function getBatch(bytes32) view returns(tuple(address payer,bytes32 storeId,bytes32 mealId,uint256 version,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 fundedAt))',
 'event RequestCompleted(bytes32 indexed requestKey,address indexed caller,bytes32 payloadHash,bytes32 result)',
]);
const token=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)','event Approval(address indexed owner,address indexed spender,uint256 value)']);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const check=c=>{if(!c)throw Error('ATOMIC_EVIDENCE_UNVERIFIED');};
const index=v=>v.index??v.transactionIndex;
export function makeAtomicChain({provider,manifest,baseChain}){
 const pins=manifest.atomicImplementations||[],target=baseChain.target;
 async function account(wallet,block){const code=await provider.getCode(wallet,block);if(!/^0xef0100[0-9a-f]{40}$/i.test(code))return {verified:false};const implementation='0x'+code.slice(8),runtime=await provider.getCode(implementation,block);const pin=pins.find(p=>p.chainId===target.chainId&&p.execution==='metamask-delegator-self-erc7579-v1'&&same(p.implementation,implementation)&&same(p.codeHash,keccak256(runtime)));return pin?{verified:true,implementation,codeHash:pin.codeHash,execution:pin.execution}:{verified:false};}
 async function context(){const final=await baseChain.verifyTarget();check(final.verified===true&&Number.isSafeInteger(final.blockNumber)&&hash(final.blockHash));check((await provider.getNetwork()).chainId===BigInt(target.chainId));const block=await provider.getBlock(final.blockNumber);check(block?.number===final.blockNumber&&same(block.hash,final.blockHash)&&Number.isSafeInteger(block.timestamp));return {...final,timestamp:block.timestamp};}
 async function canonical(number,expected){const block=await provider.getBlock(number);check(block?.number===number&&same(block.hash,expected));}
 async function read(name,args,block){return atomicEvidenceInterface.decodeFunctionResult(name,await provider.call({to:target.escrow,data:atomicEvidenceInterface.encodeFunctionData(name,args),blockTag:block}))[0];}
 return {...baseChain,atomicFundingEnabled:pins.length>0,
 async verifyAtomicAccount(wallet){const final=await context(),proof=await account(wallet,final.blockNumber);await canonical(final.blockNumber,final.blockHash);return {...proof,wallet:wallet.toLowerCase(),chainId:target.chainId,finalized:true,blockNumber:final.blockNumber};},
 async verifyAtomicExpiry(op){
  try{check(op.mode==='atomic'&&Number.isSafeInteger(op.expiresAt)&&op.expiresAt>0);const final=await context();check(final.timestamp>op.expiresAt);const requestId=chainReference(op.id),request=await read('getRequest',[op.wallet,requestId],final.blockNumber);check(request.exists===false&&BigInt(request.payloadHash)===0n&&BigInt(request.result)===0n);await canonical(final.blockNumber,final.blockHash);return {verified:true,finalized:true,absent:true,wallet:op.wallet,requestId,chainId:target.chainId,escrow:target.escrow,expiresAt:op.expiresAt,chainTime:final.timestamp,blockNumber:final.blockNumber,blockHash:final.blockHash};}catch{return {verified:false};}
 },
 async verifyAtomicFunding(op,{transactionHashes}){
  try{
   check(Array.isArray(transactionHashes)&&transactionHashes.length===1&&hash(transactionHashes[0]));const final=await context(),h=transactionHashes[0];const [tx,r]=await Promise.all([provider.getTransaction(h),provider.getTransactionReceipt(h)]);check(tx&&r&&Number.isSafeInteger(r.blockNumber)&&r.blockNumber>0&&r.blockNumber<=final.blockNumber);
   check(same(tx.hash,h)&&same(r.hash||r.transactionHash,h)&&same(tx.from,op.wallet)&&same(tx.to,op.wallet)&&same(r.from,tx.from)&&same(r.to,tx.to)&&tx.chainId===BigInt(target.chainId)&&tx.value===0n&&tx.data===atomicCalldata(atomicCalls(op,target)));
   check(r.status===1&&r.blockNumber===tx.blockNumber&&same(r.blockHash,tx.blockHash)&&hash(r.blockHash)&&Number.isSafeInteger(index(r))&&index(r)>=0&&index(tx)===index(r)&&Number.isSafeInteger(tx.nonce)&&tx.nonce>=0);
   const block=await provider.getBlock(r.blockNumber,true),priorBlock=await provider.getBlock(r.blockNumber-1);check(block?.number===r.blockNumber&&same(block.hash,r.blockHash)&&Number.isSafeInteger(block.timestamp)&&block.timestamp<op.expiresAt&&priorBlock?.number===r.blockNumber-1&&hash(priorBlock.hash)&&same(block.parentHash,priorBlock.hash));
   const atReceipt=await account(op.wallet,r.blockNumber),prior=await account(op.wallet,r.blockNumber-1);check(atReceipt.verified&&prior.verified&&same(atReceipt.codeHash,op.atomicAccount.codeHash)&&same(prior.codeHash,op.atomicAccount.codeHash));
   // A later account upgrade must not prevent recovery of an already final payment.
   // At the payment block, however, any delegation authorization invalidates this conservative proof.
   check(Array.isArray(block.transactions)&&block.transactions.length<=4096&&same(typeof block.transactions[index(tx)]==='string'?block.transactions[index(tx)]:block.transactions[index(tx)]?.hash,h));
   let prefetched;try{prefetched=block.prefetchedTransactions;}catch{}
   for(let i=0;i<block.transactions.length;i++){const entry=block.transactions[i],id=typeof entry==='string'?entry:entry.hash,item=prefetched?.[i]??(typeof entry==='object'?entry:await provider.getTransaction(id));check(item&&same(item.hash,id)&&item.blockNumber===r.blockNumber&&same(item.blockHash,r.blockHash)&&index(item)===i);for(const a of item.authorizationList||[])check(!same(verifyAuthorization(a,a.signature),op.wallet));}
   const transfers=[],approvals=[],funds=[],requests=[];let last=-1;
   for(const log of r.logs){const li=log.index??log.logIndex;check(log.removed!==true&&log.blockNumber===r.blockNumber&&same(log.blockHash,r.blockHash)&&same(log.transactionHash,h)&&log.transactionIndex===index(r)&&Number.isSafeInteger(li)&&li>last);last=li;let e;try{if(same(log.address,target.asset))e=token.parseLog(log);else if(same(log.address,target.escrow)){try{e=fundingInterface.parseLog(log);}catch{}if(!e)e=atomicEvidenceInterface.parseLog(log);}}catch{}if(e?.name==='Transfer')transfers.push({args:e.args,index:li});if(e?.name==='Approval')approvals.push({args:e.args,index:li});if(e?.name==='Funded')funds.push({args:e.args,index:li});if(e?.name==='RequestCompleted')requests.push({args:e.args,index:li});}
   const requestId=chainReference(op.id),expectedBatch=await read('requestKey',[op.wallet,requestId],r.blockNumber),payloadHash=keccak256(abi.encode(['bytes4',requestType],[fundingInterface.getFunction('fund').selector,fundingArguments(op)]));
   const completed=await read('getRequest',[op.wallet,requestId],r.blockNumber),batch=await read('getBatch',[expectedBatch],r.blockNumber);check(completed.exists&&same(completed.payloadHash,payloadHash)&&same(completed.result,expectedBatch));
   check(transfers.length===1&&funds.length===1&&requests.length===1);const transfer=transfers[0],fund=funds[0],request=requests[0];
   check(approvals.some(a=>same(a.args.owner,op.wallet)&&same(a.args.spender,target.escrow)&&a.args.value===BigInt(op.amount)&&a.index<request.index));
   check(same(transfer.args.from,op.wallet)&&same(transfer.args.to,target.escrow)&&transfer.args.value===BigInt(op.amount)&&request.index<transfer.index&&transfer.index<fund.index);
   check(same(request.args.requestKey,expectedBatch)&&same(request.args.caller,op.wallet)&&same(request.args.payloadHash,payloadHash)&&same(request.args.result,expectedBatch));
   check(same(fund.args.batchId,expectedBatch));for(const value of [fund.args,batch])check(same(value.storeId,chainReference(op.storeId))&&same(value.mealId,chainReference(op.mealId))&&same(value.payer,op.wallet)&&value.version===BigInt(op.version)&&same(value.termsHash,op.termsHash)&&value.quantity===BigInt(op.quantity)&&value.unitPrice===BigInt(op.unitPrice)&&value.amount===BigInt(op.amount));
   check(batch.fundedAt===BigInt(block.timestamp));await canonical(priorBlock.number,priorBlock.hash);await canonical(r.blockNumber,r.blockHash);await canonical(final.blockNumber,final.blockHash);
   return {verified:true,finalized:true,outcome:'CONFIRMED',batchId:expectedBatch,txHash:h,blockNumber:r.blockNumber,blockHash:r.blockHash,wallet:op.wallet,amount:op.amount,quantity:op.quantity,termsHash:op.termsHash};
  }catch{return {verified:false};}
 }};
}
