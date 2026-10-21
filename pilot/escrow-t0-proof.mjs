/**
 * MealForward Monad T0: browser-compatible, independent source and deployment
 * attestation. No access to a signer, secrets, account storage or wallet.
 *
 * The sole authorized write is performed by the user-facing UI module on an
 * explicit wallet button, after this module has generated reviewed calldata.
 */
import {
 Interface,sha256,getBytes,keccak256,toUtf8Bytes,hexlify,randomBytes,getAddress
} from 'ethers';

export const CHAIN_ID=10143;
export const TEST_USDC='0x534b2f3A21130d7a60830c2Df862319e593943A3';
export const SOURCE_SHA='bd84f387a46428802a453f28306ad6f9de7317465ff48844619d550713ce0c66';
export const CREATION_SHA='9c2583ee25a9fc08aa2434efde455ee7fc0c945847d3ef7789dfd370735d7a8d';
export const PRICE=7000000n;
export const REQUIRED_ROLES=Object.freeze([
 'owner','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority'
]);
const HEX32=/^0x[0-9a-f]{64}$/i;
const HEX=/^0x(?:[0-9a-f]{2})+$/i;
const strict=(condition,label)=>{if(!condition)throw Error(label)};
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const scalar=(x)=>{try{return BigInt(x)}catch{throw Error('INVALID_CHAIN_SCALAR')}};
const hexAddress=x=>{
 try{
  strict(typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x),'INVALID_ROLE_ADDRESS');
  const n=getAddress(x);
  strict(!eq(n,'0x0000000000000000000000000000000000000000'),'ZERO_ROLE_ADDRESS');
  return n;
 }catch{throw Error('INVALID_ROLE_ADDRESS')}
};
const countUnique=x=>new Set(x.map(s=>s.toLowerCase())).size===x.length;
const readData=async(rpc,name,args=[])=>{
 const value=await rpc.send(name,args);
 strict(value!==null&&value!==undefined,'RPC_EMPTY_'+name);
 return value;
};
const VIEW=new Interface(['function decimals() view returns (uint8)']);

export function validateArtifact(a){
 strict(a&&typeof a==='object'&&!Array.isArray(a),'ARTIFACT_REQUIRED');
 strict(a.contractName==='StoreEscrow'&&a.chainId===CHAIN_ID,'WRONG_ARTIFACT');
 strict(a.sourceSha256===SOURCE_SHA,'SOURCE_SHA_MISMATCH');
 strict(a.creationBytecodeSha256===CREATION_SHA,'CREATION_SHA_MISMATCH');
 strict(typeof a.compiler==='string'&&a.compiler.startsWith('0.8.28+'),'COMPILER_NOT_REVIEWED');
 strict(a.optimizerRuns===200&&a.evmVersion==='cancun','UNREVIEWED_COMPILER_SETTINGS');
 strict(HEX.test(a.bytecode)&&HEX.test(a.runtimeBytecode),'INVALID_BYTECODE');
 strict(sha256(a.bytecode).slice(2)===CREATION_SHA,'CREATION_BYTECODE_MISMATCH');
 strict(getBytes(a.runtimeBytecode).length<=24576,'EIP170_RUNTIME_OVERSIZE');
 strict(a.immutableReferences&&typeof a.immutableReferences==='object'&&
  !Array.isArray(a.immutableReferences),'IMMUTABLE_REFERENCE_MANIFEST_MISSING');
 const iface=new Interface(a.abi);
 for(const name of [
  'asset','owner','receiver','storeId','quoteAuthority','catalogAuthority',
  'issuerAuthority','operatorAuthority','catalog','listed','paused',
  'closed','currentVersion','computeTermsHash','getTerms'
 ]) strict(iface.hasFunction(name),'REQUIRED_GETTER_MISSING_'+name);
 strict(iface.deploy.inputs.length===6,'UNREVIEWED_CONSTRUCTOR_ABI');
 return iface;
}

export function validateRolePlan(roles,{ownerSigner}={}){
 strict(roles&&typeof roles==='object','ROLES_REQUIRED');
 const copy=Object.fromEntries(REQUIRED_ROLES.map(x=>[x,hexAddress(roles[x])]));
 strict(countUnique(Object.values(copy)),'AUTHORITIES_NOT_INDEPENDENT');
 if(ownerSigner)strict(eq(copy.owner,ownerSigner),'OWNER_SIGNER_MISMATCH');
 return copy;
}

export function freshId(){
 return hexlify(randomBytes(32));
}
export function makeDeploymentPlan({roles,ownerSigner,artifact,storeId,mealId}={}){
 const iface=validateArtifact(artifact);
 const checked=validateRolePlan(roles,{ownerSigner});
 strict(HEX32.test(storeId)&&!/^0x0{64}$/i.test(storeId),'INVALID_STORE_ID');
 strict(HEX32.test(mealId)&&!/^0x0{64}$/i.test(mealId),'INVALID_MEAL_ID');
 strict(!eq(storeId,mealId),'STORE_AND_MEAL_ID_CONFLICT');
 const bodyDigest=keccak256(toUtf8Bytes('MealForward T0 | 留膳社区厨房 | 暖心盖饭 | 7 test USDC | v1'));
 const imageDigest=keccak256(toUtf8Bytes('MealForward T0 | no photograph published'));
 const terms={
  mealId,version:1n,unitPrice:PRICE,bodyDigest,imageDigest,
  windowCount:1,startMinute0:0,endMinute0:1440,startMinute1:0,endMinute1:0
 };
 const args=[
  TEST_USDC,storeId,checked.owner,checked.quoteAuthority,
  {catalog:checked.catalogAuthority,issuer:checked.issuerAuthority,
   operator:checked.operatorAuthority},
  [{terms,current:true}]
 ];
 const data=artifact.bytecode+iface.encodeDeploy(args).slice(2);
 strict(HEX.test(data),'INVALID_DEPLOY_CALLDATA');
 const plannedManifest={
  mode:'role-separated-e2e',chainId:CHAIN_ID,asset:TEST_USDC,
  deployer:checked.owner,...checked,
  storeId,mealId,bodyDigest,imageDigest,version:1,
  unitPrice:PRICE.toString(),minConfirmations:2
 };
 return Object.freeze({manifest:Object.freeze(plannedManifest),data,terms});
}
function compareRuntime(a,b,refs){
 strict(HEX.test(a)&&HEX.test(b),'INVALID_RUNTIME_CODE');
 const original=getBytes(a),chain=getBytes(b);
 strict(original.length===chain.length,'RUNTIME_LENGTH_MISMATCH');
 strict(chain.length<=24576,'RUNTIME_OVERSIZE');
 const mask=new Uint8Array(chain.length);
 for(const collection of Object.values(refs||{})){
  strict(Array.isArray(collection),'INVALID_IMMUTABLE_REFS');
  for(const {start,length} of collection){
   strict(Number.isInteger(start)&&Number.isInteger(length)&&
    start>=0&&length>0&&start+length<=chain.length,'INVALID_IMMUTABLE_RANGE');
   for(let i=start;i<start+length;i++){
    strict(mask[i]===0,'DUPLICATE_IMMUTABLE_MASK');
    mask[i]=1;
   }
  }
 }
 for(let i=0;i<chain.length;i++){
  strict(mask[i]===1||original[i]===chain[i],'RUNTIME_SOURCE_MISMATCH_AT_BYTE_'+i);
 }
 return sha256(b);
}
export async function verifyDeployment({rpc,artifact,manifest}={}){
 strict(rpc&&typeof rpc.send==='function','RPC_REQUIRED');
 const iface=validateArtifact(artifact);
 const roles=validateRolePlan(manifest,{ownerSigner:manifest?.deployer});
 strict(manifest.mode==='role-separated-e2e','UNTRUSTED_MANIFEST_MODE');
 strict(manifest.chainId===CHAIN_ID&&eq(manifest.asset,TEST_USDC),'UNTRUSTED_NETWORK_OR_ASSET');
 strict(manifest.unitPrice===PRICE.toString()&&manifest.version===1,'UNTRUSTED_PRICE_OR_VERSION');
 strict(Number.isInteger(manifest.minConfirmations)&&manifest.minConfirmations>=2&&
  manifest.minConfirmations<=100,'CONFIRMATION_POLICY_REQUIRED');
 for(const k of ['storeId','mealId','bodyDigest','imageDigest','deploymentTx']){
  strict(HEX32.test(manifest[k])&&!/^0x0{64}$/i.test(manifest[k]),'INVALID_MANIFEST_'+k);
 }
 const contract=hexAddress(manifest.contract);
 const observedChain=scalar(await readData(rpc,'eth_chainId'));
 strict(observedChain===BigInt(CHAIN_ID),'RPC_WRONG_CHAIN');
 const [tx,receipt,head]=await Promise.all([
  readData(rpc,'eth_getTransactionByHash',[manifest.deploymentTx]),
  readData(rpc,'eth_getTransactionReceipt',[manifest.deploymentTx]),
  readData(rpc,'eth_blockNumber')
 ]);
 strict(eq(tx.hash,manifest.deploymentTx)&&eq(receipt.transactionHash,manifest.deploymentTx),
  'DEPLOYMENT_TX_HASH_MISMATCH');
 strict(tx.to===null&&eq(tx.from,roles.owner)&&eq(receipt.from,roles.owner),
  'DEPLOYER_OR_TARGET_MISMATCH');
 strict(scalar(receipt.status)===1n,'DEPLOYMENT_REVERTED');
 strict(eq(receipt.contractAddress,contract),'RECEIPT_CONTRACT_MISMATCH');
 strict(eq(tx.blockHash,receipt.blockHash)&&
  scalar(tx.blockNumber)===scalar(receipt.blockNumber),'TX_RECEIPT_BLOCK_MISMATCH');
 const depth=scalar(head)-scalar(receipt.blockNumber)+1n;
 strict(depth>=BigInt(manifest.minConfirmations)&&depth<100000n,'INSUFFICIENT_CONFIRMATIONS');
 const block=await readData(rpc,'eth_getBlockByNumber',[receipt.blockNumber,false]);
 strict(eq(block.hash,receipt.blockHash),'NON_CANONICAL_BLOCK');
 const plan=makeDeploymentPlan({
  roles,ownerSigner:manifest.deployer,artifact,
  storeId:manifest.storeId,mealId:manifest.mealId
 });
 strict(eq(plan.manifest.bodyDigest,manifest.bodyDigest)&&
  eq(plan.manifest.imageDigest,manifest.imageDigest),'TERMS_BODY_MISMATCH');
 strict(eq(tx.input??tx.data,plan.data),'RAW_DEPLOY_CALLDATA_MISMATCH');
 const [code,tokenCode]=await Promise.all([
  readData(rpc,'eth_getCode',[contract,'latest']),
  readData(rpc,'eth_getCode',[TEST_USDC,'latest'])
 ]);
 strict(HEX.test(tokenCode)&&tokenCode!=='0x','TEST_USDC_NOT_DEPLOYED');
 const deployedHash=compareRuntime(artifact.runtimeBytecode,code,artifact.immutableReferences);
 const call=async(name,args=[])=>{
  const data=iface.encodeFunctionData(name,args);
  const raw=await readData(rpc,'eth_call',[{to:contract,data},'latest']);
  try{return iface.decodeFunctionResult(name,raw)}
  catch{throw Error('BAD_RESULT_'+name)}
 };
 for(const [name,want] of [
  ['asset',TEST_USDC],['owner',roles.owner],['receiver',roles.owner],
  ['quoteAuthority',roles.quoteAuthority],
  ['catalogAuthority',roles.catalogAuthority],
  ['issuerAuthority',roles.issuerAuthority],
  ['operatorAuthority',roles.operatorAuthority],
  ['storeId',manifest.storeId]
 ]){
  strict(eq((await call(name))[0],want),'MISMATCH_'+name);
 }
 strict((await call('paused'))[0]===false&&(await call('closed'))[0]===false,
  'ESCROW_NOT_OPEN');
 strict((await call('listed',[manifest.mealId]))[0]===true,'MEAL_NOT_LISTED');
 strict((await call('currentVersion',[manifest.mealId]))[0]===1n,'MEAL_WRONG_VERSION');
 const [price,hash]=(await call('catalog',[manifest.mealId,1n]));
 strict(price===PRICE&&HEX32.test(hash),'CATALOG_TERMS_MISMATCH');
 strict(eq((await call('computeTermsHash',[plan.terms]))[0],hash),'TERMS_HASH_MISMATCH');
 const stored=(await call('getTerms',[manifest.mealId,1n]))[0];
 for(const field of ['mealId','bodyDigest','imageDigest'])
  if(field in stored)strict(eq(stored[field],plan.terms[field]),'TERMS_FIELD_MISMATCH_'+field);
 for(const field of ['unitPrice','version','windowCount','startMinute0',
  'endMinute0','startMinute1','endMinute1'])
  if(field in stored)strict(BigInt(stored[field])===BigInt(plan.terms[field]),'TERMS_FIELD_MISMATCH_'+field);
 const usdcDecimals=VIEW.decodeFunctionResult(
  'decimals',await readData(rpc,'eth_call',[{
   to:TEST_USDC,data:VIEW.encodeFunctionData('decimals')
  },'latest'])
 )[0];
 strict(usdcDecimals===6n,'WRONG_TEST_USDC_DECIMALS');
 return Object.freeze({
  status:'VERIFIED_NEW_ROLE_SEPARATED_ESCROW_T0',
  chainId:CHAIN_ID,contract,deploymentTx:manifest.deploymentTx,
  blockNumber:scalar(receipt.blockNumber).toString(),confirmations:depth.toString(),
  deployedRuntimeSha256:deployedHash,
  sourceSha256:SOURCE_SHA,creationBytecodeSha256:CREATION_SHA,
  asset:TEST_USDC,rolesSeparated:true,priceBaseUnits:PRICE.toString(),
  termsHash:hash,readOnlyVerification:true,
  onchainSettlementDelayEnforced:false,originalCp30Touched:false
 });
}
