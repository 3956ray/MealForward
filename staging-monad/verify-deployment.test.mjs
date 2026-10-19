import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interface} from 'ethers';
import {constructorArgs,validateArtifact,verifyDeployment,publicRpc} from './verify-deployment.mjs';
import {CIRCLE_TEST_USDC} from './runtime-proof.mjs';

const artifact=JSON.parse(readFileSync(new URL('./artifacts/StoreEscrow.json',import.meta.url),'utf8'));
const iface=new Interface(artifact.abi);
const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const bytes=n=>'0x'+n.toString(16).padStart(64,'0');
const termsHash=bytes(888);
const base={mode:'role-separated-e2e',chainId:10143,asset:CIRCLE_TEST_USDC,
 contract:addr(99),deployer:addr(1),owner:addr(2),quoteAuthority:addr(3),catalogAuthority:addr(4),
 issuerAuthority:addr(5),operatorAuthority:addr(6),deploymentTx:bytes(123),
 storeId:bytes(10),mealId:bytes(11),bodyDigest:bytes(12),imageDigest:bytes(13),
 version:1,unitPrice:'7000000',minConfirmations:2};

function fixture(change={}){
 const m={...base,...(change.manifest||{})};
 const state={head:'0x101',nonce:'0x3',txInput:artifact.bytecode+iface.encodeDeploy(constructorArgs(m)).slice(2),
  code:artifact.runtimeBytecode,tokenCode:'0x6001',receiptStatus:'0x1',receiptBlock:'0x100',
  receiptHash:bytes(321),blockHash:bytes(321),reportedTermsHash:termsHash,tokenDecimals:6n,
  ...change};
 const calls=[];
 const getters={
  asset:()=>[m.asset],storeId:()=>[m.storeId],owner:()=>[m.owner],receiver:()=>[m.owner],
  quoteAuthority:()=>[m.quoteAuthority],catalogAuthority:()=>[m.catalogAuthority],
  issuerAuthority:()=>[m.issuerAuthority],operatorAuthority:()=>[m.operatorAuthority],
  closed:()=>[false],paused:()=>[false],listed:()=>[true],currentVersion:()=>[1n],
  catalog:()=>[7000000n,state.reportedTermsHash],
  computeTermsHash:()=>[termsHash],
  getTerms:()=>[[7000000n,state.reportedTermsHash,m.bodyDigest,m.imageDigest,1n,0n,1440n,0n,0n]],
  ...change.getters
 };
 const rpc={async send(method,params=[]){
  calls.push(method);
  if(method==='eth_chainId')return state.chain??'0x279f';
  if(method==='eth_blockNumber')return state.head;
  if(method==='eth_getTransactionByHash')return state.tx??{
   hash:m.deploymentTx,to:null,from:m.deployer,
   input:state.txInput,blockHash:state.receiptHash,blockNumber:state.receiptBlock};
  if(method==='eth_getTransactionReceipt')return state.receipt??{
   transactionHash:m.deploymentTx,from:m.deployer,status:state.receiptStatus,
   contractAddress:m.contract,blockHash:state.receiptHash,blockNumber:state.receiptBlock};
  if(method==='eth_getBlockByNumber')return {hash:state.blockHash,number:params[0]};
  if(method==='eth_getCode')return params[0].toLowerCase()===m.asset.toLowerCase()?state.tokenCode:state.code;
  if(method==='eth_call'){
   if(params[0].to.toLowerCase()===m.asset.toLowerCase())return '0x'+state.tokenDecimals.toString(16).padStart(64,'0');
   const parsed=iface.parseTransaction({data:params[0].data});
   assert.ok(parsed,'unknown getter');
   if(state.getterErrors?.[parsed.name])throw Error('MOCK_GETTER_FAILURE');
   const result=getters[parsed.name]?.();
   if(!result)throw Error('MOCK_GETTER_UNKNOWN_'+parsed.name);
   return iface.encodeFunctionResult(parsed.name,result);
  }
  throw Error('UNEXPECTED_RPC_'+method);
 }};
 return {m,rpc,calls,state};
}

test('pinned artifact is compiler reproducible and has explicit immutable references',()=>{
 assert.equal(validateArtifact(artifact).deploy.inputs.length,6);
 assert.ok(artifact.immutableReferences);
});
test('full proof accepts exact creation transaction, runtime, getter state, terms and independent roles',async()=>{
 const t=fixture(),out=await verifyDeployment({manifest:t.m,artifact,rpc:t.rpc});
 assert.equal(out.status,'VERIFIED_ISOLATED_DEPLOYMENT');
 assert.equal(out.confirmations,'2');
 assert.equal(out.roleSeparationVerified,true);
 assert.equal(out.writes,0);
 assert.equal(out.originalCp30Touched,false);
 assert.ok(out.deployedRuntimeSha256);
 assert.ok(t.calls.includes('eth_getBlockByNumber'));
 assert.ok(!t.calls.some(x=>x.startsWith('eth_send')));
});
test('fail closed: wrong chain, reverted deploy, unavailable proof, too few confirmations, reorg',async()=>{
 for(const [label,custom,err] of [
  ['mainnet',{chain:'0x8f'},/RPC_CHAIN_MISMATCH/],
  ['revert',{receiptStatus:'0x0'},/DEPLOYMENT_REVERTED/],
  ['insufficient',{head:'0x100'},/INSUFFICIENT_CONFIRMATIONS/],
  ['block reorg',{blockHash:bytes(4)},/NON_CANONICAL_DEPLOYMENT_BLOCK/],
  ['bad creation tx',{txInput:'0x60006000'},/DEPLOYMENT_INPUT_OR_CONSTRUCTOR_MISMATCH/],
  ['missing token',{tokenCode:'0x'},/TEST_USDC_CODE_MISSING/],
  ['tampered runtime',{code:'0x'+('aa'.repeat((artifact.runtimeBytecode.length-2)/2))},/RUNTIME_MISMATCH/],
  ['wrong metadata terms hash',{reportedTermsHash:bytes(991)},/TERMS_HASH_MISMATCH/],
  ['bad USDC decimals',{tokenDecimals:18n},/TEST_USDC_DECIMALS_MISMATCH/],
  ['owner mismatch',{getters:{owner:()=>[addr(19)]}},/IMMUTABLE_ROLE_OR_ASSET_MISMATCH_owner/],
  ['unlisted meal',{getters:{listed:()=>[false]}},/MEAL_NOT_LISTED/],
  ['overridden price',{getters:{catalog:()=>[5000000n,termsHash]}},/CATALOG_PRICE_OR_HASH_MISMATCH/]
 ]){
  const t=fixture(custom);
  await assert.rejects(()=>verifyDeployment({manifest:t.m,artifact,rpc:t.rpc}),err,label);
 }
});
test('fails closed for inconsistent deployer, receipt hash and wrong transaction target',async()=>{
 for(const [label,override,err] of [
  ['unauthorized deployer',{from:addr(22)},/DEPLOYER_MISMATCH/],
  ['wrong receipt address',{contractAddress:addr(33)},/DEPLOYED_ADDRESS_MISMATCH/],
  ['wrong deployment destination',{to:addr(33)},/DEPLOYMENT_TX_NOT_CREATION/]
 ]){
  const t=fixture();
  const baseReceipt=await t.rpc.send('eth_getTransactionReceipt',[t.m.deploymentTx]);
  const baseTx=await t.rpc.send('eth_getTransactionByHash',[t.m.deploymentTx]);
  const rpc={send:async(method,params)=>method==='eth_getTransactionByHash'
   ?(label==='unauthorized deployer'||label==='wrong deployment destination'?{...baseTx,...override}:baseTx)
   :method==='eth_getTransactionReceipt'
    ?label==='wrong receipt address'?{...baseReceipt,...override}:baseReceipt
    :t.rpc.send(method,params)};
  await assert.rejects(()=>verifyDeployment({manifest:t.m,artifact,rpc}),err,label);
 }
});
test('RPC transport rejects unreviewed URL or methods before network',async()=>{
 assert.throws(()=>publicRpc('http://testnet-rpc.monad.xyz'),/RPC_URL_NOT_ALLOWLISTED/);
 assert.throws(()=>publicRpc('https://example.org'),/RPC_URL_NOT_ALLOWLISTED/);
 await assert.rejects(()=>publicRpc().send('eth_sendTransaction',[]),/READ_ONLY_RPC_ONLY/);
});
