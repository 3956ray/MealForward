import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Wallet} from 'ethers';
import {
 CHAIN,CONTRACT,TOKEN,QUOTE,PRICE,
 QUOTE_PROOF_DOMAIN,QUOTE_PROOF_TYPES,
 newQuoteProof,verifyQuoteControlProof,
 verifyRoleControlSignature,validateFundingReadOnlyState
} from '../t1-proof.mjs';

const TERMS='0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222';
const validState={
 chainId:CHAIN,escrow:CONTRACT,asset:TOKEN,quoteAuthority:QUOTE,
 listed:true,paused:false,closed:false,unitPrice:PRICE,
 termsHash:TERMS,available:0n,capacity:10n,escrowBalance:0n
};
test('harmless challenge proof verifies real EIP712 EOA signature locally without authorizing fund',async()=>{
 const fakeWallet=Wallet.createRandom();
 const when=1790000000;
 const message={
  ...newQuoteProof({now:when,random:()=>('0x'+'5'.repeat(64))}),
  expectedAuthority:fakeWallet.address
 };
 const signature=await fakeWallet.signTypedData(QUOTE_PROOF_DOMAIN,QUOTE_PROOF_TYPES,message);
 const verified=verifyRoleControlSignature({
  message,signature,now:when+1,expectedAuthority:fakeWallet.address
 });
 assert.equal(verified.status,'QUOTE_EOA_CONTROL_PROOF_PASS');
 assert.equal(verified.fundingAuthorized,false);
 assert.equal(verified.privateKeySeen,false);
 assert.notEqual(QUOTE_PROOF_DOMAIN.name,'MealForward C0 Funding');
 assert.ok(!Object.hasOwn(QUOTE_PROOF_TYPES,'FundingQuote'));
 assert.throws(()=>verifyQuoteControlProof({message,signature,now:when+1}),
  /WRONG_QUOTE_AUTHORITY/);
 assert.throws(()=>verifyRoleControlSignature({
  message,signature,now:when+301,expectedAuthority:fakeWallet.address
 }),/ROLE_PROOF_EXPIRED/);
 assert.throws(()=>verifyRoleControlSignature({
  message:{...message,role:'FundingQuote'},
  signature,now:when+1,expectedAuthority:fakeWallet.address
 }),/WRONG_ROLE_PROOF_KIND/);
});
test('real new StoreEscrow 7 test USDC and registered Quote role cannot be overridden via client inputs',()=>{
 assert.equal(validateFundingReadOnlyState(validState).status,'REAL_T1_ONCHAIN_READONLY_PASS');
 for(const [key,bad,expected] of [
  ['chainId',143,/WRONG_CHAIN/],
  ['escrow','0x0000000000000000000000000000000000000009',/ESCROW_OR_TOKEN_MISMATCH/],
  ['quoteAuthority','0x0000000000000000000000000000000000000009',/QUOTE_ROLE_MISMATCH/],
  ['listed',false,/ESCROW_NOT_OPEN/],
  ['paused',true,/ESCROW_NOT_OPEN/],
  ['unitPrice',5000000n,/PRICE_CHANGED/],
  ['termsHash','0x'+'9'.repeat(64),/TERMS_CHANGED/],
  ['capacity',-1n,/BAD_CAPACITY/]
 ]){
  assert.throws(()=>validateFundingReadOnlyState({...validState,[key]:bad}),expected);
 }
});
test('T1 UI has no funding, approvals, secret capture or automatic signing routes',()=>{
 const root=new URL('../',import.meta.url);
 const html=readFileSync(new URL('t1-readiness.html',root),'utf8');
 const script=readFileSync(new URL('t1-readiness.mjs',root),'utf8');
 const proof=readFileSync(new URL('t1-proof.mjs',root),'utf8');
 assert.match(html,/FUNDS_DISABLED/);
 assert.match(html,/7 Test USDC/);
 assert.match(html,/Quote Authority/);
 assert.match(script,/currentVersion/);
 assert.match(script,/allowance/);
 assert.match(script,/eth_signTypedData_v4/);
 assert.match(script,/QUOTE_PROOF_DOMAIN/);
 assert.match(script,/verifyQuoteControlProof/);
 assert.match(proof,/fundingAuthorized:false/);
 assert.equal((script.match(/eth_signTypedData_v4/g)||[]).length,2);
 for(const forbidden of [
  'eth_sendTransaction','eth_sendRawTransaction','wallet_sendCalls',
  "wallet('personal_sign'",'approve(', 'settle(',
  'privateKey','mnemonic','localStorage.setItem'
 ]){
  assert.ok(!script.includes(forbidden),forbidden);
 }
 assert.ok(!html.includes('<input type="password"'));
});
