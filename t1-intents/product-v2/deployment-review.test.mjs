import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {ContractFactory,keccak256,getCreateAddress,Interface} from 'ethers';
import {TARGET,makeReview,normalizedRuntime,assertDeploymentTransaction,reviewConfiguration,reserveReview} from './deployment-review.mjs';
const artifact=JSON.parse(await readFile(new URL('../../mvp-contracts/out/ProductEscrow.sol/ProductEscrow.json',import.meta.url),'utf8'));
const {data}=await new ContractFactory(artifact.abi,artifact.bytecode.object).getDeployTransaction(TARGET.asset,TARGET.claimAuthority,TARGET.redemptionAuthority,TARGET.policySeconds);
const hash='0x'+'1'.repeat(64);
const tx={to:null,from:TARGET.deployer,chainId:10143n,value:0n,data,nonce:0,gasLimit:5000000n,gasPrice:100n,hash,blockNumber:9,blockHash:'block'};
const attempt={nonce:'0x0',dataHash:keccak256(data),gas:'0x4c4b40',gasPrice:'0x64'};
const receipt={status:1,contractAddress:getCreateAddress({from:tx.from,nonce:0}),blockNumber:9,blockHash:'block',hash,from:tx.from,to:null,gasUsed:4000000n,gasPrice:100n};
test('only exact creation transaction from designated testnet wallet is accepted',()=>{
  assertDeploymentTransaction(tx,data);
  for(const change of [{to:TARGET.asset},{from:TARGET.claimAuthority},{chainId:1n},{value:1n},{data:data+'00'}])
    assert.throws(()=>assertDeploymentTransaction({...tx,...change},data),/NOT_EXPECTED_DEPLOYMENT/);
});
test('runtime normalization changes only compiler-declared immutable bytes',()=>{
  const refs={1:[{start:1,length:2}]};
  assert.equal(normalizedRuntime('0xaabbccdd',refs),'aa0000dd');
  assert.notEqual(normalizedRuntime('0xaabbccdd',refs),normalizedRuntime('0xabbbccdd',refs));
  assert.throws(()=>normalizedRuntime('0xaa',refs),/INVALID_IMMUTABLE/);
});
test('unpinned artifact cannot create review data',async()=>{
  await assert.rejects(makeReview({}, {...artifact,bytecode:{object:'0x00'}}),/UNPINNED/);
});
test('preflight rejects wrong network before making any other call',async()=>{
  const calls=[];const review=await makeReview({send:async(method)=>{calls.push(method);return '0x1';}},artifact);
  await assert.rejects(review.preflight(),/WRONG_CHAIN/);assert.deepEqual(calls,['eth_chainId']);
});
test('preflight rejects changed asset code before gas estimation',async()=>{
  const calls=[];const review=await makeReview({send:async(method)=>{calls.push(method);return method==='eth_chainId'?'0x279f':method==='eth_getBlockByNumber'?{hash:'0x123',number:'0x1'}:'0x00';}},artifact);
  await assert.rejects(review.preflight(),/ASSET_CODE_CHANGED/);assert.ok(!calls.includes('eth_estimateGas'));
});
test('verification requires final successful creation, not just a transaction hash',async()=>{
  const provider={send:async()=> '0x279f',getTransaction:async()=>tx,getTransactionReceipt:async()=>({status:1,contractAddress:TARGET.asset,blockNumber:11}),getBlock:async()=>({number:10})};
  const review=await makeReview(provider,artifact);
  await assert.rejects(review.verify(hash,attempt),/NOT_FINAL_SUCCESS/);
  provider.getTransactionReceipt=async()=>({status:0,contractAddress:TARGET.asset,blockNumber:9});
  await assert.rejects(review.verify(hash,attempt),/NOT_FINAL_SUCCESS/);
});
test('verification rejects receipt from a noncanonical block',async()=>{
  const provider={send:async()=> '0x279f',getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt,getBlock:async(n)=>n==='finalized'?{number:10}:{hash:'new'}};
  await assert.rejects((await makeReview(provider,artifact)).verify(hash,attempt),/NON_CANONICAL/);
});
function finalizedProvider(overrides={}) {
  const abi=new Interface(artifact.abi);
  return {
    send:async(method,args)=>{
      if(method==='eth_chainId')return '0x279f';
      if(method==='eth_getCode')return artifact.deployedBytecode.object;
      if(method==='eth_call'){const name=abi.parseTransaction({data:args[0].data}).name;return abi.encodeFunctionResult(name,[TARGET[name]]);}
      throw Error('Unexpected RPC');
    },
    getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt,
    getBlock:async(n)=>n==='finalized'||n===10?{number:10,hash:'final'}:{number:9,hash:'block'},...overrides,
  };
}
test('exact final deployment produces public manifest with verified code hash',async()=>{
  const result=await (await makeReview(finalizedProvider(),artifact)).verify(hash,attempt);
  assert.equal(result.escrow,receipt.contractAddress);assert.equal(result.escrowCodeHash,keccak256(artifact.deployedBytecode.object));
  assert.equal(result.policySeconds,7200);assert.equal(result.transactionHash,hash);
});
test('verification requires original reservation, nonce and fee budget',async()=>{
  const review=await makeReview(finalizedProvider(),artifact);
  await assert.rejects(review.verify(hash,null),/MISSING_ORIGINAL/);
  for(const patch of [{nonce:'0x1'},{gas:'0x1'},{gasPrice:'0x1'}])await assert.rejects(review.verify(hash,{...attempt,...patch}),/ORIGINAL_REVIEW_MISMATCH/);
});
test('receipt must belong to exact transaction and derived deployment address',async()=>{
  for(const patch of [{hash:'other'},{from:TARGET.asset},{to:TARGET.asset},{contractAddress:TARGET.asset},{blockNumber:8},{gasPrice:101n}]){
    const review=await makeReview(finalizedProvider({getTransactionReceipt:async()=>({...receipt,...patch})}),artifact);
    await assert.rejects(review.verify(hash,attempt),/RECEIPT_MISMATCH/);
  }
});
test('runtime metadata drift cannot weaken code verification',async()=>{
  const changed=structuredClone(artifact);changed.deployedBytecode.immutableReferences={};
  await assert.rejects(makeReview({},changed),/UNPINNED_VERIFICATION/);
});
test('wrong deployed authorities and changed finality both fail verification',async()=>{
  const provider=finalizedProvider(),original=provider.send;
  provider.send=async(method,args)=>method==='eth_call'?'0x'+'0'.repeat(64):original(method,args);
  await assert.rejects((await makeReview(provider,artifact)).verify(hash,attempt),/WRONG_CONSTRUCTOR/);
  const reorg=finalizedProvider({getBlock:async(n)=>n==='finalized'?{number:10,hash:'final'}:n===10?{number:10,hash:'changed'}:{number:9,hash:'block'}});
  await assert.rejects((await makeReview(reorg,artifact)).verify(hash,attempt),/FINALITY_CHANGED/);
});
test('existing attempt can reopen recovery without new gas, balance or pending nonce checks',async()=>{
  const review=await makeReview({send:async()=>{throw Error('RPC unavailable or balance too low to deploy again');}},artifact);
  const restored=await reviewConfiguration(review,attempt);
  assert.equal(restored.nonce,attempt.nonce);assert.equal(restored.attempt,attempt);assert.equal(restored.dataHash,attempt.dataHash);
  await assert.rejects(reviewConfiguration(review,null),/RPC unavailable/);
});
test('concurrent reservation admits exactly one wallet attempt and survives reopen',async()=>{
  const dir=await mkdtemp(tmpdir()+'/mealforward-deployment-reserve-'),path=pathToFileURL(dir+'/attempt.json');
  try {
    const outcomes=await Promise.allSettled([reserveReview(path,attempt),reserveReview(path,{...attempt,nonce:'0x2'})]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'EEXIST');
    const original=JSON.parse(await readFile(path,'utf8'));
    await assert.rejects(reserveReview(path,attempt),{code:'EEXIST'});
    assert.deepEqual(JSON.parse(await readFile(path,'utf8')),original);
  } finally {await rm(dir,{recursive:true});}
});
