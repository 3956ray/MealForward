import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,verifyMessage} from 'ethers';
import {personalSign} from '@metamask/eth-sig-util';
import {
 ISSUER_ORIGIN,ISSUER_ADDRESS,ISSUER_ESCROW,ISSUER_CHAIN,
 buildIssuerControlChallenge,recoverEip191Signer,verifyIssuerControlChallenge
} from './t1f-issuer-control.mjs';

const NOW=1792740800;
const NONCE='0x'+'4'.repeat(64);
const fixture=over=>buildIssuerControlChallenge({
 origin:ISSUER_ORIGIN,address:ISSUER_ADDRESS,nonce:NONCE,issuedAt:NOW,...over
});
test('issuer role proof message is hard scoped to the pinned T0 EOA, chain, origin and 5-minute window',()=>{
 const m=fixture();
 assert.equal(m.scope,'LOCAL_BROWSER_EIP191_KEY_CONTROL_ONLY');
 assert.equal(m.expiresAt-NOW,300);
 assert.ok(m.text.includes(ISSUER_ORIGIN));
 assert.ok(m.text.includes(ISSUER_ESCROW));
 assert.ok(m.text.includes(ISSUER_ADDRESS));
 assert.ok(m.text.includes('NOT a transaction'));
 assert.equal(m.validForBackendIssue,false);
 assert.equal(m.fundsAuthorization,false);
 assert.throws(()=>fixture({origin:'https://other.invalid'}),/T1F_FOREIGN_ORIGIN/);
 assert.throws(()=>fixture({address:'0x'+'a'.repeat(40)}),/T1F_NOT_ORIGINAL_ISSUER/);
 assert.throws(()=>fixture({nonce:'0x'+'0'.repeat(64)}),/T1F_BROWSER_CRYPTO_NONCE_REQUIRED/);
 assert.throws(()=>fixture({nonce:'alice'}),/T1F_BROWSER_CRYPTO_NONCE_REQUIRED/);
});
test('actual MetaMask personal_sign and ethers Wallet signMessage have same EIP191 recovery',async()=>{
 const ephemeral=Wallet.createRandom();
 const m=fixture();
 const a=await ephemeral.signMessage(m.text);
 const b=personalSign({
  privateKey:Buffer.from(ephemeral.privateKey.slice(2),'hex'),
  data:'0x'+Buffer.from(m.text,'utf8').toString('hex')
 });
 assert.equal(a.toLowerCase(),b.toLowerCase());
 assert.equal(verifyMessage(m.text,b),ephemeral.address);
 const recovered=recoverEip191Signer({
  message:m.text,signature:b,
  expectedAddress:ephemeral.address,recover:verifyMessage
 });
 assert.equal(recovered,ephemeral.address);
 assert.throws(()=>recoverEip191Signer({
  message:m.text,signature:b,
  expectedAddress:ISSUER_ADDRESS,recover:verifyMessage
 }),/T1F_RECOVERED_SIGNER_NOT_ISSUER/);
});
test('only wallet-local issuer proof is accepted; no reusable backend authorization is emitted',async()=>{
 const m=fixture();
 const wallet=Wallet.createRandom();
 const signature=await wallet.signMessage(m.text);
 // Mock ONLY signer recovery here because the private key of the original
 // registered Issuer is not stored in CI or available to any agent.
 const recovered=(text,sig)=>{
  assert.equal(text,m.text);
  assert.equal(sig,signature);
  return ISSUER_ADDRESS;
 };
 const proof=verifyIssuerControlChallenge({
  challenge:m,signature,selectedAccount:ISSUER_ADDRESS,
  chainId:'0x279f',origin:ISSUER_ORIGIN,now:NOW+11,recover:recovered
 });
 assert.equal(proof.status,'LOCAL_ISSUER_EOA_EIP191_PROOF_PASS');
 assert.equal(proof.validForServerAuthorization,false);
 assert.equal(proof.originalVoucherIssued,false);
 assert.equal(proof.transactionsSent,0);
 assert.equal(JSON.stringify(proof).includes(signature),false);
});
test('issuer proof rejects changed wallet/chain/origin, expired or tampered challenge',async()=>{
 const m=fixture();
 const wallet=Wallet.createRandom();
 const sig=await wallet.signMessage(m.text);
 const ok={challenge:m,signature:sig,selectedAccount:ISSUER_ADDRESS,
  chainId:ISSUER_CHAIN,origin:ISSUER_ORIGIN,now:NOW+10,
  recover:()=>ISSUER_ADDRESS
 };
 for(const bad of [
  {selectedAccount:wallet.address},{chainId:'0x1'},
  {origin:'https://evil.invalid'},{now:NOW-1},{now:NOW+300},
  {challenge:{...m,nonce:'0x'+'0'.repeat(64)}},
  {challenge:{...m,scope:'SERVER_SESSION'}},
  {challenge:{...m,text:m.text+'\nIssue one voucher'}},
  {challenge:{...m,expiresAt:m.expiresAt+3600}},
  {signature:'0x123'},
  {recover:verifyMessage}
 ]){
  assert.throws(()=>verifyIssuerControlChallenge({...ok,...bad}),/T1F_/);
 }
});
