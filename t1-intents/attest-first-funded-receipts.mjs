// Independent, public Monad Testnet read-only post-funding proof.
// No private keys, automatic transactions, cookies, Admin DSNs or signing.
import assert from 'node:assert/strict';
import {Interface,TypedDataEncoder,verifyTypedData,keccak256} from 'ethers';
import {makeReadOnlyPublicRpc} from './testnet-readonly-rpc.mjs';
import {CHAIN,ESCROW,TOKEN,MEAL,TERMS,QUOTE,PRICE,erc20,escrowAbi,quoteTypes,signatureDomain} from './core.mjs';
import {ERC20,ESCROW_ABI} from './receipt.mjs';
import {assertRealT0IsOpen} from './testnet-funding-chain.mjs';

const APPROVE='0x0b5ef56afe4e8ffcba6349b7893929231213a130896a7810d5f428723b4a218d';
const FUND='0x6d241844fc0edda40af1c30eceab11ac0b95057337218de21e0c4026954ce219';
const QUOTE_ID='0xd19b6ca862dc452dd13246bac6faba2d024ba7c59add7e614c6d3b9b54421e12';
const DIGEST='0xad03e29d0d3b8e97f73710822961c5162cde1cdcfc4b034b63c1a566fb14a31a';
const FINGERPRINT='0x5ec41ebeb6899d36393b9a4ecdfc1c66b7e6b15f21b39652ab1b2a629111a885';
const reference={
 approve:{block:73410402n,hash:'0x65e25481798e882a51c96cd07457639566d4047d5c595c189c60419d67857dd3'},
 fund:{block:73410628n,hash:'0xe90a0e084d9b83e6063c04a2e831158d53173c77c6cd2e240551257587c80b9e'}
};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const hx=n=>'0x'+BigInt(n).toString(16);
const rpc=makeReadOnlyPublicRpc({intervalMs:450,timeoutMs:15000});
const escrowState=new Interface(['function lifetimeFundedUnits() view returns (uint256)']);
async function call(to,iface,name,args,tag){
 const raw=await rpc.send('eth_call',[{to,data:iface.encodeFunctionData(name,args)},tag]);
 return iface.decodeFunctionResult(name,raw);
}
function events(receipt,to,abi,name){
 return receipt.logs.flatMap(log=>{
  if(!same(log.address,to))return [];
  try{const x=abi.parseLog(log);return x?.name===name?[x.args]:[];}
  catch{return []}
 });
}
async function load(kind,hash,recipient,nonce){
 const [tx,receipt]=await Promise.all([
  rpc.send('eth_getTransactionByHash',[hash]),
  rpc.send('eth_getTransactionReceipt',[hash])
 ]);
 assert.ok(tx&&receipt,'ORIGINAL_ONCHAIN_RECEIPT_REQUIRED');
 assert.ok(same(tx.hash,hash)&&same(receipt.transactionHash,hash));
 assert.ok(same(tx.from,QUOTE)&&same(receipt.from,QUOTE));
 assert.ok(same(tx.to,recipient)&&same(receipt.to,recipient));
 assert.equal(BigInt(tx.nonce),nonce);
 assert.equal(BigInt(tx.value),0n);
 assert.equal(BigInt(receipt.status),1n);
 assert.equal(BigInt(receipt.blockNumber),reference[kind].block);
 assert.equal(BigInt(tx.blockNumber),reference[kind].block);
 assert.ok(same(receipt.blockHash,reference[kind].hash)&&same(tx.blockHash,receipt.blockHash));
 const block=await rpc.send('eth_getBlockByNumber',[hx(receipt.blockNumber),false]);
 assert.ok(same(block?.hash,receipt.blockHash),'NONCANONICAL_ONCHAIN_RECEIPT');
 if(tx.chainId!==undefined&&tx.chainId!==null)assert.equal(BigInt(tx.chainId),10143n);
 return {tx,receipt};
}
async function prove(){
 assert.equal(CHAIN,10143);assert.equal(PRICE,7000000n);
 const [chain,height]=await Promise.all([rpc.send('eth_chainId',[]),rpc.send('eth_blockNumber',[])]);
 assert.equal(BigInt(chain),10143n);
 assert.ok(BigInt(height)>reference.fund.block+1n);
 const a=await load('approve',APPROVE,TOKEN,7n);
 const approved=erc20.parseTransaction({data:a.tx.input});
 assert.equal(approved?.name,'approve');
 assert.ok(same(approved.args[0],ESCROW));
 assert.equal(approved.args[1],PRICE);
 assert.equal(events(a.receipt,TOKEN,ERC20,'Approval').filter(
  x=>same(x.owner,QUOTE)&&same(x.spender,ESCROW)&&x.value===PRICE).length,1);
 const granted=await call(TOKEN,ERC20,'allowance',[QUOTE,ESCROW],hx(reference.approve.block));
 assert.ok(granted[0]>=PRICE,'ONCHAIN_ALLOWANCE_NOT_PROVEN');

 const f=await load('fund',FUND,ESCROW,8n);
 const decoded=escrowAbi.parseTransaction({data:f.tx.input});
 assert.equal(decoded?.name,'fund');
 const q=decoded.args[0],signature=decoded.args[1];
 assert.ok(same(q.quoteId,QUOTE_ID)&&same(q.payer,QUOTE)&&
  same(q.mealId,MEAL)&&same(q.termsHash,TERMS));
 assert.equal(q.currentVersion,1n);assert.equal(q.quantity,1n);
 assert.equal(q.unitPrice,PRICE);assert.equal(q.amount,PRICE);
 const quote={
  quoteId:q.quoteId,payer:q.payer,mealId:q.mealId,currentVersion:q.currentVersion,
  termsHash:q.termsHash,quantity:q.quantity,unitPrice:q.unitPrice,
  amount:q.amount,deadline:q.deadline
 };
 assert.ok(same(TypedDataEncoder.hash(signatureDomain,quoteTypes,quote),DIGEST));
 assert.ok(same(verifyTypedData(signatureDomain,quoteTypes,quote,signature),QUOTE));
 assert.ok(same(keccak256(signature),FINGERPRINT));
 const funded=events(f.receipt,ESCROW,ESCROW_ABI,'Funded');
 assert.equal(funded.length,1);
 const e=funded[0];
 assert.ok(same(e.quoteId,QUOTE_ID)&&same(e.payer,QUOTE)&&
  same(e.mealId,MEAL)&&same(e.termsHash,TERMS));
 assert.equal(e.version,1n);assert.equal(e.quantity,1n);
 assert.equal(e.unitPrice,PRICE);assert.equal(e.amount,PRICE);
 assert.equal(events(f.receipt,TOKEN,ERC20,'Transfer').filter(
  x=>same(x.from,QUOTE)&&same(x.to,ESCROW)&&x.value===PRICE).length,1);
 const tag=hx(reference.fund.block);
 const [used,liability,balance,units,donorBalance]=await Promise.all([
  call(ESCROW,ESCROW_ABI,'quoteUses',[QUOTE_ID],tag),
  call(ESCROW,ESCROW_ABI,'liability',[],tag),
  call(TOKEN,ERC20,'balanceOf',[ESCROW],tag),
  call(ESCROW,escrowState,'lifetimeFundedUnits',[],tag),
  call(TOKEN,ERC20,'balanceOf',[QUOTE],tag)
 ]);
 assert.ok(same(used.batchId,e.batchId));
 assert.ok(!same(used.batchId,'0x'+'0'.repeat(64))&&
  !same(used.payloadHash,'0x'+'0'.repeat(64)));
 assert.equal(units[0],1n);
 assert.ok(liability[0]>=PRICE&&balance[0]>=liability[0]);
 const latest=await assertRealT0IsOpen({rpc,payer:QUOTE});
 assert.ok(BigInt(latest.unitsFunded)>=1n);
 console.log(JSON.stringify({
  status:'T1D_FIRST_REAL_TESTNET_FUND_INDEPENDENT_CHAIN_PASS',
  chainId:10143,approveTx:APPROVE,approveNonce:7,
  approveBlock:reference.approve.block.toString(),fundTx:FUND,fundNonce:8,
  fundBlock:reference.fund.block.toString(),quoteId:QUOTE_ID,
  quoteSignatureVerified:true,approveEventVerified:true,
  fundTransferEventVerified:true,fundedEventVerified:true,
  usedOriginalQuoteId:true,
  lifetimeFundedUnitsAtReceipt:units[0].toString(),
  escrowLiabilityBaseUnits:liability[0].toString(),
  escrowUSDCBaseUnits:balance[0].toString(),
  donorUSDCBaseUnitsAtFund:donorBalance[0].toString(),
  escrowSolventAtReceipt:true,latestBlock:latest.blockNumber,
  transactionsBroadcast:0
 }));
}
try{await prove()}catch(e){
 const msg=e instanceof Error?e.message:'UNKNOWN';
 console.error(/^[A-Z_0-9]+$/.test(msg)?msg:'READ_ONLY_CHAIN_VERIFICATION_FAILED');
 process.exitCode=1;
}
