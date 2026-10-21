/**
 * T1-A: read-only preflight of the REAL already-deployed T0 StoreEscrow.
 * No signer, approval, funding, transaction broadcast or historical Mac.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {Interface,TypedDataEncoder,keccak256,toUtf8Bytes} from 'ethers';
import {makeReadOnlyPublicRpc} from './attest-live-t0.mjs';
import {
 TESTNET_CHAIN_ID,CIRCLE_TEST_USDC,REVIEWED_SOURCE_SHA256,
 REVIEWED_CREATION_SHA256
} from './runtime-proof.mjs';
const CONTRACT='0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58';
const DEPLOYMENT_TX='0xa04240fd813a0a1a00ed72b67a689de050c58b64418e6e5ffa81303848510839';
const MEAL='0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b';
const TERMS_HASH='0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222';
const ROLES=Object.freeze({
 owner:'0xC4F8a468f10d5f98DCfF3282516125E97F26433b',
 quoteAuthority:'0xcc5C1ce846c0302ab27a4811cf2e0E6FC7282952',
 catalogAuthority:'0x41DCBFED391b79FAC7B2951dD136c6B7e1384259',
 issuerAuthority:'0x9747D93d9F8C2e1202b4d922a4916fcF634aA2B3',
 operatorAuthority:'0x3Dc9d4509062cBa2cFCB8edd3A8D656839A50165'
});
const types={
 FundingQuote:[
  {name:'quoteId',type:'bytes32'}, {name:'payer',type:'address'},
  {name:'mealId',type:'bytes32'}, {name:'currentVersion',type:'uint256'},
  {name:'termsHash',type:'bytes32'}, {name:'quantity',type:'uint256'},
  {name:'unitPrice',type:'uint256'}, {name:'amount',type:'uint256'},
  {name:'deadline',type:'uint256'}
 ]
};
const ERC20=new Interface([
 'function balanceOf(address account) view returns (uint256)',
 'function decimals() view returns (uint8)',
 'function allowance(address owner,address spender) view returns (uint256)'
]);
const domain={name:'MealForward C0 Funding',version:'1',chainId:TESTNET_CHAIN_ID,verifyingContract:CONTRACT};
const strict=(valid,code)=>{if(!valid)throw Error(code)};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const asInt=x=>{try{return BigInt(x)}catch{throw Error('INVALID_NUMBER_FROM_RPC')}};
async function run({rpc=makeReadOnlyPublicRpc(),artifactPath=new URL('./artifacts/StoreEscrow.json',import.meta.url)}={}){
 strict(typeof rpc?.send==='function','READ_ONLY_RPC_REQUIRED');
 const artifact=JSON.parse(await readFile(artifactPath,'utf8'));
 strict(artifact.sourceSha256===REVIEWED_SOURCE_SHA256&&
  artifact.creationBytecodeSha256===REVIEWED_CREATION_SHA256,
  'SOURCE_PIN_MISMATCH');
 const iface=new Interface(artifact.abi);
 const chain=await rpc.send('eth_chainId',[]);
 strict(asInt(chain)===BigInt(TESTNET_CHAIN_ID),'WRONG_NETWORK');
 // Fix the same block tag for all accounting reads. Not a finalized
 // multi-party-consensus proof; see report.
 const height=await rpc.send('eth_blockNumber',[]);
 const block=await rpc.send('eth_getBlockByNumber',[height,false]);
 strict(block&&block.hash&&asInt(block.number)===asInt(height),'UNEXPECTED_BLOCK');
 const call=async(address,abi,name,args=[])=>{
  const data=abi.encodeFunctionData(name,args);
  const raw=await rpc.send('eth_call',[{to:address,data},height]);
  try{return abi.decodeFunctionResult(name,raw)}
  catch{throw Error('CANNOT_DECODE_'+name)}
 };
 const src=async(name,args=[])=> (await call(CONTRACT,iface,name,args))[0];
 const erc=async(name,args=[])=> (await call(CIRCLE_TEST_USDC,ERC20,name,args))[0];
 const code=await rpc.send('eth_getCode',[CONTRACT,height]);
 strict(typeof code==='string'&&code!=='0x','CONTRACT_UNAVAILABLE');
 const version=await src('currentVersion',[MEAL]);
 strict(version===1n,'T0_MENU_VERSION_CHANGED');
 const listed=await src('listed',[MEAL]);
 const closed=await src('closed'),paused=await src('paused');
 strict(listed===true&&!closed&&!paused,'ESCROW_NOT_OPEN_FOR_T1');
 const [unitPrice,termsHash]=await call(CONTRACT,iface,'catalog',[MEAL,1n]);
 strict(unitPrice===7000000n&&same(termsHash,TERMS_HASH),'T0_MENU_TERMS_CHANGED');
 for(const [role,want] of Object.entries(ROLES)){
  strict(same(await src(role),want),'T0_ROLE_CHANGED_'+role);
 }
 strict(same(await src('asset'),CIRCLE_TEST_USDC),'T0_ASSET_CHANGED');
 const quoteCode=await rpc.send('eth_getCode',[ROLES.quoteAuthority,height]);
 const quoteIsEOA=quoteCode==='0x';
 const accounting=await src('getAccounting');
 const counts=Array.from(accounting.counts,asInt),amounts=Array.from(accounting.amounts,asInt);
 strict(counts.length===5&&amounts.length===5,'INVALID_BUCKETS');
 const fundedUnits=asInt(accounting.fundedUnits),fundedAmount=asInt(accounting.fundedAmount);
 const liability=asInt(accounting.liability);
 strict(counts.reduce((a,b)=>a+b,0n)===fundedUnits,'UNIT_BUCKET_INVARIANT');
 strict(amounts.reduce((a,b)=>a+b,0n)===fundedAmount,'AMOUNT_BUCKET_INVARIANT');
 strict(amounts[0]+amounts[1]+amounts[2]===liability,'LIABILITY_INVARIANT');
 strict(await src('lifetimeFundedUnits')===fundedUnits,'FUNDED_UNIT_INVARIANT');
 strict(await src('totalFundedAmount')===fundedAmount,'FUNDED_AMOUNT_INVARIANT');
 strict(await src('availableUnits')===counts[0],'AVAILABLE_UNIT_INVARIANT');
 strict(await src('availableAmount')===amounts[0],'AVAILABLE_AMOUNT_INVARIANT');
 const escrowUsdc=await erc('balanceOf',[CONTRACT]);
 strict(await erc('decimals')===6n,'TOKEN_DECIMALS_CHANGED');
 strict(escrowUsdc>=liability,'ESCROW_INSOLVENT');
 const surplus=await src('surplus');
 strict(surplus===escrowUsdc-liability,'SURPLUS_NOT_CONSERVED');

 // Compatibility check ONLY: no signature, transferable quote or approval.
 // A fixed test quote's typed hash must agree with original source contract.
 const quote={
  quoteId:keccak256(toUtf8Bytes('MealForward T1-A read-only EIP-712 compatibility check - NOT AUTHORIZED')),
  payer:ROLES.owner,mealId:MEAL,currentVersion:1n,termsHash:TERMS_HASH,
  quantity:1n,unitPrice:7000000n,amount:7000000n,
  deadline:asInt(block.timestamp)+600n
 };
 const offlineDigest=TypedDataEncoder.hash(domain,types,quote);
 const originalDigest=await src('quoteDigest',[quote]);
 strict(same(offlineDigest,originalDigest),'EIP712_QUOTE_DIGEST_INCOMPATIBLE');
 // Check block remains canonical after the reads, not just at start.
 const second=await rpc.send('eth_getBlockByNumber',[height,false]);
 strict(same(second.hash,block.hash),'BLOCK_REORG_DURING_PREFLIGHT');
 const report={
  status:'T1_A_CHAIN_READINESS_VERIFIED',chainId:TESTNET_CHAIN_ID,
  deploymentTx:DEPLOYMENT_TX,contract:CONTRACT,observedBlock:asInt(height).toString(),
  blockHash:block.hash,readConsistency:'single_block_tag_and_reorg_recheck',
  blockDepthIsNotAbsoluteFinality:true,
  asset:CIRCLE_TEST_USDC,priceBaseUnits:'7000000',mealId:MEAL,
  termsHash,allFiveRegisteredAuthoritiesMatch:true,
  quoteAuthorityType:quoteIsEOA?'EOA_CANDIDATE':'CONTRACT_ACCOUNT_UNSUPPORTED_BY_ECDSA_RECOVER',
  quoteAuthorityKeyOwnershipProven:false,
  eip712TypeAndDomainMatchOriginalContract:true,
  accounting:{
   fundedUnits:fundedUnits.toString(),fundedAmount:fundedAmount.toString(),
   counts:Object.fromEntries(['A','R','H','S','X'].map((k,i)=>[k,counts[i].toString()])),
   amounts:Object.fromEntries(['A','R','H','S','X'].map((k,i)=>[k,amounts[i].toString()])),
   liability:liability.toString(),
   escrowTestUsdcBalance:escrowUsdc.toString(),
   surplus:surplus.toString(),remainingLifetimeCapacity:(10n-fundedUnits).toString()
  },
  listed,paused,closed,
  refundOrFundPerformed:false,
  eip712QuoteSigned:false,donorWalletBalancesUnknown:true,
  publicFundingEnabled:false,readyForRealFund:false,
  safetyBlockers:[
   'QUOTE_AUTHORITY_WALLET_SIGNATURE_NOT_PROVEN',
   'DONOR_TEST_USDC_AND_MON_NOT_CHECKED',
   'DURABLE_FUND_INTENT_AND_UNKNOWN_RECOVERY_NOT_DEPLOYED',
   'ORIGINAL_SETTLE_HAS_NO_ONCHAIN_180S_DELAY'
  ],
  originalMacCp30Touched:false,writesSent:0,
  rpcProvidersUsed:typeof rpc.providersUsed==='function'?rpc.providersUsed():[]
 };
 strict(fundedUnits>=0n&&fundedUnits<=10n,'LIFETIME_CAP_CORRUPT');
 return Object.freeze(report);
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const proof=await run();
  const output=JSON.stringify(proof,null,2)+'\n';
  await writeFile(new URL('./artifacts/T1-A-chain-readiness.json',import.meta.url),output,{encoding:'utf8',mode:0o600});
  process.stdout.write(output);
 }catch(e){
  process.stderr.write('T1_A_BLOCKED: '+String(e?.message||e).slice(0,130)+'\n');
  process.exitCode=1;
 }
}
export {run,CONTRACT,MEAL,ROLES,domain,types};
