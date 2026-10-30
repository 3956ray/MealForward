import {parseSiweMessage,createSiweMessage} from 'viem/siwe';
import {getAddress} from 'viem';
import {validateProductConfiguration} from './product-network.mjs';
export function validateProductChallenge(c,account,origin,configuration,now=Date.now()){
 const target=validateProductConfiguration(configuration,origin),m=parseSiweMessage(c?.message||'');
 if(!/^0x[0-9a-f]{40}$/i.test(account||'')||m.address?.toLowerCase()!==account.toLowerCase()||
 m.domain!==new URL(origin).host||m.uri!==origin||m.chainId!==target.chainId||
 m.requestId!==c.challengeId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(c.challengeId||'')||m.version!=='1'||
 m.statement!=='Sign in to MealForward with your test wallet.'||!/^[a-f0-9]{64}$/.test(m.nonce||'')||
 !Number.isFinite(m.issuedAt?.getTime())||!Number.isFinite(m.expirationTime?.getTime())||
 m.expirationTime.getTime()<=now||m.issuedAt.getTime()>now+30000||
 m.expirationTime.getTime()-m.issuedAt.getTime()!==180000||m.resources?.length||m.notBefore)
 throw Error('INVALID_LOGIN_CHALLENGE');
 const rebuilt=createSiweMessage({address:getAddress(account),chainId:target.chainId,domain:new URL(origin).host,nonce:m.nonce,uri:origin,version:'1',statement:m.statement,requestId:c.challengeId,issuedAt:m.issuedAt,expirationTime:m.expirationTime});
 if(rebuilt!==c.message)throw Error('INVALID_LOGIN_CHALLENGE');
}
