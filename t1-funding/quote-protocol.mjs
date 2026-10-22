/**
 * MealForward T1-D — real Monad Testnet 7 USDC *intent-bound* quote and
 * transaction construction. This library cannot send transactions.
 *
 * All values are pinned to the ORIGINAL T0 StoreEscrow on 10143.
 * No new contract, chain, token, owner or Quote Authority is configured.
 *
 * IMPORTANT: the T1-B harmless role-control signature is INCOMPATIBLE
 * with the StoreEscrow FundingQuote domain and must never be reused.
 */
import {
  getAddress,verifyTypedData,TypedDataEncoder,keccak256
} from 'ethers';
import {
 CHAIN,ESCROW,TOKEN,MEAL,TERMS,QUOTE,PRICE,
 signatureDomain,quoteTypes,erc20,escrowAbi
} from '../t1-intents/core.mjs';

const DOMAIN_FIELDS=Object.freeze([
  {name:'name',type:'string'},
  {name:'version',type:'string'},
  {name:'chainId',type:'uint256'},
  {name:'verifyingContract',type:'address'}
]);
const ONE=1n;
const HEX32=/^0x[0-9a-fA-F]{64}$/;
const HEX130=/^0x[0-9a-fA-F]{130}$/;
const fail=(ok,why)=>{if(!ok)throw Error(why)};
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const uint=x=>{
  fail((typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x))||
    (typeof x==='number'&&Number.isSafeInteger(x)&&x>=0)||
    (typeof x==='bigint'&&x>=0n),
  'T1D_INVALID_UINT');
  const n=BigInt(x);
  fail(n>=0n,'T1D_INVALID_UINT');
  return n;
};
function wallet(x){
 fail(typeof x==='string'&&/^0x[a-fA-F0-9]{40}$/.test(x),
  'T1D_WALLET_ADDRESS_REQUIRED');
 const a=getAddress(x);
 fail(!eq(a,'0x0000000000000000000000000000000000000000'),
  'T1D_ZERO_PAYER');
 return a;
}
function currentTime(now){
 fail(Number.isSafeInteger(now)&&now>0,'T1D_SERVER_CLOCK_REQUIRED');
 return BigInt(now);
}
export function quoteFromFrozenIntent(row,{now=Math.floor(Date.now()/1000),stages=['PREPARED','QUOTE_BOUND','APPROVED']}={}){
 fail(row&&typeof row==='object','T1D_FROZEN_INTENT_REQUIRED');
 fail(stages.includes(row.stage),'T1D_ILLEGAL_INTENT_STAGE');
 fail(uint(row.chain_id)===BigInt(CHAIN)&&eq(row.escrow,ESCROW),'T1D_WRONG_CHAIN_OR_ESCROW');
 fail(eq(row.meal_id,MEAL)&&eq(row.terms_hash,TERMS),'T1D_WRONG_MEAL_OR_TERMS');
 fail(uint(row.version)===1n,'T1D_WRONG_MEAL_VERSION');
 fail(uint(row.quantity)===ONE,'T1D_SINGLE_MEAL_ONLY');
 fail(uint(row.unit_price)===PRICE&&uint(row.amount)===PRICE,
   'T1D_AMOUNT_NOT_7_TEST_USDC');
 fail(typeof row.quote_id==='string'&&HEX32.test(row.quote_id)&&
  !/^0x0{64}$/i.test(row.quote_id),'T1D_INVALID_QUOTE_ID');
 const expires=uint(row.quote_deadline);
 const nowN=currentTime(now);
 fail(expires>nowN+60n,'T1D_QUOTE_TOO_CLOSE_TO_EXPIRY');
 fail(expires<=nowN+1800n,'T1D_QUOTE_DEADLINE_EXCEEDS_30_MINUTES');
 const payer=wallet(row.payer);
 return Object.freeze({
  quoteId:row.quote_id.toLowerCase(),
  payer,
  mealId:MEAL,
  currentVersion:1n,
  termsHash:TERMS,
  quantity:ONE,
  unitPrice:PRICE,
  amount:PRICE,
  deadline:expires
 });
}
export function buildMetaMaskFundingQuoteV4(row,{now=Math.floor(Date.now()/1000)}={}){
 const q=quoteFromFrozenIntent(row,{now,stages:['PREPARED']});
 // MetaMask's eth_signTypedData_v4 requires EIP712Domain TYPES to be
 // provided explicitly, not inferred from domain. Missing this field
 // caused T1-B's original ROLE_SIGNER_MISMATCH (already fixed there).
 const rpcPayload={
  types:{
   EIP712Domain:DOMAIN_FIELDS.map(x=>({...x})),
   FundingQuote:quoteTypes.FundingQuote.map(x=>({...x}))
  },
  primaryType:'FundingQuote',
  domain:{...signatureDomain},
  message:{
   quoteId:q.quoteId,
   payer:q.payer,
   mealId:q.mealId,
   currentVersion:q.currentVersion.toString(),
   termsHash:q.termsHash,
   quantity:q.quantity.toString(),
   unitPrice:q.unitPrice.toString(),
   amount:q.amount.toString(),
   deadline:q.deadline.toString()
  }
 };
 const digest=TypedDataEncoder.hash(signatureDomain,quoteTypes,q);
 return {signer: getAddress(QUOTE),payer:q.payer,
  digest,expiry: q.deadline.toString(),quoteId:q.quoteId,
  payload:rpcPayload};
}
export function verifyOriginalFundingQuote(row,signature,{now=Math.floor(Date.now()/1000)}={}){
 fail(typeof signature==='string'&&HEX130.test(signature),'T1D_BAD_QUOTE_SIGNATURE');
 const q=quoteFromFrozenIntent(row,{now});
 const actual=verifyTypedData(signatureDomain,quoteTypes,q,signature);
 fail(eq(actual,QUOTE),'T1D_QUOTE_SIGNER_NOT_ONCHAIN_AUTHORITY');
 const digest=TypedDataEncoder.hash(signatureDomain,quoteTypes,q);
 if(row.quote_digest!==undefined&&row.quote_digest!==null)
  fail(eq(row.quote_digest,digest),'T1D_ORIGINAL_QUOTE_DIGEST_CHANGED');
 if(row.quote_signature_hash!==undefined&&row.quote_signature_hash!==null)
  fail(eq(row.quote_signature_hash,keccak256(signature)),
    'T1D_ORIGINAL_QUOTE_SIGNATURE_CHANGED');
 return Object.freeze({
  signer:getAddress(actual),
  quoteId:q.quoteId,
  payer:q.payer,
  digest,
  fingerprint:keccak256(signature),
  chainId:CHAIN,
  amount:PRICE.toString(),
  expires:q.deadline.toString()
 });
}
function nonce(n){
 const v=uint(n);
 fail(v<=BigInt(Number.MAX_SAFE_INTEGER),'T1D_NONCE_TOO_LARGE');
 return '0x'+v.toString(16);
}
export function exactApproveTransaction(row,{nonce:txNonce,now=Math.floor(Date.now()/1000)}={}){
 const q=quoteFromFrozenIntent(row,{now,stages:['QUOTE_BOUND']});
 return Object.freeze({
  from:q.payer,
  to:getAddress(TOKEN),
  value:'0x0',chainId:'0x279f',nonce:nonce(txNonce),
  data:erc20.encodeFunctionData('approve',[ESCROW,PRICE]),
  gas:null // gas estimate is wallet-owned; no invisible approval/signing
 });
}
export function exactFundTransaction(row,{signature,nonce:txNonce,now=Math.floor(Date.now()/1000)}={}){
 fail(row.stage==='APPROVED','T1D_ORIGINAL_APPROVAL_NOT_CONFIRMED');
 verifyOriginalFundingQuote(row,signature,{now});
 const q=quoteFromFrozenIntent(row,{now,stages:['APPROVED']});
 return Object.freeze({
  from:q.payer,
  to:getAddress(ESCROW),
  value:'0x0',chainId:'0x279f',nonce:nonce(txNonce),
  data:escrowAbi.encodeFunctionData('fund',[q,signature]),
  gas:null
 });
}
export {DOMAIN_FIELDS};
