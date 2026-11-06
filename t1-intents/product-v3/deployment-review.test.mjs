import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {ContractFactory,Interface,keccak256,getCreateAddress} from 'ethers';
import {TARGET,makeReview,assertDeploymentTransaction,reserveReview,reviewConfiguration} from './deployment-review.mjs';
import {TARGET as OLD_TARGET} from '../product-v2/deployment-review.mjs';
import {startReview} from './review-server.mjs';
const artifact=JSON.parse(await readFile(new URL('../../mvp-contracts/out/ProductEscrowV3.sol/ProductEscrowV3.json',import.meta.url),'utf8'));
const code='0x6000',localTarget={...TARGET,chainId:31337,assetCodeHash:keccak256(code)},options={profile:'local-acceptance',localTarget};
const data=(await new ContractFactory(artifact.abi,artifact.bytecode.object).getDeployTransaction(TARGET.asset,TARGET.claimAuthority,TARGET.redemptionAuthority,7200)).data;
const H='0x'+'1'.repeat(64),B='0x'+'2'.repeat(64),F='0x'+'3'.repeat(64);
const attempt={nonce:'0x0',dataHash:keccak256(data),gas:'0x4c4b40',gasPrice:'0x78'};
function fixture(){
 const tx={hash:H,to:null,from:TARGET.deployer,chainId:31337n,value:0n,data,nonce:0,gasLimit:5000000n,gasPrice:120n,blockNumber:9,blockHash:B};
 const receipt={status:1,hash:H,from:TARGET.deployer,to:null,contractAddress:getCreateAddress({from:TARGET.deployer,nonce:0}),blockNumber:9,blockHash:B,gasUsed:4000000n,gasPrice:120n};
 const calls=[],abi=new Interface(artifact.abi),state={assetCode:code,runtime:artifact.deployedBytecode.object,fields:{...localTarget},chain:'0x7a69',pending:'0x0'};
 const provider={send:async(method,args)=>{calls.push({method,args});switch(method){
  case 'eth_chainId':return state.chain;
  case 'eth_getBlockByNumber':return {number:'0xa',hash:F};
  case 'eth_getCode':return args[0].toLowerCase()===TARGET.asset.toLowerCase()?state.assetCode:args[0].toLowerCase()===receipt.contractAddress.toLowerCase()?state.runtime:'0x';
  case 'eth_call':if(args[0].to.toLowerCase()===TARGET.asset.toLowerCase())return '0x'+('6').padStart(64,'0');return abi.encodeFunctionResult(abi.parseTransaction(args[0]).name,[state.fields[abi.parseTransaction(args[0]).name]]);
  case 'eth_getTransactionCount':return args[1]==='pending'?state.pending:'0x0';
  case 'eth_estimateGas':return '0x3d0900';
  case 'eth_gasPrice':return '0x64';
  case 'eth_getBalance':return '0x1bc16d674ec80000';
  default:throw Error('unexpected RPC '+method);
 }},getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt,getBlock:async n=>n==='finalized'||n===10?{number:10,hash:F}:{number:9,hash:B}};
 return {tx,receipt,state,provider,calls,review:()=>makeReview(provider,artifact,options)};
}
test('V3 target reuses fixed public keys but does not pretend old commit or address is V3',()=>{
 assert.equal(TARGET.deployer,OLD_TARGET.deployer);assert.equal(TARGET.contractVersion,3);assert.equal(TARGET.chainId,10143);assert.equal(TARGET.policySeconds,7200);assert.equal(TARGET.escrow,undefined);assert.equal(TARGET.sourceCommit,undefined);
});
test('creation, ABI, runtime and immutable masks are pinned; V2 artifact cannot be reviewed',async()=>{
 for(const mutate of [a=>a.bytecode.object='0x00',a=>a.abi.pop(),a=>a.deployedBytecode.object='0x00',a=>a.deployedBytecode.immutableReferences={}]){const a=structuredClone(artifact);mutate(a);await assert.rejects(makeReview({},a),/UNPINNED/);}
 const old=JSON.parse(await readFile(new URL('../../mvp-contracts/out/ProductEscrow.sol/ProductEscrow.json',import.meta.url),'utf8'));await assert.rejects(makeReview({},old),/UNPINNED/);
});
test('local target requires explicit local profile and cannot override testnet pins',async()=>{
 await assert.rejects(makeReview({},artifact,{localTarget}),/LOCAL_TARGET_FORBIDDEN/);
 for(const change of [{chainId:10143},{policySeconds:259200},{claimAuthority:TARGET.deployer}])await assert.rejects(makeReview({},artifact,{...options,localTarget:{...localTarget,...change}}));
 const f=fixture();const review=await makeReview(f.provider,artifact);await assert.rejects(review.preflight(),/WRONG_CHAIN/);
});
test('preflight is read-only and bounds gas, nonce, role/code checks',async()=>{
 const f=fixture(),r=await (await f.review()).preflight();assert.equal(r.contractVersion,3);assert.equal(r.dataHash,attempt.dataHash);assert.equal(r.chainId,31337);assert.ok(f.calls.every(c=>!c.method.includes('sendTransaction')&&!c.method.includes('sign')));
 f.state.pending='0x1';await assert.rejects((await f.review()).preflight(),/PENDING/);
 f.state.assetCode='0x6001';await assert.rejects((await f.review()).preflight(),/ASSET_CODE_CHANGED/);
});
test('only exact nonce/creation/calldata/from/chain/value and fee budget are accepted',async()=>{
 const f=fixture();assertDeploymentTransaction({...f.tx,chainId:10143n},data);
 for(const patch of [{from:TARGET.asset},{to:TARGET.asset},{chainId:10143n},{value:1n},{data:data+'00'},{nonce:1},{gasLimit:5000001n},{gasPrice:121n}]){const g=fixture();Object.assign(g.tx,patch);await assert.rejects((await g.review()).verify(H,attempt));}
});
test('correct final receipt restores a public candidate manifest, without registry writes',async()=>{
 const f=fixture(),m=await (await f.review()).verify(H,attempt);assert.equal(m.contractVersion,3);
 const legacy=JSON.parse(await readFile(new URL('../product-v2/monad-deployment.json',import.meta.url),'utf8'));for(const key of ['maxFeePerGas','maxTransactionFee','claimGasLimit','assetDecimals'])assert.equal(m[key],legacy[key]);assert.equal(m.settlementGasLimit,'1000000');assert.equal(m.escrow,f.receipt.contractAddress);assert.equal(m.escrowCodeHash,keccak256(f.state.runtime));assert.equal(m.reviewStatus,'VERIFIED_CANDIDATE_NOT_APPROVED');assert.ok(!JSON.stringify(m).match(/privateKey|signature|session|csrf/));
});
test('recovery never needs new nonce, gas, balance or a fresh deploy preflight',async()=>{
 const review=await makeReview({send:async()=>{throw Error('must not call RPC');}},artifact,options);const r=await reviewConfiguration(review,attempt);assert.equal(r.attempt.dataHash,attempt.dataHash);assert.equal(r.deployer,TARGET.deployer);
 for(const patch of [{deployer:TARGET.asset},{chainId:1},{data:'0x00'},{gas:'0x0'},{gasPrice:'0xffffffffffffffff'},{nonce:'-1'},{dataHash:B}])assert.throws(()=>review.restore({...attempt,...patch}));
});
test('receipt identity, finality, canonical block and CREATE address must match',async()=>{
 for(const patch of [{status:0},{from:TARGET.asset},{to:TARGET.asset},{hash:F},{contractAddress:TARGET.asset},{blockNumber:11},{blockHash:F},{gasUsed:5000001n},{gasPrice:121n}]){const f=fixture();Object.assign(f.receipt,patch);await assert.rejects((await f.review()).verify(H,attempt));}
 const f=fixture();f.provider.getBlock=async n=>n==='finalized'?{number:10,hash:F}:{number:n,hash:H};await assert.rejects((await f.review()).verify(H,attempt),/NON_CANONICAL/);
});
test('fixed receiver capability, constructor roles, asset and runtime are verified again at finality',async()=>{
 for(const [key,value]of [['contractVersion',2],['asset',TARGET.deployer],['claimAuthority',TARGET.deployer],['redemptionAuthority',TARGET.deployer],['policySeconds',259200]]){const f=fixture();f.state.fields[key]=value;await assert.rejects((await f.review()).verify(H,attempt),/WRONG_CONSTRUCTOR/);}
 const f=fixture();f.state.runtime='0x00'+f.state.runtime.slice(4);await assert.rejects((await f.review()).verify(H,attempt),/WRONG_RUNTIME/);
 const g=fixture();g.state.assetCode='0x6001';await assert.rejects((await g.review()).verify(H,attempt),/ASSET_CODE_CHANGED/);
});
test('final snapshot changing during verification is rejected',async()=>{
 const f=fixture();f.provider.getBlock=async n=>n==='finalized'?{number:10,hash:F}:n===10?{number:10,hash:H}:{number:9,hash:B};await assert.rejects((await f.review()).verify(H,attempt),/FINALITY_CHANGED/);
});
test('loopback server reserves exactly once and reopens only original receipt recovery',async t=>{
 const directory=await mkdtemp(tmpdir()+'/mf-v3-review-'),attemptPath=pathToFileURL(directory+'/attempt.json'),f=fixture();let server;
 t.after(async()=>{await server?.stop();await rm(directory,{recursive:true,force:true});});
 server=await startReview({provider:f.provider,artifact,...options,attemptPath});
 const json=async(path,init)=>{const r=await fetch(server.origin+path,init);return {status:r.status,body:await r.json()};};
 assert.equal((await fetch(server.origin)).status,200);assert.match(await (await fetch(server.origin+'/client.mjs')).text(),/product-v3-deployment/);
 const config=(await json('/preflight')).body;const body=JSON.stringify(Object.fromEntries(['nonce','gas','gasPrice','dataHash'].map(k=>[k,config[k]])));
 const init={method:'POST',headers:{origin:server.origin,'content-type':'application/json'},body};
 assert.equal((await json('/reserve',{...init,headers:{...init.headers,origin:'https://attacker.example'}})).status,403);
 assert.equal((await json('/reserve',init)).status,200);assert.equal((await json('/reserve',init)).status,409);
 const saved=JSON.parse(await readFile(attemptPath,'utf8'));assert.equal(saved.dataHash,attempt.dataHash);
 f.tx.gasLimit=BigInt(config.gas);f.receipt.gasUsed=BigInt(config.gas)-1n;
 assert.equal((await json('/verify?hash='+H)).body.reviewStatus,'VERIFIED_CANDIDATE_NOT_APPROVED');
 await server.stop();f.state.pending='0x99';server=await startReview({provider:f.provider,artifact,...options,attemptPath});assert.equal((await json('/preflight')).body.attempt.nonce,'0x0');assert.equal((await json('/verify?hash='+H)).status,200);
});
