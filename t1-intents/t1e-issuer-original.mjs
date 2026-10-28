/**
 * T1-E original Issuer wallet transaction / receipt verifier, pure read-only.
 * NO transaction broadcast, NO wallet login, NO DB mutation.
 * The caller MUST first commit an immutable ISSUE_UNKNOWN reservation (opId,
 * issuer nonce and calldata hash) under the separate T1-E role; this module
 * will NOT accept a browser-supplied recipient as an onchain entitlement.
 */
import {Interface,keccak256} from 'ethers';
import {CHAIN,ESCROW,MEAL,TERMS,PRICE} from './core.mjs';
import {t0,FIXED,originalVoucherId} from './t1e-first-issue-readiness.mjs';

const hex32=/^0x[0-9a-fA-F]{64}$/;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const check=(v,error)=>{if(!v)throw Error(error)};
const issueEvent=new Interface([
 'event Issued(bytes32 indexed voucherId,uint8 unitSeq,uint256 generation,bytes32 termsHash,uint256 issuedAt,uint256 expiresAt)'
]);
const asBig=x=>BigInt(x);
const want='2b9ae6f1-2bb7-4096-8136-70f30f302eea';
const ID=originalVoucherId(0,1n);

/** Build the only acceptable calldata before reserving original wallet nonce. */
export function exactIssuerCall({
 claim,opId,nonce,deadline,now=Math.floor(Date.now()/1000)
}={}){
 check(claim&&claim.funding_intent===want&&
  claim.stage==='CONSENT_VERIFIED'&&
  claim.unit_seq===0&&asBig(claim.generation)===1n&&
  same(claim.voucher_id,ID)&&
  same(claim.issuer_wallet,FIXED.issuerAuthority)&&
  hex32.test(claim.consent_digest||'')&&
  hex32.test(claim.consent_signature_fingerprint||''),
  'T1E_CONSENT_AND_ORIGINAL_CLAIM_REQUIRED');
 check(hex32.test(opId||'')&&!/^0x0{64}$/i.test(opId),
  'T1E_ORIGINAL_ISSUER_OPERATION_ID_REQUIRED');
 check(Number.isSafeInteger(nonce)&&nonce>=0&&
  Number.isSafeInteger(now)&&now>0&&
  Number.isSafeInteger(deadline)&&deadline>now+30&&deadline<=now+600,
  'T1E_ISSUE_NONCE_OR_DEADLINE_INVALID');
 const data=t0.encodeFunctionData('issue',[opId,MEAL,0,1,TERMS,deadline]);
 return Object.freeze({
  from:FIXED.issuerAuthority,to:ESCROW,value:'0x0',
  chainId:'0x279f',nonce:'0x'+nonce.toString(16),data,
  dataHash:keccak256(data),opId,
  voucherId:ID,
  action:'T1E_WALLET_CLICK_ONLY_ISSUE',
  chainWritesPerformed:0
 });
}

/** Only an actual original receipt can advance ISSUE_HASH_BOUND -> ISSUED. */
export async function attestIssuerReceipt({rpc,original,txHash}={}){
 check(rpc&&typeof rpc.send==='function','T1E_READ_ONLY_RPC_REQUIRED');
 check(original&&original.stage==='ISSUE_HASH_BOUND'&&
  original.funding_intent===want&&
  original.unit_seq===0&&asBig(original.generation)===1n&&
  same(original.issuer_wallet,FIXED.issuerAuthority)&&
  same(original.voucher_id,ID)&&
  hex32.test(original.issuer_op_id||'')&&
  hex32.test(original.issuer_tx_data_hash||'')&&
  Number.isSafeInteger(Number(original.issuer_tx_nonce))&&
  original.issuer_tx_hash===txHash&&hex32.test(txHash||''),
  'T1E_ORIGINAL_ISSUE_RESERVATION_REQUIRED');
 const [chain,tx,receipt,height]=await Promise.all([
  rpc.send('eth_chainId',[]),
  rpc.send('eth_getTransactionByHash',[txHash]),
  rpc.send('eth_getTransactionReceipt',[txHash]),
  rpc.send('eth_blockNumber',[])
 ]);
 check(asBig(chain)===BigInt(CHAIN),'T1E_WRONG_CHAIN');
 check(tx&&same(tx.hash,txHash)&&same(tx.from,FIXED.issuerAuthority)&&
  same(tx.to,ESCROW)&&asBig(tx.value??'0x0')===0n&&
  asBig(tx.nonce)===asBig(original.issuer_tx_nonce)&&
  same(keccak256(tx.input??tx.data),original.issuer_tx_data_hash),
  'T1E_ISSUER_ORIGINAL_BYTES_NONCE_MISMATCH');
 const decoded=t0.parseTransaction({data:tx.input??tx.data});
 check(decoded?.name==='issue'&&same(decoded.args[0],original.issuer_op_id)&&
  same(decoded.args[1],MEAL)&&decoded.args[2]===0n&&
  decoded.args[3]===1n&&same(decoded.args[4],TERMS),
  'T1E_WRONG_ORIGINAL_ISSUE_FUNCTION');
 if(!receipt)return Object.freeze({status:'UNKNOWN',mustNotRetry:true,originalTxHash:txHash});
 check(same(receipt.transactionHash,txHash)&&
  same(receipt.blockHash,tx.blockHash)&&
  asBig(receipt.blockNumber)===asBig(tx.blockNumber)&&
  asBig(height)-asBig(receipt.blockNumber)>=1n,
  'T1E_RECEIPT_NOT_CONFIRMED');
 const block=await rpc.send('eth_getBlockByNumber',[receipt.blockNumber,false]);
 check(block&&same(block.hash,receipt.blockHash),'T1E_RECEIPT_BLOCK_NONCANONICAL');
 if(asBig(receipt.status)!==1n)return Object.freeze({
  status:'REVERTED',mustNotRetry:true,originalTxHash:txHash
 });
 const issued=receipt.logs.flatMap(log=>{
  if(!same(log.address,ESCROW))return [];
  try{const parsed=issueEvent.parseLog(log);return parsed?.name==='Issued'?[parsed.args]:[]}
  catch{return []}
 });
 check(issued.length===1,'T1E_EXACTLY_ONE_ISSUED_EVENT_REQUIRED');
 const e=issued[0];
 check(same(e.voucherId,ID)&&e.unitSeq===0n&&e.generation===1n&&
  same(e.termsHash,TERMS),'T1E_ISSUED_EVENT_MISMATCH');
 const at=receipt.blockNumber;
 const read=async(name,args)=>t0.decodeFunctionResult(name,
  await rpc.send('eth_call',[{to:ESCROW,data:t0.encodeFunctionData(name,args)},at]))[0];
 const [unit,voucher,accounting]=await Promise.all([
  read('getUnit',[0]),read('getVoucher',[ID]),read('getAccounting',[])
 ]);
 check(unit.bucket===1n&&unit.generation===1n&&
  same(unit.voucherId,ID)&&same(unit.mealId,MEAL)&&
  unit.unitPrice===PRICE&&
  voucher.generation===1n&&voucher.unitSeq===0n&&
  same(voucher.termsHash,TERMS)&&
  accounting.counts[0]===0n&&accounting.counts[1]===1n&&
  accounting.liability===PRICE,
  'T1E_ISSUE_ONCHAIN_BUCKET_ACCOUNTING_MISMATCH');
 const canonical=await rpc.send('eth_getBlockByNumber',[at,false]);
 check(canonical&&same(canonical.hash,receipt.blockHash),'T1E_REORG_ON_RECEIPT_READ');
 return Object.freeze({
  status:'ISSUED_VERIFIED',originalTxHash:txHash,
  voucherId:ID,blockNumber:asBig(at).toString(),
  blockHash:receipt.blockHash,
  unitSequence:0,generation:1,
  fundsPaidOut:false,
  recipientOnchainEnforced:false,
  merchantSettlementAllowed:false,
  noChainTransactionsBroadcast:true
 });
}
export {ID as FIRST_VOUCHER_ID,issueEvent};
