import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 REGISTERED_ROLES,classifyT1EWallet,walletSelectionHelp
} from './public/t1e-wallet-roles.mjs';
test('every original T0 privileged wallet is rejected for beneficiary role',()=>{
 const roles=Object.entries(REGISTERED_ROLES);
 assert.equal(roles.length,5);
 assert.equal(new Set(roles.map(([_,a])=>a)).size,5);
 for(const [role,address] of roles){
  const lower=classifyT1EWallet('recipient',address);
  const upper=classifyT1EWallet('recipient',address.toUpperCase().replace(/^0X/,'0x'));
  assert.equal(lower.code,'RECIPIENT_MUST_BE_INDEPENDENT',role);
  assert.equal(upper.code,'RECIPIENT_MUST_BE_INDEPENDENT',role);
  assert.equal(lower.ok,false,role);
  assert.equal(lower.wallet,address,role);
  assert.equal(upper.wallet,address,role);
  assert.match(walletSelectionHelp(lower),/MetaMask|独立/);
  assert.ok(lower.roleName?.length>0);
 }
});
test('independent beneficiary wallet is allowed, but never promoted to Issuer',()=>{
 const wallet='0x'+'a'.repeat(40);
 const beneficiary=classifyT1EWallet('recipient',wallet);
 assert.equal(beneficiary.ok,true);
 assert.equal(beneficiary.wallet,wallet);
 assert.match(walletSelectionHelp(beneficiary),/符合/);
 const fakeIssuer=classifyT1EWallet('issuer',wallet);
 assert.equal(fakeIssuer.code,'ONLY_PINNED_ISSUER_ALLOWED');
 assert.equal(fakeIssuer.ok,false);
});
test('the real Issuer address is accepted only in Issuer role',()=>{
 const valid=classifyT1EWallet('issuer',REGISTERED_ROLES.issuer);
 assert.equal(valid.ok,true);
 assert.match(valid.roleName,/Issuer/);
 const notRecipient=classifyT1EWallet('recipient',REGISTERED_ROLES.issuer);
 assert.equal(notRecipient.ok,false);
 assert.equal(notRecipient.code,'RECIPIENT_MUST_BE_INDEPENDENT');
 const incorrect=classifyT1EWallet('issuer',REGISTERED_ROLES.quote);
 assert.equal(incorrect.code,'ONLY_PINNED_ISSUER_ALLOWED');
});
test('invalid and absent MetaMask accounts are denied before challenge',()=>{
 for(const address of [
  undefined,null,'','0x','0x'+'0'.repeat(40),
  '0x'+'1'.repeat(39),'0X'+'a'.repeat(40)
 ]){
  const result=classifyT1EWallet('recipient',address);
  assert.equal(result.ok,false,JSON.stringify(address));
 }
 assert.equal(classifyT1EWallet('recipient','0x'+'0'.repeat(40)).code,'ZERO_WALLET_DENIED');
 assert.equal(classifyT1EWallet('wrong','0x'+'a'.repeat(40)).ok,false);
});
test('real page displays connected account and user-click permission chooser',()=>{
 const ui=readFileSync(new URL('./public/t1e-role-proof.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('./public/t1e-role-proof.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('./t1e-role-proof-server.mjs',import.meta.url),'utf8');
 assert.match(html,/id="recipient-current-wallet"/);
 assert.match(html,/id="issuer-current-wallet"/);
 assert.match(html,/id="recipient-switch"/);
 assert.match(ui,/wallet_requestPermissions/);
 assert.match(ui,/classifyT1EWallet\(role,address\)/);
 assert.match(ui,/const check=preview\(role,wallet\)/);
 assert.match(ui,/if\(!check\.ok\)/);
 assert.match(ui,/实际连接地址/);
 assert.match(ui,/await provider\.request\(\{method:'eth_accounts'\}\)/);
 assert.match(server,/\['\/t1e-wallet-roles\.mjs','t1e-wallet-roles\.mjs'/);
 assert.match(server,/RECIPIENT_MUST_BE_INDEPENDENT/);
 for(const text of [ui,readFileSync(new URL('./public/t1e-wallet-roles.mjs',import.meta.url),'utf8')]){
  for(const forbidden of ['eth_sendTransaction','eth_sendRawTransaction','eth_signTypedData_v4','privateKeyToAccount','localStorage'])
   assert.equal(text.includes(forbidden),false,forbidden);
 }
});
