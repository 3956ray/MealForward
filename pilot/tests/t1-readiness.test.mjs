import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Wallet,TypedDataEncoder,verifyTypedData} from 'ethers';
import {
 signTypedData,recoverTypedSignature,SignTypedDataVersion,TypedDataUtils
} from '@metamask/eth-sig-util';
import {
 CHAIN,CONTRACT,TOKEN,QUOTE,PRICE,
 QUOTE_PROOF_DOMAIN,QUOTE_PROOF_TYPES,
 newQuoteProof,buildMetaMaskQuoteControlPayload,verifyQuoteControlProof,
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
test('regression: actual MetaMask V4 must include EIP712Domain or ethers recovers wrong signer',()=>{
 const key=Wallet.createRandom(); // CI-only ephemeral key, never logged or persisted.
 const now=1790000000;
 const message=newQuoteProof({now,random:()=>('0x'+'6'.repeat(64))});
 const payload=buildMetaMaskQuoteControlPayload(message);
 assert.equal(payload.primaryType,'T1RoleControl');
 assert.deepEqual(payload.types.EIP712Domain,[
  {name:'name',type:'string'},
  {name:'version',type:'string'},
  {name:'chainId',type:'uint256'},
  {name:'verifyingContract',type:'address'}
 ]);
 assert.equal(payload.domain.chainId,CHAIN);
 const v4=SignTypedDataVersion.V4;
 const privateKey=Buffer.from(key.privateKey.slice(2),'hex');
 const signature=signTypedData({privateKey,data:payload,version:v4});
 // Compare the EXACT on-wire MetaMask V4 hash to ethers' intended full-domain hash.
 const metamaskHash='0x'+Buffer.from(TypedDataUtils.eip712Hash(payload,v4)).toString('hex');
 const ethersHash=TypedDataEncoder.hash(QUOTE_PROOF_DOMAIN,QUOTE_PROOF_TYPES,message);
 assert.equal(metamaskHash.toLowerCase(),ethersHash.toLowerCase());
 assert.equal(verifyTypedData(QUOTE_PROOF_DOMAIN,QUOTE_PROOF_TYPES,message,signature),key.address);
 assert.equal(recoverTypedSignature({data:payload,signature,version:v4}).toLowerCase(),key.address.toLowerCase());
 // Reproduce the exact bug in the first T1-B deployment:
 // MetaMask sanitizes a missing domain declaration into EIP712Domain:[],
 // whereas ethers verifies the full domain, resulting in signer mismatch.
 const legacy={...payload,types:{T1RoleControl:QUOTE_PROOF_TYPES.T1RoleControl}};
 const buggySig=signTypedData({privateKey,data:legacy,version:v4});
 assert.equal(recoverTypedSignature({data:legacy,signature:buggySig,version:v4}).toLowerCase(),key.address.toLowerCase());
 assert.notEqual(
  verifyTypedData(QUOTE_PROOF_DOMAIN,QUOTE_PROOF_TYPES,message,buggySig).toLowerCase(),
  key.address.toLowerCase()
 );
 assert.notEqual('0x'+Buffer.from(TypedDataUtils.eip712Hash(legacy,v4)).toString('hex'),ethersHash);
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
 assert.match(script,/buildMetaMaskQuoteControlPayload\(message\)/);
 assert.match(script,/signedWalletEpoch!==walletEpoch/);
 assert.match(script,/ROLE_SIGNER_MISMATCH/);
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
