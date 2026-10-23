/**
 * MealForward T1-E: first recipient voucher issuance READ-ONLY gate.
 *
 * This only inspects the ORIGINAL user-funded StoreEscrow and can optionally
 * simulate a hypothetical contract.issue via eth_call. Eth_call executes
 * without persisting state; NEVER broadcasts, signs, stores beneficiary data,
 * assigns a real recipient, changes a voucher or marks food as delivered.
 *
 * A successful simulator proves Solidity conditions for a hypothetical
 * issuer caller, NOT private-key custody, recipient eligibility or safe
 * operator/merchant settlement. Do not treat it as approval to call settle.
 */
import {createHash} from 'node:crypto';
import {Interface,keccak256,AbiCoder,toUtf8Bytes} from 'ethers';
import {
 CHAIN,ESCROW,TOKEN,MEAL,TERMS,QUOTE,PRICE
} from './core.mjs';
import {T0_RUNTIME_SHA256} from './testnet-funding-chain.mjs';
import {makeReadOnlyPublicRpc} from './testnet-readonly-rpc.mjs';

const strict=(x,code)=>{if(!x)throw Error(code)};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const n=x=>BigInt(x);
const h=x=>'0x'+BigInt(x).toString(16);
const ZERO='0x'+'0'.repeat(64);
const FIXED={
  owner:'0xc4f8a468f10d5f98dcff3282516125e97f26433b',
  issuerAuthority:'0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3',
  operatorAuthority:'0x3dc9d4509062cba2cfcb8edd3a8d656839a50165',
  catalogAuthority:'0x41dcbfed391b79fac7b2951dd136c6b7e1384259'
};
const QUOTE_ID='0xd19b6ca862dc452dd13246bac6faba2d024ba7c59add7e614c6d3b9b54421e12';
const ORIGINAL_FUND='0x6d241844fc0edda40af1c30eceab11ac0b95057337218de21e0c4026954ce219';
const VOUCHER_DOMAIN=keccak256(toUtf8Bytes('MealForwardVoucherV1'));
const abiCoder=AbiCoder.defaultAbiCoder();
const t0=new Interface([
 'function asset() view returns (address)',
 'function owner() view returns (address)',
 'function quoteAuthority() view returns (address)',
 'function issuerAuthority() view returns (address)',
 'function operatorAuthority() view returns (address)',
 'function catalogAuthority() view returns (address)',
 'function currentVersion(bytes32) view returns (uint256)',
 'function listed(bytes32) view returns (bool)',
 'function paused() view returns (bool)',
 'function closed() view returns (bool)',
 'function lifetimeFundedUnits() view returns (uint256)',
 'function availableUnits() view returns (uint256)',
 'function liability() view returns (uint256)',
 'function nextCandidate(bytes32) view returns ((bool available,uint8 unitSeq,uint256 nextGeneration,bytes32 termsHash,bool needsExpiry))',
 'function quoteUses(bytes32) view returns (bytes32 payloadHash,bytes32 batchId)',
 'function getUnit(uint8) view returns ((bytes32 batchId,uint8 localIndex,address payer,bytes32 mealId,uint256 version,bytes32 termsHash,uint256 unitPrice,uint8 bucket,uint256 generation,bytes32 voucherId))',
 'function getBatch(bytes32) view returns ((address payer,bytes32 mealId,uint256 version,bytes32 termsHash,uint256 unitPrice,uint256 quantity,uint256 firstUnit,uint16 refundedMask))',
 'function getVoucher(bytes32) view returns ((uint8 unitSeq,uint256 generation,bytes32 termsHash,uint256 issuedAt,uint256 expiresAt,address issuer,bytes32 lockId,uint256 lockedAt,address operator,address processor,bytes32 markerId,uint256 handoverRecordedAt,uint256 handoverBlock,bytes32 reportId,bytes32 settleId,bool expired))',
 'function getAccounting() view returns ((uint256 fundedUnits,uint256 fundedAmount,uint256[5] counts,uint256[5] amounts,uint256 liability))',
 'function issue(bytes32 opId,bytes32 mealId,uint8 expectedUnitSeq,uint256 expectedNextGeneration,bytes32 expectedTermsHash,uint256 deadline) returns (bytes32 voucherId)'
]);
const erc20=new Interface(['function balanceOf(address owner) view returns (uint256)']);
const dryRunHash=blockHash=>keccak256(toUtf8Bytes(
 'MealForward T1-E ETH_CALL_ONLY / NO WRITE / '+blockHash
));
function originalVoucherId(seq,generation){
 return keccak256(abiCoder.encode(
  ['bytes32','uint256','address','uint8','uint256'],
  [VOUCHER_DOMAIN,CHAIN,ESCROW,seq,generation]
 ));
}
async function call(rpc,contract,iface,fn,args,tag,from){
 const tx={to:contract,data:iface.encodeFunctionData(fn,args)};
 if(from)tx.from=from;
 const raw=await rpc.send('eth_call',[tx,tag]);
 strict(typeof raw==='string'&&/^0x[0-9a-f]*$/i.test(raw),
  'T1E_BAD_CONTRACT_RETURN_'+fn);
 try{return iface.decodeFunctionResult(fn,raw)}
 catch{throw Error('T1E_UNREVIEWED_ABI_'+fn)}
}
async function read(rpc,fn,args,tag){
 return (await call(rpc,ESCROW,t0,fn,args,tag))[0];
}

export async function firstVoucherCandidate({
 rpc=makeReadOnlyPublicRpc(),simulateIssuer=true
}={}){
 strict(rpc&&typeof rpc.send==='function','T1E_READ_ONLY_RPC_REQUIRED');
 strict(typeof simulateIssuer==='boolean','T1E_SIMULATION_MODE_INVALID');
 const id=await rpc.send('eth_chainId',[]);
 strict(n(id)===BigInt(CHAIN),'T1E_WRONG_CHAIN');
 const at=await rpc.send('eth_blockNumber',[]);
 const block=await rpc.send('eth_getBlockByNumber',[at,false]);
 strict(block&&block.hash&&block.timestamp,'T1E_UNTRUSTED_CHAIN_HEAD');
 strict(n(block.number)===n(at),'T1E_BLOCK_NUMBER_CHANGED');
 const runtime=await rpc.send('eth_getCode',[ESCROW,at]);
 strict(typeof runtime==='string'&&/^0x[0-9a-f]{200,}$/i.test(runtime),
  'T1E_ORIGINAL_CODE_MISSING');
 strict(createHash('sha256').update(
  Buffer.from(runtime.slice(2),'hex')).digest('hex')===T0_RUNTIME_SHA256,
 'T1E_T0_RUNTIME_HASH_CHANGED');
 const [originalFund,issuerCode]=await Promise.all([
  rpc.send('eth_getTransactionReceipt',[ORIGINAL_FUND]),
  rpc.send('eth_getCode',[FIXED.issuerAuthority,at])
 ]);
 strict(originalFund&&n(originalFund.status)===1n&&
  same(originalFund.to,ESCROW)&&
  same(originalFund.from,QUOTE)&&
  n(originalFund.blockNumber)===73410628n,
  'T1E_ORIGINAL_7_USDC_FUND_UNPROVEN');
 strict(issuerCode==='0x','T1E_ISSUER_MUST_BE_SEPARATE_EOA_WALLET');

 // Every independent read is anchored to the SAME block. No previous
 // frontend/My Intents state is used as an authorization.
 const names=[
  ['asset',[],TOKEN],['owner',[],FIXED.owner],
  ['quoteAuthority',[],QUOTE],
  ['catalogAuthority',[],FIXED.catalogAuthority],
  ['issuerAuthority',[],FIXED.issuerAuthority],
  ['operatorAuthority',[],FIXED.operatorAuthority]
 ];
 for(const [fn,args,expected] of names){
  const got=await read(rpc,fn,args,at);
  strict(same(got,expected),'T1E_ORIGINAL_'+fn.toUpperCase()+'_CHANGED');
 }
 const ver=await read(rpc,'currentVersion',[MEAL],at);
 const listed=await read(rpc,'listed',[MEAL],at);
 const paused=await read(rpc,'paused',[],at);
 const closed=await read(rpc,'closed',[],at);
 strict(ver===1n&&listed===true&&!paused&&!closed,
  'T1E_MENU_OR_OPERATING_STATE_CHANGED');
 const [candidate,accounting,units,available,used,balance]=await Promise.all([
  read(rpc,'nextCandidate',[MEAL],at),
  read(rpc,'getAccounting',[],at),
  read(rpc,'lifetimeFundedUnits',[],at),
  read(rpc,'availableUnits',[],at),
  call(rpc,ESCROW,t0,'quoteUses',[QUOTE_ID],at),
  call(rpc,TOKEN,erc20,'balanceOf',[ESCROW],at)
 ]);
 const fundedUnits=accounting.fundedUnits,amount=accounting.fundedAmount;
 strict(units===1n&&fundedUnits===1n&&amount===PRICE,
  'T1E_ORIGINAL_FIRST_FUND_UNIT_COUNT_CHANGED');
 strict(available===1n&&accounting.counts.length===5&&
  accounting.counts[0]===1n&&accounting.counts.slice(1).every(x=>x===0n),
  'T1E_ORIGINAL_FIRST_UNIT_NOT_AVAILABLE');
 strict(accounting.amounts[0]===PRICE&&
  accounting.amounts.slice(1).every(x=>x===0n)&&
  accounting.liability===PRICE&&
  balance[0]>=accounting.liability,
  'T1E_ORIGINAL_ESCROW_ACCOUNTING_CHANGED');
 strict(candidate.available===true&&candidate.unitSeq===0n&&
  candidate.nextGeneration===1n&&same(candidate.termsHash,TERMS)&&
  candidate.needsExpiry===false,'T1E_FIRST_ISSUE_CANDIDATE_MISMATCH');
 const usedBatch=used[1];
 strict(used[0]!==ZERO&&usedBatch!==ZERO,
  'T1E_ORIGINAL_FUND_QUOTE_NOT_CONSUMED');
 const [unit,batch]=await Promise.all([
  read(rpc,'getUnit',[0],at),
  read(rpc,'getBatch',[usedBatch],at)
 ]);
 strict(same(unit.batchId,usedBatch)&&unit.localIndex===0n&&
  same(unit.payer,QUOTE)&&same(unit.mealId,MEAL)&&
  unit.version===1n&&same(unit.termsHash,TERMS)&&
  unit.unitPrice===PRICE&&unit.bucket===0n&&unit.generation===0n&&
  unit.voucherId===ZERO,
  'T1E_FIRST_FUNDED_UNIT_NOT_PRISTINE');
 strict(same(batch.payer,QUOTE)&&same(batch.mealId,MEAL)&&
  batch.version===1n&&same(batch.termsHash,TERMS)&&
  batch.unitPrice===PRICE&&batch.quantity===1n&&
  batch.firstUnit===0n&&batch.refundedMask===0n,
  'T1E_ORIGINAL_FUNDED_BATCH_CHANGED');
 const predicted=originalVoucherId(0,1n);
 let simulation=false;
 if(simulateIssuer){
  // eth_call is a read-only EVM simulation: no issuer key and NO SEND.
  const opId=dryRunHash(block.hash);
  const deadline=n(block.timestamp)+600n;
  const res=await call(rpc,ESCROW,t0,'issue',
   [opId,MEAL,0,1,TERMS,deadline],at,FIXED.issuerAuthority);
  strict(same(res[0],predicted),'T1E_ISSUE_SIMULATION_VOUCHER_MISMATCH');
  simulation=true;
  // A donor/Quote wallet is NOT the issuer; cross-role simulation must
  // fail without returning a voucher. This does not authenticate any EOA.
  let unprivilegedDenied=false;
  try{
   await call(rpc,ESCROW,t0,'issue',
    [opId,MEAL,0,1,TERMS,deadline],at,QUOTE);
  }catch{unprivilegedDenied=true}
  strict(unprivilegedDenied,'T1E_NON_ISSUER_CAN_ISSUE');
 }
 const again=await rpc.send('eth_getBlockByNumber',[at,false]);
 strict(same(again?.hash,block.hash),'T1E_REORG_DURING_READ_ONLY_PREFLIGHT');
 const publicEvidence={
  status:'T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS',
  chainId:CHAIN,escrow:ESCROW,mealId:MEAL,
  blockNumber:n(at).toString(),
  firstUnitSequence:0,nextGeneration:1,unitPrice:PRICE.toString(),
  accounting:{fundedUnits:fundedUnits.toString(),
   availableUnits:available.toString(),
   escrowBalanceBaseUnits:balance[0].toString(),
   liabilityBaseUnits:accounting.liability.toString()},
  originalQuoteUsed:true,
  verifiedFirstBatch:true,
  originalIssuerAuthority:FIXED.issuerAuthority,
  originalIssuerWalletPrivateKeyControlProven:false,
  recipientIdentityOrConsentVerified:false,
  onchainRecipientWalletBinding:false,
  onchain180SecondSettlementCooldown:false,
  issueSimulatedWithoutSend:simulation,
  issuedOnchain:false,voucherDelivered:false,
  merchantSettlementAllowed:false,
  rpcWriteMethodsCalled:0
 };
 return Object.freeze(publicEvidence);
}
export {t0,erc20,originalVoucherId,FIXED,QUOTE_ID,ORIGINAL_FUND};

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await firstVoucherCandidate())+'\n');}
 catch(e){
  const msg=typeof e?.message==='string'&&/^T1E_[A-Z0-9_]+$/.test(e.message)?
   e.message:'T1E_READ_ONLY_ISSUE_NOT_ATTESTED';
  process.stderr.write(msg+'\n');
  process.exitCode=1;
 }
}
