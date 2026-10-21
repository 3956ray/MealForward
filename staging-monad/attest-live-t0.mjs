/**
 * MealForward T0 first independent PUBLIC CHAIN attestation.
 *
 * Public Monad Testnet JSON-RPC READ ONLY. Derives the original T0 public
 * manifest from exact creation transaction input and compiler-pinned ABI,
 * NOT from an attacker-supplied JSON manifest, screenshot or mutable web UI.
 *
 * NEVER sends transactions, signs, connects a wallet, touches the original
 * Mac CP30 Journal/DB or modifies existing StoreEscrow assets.
 */
import {readFile} from 'node:fs/promises';
import {AbiCoder,Interface} from 'ethers';
import {
 verifyDeployment,validateArtifact,publicRpc
} from './verify-deployment.mjs';
import {
 validateManifest,REVIEWED_SOURCE_SHA256,
 REVIEWED_CREATION_SHA256,TESTNET_CHAIN_ID,CIRCLE_TEST_USDC
} from './runtime-proof.mjs';

const TX='0xa04240fd813a0a1a00ed72b67a689de050c58b64418e6e5ffa81303848510839';
const CONTRACT='0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58';
const REPORT={
 block:'72934128',
 runtimeSha256:'31417d9cdf4bd883f5a07d717cfeee368758f23190dc6d2ec41b30c3d676c6c8',
 termsHash:'0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222',
 price:'7000000'
};
const strict=(value,code)=>{if(!value)throw Error(code)};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();

function getConstructorManifest(artifact,transaction){
 const abi=validateArtifact(artifact);
 const txInput=transaction?.input??transaction?.data;
 strict(typeof txInput==='string'&&/^0x[0-9a-fA-F]+$/.test(txInput),'MISSING_TRANSACTION_INPUT');
 strict(txInput.length>artifact.bytecode.length,'TRANSACTION_INPUT_TOO_SHORT');
 strict(txInput.slice(0,artifact.bytecode.length).toLowerCase()===
   artifact.bytecode.toLowerCase(),'UNREVIEWED_CREATION_BYTECODE');
 strict(transaction.to===null,'TRANSACTION_NOT_A_NEW_CONTRACT_DEPLOYMENT');
 const constructorPayload='0x'+txInput.slice(artifact.bytecode.length);
 const decoded=AbiCoder.defaultAbiCoder().decode(abi.deploy.inputs,constructorPayload);
 strict(decoded.length===6,'UNREVIEWED_CONSTRUCTOR_SHAPE');
 const [asset,storeId,owner,quoteAuthority,authorities,entries]=decoded;
 strict(Array.isArray(entries)&&entries.length===1&&entries[0].current===true,
  'UNREVIEWED_T0_MENU');
 const terms=entries[0].terms;
 const version=BigInt(terms.version);
 const quantity=BigInt(terms.unitPrice);
 strict(version===1n&&quantity===7000000n,'UNEXPECTED_VERSION_OR_PRICE');
 strict(BigInt(terms.windowCount)===1n&&
  BigInt(terms.startMinute0)===0n&&BigInt(terms.endMinute0)===1440n&&
  BigInt(terms.startMinute1)===0n&&BigInt(terms.endMinute1)===0n,
  'UNEXPECTED_T0_SERVICE_WINDOW');
 const manifest={
  mode:'role-separated-e2e',chainId:TESTNET_CHAIN_ID,
  asset,contract:CONTRACT,deployer:transaction.from,
  owner,quoteAuthority,
  catalogAuthority:authorities.catalog,
  issuerAuthority:authorities.issuer,
  operatorAuthority:authorities.operator,
  deploymentTx:TX,
  storeId,mealId:terms.mealId,
  bodyDigest:terms.bodyDigest,imageDigest:terms.imageDigest,
  version:1,unitPrice:'7000000',minConfirmations:2
 };
 const policy=validateManifest(manifest);
 strict(policy.roleSeparationVerified,'T0_FIVE_DISTINCT_ROLE_ADDRESSES_MISSING');
 strict(same(asset,CIRCLE_TEST_USDC),'WRONG_TEST_USDC_ASSET');
 return manifest;
}

async function run({rpc=publicRpc(),artifactPath}={}){
 strict(artifactPath,'COMPILED_SOURCE_ARTIFACT_REQUIRED');
 const artifact=JSON.parse(await readFile(artifactPath,'utf8'));
 strict(artifact.sourceSha256===REVIEWED_SOURCE_SHA256 &&
        artifact.creationBytecodeSha256===REVIEWED_CREATION_SHA256,
  'SOURCE_OR_BYTECODE_HASH_CHANGED');

 // First get the actual chain transaction from an independently executed
 // GitHub Actions process. It is NOT a browser-supplied manifest.
 const [chain,transaction]=await Promise.all([
  rpc.send('eth_chainId',[]),rpc.send('eth_getTransactionByHash',[TX])
 ]);
 strict(BigInt(chain)===BigInt(TESTNET_CHAIN_ID),'WRONG_PUBLIC_RPC_CHAIN');
 strict(transaction&&same(transaction.hash,TX),'DEPLOYMENT_TX_UNAVAILABLE');
 const manifest=getConstructorManifest(artifact,transaction);
 const proof=await verifyDeployment({rpc,artifact,manifest});

 strict(same(proof.contract,CONTRACT)&&
        same(proof.deploymentTx,TX),'CONTRACT_OR_TRANSACTION_CHANGED');
 strict(proof.block===REPORT.block,'DEPLOYMENT_BLOCK_MISMATCH');
 strict(proof.deployedRuntimeSha256.toLowerCase()===REPORT.runtimeSha256,
        'RUNTIME_CODE_HASH_MISMATCH');
 strict(same(proof.termsHash,REPORT.termsHash),'MENU_TERMS_HASH_MISMATCH');
 strict(proof.unitPriceBaseUnits===REPORT.price,'MENU_UNIT_PRICE_MISMATCH');
 strict(proof.roleSeparationVerified===true,'ROLE_ADDRESSES_NOT_DISTINCT');
 strict(proof.writes===0&&proof.originalCp30Touched===false,'UNEXPECTED_FINANCIAL_SIDE_EFFECT');

 return Object.freeze({
  status:'T0_INDEPENDENT_PUBLIC_RPC_PASS',
  comparedAgainst:'2026-10-21 USER T0 BROWSER PROOF',
  chainId:TESTNET_CHAIN_ID,contract:CONTRACT,deploymentTx:TX,
  blockNumber:proof.block,confirmationsAtCheck:proof.confirmations,
  confirmationMeaning:'block_depth_not_absolute_finality',
  sourceSha256:proof.sourceSha256,
  creationBytecodeSha256:proof.creationBytecodeSha256,
  deployedRuntimeSha256:proof.deployedRuntimeSha256,
  termsHash:proof.termsHash,
  priceBaseUnits:proof.unitPriceBaseUnits,
  asset:CIRCLE_TEST_USDC,
  originalSourceConstructorMatch:true,
  receiptAndRuntimeMatch:true,
  registeredRoleAddressCount:5,
  roleAddressesAreDifferent:true,
  // Public role addresses (not private keys); derived from tx input.
  roles:{
   owner:manifest.owner,quoteAuthority:manifest.quoteAuthority,
   catalogAuthority:manifest.catalogAuthority,
   issuerAuthority:manifest.issuerAuthority,
   operatorAuthority:manifest.operatorAuthority
  },
  publicStoreId:manifest.storeId,publicMealId:manifest.mealId,
  historicalCp30Accessed:false,
  onchain180SecondCooldownEnforced:false,
  fundIssueSettleTested:false,
  writesSent:0
 });
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const proof=await run({
   artifactPath:process.argv[2]??new URL('./artifacts/StoreEscrow.json',import.meta.url)
  });
  // Public addresses / transaction hashes only. No personal data, secrets.
  process.stdout.write(JSON.stringify(proof,null,2)+'\n');
 }catch(e){
  // No stack or raw RPC response; no chance of echoing wallet secrets.
  process.stderr.write('T0_INDEPENDENT_ATTESTATION_BLOCKED: '+
   String(e?.message||e).slice(0,180)+'\n');
  process.exitCode=1;
 }
}
export {run,getConstructorManifest};
