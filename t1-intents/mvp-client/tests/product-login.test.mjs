import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProductSiwe} from '../../product-v2/siwe.mjs';
import {validateProductChallenge} from '../product-login.mjs';
const wallet='0x'+'11'.repeat(20),other='0x'+'22'.repeat(20),origin='https://mealforward-test.onrender.com',now=1800000000000;
const configuration={verified:true,profile:'monad-testnet',chainId:10143,asset:'0x534b2f3a21130d7a60830c2df862319e593943a3',escrow:'0x'+'aa'.repeat(20)};
function challenge(profile='monad-testnet',targetOrigin=origin){return makeProductSiwe({profile,origin:targetOrigin}).makeChallenge({wallet,origin:targetOrigin,chainId:profile==='local-acceptance'?31337:10143,nonce:'ab'.repeat(32),challengeId:'11111111-2222-3333-4444-555555555555',issuedAt:now/1000,expiresAt:now/1000+180});}
test('actual backend SIWE builder is accepted for pinned Monad and explicit local profiles',()=>{
 validateProductChallenge(challenge(),wallet,origin,configuration,now);
 const localOrigin='http://127.0.0.1:43210',local={...configuration,profile:'local-acceptance',chainId:31337,asset:'0x'+'bb'.repeat(20)};validateProductChallenge(challenge('local-acceptance',localOrigin),wallet,localOrigin,local,now);
});
test('challenge address, domain, URI, chain, request id, statement, nonce and time remain strict',()=>{
 const c=challenge();for(const [index,message] of [c.message.replace(wallet,other),c.message.replace('mealforward-test.onrender.com wants','evil.onrender.com wants'),c.message.replace('URI: '+origin,'URI: https://evil.onrender.com'),c.message.replace('Chain ID: 10143','Chain ID: 31337'),c.message.replace(c.challengeId,'99999999-2222-3333-4444-555555555555'),c.message.replace('Sign in to MealForward with your test wallet.','Approve arbitrary terms.'),c.message.replace('Nonce: '+'ab'.repeat(32),'Nonce: abcdefgh'),c.message.replace('Version: 1','Version: 2'),c.message.replace(new Date(now+180000).toISOString(),new Date(now+181000).toISOString()),c.message+'\nResources:\n- https://evil.test/',c.message+'\nNot Before: '+new Date(now).toISOString()].entries())assert.throws(()=>validateProductChallenge({...c,message},wallet,origin,configuration,now),undefined,'mutation '+index);
 assert.throws(()=>validateProductChallenge(c,other,origin,configuration,now));assert.throws(()=>validateProductChallenge(c,wallet,origin,configuration,now+180000));assert.throws(()=>validateProductChallenge(c,wallet,origin,configuration,now-31000));
});
test('local SIWE cannot cross into a default profile or public origin',()=>{
 const localOrigin='http://127.0.0.1:43210',c=challenge('local-acceptance',localOrigin);assert.throws(()=>validateProductChallenge(c,wallet,localOrigin,{...configuration,chainId:31337},now));assert.throws(()=>validateProductChallenge(c,wallet,origin,{...configuration,profile:'local-acceptance',chainId:31337},now));assert.throws(()=>validateProductChallenge(c,wallet,localOrigin,configuration,now));
});
