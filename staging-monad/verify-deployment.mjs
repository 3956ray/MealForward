/**
 * Independent public Monad Testnet StoreEscrow deployment proof.
 * READ ONLY: JSON-RPC eth_* state queries; no private keys, no transactions,
 * no CP30 DB/Journal, no signer, no deployment or secret-bearing RPC.
 */
import {readFile} from 'node:fs/promises';
import {Interface} from 'ethers';
import {
 validateManifest,compareRuntime,sha256Hex,TESTNET_CHAIN_ID,CIRCLE_TEST_USDC,
 REVIEWED_SOURCE_SHA256,REVIEWED_CREATION_SHA256,equalHex
} from './runtime-proof.mjs';

const ensure=(condition,code)=>{if(!condition)throw Error(code)};
const lower=x=>typeof x==='string'?x.toLowerCase():'';
const isHex=x=>typeof x==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(x);
const isHash=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{64}$/.test(x);
const toHexBytes=x=>Buffer.from(x.slice(2),'hex');
const asBigInt=x=>{try{return BigInt(x)}catch{throw Error('INVALID_RPC_NUMBER')}};
const simpleAbi=new Interface(['function decimals() view returns (uint8)']);

export function constructorArgs(m){
 const terms={
  mealId:m.mealId,version:1n,unitPrice:7000000n,
  bodyDigest:m.bodyDigest,imageDigest:m.imageDigest,
  windowCount:1,startMinute0:0,endMinute0:1440,startMinute1:0,endMinute1:0
 };
 return [m.asset,m.storeId,m.owner,m.quoteAuthority,
  {catalog:m.catalogAuthority,issuer:m.issuerAuthority,operator:m.operatorAuthority},
  [{terms,current:true}]];
}

export function validateArtifact(a){
 ensure(a&&a.contractName==='StoreEscrow'&&a.chainId===TESTNET_CHAIN_ID,'WRONG_ARTIFACT');
 ensure(a.sourceSha256===REVIEWED_SOURCE_SHA256,'SOURCE_HASH_MISMATCH');
 ensure(a.creationBytecodeSha256===REVIEWED_CREATION_SHA256,'CREATION_HASH_MISMATCH');
 ensure(a.compiler?.startsWith('0.8.28+'),'COMPILER_NOT_REVIEWED');
 ensure(a.optimizerRuns===200&&a.evmVersion==='cancun','BUILD_SETTINGS_MISMATCH');
 ensure(isHex(a.bytecode)&&isHex(a.runtimeBytecode),'MISSING_BYTECODE');
 ensure(sha256Hex(toHexBytes(a.bytecode))===REVIEWED_CREATION_SHA256,'ACTUAL_CREATION_BYTES_DIFFER');
 ensure(a.immutableReferences&&typeof a.immutableReferences==='object','MISSING_COMPILER_IMMUTABLE_REFERENCES');
 ensure(Array.isArray(a.abi)&&a.abi.length>10,'ABI_MISSING');
 const i=new Interface(a.abi);
 for(const name of ['asset','storeId','owner','receiver','quoteAuthority','catalogAuthority',
  'issuerAuthority','operatorAuthority','catalog','listed','paused','closed','currentVersion',
  'computeTermsHash','getTerms']){
  ensure(i.hasFunction(name),'REQUIRED_GETTER_MISSING_'+name);
 }
 ensure(i.deploy.inputs.length===6,'CONSTRUCTOR_ABI_UNEXPECTED');
 return i;
}

export async function verifyDeployment({manifest,artifact,rpc}){
 ensure(rpc&&typeof rpc.send==='function','RPC_ADAPTER_REQUIRED');
 const policy=validateManifest(manifest),iface=validateArtifact(artifact);
 const m=manifest;
 const chain=asBigInt(await rpc.send('eth_chainId',[]));
 ensure(chain===BigInt(TESTNET_CHAIN_ID),'RPC_CHAIN_MISMATCH');
 const [rawTx,receipt,head]=await Promise.all([
  rpc.send('eth_getTransactionByHash',[m.deploymentTx]),
  rpc.send('eth_getTransactionReceipt',[m.deploymentTx]),
  rpc.send('eth_blockNumber',[])
 ]);
 ensure(rawTx&&receipt,'DEPLOYMENT_TX_OR_RECEIPT_MISSING');
 ensure(equalHex(rawTx.hash,m.deploymentTx)&&equalHex(receipt.transactionHash,m.deploymentTx),'RECEIPT_TX_HASH_MISMATCH');
 ensure(rawTx.to==null,'DEPLOYMENT_TX_NOT_CREATION');
 ensure(equalHex(rawTx.from,m.deployer)&&equalHex(receipt.from,m.deployer),'DEPLOYER_MISMATCH');
 ensure(asBigInt(receipt.status)===1n,'DEPLOYMENT_REVERTED');
 ensure(equalHex(receipt.contractAddress,m.contract),'DEPLOYED_ADDRESS_MISMATCH');
 ensure(equalHex(rawTx.blockHash,receipt.blockHash)&&asBigInt(rawTx.blockNumber)===asBigInt(receipt.blockNumber),'TX_RECEIPT_BLOCK_MISMATCH');
 const depth=asBigInt(head)-asBigInt(receipt.blockNumber)+1n;
 ensure(depth>=BigInt(m.minConfirmations)&&depth<100000n,'INSUFFICIENT_CONFIRMATIONS');
 const block=await rpc.send('eth_getBlockByNumber',[receipt.blockNumber,false]);
 ensure(block&&equalHex(block.hash,receipt.blockHash),'NON_CANONICAL_DEPLOYMENT_BLOCK');
 const expectedInput=artifact.bytecode+iface.encodeDeploy(constructorArgs(m)).slice(2);
 const txInput=rawTx.input??rawTx.data;
 ensure(isHex(txInput)&&equalHex(txInput,expectedInput),'DEPLOYMENT_INPUT_OR_CONSTRUCTOR_MISMATCH');

 const [deployedCode,tokenCode]=await Promise.all([
  rpc.send('eth_getCode',[m.contract,'latest']),
  rpc.send('eth_getCode',[CIRCLE_TEST_USDC,'latest'])
 ]);
 ensure(isHex(tokenCode)&&tokenCode!=='0x','TEST_USDC_CODE_MISSING');
 ensure(isHex(deployedCode)&&deployedCode!=='0x','ESCROW_CODE_MISSING');
 const code=compareRuntime(artifact.runtimeBytecode,deployedCode,artifact.immutableReferences);

 async function result(name,args=[]){
  const data=iface.encodeFunctionData(name,args);
  const output=await rpc.send('eth_call',[{to:m.contract,data},'latest']);
  ensure(typeof output==='string'&&/^0x[0-9a-fA-F]*$/.test(output),'BAD_READ_RESPONSE_'+name);
  try{return iface.decodeFunctionResult(name,output)}
  catch{throw Error('READ_DECODE_FAILED_'+name)}
 }
 async function address(name,want){
  const resultAddress=(await result(name))[0];
  ensure(equalHex(resultAddress,want),'IMMUTABLE_ROLE_OR_ASSET_MISMATCH_'+name);
 }
 for(const [key,want] of [
  ['asset',m.asset],['owner',m.owner],['receiver',m.owner],
  ['quoteAuthority',m.quoteAuthority],['catalogAuthority',m.catalogAuthority],
  ['issuerAuthority',m.issuerAuthority],['operatorAuthority',m.operatorAuthority]
 ]) await address(key,want);
 ensure(equalHex((await result('storeId'))[0],m.storeId),'STORE_ID_MISMATCH');
 ensure((await result('paused'))[0]===false&&(await result('closed'))[0]===false,'ESCROW_NOT_OPEN');
 ensure((await result('listed',[m.mealId]))[0]===true,'MEAL_NOT_LISTED');
 ensure((await result('currentVersion',[m.mealId]))[0]===1n,'MEAL_VERSION_MISMATCH');
 const [unitPrice,storedTermsHash]=await result('catalog',[m.mealId,1n]);
 ensure(unitPrice===7000000n&&isHash(storedTermsHash),'CATALOG_PRICE_OR_HASH_MISMATCH');
 const terms=constructorArgs(m)[5][0].terms;
 const recomputed=(await result('computeTermsHash',[terms]))[0];
 ensure(equalHex(recomputed,storedTermsHash),'TERMS_HASH_MISMATCH');
 const current=(await result('getTerms',[m.mealId,1n]))[0];
 for(const key of ['unitPrice','bodyDigest','imageDigest','windowCount',
  'startMinute0','endMinute0','startMinute1','endMinute1']){
  const want=terms[key];
  const got=current[key];
  ensure(typeof want==='string'?equalHex(got,want):asBigInt(got)===asBigInt(want),'TERMS_FIELD_MISMATCH_'+key);
 }
 ensure(equalHex(current.termsHash,storedTermsHash),'TERMS_STORED_HASH_MISMATCH');
 const decimalsRaw=await rpc.send('eth_call',[{to:CIRCLE_TEST_USDC,data:simpleAbi.encodeFunctionData('decimals')},'latest']);
 ensure(simpleAbi.decodeFunctionResult('decimals',decimalsRaw)[0]===6n,'TEST_USDC_DECIMALS_MISMATCH');
 return {
  status:'VERIFIED_ISOLATED_DEPLOYMENT',chainId:TESTNET_CHAIN_ID,
  contract:m.contract,deploymentTx:m.deploymentTx,block:asBigInt(receipt.blockNumber).toString(),
  confirmations:depth.toString(),confirmationMeaning:'depth_only_not_finality_guarantee',
  sourceSha256:artifact.sourceSha256,creationBytecodeSha256:artifact.creationBytecodeSha256,
  deploymentInputSha256:sha256Hex(toHexBytes(txInput)),
  deployedRuntimeSha256:code.deployedRuntimeSha256,
  runtimeBytes:code.runtimeBytes,compilerImmutableBytes:code.immutableBytes,
  mode:m.mode,roleSeparationVerified:policy.roleSeparationVerified,
  asset:CIRCLE_TEST_USDC,unitPriceBaseUnits:'7000000',termsHash:storedTermsHash,
  writes:0,originalCp30Touched:false
 };
}

export function publicRpc(url='https://testnet-rpc.monad.xyz'){
 const dest=new URL(url);
 ensure(dest.protocol==='https:'&&dest.username===''&&dest.password===''&&
  (dest.hostname==='testnet-rpc.monad.xyz'||dest.hostname.endsWith('.monad.xyz')),
  'RPC_URL_NOT_ALLOWLISTED');
 let id=0;
 return {async send(method,params=[]){
  ensure(['eth_chainId','eth_getTransactionByHash','eth_getTransactionReceipt','eth_blockNumber',
   'eth_getBlockByNumber','eth_getCode','eth_call'].includes(method),'READ_ONLY_RPC_ONLY');
  const callId=++id;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch(dest.toString(),{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:callId,method,params}),signal:controller.signal
   });
   ensure(response.ok,'RPC_HTTP_'+response.status);
   const decoded=await response.json();
   ensure(decoded.jsonrpc==='2.0'&&decoded.id===callId&&!decoded.error,'RPC_BAD_RESPONSE_'+method);
   return decoded.result;
  }finally{clearTimeout(timer)}
 }};
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const [manifestPath,artifactPath]=process.argv.slice(2);
 if(!manifestPath||!artifactPath){
  process.stderr.write('USAGE: node verify-deployment.mjs <public-manifest.json> <compiled-StoreEscrow.json>\n');
  process.exitCode=2;
 }else{
  try{
   const [m,a]=await Promise.all([readFile(manifestPath,'utf8'),readFile(artifactPath,'utf8')]);
   const report=await verifyDeployment({manifest:JSON.parse(m),artifact:JSON.parse(a),rpc:publicRpc()});
   process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }catch(e){
   process.stderr.write('DEPLOYMENT_PROOF_BLOCKED: '+String(e?.message||e).slice(0,170)+'\n');
   process.exitCode=1;
  }
 }
}