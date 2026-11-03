/** Real disposable Anvil transactions with a synthetic EIP-7702 account and a TEST-ONLY
 * ERC-7579 execute(mode,calldata) fixture. This is NOT MetaMask acceptance, an official
 * implementation audit, a production allowlist entry, or a public-chain deployment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {ContractFactory,JsonRpcProvider,Wallet,keccak256,parseEther,toUtf8Bytes} from 'ethers';
import {makeProductChain} from './chain-adapter.mjs';
import {makeAtomicChain} from './atomic-chain.mjs';
import {atomicCalls,atomicCalldata} from './atomic-wire.mjs';
import {chainReference} from './funding-wire.mjs';
const artifact=async name=>JSON.parse(await readFile(new URL(`../../mvp-contracts/out/${name}.sol/${name}.json`,import.meta.url),'utf8'));

test('synthetic EIP-7702 self batch: real atomic proof, rollback, original payer and funding index',{timeout:120000},async()=>{
 const root=await mkdtemp(tmpdir()+'/mf-atomic-chain-');let child,provider;
 try{
  await mkdir(root+'/src');await writeFile(root+'/src/TestBatchAccount.sol',`// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
// TEST ONLY: mimics only self-authorized batch mode, not the official MetaMask runtime.
contract TestBatchAccount {
 struct Execution { address target; uint256 value; bytes callData; }
 function execute(bytes32 mode, bytes calldata encoded) external payable {
  require(msg.sender == address(this), "SELF_ONLY");
  require(mode == bytes32(uint256(1) << 248), "BATCH_DEFAULT_ONLY");
  Execution[] memory calls = abi.decode(encoded, (Execution[]));
  for (uint256 i; i < calls.length; ++i) {
   (bool success, bytes memory result) = calls[i].target.call{value:calls[i].value}(calls[i].callData);
   if (!success) assembly { revert(add(result, 32), mload(result)) }
  }
 }
}`);
  execFileSync('forge',['build','--root',root,'--contracts','src','--use','0.8.28','--offline'],{stdio:'pipe'});
  const fixtureArtifact=JSON.parse(await readFile(root+'/out/TestBatchAccount.sol/TestBatchAccount.json','utf8'));
  const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  child=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--slots-in-an-epoch','1','--silent'],{stdio:'ignore'});let spawnError;child.on('error',e=>spawnError=e);
  for(let i=0;i<100;i++){if(spawnError)throw Error('ANVIL_START_FAILED');try{const r=await fetch(`http://127.0.0.1:${port}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});assert.equal((await r.json()).result,'0x7a69');break;}catch{if(i===99)throw Error('ANVIL_NOT_READY');await new Promise(r=>setTimeout(r,20));}}
  provider=new JsonRpcProvider(`http://127.0.0.1:${port}`,31337,{cacheTimeout:-1,pollingInterval:10});
  const finalize=()=>provider.send('anvil_mine',['0x2','0x0']),now=async()=>Number((await provider.getBlock('latest')).timestamp);
  const merchant=await provider.getSigner(0),owner=(await merchant.getAddress()).toLowerCase();
  const donor=Wallet.createRandom().connect(provider),platform=Wallet.createRandom().connect(provider),verifier=Wallet.createRandom();
  await (await merchant.sendTransaction({to:donor.address,value:parseEther('2')})).wait();
  const ta=await artifact('AcceptanceTestAsset'),ea=await artifact('ProductEscrowV3');
  const token=await new ContractFactory(ta.abi,ta.bytecode.object,merchant).deploy();await token.waitForDeployment();
  const escrow=await new ContractFactory(ea.abi,ea.bytecode.object,merchant).deploy(await token.getAddress(),platform.address,verifier.address,7200);await escrow.waitForDeployment();
  const deploymentBlock=(await escrow.deploymentTransaction().wait()).blockNumber,E=(await escrow.getAddress()).toLowerCase(),T=(await token.getAddress()).toLowerCase();
  const account=await new ContractFactory(fixtureArtifact.abi,fixtureArtifact.bytecode.object,merchant).deploy();await account.waitForDeployment();
  const implementation=(await account.getAddress()).toLowerCase();
  // Real EIP-7702 authorization, mined separately before the funding block. No setCode RPC.
  const authorization=await donor.authorize({address:implementation,chainId:31337,nonce:await provider.getTransactionCount(donor.address)});
  const delegated=await (await merchant.sendTransaction({to:owner,value:0n,authorizationList:[authorization],gasLimit:150000})).wait();
  assert.equal(delegated.status,1);assert.equal((await provider.getCode(donor.address)).toLowerCase(),'0xef0100'+implementation.slice(2));
  const sid=chainReference('kitchen'),mid=chainReference('meal'),price=7000000n,name='Synthetic test meal',description='Local chain only';
  const terms={unitPrice:price,bodyDigest:keccak256(toUtf8Bytes(JSON.stringify({name,description}))),imageDigest:chainReference('image'),windowCount:1,startMinute0:0,endMinute0:1440,startMinute1:0,endMinute1:0};
  const registered=await (await escrow.registerStore(chainReference('register'),sid)).wait();
  const published=await (await escrow.publish(chainReference('publish'),sid,mid,0,terms,10,(await now())+86400)).wait();
  const termsHash=(await escrow.getTerms(sid,mid,1)).termsHash;await (await token.mint(donor.address,price*10n)).wait();
  let state={publications:{registration:{kind:'registration',state:'CONFIRMED',storeId:'kitchen',wallet:owner,name:'Test kitchen',confirmedBlock:registered.blockNumber},publication:{kind:'publication',state:'CONFIRMED',storeId:'kitchen',mealId:'meal',wallet:owner,name,description,version:1,unitPrice:String(price),terms:{imageDigest:terms.imageDigest},termsHash,windows:[[0,1440]],confirmedBlock:published.blockNumber}},intents:{},claims:{},vouchers:{}},tail=Promise.resolve();
  const store={read:async()=>structuredClone(state),transact(fn){const run=tail.then(async()=>{const next=structuredClone(state),result=await fn(next);state=next;return structuredClone(result);});tail=run.catch(()=>{});return run;}};
  // This pin exists only inside this test process; it is NOT an approved MetaMask implementation.
  const pin={chainId:31337,execution:'metamask-delegator-self-erc7579-v1',implementation,codeHash:keccak256(await provider.getCode(implementation))};
  const manifest={chainId:31337,contractVersion:3,escrow:E,asset:T,claimAuthority:platform.address,redemptionAuthority:verifier.address,policySeconds:7200,assetDecimals:6,deploymentBlock,escrowCodeHash:keccak256(await provider.getCode(E)),assetCodeHash:keccak256(await provider.getCode(T)),maxFeePerGas:'10000000000',maxTransactionFee:'100000000000000000',claimGasLimit:'1000000',atomicImplementations:[pin]};
  const baseChain=makeProductChain({provider,manifest,store,claimSigner:platform,redemptionSigner:verifier,profile:'local-acceptance'}),chain=makeAtomicChain({provider,manifest,baseChain});
  await finalize();const proof=await chain.verifyAtomicAccount(donor.address);assert.equal(proof.verified,true);assert.equal(proof.finalized,true);assert.equal((await makeAtomicChain({provider,manifest:{...manifest,atomicImplementations:[]},baseChain}).verifyAtomicAccount(donor.address)).verified,false,'capability alone does not authorize an unpinned implementation');
  const operation={id:'atomic-original',kind:'support',mode:'atomic',wallet:donor.address.toLowerCase(),storeId:'kitchen',mealId:'meal',version:1,termsHash,unitPrice:String(price),quantity:'2',amount:String(price*2n),expiresAt:(await now())+600,atomicAccount:proof};
  const before=await token.balanceOf(donor.address),nativeNonce=await provider.getTransactionCount(donor.address);
  const sent=await donor.sendTransaction({to:donor.address,value:0n,data:atomicCalldata(atomicCalls(operation,chain.target)),gasLimit:1000000});const receipt=await sent.wait();assert.equal(receipt.status,1);assert.ok(receipt.blockNumber>delegated.blockNumber);await finalize();
  const evidence=await chain.verifyAtomicFunding(operation,{transactionHashes:[sent.hash]});assert.equal(evidence.verified,true);assert.equal(evidence.outcome,'CONFIRMED');assert.equal(evidence.batchId,await escrow.requestKey(donor.address,chainReference(operation.id)));
  assert.equal(await token.balanceOf(donor.address),before-price*2n);assert.equal(await token.allowance(donor.address,E),0n);assert.equal(await provider.getTransactionCount(donor.address),nativeNonce+1);assert.equal((await escrow.getBatch(evidence.batchId)).payer.toLowerCase(),donor.address.toLowerCase());
  // The independent index must recover the batch without a recorded application funding intent.
  for(let i=0;i<30&&!state.indexedBatches?.[evidence.batchId];i++)await chain.syncFundingIndex();assert.ok(state.indexedBatches[evidence.batchId]);assert.equal(state.indexedBatches[evidence.batchId].wallet,donor.address.toLowerCase());assert.equal(Object.keys(state.intents).length,0);
  const catalog=await chain.catalog();assert.equal(catalog.verified,true);assert.equal(catalog.meals[0].claimable,'2');assert.equal(catalog.meals[0].remaining,'8');
  // Fund fails after approve executes: invalid terms roll back approval, balance, batch and logs.
  const failed={...operation,id:'atomic-must-revert',termsHash:chainReference('wrong-terms'),quantity:'1',amount:String(price)};
  const balance=await token.balanceOf(donor.address),allowance=await token.allowance(donor.address,E),accounting=await escrow.accounting();
  const reverted=await donor.sendTransaction({to:donor.address,value:0n,data:atomicCalldata(atomicCalls(failed,chain.target)),gasLimit:1000000});let failedReceipt;try{await reverted.wait();assert.fail('fund must revert the batch');}catch(error){failedReceipt=error.receipt;assert.equal(failedReceipt?.status,0);}await finalize();
  assert.equal(failedReceipt.logs.length,0);assert.equal(await token.balanceOf(donor.address),balance);assert.equal(await token.allowance(donor.address,E),allowance);assert.equal((await escrow.getRequest(donor.address,chainReference(failed.id))).exists,false);assert.equal((await escrow.accounting()).fundedAmount,accounting.fundedAmount);assert.equal((await chain.verifyAtomicFunding(failed,{transactionHashes:[reverted.hash]})).verified,false);
  assert.equal((await chain.verifyAtomicFunding({...operation,wallet:owner},{transactionHashes:[sent.hash]})).verified,false,'original payer cannot be substituted');
 }finally{provider?.destroy();if(child&&!child.killed){child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(r,1000).unref();});}await rm(root,{recursive:true,force:true});}
});
