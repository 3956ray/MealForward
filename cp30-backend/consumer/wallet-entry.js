// Read-only reuse of the finalized helper. No provider or network at module load.
export {prepareApprove,prepareFund,prepareSettle} from '../integrations/wallet/index.mjs';
import {parseUnits,formatUnits,createClient,custom,getAddress} from 'viem';
import {signMessage} from 'viem/actions';
import {createSiweMessage} from 'viem/siwe';

export function validateWalletLoginChallenge(challenge,{address,chainId,origin,now}){
  const fields=['challengeId','address','chainId','nonce','domain','uri','issuedAt','expiresAt','message'];
  const fail=()=>{throw Error('钱包登录请求不匹配或已过期，请重新点击登录。');};
  if(!challenge || typeof challenge!=='object' || Array.isArray(challenge) || Object.keys(challenge).length!==fields.length || fields.some(key=>!Object.hasOwn(challenge,key)))fail();
  let location;try{location=new URL(origin);}catch{fail();}
  if(location.origin!==origin || !['http:','https:'].includes(location.protocol) || challenge.domain!==location.host || challenge.uri!==origin || chainId!==10143 || challenge.chainId!==chainId)fail();
  if(!/^0x[0-9a-f]{40}$/.test(challenge.address) || challenge.address==='0x'+'0'.repeat(40) || challenge.address!==getAddress(address).toLowerCase())fail();
  if(!/^[0-9a-f]{64}$/.test(challenge.nonce) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(challenge.challengeId))fail();
  const {issuedAt,expiresAt}=challenge;
  if(!Number.isSafeInteger(now) || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || issuedAt<=0 || issuedAt>now || expiresAt<=now || expiresAt<=issuedAt || expiresAt-issuedAt>300)fail();
  const message=createSiweMessage({address:getAddress(challenge.address),domain:challenge.domain,uri:challenge.uri,chainId,nonce:challenge.nonce,
    issuedAt:new Date(issuedAt*1000),expirationTime:new Date(expiresAt*1000),statement:'Sign in to MealForward with your test wallet.',version:'1',requestId:challenge.challengeId});
  if(challenge.message!==message)fail();
  return message;
}
export async function signWalletLoginMessage(provider,challenge,context){
  const message=validateWalletLoginChallenge(challenge,context),account=getAddress(context.address);
  const client=createClient({account,transport:custom(provider,{retryCount:0,methods:{include:['personal_sign']}})});
  try{return await signMessage(client,{account,message});}
  catch{throw Error('钱包登录签名未完成。请确认钱包提示后，重新点击登录。');}
}
export function priceUnits(value,decimals){
  if(!Number.isInteger(decimals) || decimals<0 || decimals>36 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) || (value.split('.')[1]?.length || 0)>decimals)throw Error('Check the meal price.');
  const units=parseUnits(value,decimals);if(units<=0n)throw Error('Check the meal price.');return units.toString();
}
export function priceDisplay(value,decimals,symbol=''){
  if(!Number.isInteger(decimals) || decimals<0 || decimals>36 || !/^(0|[1-9][0-9]*)$/.test(String(value)))throw Error('The configured amount is unavailable.');
  return formatUnits(BigInt(value),decimals)+(symbol?' '+symbol:'');
}
