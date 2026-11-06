import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet} from 'ethers';
import {makeProductSiwe} from './siwe.mjs';
const wallet=Wallet.createRandom(),now=1793332800;
const fields={wallet:wallet.address.toLowerCase(),nonce:'a'.repeat(64),challengeId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',issuedAt:now,expiresAt:now+180};
test('explicit local profile proves original wallet and rejects a different chain/origin',async()=>{
 const origin='http://127.0.0.1:43210',siwe=makeProductSiwe({profile:'local-acceptance',origin});
 const c=siwe.makeChallenge({...fields,origin,chainId:31337});
 assert.equal(await siwe.verifyChallenge(c,await wallet.signMessage(c.message),now+1),fields.wallet);
 for(const patch of [{chainId:10143},{origin:'http://127.0.0.1:43211'}])assert.throws(()=>siwe.makeChallenge({...fields,origin,chainId:31337,...patch}));
 await assert.rejects(siwe.verifyChallenge({...c,chainId:10143},await wallet.signMessage(c.message),now+1));
});
test('local profile cannot be enabled on a public origin; production remains pinned',()=>{
 for(const origin of ['https://mealforward.onrender.com','http://localhost:1234','http://127.0.0.1.evil:1234'])assert.throws(()=>makeProductSiwe({profile:'local-acceptance',origin}));
 const origin='https://mealforward.onrender.com',siwe=makeProductSiwe({origin});
 assert.throws(()=>siwe.makeChallenge({...fields,origin,chainId:31337}));
 assert.equal(siwe.makeChallenge({...fields,origin,chainId:10143}).chainId,10143);
});
