/** Mirrors CP30's server-authored SIWE EIP-191 message, with a pinned cloud origin. */
import {createSiweMessage} from 'viem/siwe';
import {getAddress, recoverMessageAddress} from 'viem';
const ADDRESS=/^0x[0-9a-f]{40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NONCE=/^[0-9a-f]{64}$/;
const statement='Sign in to MealForward with your test wallet.';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function makeChallenge({wallet,origin,chainId,nonce,challengeId,issuedAt,expiresAt}) {
  if(!ADDRESS.test(wallet)||!NONCE.test(nonce)||!UUID.test(challengeId)||chainId!==10143||!/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin)&&!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin)||!Number.isSafeInteger(issuedAt)||!Number.isSafeInteger(expiresAt)||expiresAt-issuedAt!==180)throw Error('INVALID_CHALLENGE_CONFIG');
  const message=createSiweMessage({address:getAddress(wallet),chainId,domain:new URL(origin).host,nonce,uri:origin,version:'1',statement,requestId:challengeId,issuedAt:new Date(issuedAt*1000),expirationTime:new Date(expiresAt*1000)});
  return {challengeId,address:wallet,chainId,nonce,domain:new URL(origin).host,uri:origin,issuedAt,expiresAt,message};
}
export async function verifyChallenge(stored,signature,now) {
  if(!exact(stored,['challengeId','address','chainId','nonce','domain','uri','issuedAt','expiresAt','message'])||typeof signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(signature)||!Number.isSafeInteger(now)||now<stored.issuedAt||now>=stored.expiresAt)throw Error('WALLET_LOGIN_REJECTED');
  const rebuilt=makeChallenge({wallet:stored.address,origin:stored.uri,chainId:stored.chainId,nonce:stored.nonce,challengeId:stored.challengeId,issuedAt:stored.issuedAt,expiresAt:stored.expiresAt});
  if(Object.keys(rebuilt).some(k=>rebuilt[k]!==stored[k]))throw Error('WALLET_LOGIN_REJECTED');
  const address=(await recoverMessageAddress({message:rebuilt.message,signature})).toLowerCase();
  if(address!==stored.address)throw Error('WALLET_LOGIN_REJECTED');
  return address;
}
