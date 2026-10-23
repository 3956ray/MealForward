import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,TypedDataEncoder,verifyTypedData} from 'ethers';
import {TypedDataUtils,SignTypedDataVersion} from '@metamask/eth-sig-util';
import {
 buildRecipientConsent,verifyRecipientConsent,
 DOMAIN,TYPES,ORIGINAL_INTENT_BYTES16
} from './t1e-recipient-consent.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {MEAL,ESCROW,CHAIN,QUOTE,PRICE} from './core.mjs';

const CLOCK=1792740000;
const nonce='0x'+'a'.repeat(64);
const proof={
 status:'T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS',
 chainId:CHAIN,escrow:ESCROW,mealId:MEAL,
 firstUnitSequence:0,nextGeneration:1,unitPrice:PRICE.toString(),
 originalQuoteUsed:true,verifiedFirstBatch:true,
 issuedOnchain:false
};
const donor=Wallet.createRandom();
const recipient=Wallet.createRandom();
const create=over=>buildRecipientConsent({
 recipient:recipient.address,nonce,deadline:CLOCK+480,
 now:CLOCK,fundedUnitProof:proof,...over
});

test('recipient MetaMask V4 typed hash equals ethers and cannot reuse FundingQuote domain',()=>{
 const p=create();
 assert.equal(p.originalFundingIntent,'2b9ae6f1-2bb7-4096-8136-70f30f302eea');
 assert.equal(p.message.fundingIntentId,ORIGINAL_INTENT_BYTES16);
 assert.equal(p.message.issuer.toLowerCase(),FIXED.issuerAuthority);
 assert.equal(p.domain.verifyingContract,ESCROW);
 assert.equal(p.domain.chainId,CHAIN);
 assert.equal(p.kind,'RECIPIENT_OFFCHAIN_CONSENT_ONLY');
 const mmDigest='0x'+Buffer.from(
  TypedDataUtils.eip712Hash(p.metaMaskV4,SignTypedDataVersion.V4)
 ).toString('hex');
 assert.equal(mmDigest,p.digest);
 assert.equal(TypedDataEncoder.hash(DOMAIN,TYPES,p.message),p.digest);
 assert.notEqual(p.domain.name,'MealForward C0 Funding');
 assert.equal(p.onchainRecipientBinding,false);
 assert.equal(p.claimOrVoucherIssued,false);
});
test('matching recipient wallet EIP712 signature needs an independent durable nonce proof',async()=>{
 const p=create();
 const sig=await recipient.signTypedData(DOMAIN,TYPES,p.message);
 assert.equal(verifyTypedData(DOMAIN,TYPES,p.message,sig),recipient.address);
 assert.throws(()=>verifyRecipientConsent({
  prepared:p,signature:sig,sessionWallet:recipient.address,now:CLOCK+10
 }),/T1E_DURABLE_NONCE_AND_CLAIM_REQUIRED/);
 const ok=verifyRecipientConsent({
  prepared:p,signature:sig,sessionWallet:recipient.address,
  nonceReservedInPrivateDatabase:true,now:CLOCK+10
 });
 assert.equal(ok.status,'OFFCHAIN_RECIPIENT_SIGNATURE_CRYPTO_VERIFIED_ONLY');
 assert.equal(ok.originalFundingIntent,p.originalFundingIntent);
 assert.equal(ok.recipient,recipient.address);
 assert.equal(ok.beneficiaryEligibilityVerified,false);
 assert.equal(ok.onchainIssued,false);
 assert.equal(ok.merchantSettlementAuthorized,false);
});
test('someone else cannot attest recipient consent or use a funding authority wallet',async()=>{
 const p=create();
 const sig=await recipient.signTypedData(DOMAIN,TYPES,p.message);
 assert.throws(()=>verifyRecipientConsent({
  prepared:p,signature:sig,sessionWallet:donor.address,
  nonceReservedInPrivateDatabase:true,now:CLOCK+10
 }),/T1E_SIWE_RECIPIENT_NOT_CONSENT_SIGNER/);
 const other=await donor.signTypedData(DOMAIN,TYPES,p.message);
 assert.throws(()=>verifyRecipientConsent({
  prepared:p,signature:other,sessionWallet:recipient.address,
  nonceReservedInPrivateDatabase:true,now:CLOCK+10
 }),/T1E_RECIPIENT_SIGNATURE_MISMATCH/);
 for(const role of [QUOTE,FIXED.issuerAuthority,FIXED.owner,FIXED.operatorAuthority]){
  assert.throws(()=>create({recipient:role}),/T1E_RECIPIENT_MUST_BE_INDEPENDENT/);
 }
});
test('recipient signature is bound to original unit, consent nonce, onchain escrow, deadline',async()=>{
 const p=create();
 const sig=await recipient.signTypedData(DOMAIN,TYPES,p.message);
 const cases=[
  {...p,message:{...p.message,nonce:'0x'+'b'.repeat(64)}},
  {...p,message:{...p.message,voucherId:'0x'+'f'.repeat(64)}},
  {...p,message:{...p.message,unitSeq:1}},
  {...p,message:{...p.message,generation:2}},
  {...p,message:{...p.message,fundingIntentId:'0x'+'0'.repeat(32)}},
  {...p,message:{...p.message,deadline:(CLOCK+100).toString()}},
  {...p,domain:{...DOMAIN,chainId:1}},
  {...p,domain:{...DOMAIN,verifyingContract:donor.address}},
  {...p,digest:'0x'+'0'.repeat(64)}
 ];
 for(const altered of cases){
  assert.throws(()=>verifyRecipientConsent({
   prepared:altered,signature:sig,sessionWallet:recipient.address,
   nonceReservedInPrivateDatabase:true,now:CLOCK+10
  }),/T1E_/);
 }
});
test('expired, unbounded or unverified source unit must never generate an acceptance',async()=>{
 for(const invalid of [
  {nonce:'0x'+'0'.repeat(64)},
  {nonce:'test-only-nonce'},
  {deadline:CLOCK+601},
  {deadline:CLOCK+1},
  {now:-1},
  {fundedUnitProof:{...proof,nextGeneration:2}},
  {fundedUnitProof:{...proof,issuedOnchain:true}},
  {fundedUnitProof:{...proof,verifiedFirstBatch:false}},
  {fundedUnitProof:null},
  {recipient:'0x0000000000000000000000000000000000000000'}
 ]){
  assert.throws(()=>create(invalid),/T1E_/);
 }
 const p=create();
 const sig=await recipient.signTypedData(DOMAIN,TYPES,p.message);
 assert.throws(()=>verifyRecipientConsent({
  prepared:p,signature:sig,sessionWallet:recipient.address,
  nonceReservedInPrivateDatabase:true,now:CLOCK+477
 }),/T1E_RECIPIENT_CONSENT_EXPIRED/);
});
