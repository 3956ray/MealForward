import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,TypedDataEncoder,verifyTypedData,keccak256} from 'ethers';
import {
 signTypedData,recoverTypedSignature,SignTypedDataVersion,TypedDataUtils
} from '@metamask/eth-sig-util';
import {
 quoteFromFrozenIntent,buildMetaMaskFundingQuoteV4,
 verifyOriginalFundingQuote,exactApproveTransaction,exactFundTransaction,
 DOMAIN_FIELDS
} from './quote-protocol.mjs';
import {
 CHAIN,ESCROW,TOKEN,QUOTE,PRICE,MEAL,TERMS,
 quoteTypes,signatureDomain,erc20,escrowAbi
} from '../t1-intents/core.mjs';

const NOW=1792680000,QUOTE_ID='0x'+'7'.repeat(64);
const payer=Wallet.createRandom();
const quoteAuthority=Wallet.createRandom();
const row=(over={})=>({
  intent_id:'971786d3-403e-422c-a48f-2da4c84532e4',
  chain_id:CHAIN,escrow:ESCROW,payer:payer.address.toLowerCase(),
  stage:'PREPARED',quote_id:QUOTE_ID,meal_id:MEAL,terms_hash:TERMS,
  version:1,quantity:1,unit_price:PRICE.toString(),amount:PRICE.toString(),
  quote_deadline:BigInt(NOW+1200),quote_digest:null,quote_signature_hash:null,
  ...over
});
const syntheticQuote=(q)=>quoteAuthority.signTypedData(signatureDomain,quoteTypes,q);
const override={now:NOW,authorityOverride:quoteAuthority.address};

test('fixed original T0 7 Test USDC quote is bound to EXACT payer/meal/version/amount/deadline',()=>{
 const q=quoteFromFrozenIntent(row(),{now:NOW});
 assert.equal(q.payer,payer.address);
 assert.equal(q.quoteId,QUOTE_ID);
 assert.equal(q.quantity,1n);
 assert.equal(q.unitPrice,7000000n);
 assert.equal(q.amount,7000000n);
 assert.equal(q.deadline,BigInt(NOW+1200));
 assert.equal(signatureDomain.chainId,10143);
 assert.equal(signatureDomain.verifyingContract.toLowerCase(),ESCROW);
 assert.equal(QUOTE.toLowerCase(),'0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952');
 assert.notEqual(signatureDomain.name,'MealForward T1 Role Control Proof - NOT A FUNDING QUOTE');
});
test('all misuse of quoted 7 USDC amount/version, different payer/chain/escrow or expired original is rejected',()=>{
 const bad=[
  [{chain_id:1},/T1D_WRONG_CHAIN_OR_ESCROW/],
  [{escrow:'0x'+'1'.repeat(40)},/T1D_WRONG_CHAIN_OR_ESCROW/],
  [{payer:'0x'+'0'.repeat(40)},/T1D_ZERO_PAYER/],
  [{meal_id:'0x'+'1'.repeat(64)},/T1D_WRONG_MEAL_OR_TERMS/],
  [{terms_hash:'0x'+'1'.repeat(64)},/T1D_WRONG_MEAL_OR_TERMS/],
  [{version:2},/T1D_WRONG_MEAL_VERSION/],
  [{quantity:2},/T1D_SINGLE_MEAL_ONLY/],
  [{unit_price:8000000n},/T1D_AMOUNT_NOT_7_TEST_USDC/],
  [{amount:1000000n},/T1D_AMOUNT_NOT_7_TEST_USDC/],
  [{quote_id:'0x'+'0'.repeat(64)},/T1D_INVALID_QUOTE_ID/],
  [{quote_deadline:BigInt(NOW+2)},/T1D_QUOTE_TOO_CLOSE_TO_EXPIRY/],
  [{quote_deadline:BigInt(NOW+5000)},/T1D_QUOTE_DEADLINE_EXCEEDS_30_MINUTES/],
  [{stage:'FUNDED'},/T1D_ILLEGAL_INTENT_STAGE/]
 ];
 for(const [change,msg] of bad){
  assert.throws(()=>quoteFromFrozenIntent(row(change),{now:NOW}),msg);
 }
});
test('EIP-712 MetaMask V4 on-wire digest EXACTLY matches original ethers FundingQuote full domain',()=>{
 const m=buildMetaMaskFundingQuoteV4(row(),{now:NOW});
 assert.equal(m.signer.toLowerCase(),QUOTE);
 assert.equal(m.quoteId,QUOTE_ID);
 assert.equal(m.payer,payer.address);
 assert.equal(m.payload.primaryType,'FundingQuote');
 assert.deepEqual(m.payload.types.EIP712Domain,DOMAIN_FIELDS);
 assert.equal(m.payload.domain.name,'MealForward C0 Funding');
 assert.equal(m.payload.domain.version,'1');
 assert.equal(m.payload.domain.chainId,CHAIN);
 assert.equal(m.payload.domain.verifyingContract.toLowerCase(),ESCROW);
 assert.deepEqual(m.payload.types.FundingQuote,quoteTypes.FundingQuote);
 assert.equal(m.payload.message.amount,'7000000');
 const metamaskDigest='0x'+Buffer.from(TypedDataUtils.eip712Hash(m.payload,SignTypedDataVersion.V4)).toString('hex');
 assert.equal(metamaskDigest,m.digest);
 assert.equal(m.digest,TypedDataEncoder.hash(signatureDomain,quoteTypes,quoteFromFrozenIntent(row(),{now:NOW})));
 const privateKey=Buffer.from(quoteAuthority.privateKey.slice(2),'hex');
 const signature=signTypedData({privateKey,data:m.payload,version:SignTypedDataVersion.V4});
 assert.equal(recoverTypedSignature({data:m.payload,signature,version:SignTypedDataVersion.V4}).toLowerCase(),quoteAuthority.address.toLowerCase());
 assert.equal(verifyTypedData(signatureDomain,quoteTypes,quoteFromFrozenIntent(row(),{now:NOW}),signature).toLowerCase(),quoteAuthority.address.toLowerCase());
});
test('regression: missing EIP712Domain makes MetaMask sign wrong hash (original T1-B failure class)',()=>{
 const m=buildMetaMaskFundingQuoteV4(row(),{now:NOW});
 const privateKey=Buffer.from(quoteAuthority.privateKey.slice(2),'hex');
 const broken={...m.payload,types:{FundingQuote:m.payload.types.FundingQuote}};
 const sig=signTypedData({privateKey,data:broken,version:SignTypedDataVersion.V4});
 assert.notEqual('0x'+Buffer.from(TypedDataUtils.eip712Hash(broken,SignTypedDataVersion.V4)).toString('hex'),m.digest);
 assert.notEqual(verifyTypedData(signatureDomain,quoteTypes,quoteFromFrozenIntent(row(),{now:NOW}),sig).toLowerCase(),quoteAuthority.address.toLowerCase());
});
test('actual Quote EOA immutable in prod; synthetic keys accepted only under disposable GitHub CI',async()=>{
 const q=quoteFromFrozenIntent(row(),{now:NOW});
 const sig=await syntheticQuote(q);
 assert.throws(()=>verifyOriginalFundingQuote(row(),sig,{now:NOW}),/T1D_QUOTE_SIGNER_NOT_ONCHAIN_AUTHORITY/);
 assert.equal(verifyOriginalFundingQuote(row(),sig,override).signer.toLowerCase(),quoteAuthority.address.toLowerCase());
 assert.equal(verifyOriginalFundingQuote(row(),sig,override).amount,'7000000');
 assert.throws(()=>verifyOriginalFundingQuote(row(),sig,{
   now:NOW,authorityOverride:QUOTE
 }),/T1D_QUOTE_SIGNER_NOT_ONCHAIN_AUTHORITY/);
});
test('quote signed for one payer / amount / nonce cannot be modified or reused for another original quote',async()=>{
 const q=quoteFromFrozenIntent(row(),{now:NOW});
 const sig=await syntheticQuote(q);
 const binding=verifyOriginalFundingQuote(row(),sig,override);
 assert.equal(binding.fingerprint,keccak256(sig));
 assert.equal(binding.digest,TypedDataEncoder.hash(signatureDomain,quoteTypes,q));
 for(const altered of [
  {payer:Wallet.createRandom().address.toLowerCase()},
  {quote_id:'0x'+'8'.repeat(64)},
  {quote_deadline:BigInt(NOW+1000)}
 ]){
  assert.throws(()=>verifyOriginalFundingQuote(row(altered),sig,override),/T1D_QUOTE_SIGNER_NOT_ONCHAIN_AUTHORITY/);
 }
 assert.throws(()=>verifyOriginalFundingQuote(row({quote_digest:'0x'+'2'.repeat(64)}),sig,override),
  /T1D_ORIGINAL_QUOTE_DIGEST_CHANGED/);
 assert.throws(()=>verifyOriginalFundingQuote(row({quote_signature_hash:'0x'+'2'.repeat(64)}),sig,override),
  /T1D_ORIGINAL_QUOTE_SIGNATURE_CHANGED/);
 const p2=await Wallet.createRandom().signMessage('T1-B harmless control proof');
 assert.throws(()=>verifyOriginalFundingQuote(row(),p2,override),/T1D_QUOTE_SIGNER_NOT_ONCHAIN_AUTHORITY/);
});
test('wallet Approve transaction is exact 7 Test USDC ERC20 spender and chain/nonce, NEVER sends',()=>{
 const tx=exactApproveTransaction(row({stage:'QUOTE_BOUND'}),{nonce:14,now:NOW});
 assert.equal(tx.from.toLowerCase(),payer.address.toLowerCase());
 assert.equal(tx.to.toLowerCase(),TOKEN);
 assert.equal(tx.chainId,'0x279f');
 assert.equal(tx.value,'0x0');
 assert.equal(tx.nonce,'0xe');
 assert.equal('gas' in tx,false);
 const call=erc20.parseTransaction({data:tx.data});
 assert.equal(call.name,'approve');
 assert.equal(call.args[0].toLowerCase(),ESCROW);
 assert.equal(call.args[1],7000000n);
 assert.throws(()=>exactApproveTransaction(row({stage:'PREPARED'}),{nonce:14,now:NOW}),
  /T1D_ILLEGAL_INTENT_STAGE/);
 assert.throws(()=>exactApproveTransaction(row({stage:'QUOTE_BOUND'}),{nonce:-1,now:NOW}),
  /T1D_INVALID_UINT/);
});
test('only original APPROVED + EIP712 Quote from valid signer yields encoded StoreEscrow.fund without sending',async()=>{
 const q=quoteFromFrozenIntent(row(),{now:NOW});
 const sig=await syntheticQuote(q);
 const frozen={
  stage:'APPROVED',
  quote_digest:TypedDataEncoder.hash(signatureDomain,quoteTypes,q),
  quote_signature_hash:keccak256(sig)
 };
 const tx=exactFundTransaction(row(frozen),{signature:sig,nonce:15,...override});
 assert.equal(tx.from.toLowerCase(),payer.address.toLowerCase());
 assert.equal(tx.to.toLowerCase(),ESCROW);
 assert.equal(tx.value,'0x0');
 assert.equal(tx.nonce,'0xf');
 assert.equal(tx.chainId,'0x279f');
 const call=escrowAbi.parseTransaction({data:tx.data});
 assert.equal(call.name,'fund');
 assert.equal(call.args[0].quoteId,QUOTE_ID);
 assert.equal(call.args[0].payer.toLowerCase(),payer.address.toLowerCase());
 assert.equal(call.args[0].amount,PRICE);
 assert.equal(call.args[0].unitPrice,PRICE);
 assert.equal(call.args[0].quantity,1n);
 assert.equal(call.args[1],sig);
 assert.throws(()=>exactFundTransaction(row({stage:'QUOTE_BOUND'}),{signature:sig,nonce:15,...override}),
  /T1D_ORIGINAL_APPROVAL_NOT_CONFIRMED/);
 assert.throws(()=>exactFundTransaction(row(frozen),{signature:sig,nonce:15,now:NOW+1400,authorityOverride:quoteAuthority.address}),
  /T1D_QUOTE_TOO_CLOSE_TO_EXPIRY/);
});
test('production cannot override fixed chain registered authority via a request without disposable CI safety flag',async()=>{
 const previous=process.env.MF_T1D_DISPOSABLE_ONLY;
 try{
  delete process.env.MF_T1D_DISPOSABLE_ONLY;
  const sig=await syntheticQuote(quoteFromFrozenIntent(row(),{now:NOW}));
  assert.throws(()=>verifyOriginalFundingQuote(row(),sig,{now:NOW,authorityOverride:quoteAuthority.address}),
   /T1D_PRODUCTION_QUOTE_AUTHORITY_IMMUTABLE/);
 }finally{
  if(previous!==undefined)process.env.MF_T1D_DISPOSABLE_ONLY=previous;
 }
});
