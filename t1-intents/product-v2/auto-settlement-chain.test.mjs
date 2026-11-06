/** Disposable real Anvil + real V3 + MEMORY transaction store. No public RPC or existing keys. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {ContractFactory,JsonRpcProvider,Wallet,keccak256,parseEther} from 'ethers';
import {makeProductChain} from './chain-adapter.mjs';
import {makeAutoSettlement,settlementKey} from './auto-settlement.mjs';
import {chainReference} from './funding-wire.mjs';
import {redemptionDomain,redemptionTypes} from './redemption-wire.mjs';
const artifact=async(name,file=name)=>JSON.parse(await readFile(new URL(`../../mvp-contracts/out/${file}.sol/${name}.json`,import.meta.url),'utf8'));

test('real V3 automatic settlement, helper multi-settlement, and manual-wins platform revert recovery',{timeout:120000},async()=>{
 const root=await mkdtemp(tmpdir()+'/mf-auto-chain-');let child,provider;
 try{
  await mkdir(root+'/src');await writeFile(root+'/src/BatchHelper.sol','// SPDX-License-Identifier: MIT\npragma solidity 0.8.28; interface Escrow { function settle(bytes32,bytes32,uint256) external; } contract BatchHelper { function settleTwo(address escrow,bytes32 a,bytes32 b) external { Escrow(escrow).settle(keccak256(abi.encode(a)),a,1); Escrow(escrow).settle(keccak256(abi.encode(b)),b,1); } }');
  execFileSync('forge',['build','--root',root,'--contracts','src','--use','0.8.28','--offline'],{stdio:'pipe'});
  const helperArtifact=JSON.parse(await readFile(root+'/out/BatchHelper.sol/BatchHelper.json','utf8'));
  const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  child=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--slots-in-an-epoch','1','--silent'],{stdio:'ignore'});let spawnError;child.on('error',e=>spawnError=e);
  for(let i=0;i<100;i++){if(spawnError)throw Error('ANVIL_START_FAILED');try{const r=await fetch(`http://127.0.0.1:${port}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});assert.equal((await r.json()).result,'0x7a69');break;}catch{if(i===99)throw Error('ANVIL_NOT_READY');await new Promise(r=>setTimeout(r,20));}}
  provider=new JsonRpcProvider(`http://127.0.0.1:${port}`,31337,{cacheTimeout:-1,pollingInterval:10});
  const finalize=()=>provider.send('anvil_mine',['0x2','0x0']),now=async()=>Number((await provider.getBlock('latest')).timestamp);
  const merchant=await provider.getSigner(0),donor=await provider.getSigner(1),other=await provider.getSigner(8),owner=(await merchant.getAddress()).toLowerCase();
  const platform=Wallet.createRandom().connect(provider),verifier=Wallet.createRandom();await (await merchant.sendTransaction({to:platform.address,value:parseEther('2')})).wait();
  const ta=await artifact('AcceptanceTestAsset'),ea=await artifact('ProductEscrowV3');
  const token=await new ContractFactory(ta.abi,ta.bytecode.object,merchant).deploy();await token.waitForDeployment();
  const escrow=await new ContractFactory(ea.abi,ea.bytecode.object,merchant).deploy(await token.getAddress(),platform.address,verifier.address,7200);await escrow.waitForDeployment();
  const deploymentBlock=(await escrow.deploymentTransaction().wait()).blockNumber,E=(await escrow.getAddress()).toLowerCase(),T=(await token.getAddress()).toLowerCase();
  const helper=await new ContractFactory(helperArtifact.abi,helperArtifact.bytecode.object,other).deploy();await helper.waitForDeployment();
  const sid=chainReference('kitchen'),mid=chainReference('meal'),price=7000000n,terms={unitPrice:price,bodyDigest:chainReference('body'),imageDigest:chainReference('image'),windowCount:1,startMinute0:0,endMinute0:1440,startMinute1:0,endMinute1:0};
  await (await escrow.registerStore(chainReference('register'),sid)).wait();await (await escrow.publish(chainReference('publish'),sid,mid,0,terms,4,(await now())+86400)).wait();
  const termsHash=(await escrow.getTerms(sid,mid,1)).termsHash;await (await token.mint(await donor.getAddress(),price*4n)).wait();await (await token.connect(donor).approve(E,price*4n)).wait();
  await (await escrow.connect(donor).fund({requestId:chainReference('fund'),storeId:sid,mealId:mid,version:1,termsHash,quantity:4,expectedAmount:price*4n,deadline:(await now())+600})).wait();
  const batch=await escrow.requestKey(await donor.getAddress(),chainReference('fund'));
  let state={vouchers:{},claims:{},intents:{},publications:{},autoSettlements:{}},tail=Promise.resolve();const store={read:async()=>structuredClone(state),transact(fn){const run=tail.then(async()=>{const s=structuredClone(state),r=await fn(s);state=s;return structuredClone(r);});tail=run.catch(()=>{});return run;}};
  const manifest={chainId:31337,contractVersion:3,escrow:E,asset:T,claimAuthority:platform.address,redemptionAuthority:verifier.address,policySeconds:7200,assetDecimals:6,deploymentBlock,escrowCodeHash:keccak256(await provider.getCode(E)),assetCodeHash:keccak256(await provider.getCode(T)),maxFeePerGas:'10000000000',maxTransactionFee:'100000000000000000',claimGasLimit:'1000000',settlementGasLimit:'1000000'};
  const chain=makeProductChain({provider,manifest,store,claimSigner:platform,redemptionSigner:verifier,profile:'local-acceptance'});await finalize();assert.equal((await chain.verifyTarget()).verified,true);
  const vouchers=[];for(let i=0;i<4;i++){const recipient=(await (await provider.getSigner(i+2)).getAddress()).toLowerCase();await (await escrow.connect(platform).claim(chainReference('claim-'+i),batch,i,1,recipient)).wait();const vId=(await escrow.getUnit(batch,i)).voucherId;const issuedAt=await now(),permit={voucherId:vId,generation:1,owner,issuedAt,deadline:issuedAt+120};const signature=await verifier.signTypedData(redemptionDomain(chain.target),redemptionTypes,permit);await (await escrow.redeem(chainReference('redeem-'+i),vId,1,permit,signature)).wait();vouchers.push(vId);await store.transact(s=>{s.vouchers[vId]={id:vId,batchId:batch,unitIndex:String(i),generation:1,wallet:recipient,storeId:'kitchen',mealId:'meal',termsHash,state:'HANDED_OVER'};});}
  await finalize();let clock=await now();const auto=makeAutoSettlement({store,chain,clock:()=>clock});await auto.scan();assert.equal(Object.keys(state.autoSettlements).length,4);assert.equal(await auto.signNext(),null,'180 second delay enforced');
  await provider.send('evm_increaseTime',[181]);await provider.send('evm_mine',[]);await finalize();clock=await now();const timing=await chain.voucherState(state.vouchers[vouchers[0]]);assert.ok(timing.chainTime>=timing.settlementAvailableAt,JSON.stringify({chain:timing.chainTime,ready:timing.settlementAvailableAt}));const before=await token.balanceOf(owner);
  const first=await auto.signNext();assert.ok(first,'worker must sign eligible task');assert.equal(first.voucherId,vouchers[0]);const key=id=>settlementKey(chain.target,{id,generation:1});await auto.dispatch(key(vouchers[0]));await finalize();await auto.reconcile(key(vouchers[0]));assert.equal(state.autoSettlements[key(vouchers[0])].state,'CONFIRMED');assert.equal(await token.balanceOf(owner),before+price);
  const helperReceipt=await (await helper.settleTwo(E,vouchers[1],vouchers[2])).wait();await finalize();for(const id of vouchers.slice(1,3)){for(let i=0;i<20&&state.autoSettlements[key(id)].state!=='CONFIRMED';i++)await auto.reconcile(key(id));assert.equal(state.autoSettlements[key(id)].state,'CONFIRMED');assert.equal(state.autoSettlements[key(id)].txHash,helperReceipt.hash);}assert.equal(await token.balanceOf(owner),before+3n*price);
  const race=await auto.signNext();assert.equal(race.voucherId,vouchers[3]);const originalHash=race.txHash;const manual=await (await escrow.connect(other).settle(chainReference('manual-race'),vouchers[3],1)).wait();await finalize();await auto.dispatch(key(vouchers[3]));await finalize();await auto.reconcile(key(vouchers[3]));assert.equal(state.autoSettlements[key(vouchers[3])].state,'REVERTED');assert.equal((await provider.getTransactionReceipt(originalHash)).status,0);
  for(let i=0;i<20&&state.autoSettlements[key(vouchers[3])].state!=='CONFIRMED';i++)await auto.reconcile(key(vouchers[3]));assert.equal(state.autoSettlements[key(vouchers[3])].state,'CONFIRMED');assert.equal(state.autoSettlements[key(vouchers[3])].txHash,manual.hash);assert.equal(await token.balanceOf(owner),before+4n*price);assert.equal((await escrow.accounting()).settledQuantity,4n);assert.equal(await auto.signNext(),null);
 }finally{provider?.destroy();if(child&&!child.killed){child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(r,1000).unref();});}await rm(root,{recursive:true,force:true});}
});
