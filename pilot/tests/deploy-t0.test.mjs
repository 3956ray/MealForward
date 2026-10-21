import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interface} from 'ethers';
import {
 CHAIN_ID,TEST_USDC,SOURCE_SHA,CREATION_SHA,PRICE,
 validateArtifact,validateRolePlan,makeDeploymentPlan,verifyDeployment
} from '../escrow-t0-proof.mjs';

const artifact=JSON.parse(readFileSync(
 new URL('../../staging-monad/artifacts/StoreEscrow.json',import.meta.url),'utf8'));
const iface=new Interface(artifact.abi);
const hex=n=>'0x'+n.toString(16).padStart(64,'0');
const address=n=>'0x'+n.toString(16).padStart(40,'0');
const roles={
 owner:address(1),quoteAuthority:address(2),catalogAuthority:address(3),
 issuerAuthority:address(4),operatorAuthority:address(5)
};
const id=hex(20),meal=hex(30),hash=hex(40),blockHash=hex(50);
const CONTRACT=address(6);

function testPlan(){
 const plan=makeDeploymentPlan({
  roles,ownerSigner:roles.owner,artifact,storeId:id,mealId:meal
 });
 return {...plan,manifest:{...plan.manifest,contract:CONTRACT,deploymentTx:hash}};
}
function mockedRpc(override={}){
 const plan=testPlan();
 const m=plan.manifest;
 const getters={
  asset:()=>[TEST_USDC],
  owner:()=>[roles.owner],receiver:()=>[roles.owner],
  quoteAuthority:()=>[roles.quoteAuthority],
  catalogAuthority:()=>[roles.catalogAuthority],
  issuerAuthority:()=>[roles.issuerAuthority],
  operatorAuthority:()=>[roles.operatorAuthority],
  storeId:()=>[id],paused:()=>[false],closed:()=>[false],
  listed:()=>[true],currentVersion:()=>[1n],
  catalog:()=>[PRICE,hex(80)],
  computeTermsHash:()=>[hex(80)],
  getTerms:()=>[{unitPrice:PRICE,termsHash:hex(80),
   bodyDigest:plan.terms.bodyDigest,imageDigest:plan.terms.imageDigest,
   windowCount:1n,startMinute0:0n,endMinute0:1440n,
   startMinute1:0n,endMinute1:0n}]
 };
 const tx={hash,from:roles.owner,to:null,blockHash,blockNumber:'0x10',input:plan.data};
 const receipt={transactionHash:hash,from:roles.owner,status:'0x1',
  contractAddress:CONTRACT,blockHash,blockNumber:'0x10'};
 const data={
  chain:'0x279f',head:'0x12',tx,receipt,block:{hash:blockHash},
  tokenCode:'0x6000',runtime:artifact.runtimeBytecode,
  decimals:6n,
  ...override
 };
 let calls=[];
 const rpc={async send(method,args=[]){
  calls.push(method);
  if(method==='eth_chainId')return data.chain;
  if(method==='eth_getTransactionByHash')return data.tx;
  if(method==='eth_getTransactionReceipt')return data.receipt;
  if(method==='eth_blockNumber')return data.head;
  if(method==='eth_getBlockByNumber')return data.block;
  if(method==='eth_getCode'){
   return String(args[0]).toLowerCase()===TEST_USDC.toLowerCase()?
    data.tokenCode:data.runtime;
  }
  if(method==='eth_call'){
   if(String(args[0].to).toLowerCase()===TEST_USDC.toLowerCase())
    return '0x'+data.decimals.toString(16).padStart(64,'0');
   const decoded=iface.parseTransaction({data:args[0].data});
   assert.ok(decoded,'Unknown readonly getter');
   if(override.getterOverrides?.[decoded.name])
    return iface.encodeFunctionResult(decoded.name,override.getterOverrides[decoded.name]());
   return iface.encodeFunctionResult(decoded.name,getters[decoded.name]());
  }
  throw Error('RPC_WRITE_OR_UNKNOWN_'+method);
 }};
 return {rpc,calls,m};
}

test('fixed reviewed compiler source and strict original contract artifact',()=>{
 assert.equal(validateArtifact(artifact).deploy.inputs.length,6);
 assert.equal(artifact.sourceSha256,SOURCE_SHA);
 assert.equal(artifact.creationBytecodeSha256,CREATION_SHA);
 assert.equal(artifact.chainId,CHAIN_ID);
 assert.ok(artifact.immutableReferences);
});

test('preparation refuses duplicated roles, wrong account, invalid artifact, invalid identifiers',()=>{
 assert.equal(Object.keys(validateRolePlan(roles)).length,5);
 assert.throws(()=>validateRolePlan({...roles,operatorAuthority:roles.owner}),
  /AUTHORITIES_NOT_INDEPENDENT/);
 assert.throws(()=>validateRolePlan(roles,{ownerSigner:address(66)}),
  /OWNER_SIGNER_MISMATCH/);
 assert.throws(()=>makeDeploymentPlan({roles,ownerSigner:roles.owner,
  artifact:{...artifact,sourceSha256:'0'.repeat(64)},storeId:id,mealId:meal}),
  /SOURCE_SHA_MISMATCH/);
 assert.throws(()=>makeDeploymentPlan({roles,ownerSigner:roles.owner,
  artifact,storeId:meal,mealId:meal}),/STORE_AND_MEAL_ID_CONFLICT/);
 const data=testPlan();
 assert.equal(data.manifest.unitPrice,'7000000');
 assert.equal(data.manifest.mode,'role-separated-e2e');
 assert.equal(data.manifest.minConfirmations,2);
 assert.equal(data.manifest.deployer,roles.owner);
 assert.ok(data.data.startsWith(artifact.bytecode));
});

test('entire independently verified deployment proof uses only read-only RPC and real constructor bytecode',async()=>{
 const {rpc,calls,m}=mockedRpc();
 const proof=await verifyDeployment({rpc,artifact,manifest:m});
 assert.equal(proof.status,'VERIFIED_NEW_ROLE_SEPARATED_ESCROW_T0');
 assert.equal(proof.contract,CONTRACT);
 assert.equal(proof.confirmations,'3');
 assert.equal(proof.rolesSeparated,true);
 assert.equal(proof.onchainSettlementDelayEnforced,false);
 assert.equal(proof.originalCp30Touched,false);
 assert.ok(calls.includes('eth_getTransactionByHash'));
 assert.ok(calls.includes('eth_call'));
 assert.ok(!calls.some(x=>x.startsWith('eth_send')));
});

test('tampered constructor, wrong token, wrong owner, reverted tx, wrong runtime or insufficient confirmations fail closed',async()=>{
 const baseline=testPlan();
 const scenarios=[
  [{chain:'0x8f'},/RPC_WRONG_CHAIN/],
  [{tx:{hash,from:roles.owner,to:null,blockHash,blockNumber:'0x10',input:'0x6000'}},/RAW_DEPLOY_CALLDATA_MISMATCH/],
  [{receipt:{transactionHash:hash,from:roles.owner,status:'0x0',contractAddress:CONTRACT,blockHash,blockNumber:'0x10'}},/DEPLOYMENT_REVERTED/],
  [{head:'0x10'},/INSUFFICIENT_CONFIRMATIONS/],
  [{runtime:'0x'+('11'.repeat((artifact.runtimeBytecode.length-2)/2))},/RUNTIME_SOURCE_MISMATCH/],
  [{decimals:18n},/WRONG_TEST_USDC_DECIMALS/],
  [{getterOverrides:{owner:()=>[address(99)]}},/MISMATCH_owner/],
  [{getterOverrides:{listed:()=>[false]}},/MEAL_NOT_LISTED/],
  [{getterOverrides:{catalog:()=>[5000000n,hex(80)]}},/CATALOG_TERMS_MISMATCH/],
  [{getterOverrides:{getTerms:()=>[{unitPrice:PRICE,termsHash:hex(81),
   bodyDigest:baseline.terms.bodyDigest,imageDigest:baseline.terms.imageDigest,
   windowCount:1n,startMinute0:0n,endMinute0:1440n,startMinute1:0n,endMinute1:0n}]}},
   /STORED_TERMS_HASH_MISMATCH/]
 ];
 for(const [change,reason] of scenarios){
  const {rpc,m}=mockedRpc(change);
  await assert.rejects(()=>verifyDeployment({rpc,artifact,manifest:m}),reason);
 }
 await assert.rejects(()=>verifyDeployment({
  rpc:mockedRpc().rpc,artifact,manifest:{...baseline.manifest,quoteAuthority:roles.owner}
 }),/AUTHORITIES_NOT_INDEPENDENT/);
});

test('read-only preflight is unchanged and only one wallet-click deploy primitive exists in T0 UI',()=>{
 const root=new URL('../',import.meta.url);
 const index=readFileSync(new URL('index.html',root),'utf8');
 const html=readFileSync(new URL('deploy-t0.html',root),'utf8');
 const script=readFileSync(new URL('deploy-t0.mjs',root),'utf8');
 assert.match(index,/READ ONLY/);
 assert.match(index,/deploy-t0\.html/);
 assert.match(html,/Monad Testnet/);
 assert.match(html,/五项/);
 assert.match(html,/部署全新隔离 Escrow/);
 assert.equal((script.match(/eth_sendTransaction/g)||[]).length,1);
 assert.match(script,/await checkActiveOwner\(\)/);
 assert.match(script,/await verifyNetwork\(\)/);
 assert.match(script,/validateArtifact\(data\)/);
 assert.match(script,/if\(pending\)throw Error/);
 assert.match(script,/localStorage\.setItem\(KEY,JSON\.stringify\(reserved\)\)/);
 assert.match(script,/pending=reserved;prepared=null/);
 assert.match(script,/error\?\.code===4001/);
 assert.match(script,/tx\.to!==null/);
 assert.match(html,/recoverHash/);
 assert.match(html,/id="recover"/);
 assert.match(script,/originalCp30Touched:false|verified=\{manifest:m,evidence\}/);
 for(const unsafe of ['eth_signTypedData_v4','eth_sendRawTransaction',
  'personal_sign','mnemonicToAccount','privateKeyToAccount',
  'approve(', 'fund(', 'settle(']){
  assert.ok(!script.includes(unsafe),'Forbidden wallet or funds primitive: '+unsafe);
 }
});
