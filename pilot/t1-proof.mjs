/**
 * T1-B harmless Quote Authority ownership challenge.
 * CRITICAL: this EIP-712 domain/type is deliberately incompatible with the
 * StoreEscrow's FUNDINGQUOTE type and is NOT usable for fund() authorization.
 * No signer, private key, tx call, or persistent signature appears here.
 */
import {
 getAddress,randomBytes,hexlify,verifyTypedData,TypedDataEncoder
} from 'ethers';

export const CONTRACT='0xcF0C8827C8610EEFF1ecbd9719E559d805FafE58';
export const TOKEN='0x534b2f3A21130d7a60830c2Df862319e593943A3';
export const QUOTE='0xcc5C1ce846c0302ab27a4811cf2e0E6FC7282952';
export const MEAL='0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b';
export const CHAIN=10143;
export const PRICE=7000000n;
export const QUOTE_PROOF_DOMAIN=Object.freeze({
 name:'MealForward T1 Role Control Proof - NOT A FUNDING QUOTE',
 version:'1',
 chainId:CHAIN,
 verifyingContract:CONTRACT
});
export const QUOTE_PROOF_TYPES=Object.freeze({
 T1RoleControl:[
  {name:'role',type:'string'},
  {name:'challengeId',type:'bytes32'},
  {name:'expectedAuthority',type:'address'},
  {name:'expiresAt',type:'uint256'}
 ]
});
const stop=(ok,reason)=>{if(!ok)throw Error(reason)};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export function newQuoteProof({now=Math.floor(Date.now()/1000),random=()=>hexlify(randomBytes(32))}={}){
 stop(Number.isSafeInteger(now)&&now>0,'INVALID_ROLE_PROOF_TIME');
 const challengeId=random();
 stop(/^0x[0-9a-fA-F]{64}$/.test(challengeId) &&
  !/^0x0{64}$/i.test(challengeId),'INVALID_ROLE_PROOF_CHALLENGE');
 return Object.freeze({
  role:'QUOTE_AUTHORITY_CONTROL_ONLY',
  challengeId,
  expectedAuthority:QUOTE,
  expiresAt:now+300
 });
}
export function verifyQuoteControlProof({
 message,signature,now=Math.floor(Date.now()/1000)
}={}){
 stop(message?.role==='QUOTE_AUTHORITY_CONTROL_ONLY','WRONG_ROLE_PROOF_KIND');
 stop(same(message.expectedAuthority,QUOTE),'WRONG_QUOTE_AUTHORITY');
 stop(/^0x[0-9a-fA-F]{64}$/.test(message.challengeId),'BAD_CHALLENGE');
 stop(Number.isSafeInteger(message.expiresAt)&&
  message.expiresAt>now&&message.expiresAt<=now+300,
  'ROLE_PROOF_EXPIRED_OR_TOO_LONG');
 const address=getAddress(verifyTypedData(QUOTE_PROOF_DOMAIN,QUOTE_PROOF_TYPES,message,signature));
 stop(same(address,QUOTE),'ROLE_SIGNER_MISMATCH');
 return {
  status:'QUOTE_EOA_CONTROL_PROOF_PASS',
  authority:QUOTE,
  mode:'harmless_t1_role_challenge_not_funding_quote',
  domainHash:TypedDataEncoder.hashDomain(QUOTE_PROOF_DOMAIN),
  expiresAt:message.expiresAt,
  fundingAuthorized:false,privateKeySeen:false
 };
}
export function validateFundingReadOnlyState({
 chainId,escrow,asset,quoteAuthority,listed,paused,closed,
 unitPrice,termsHash,available,capacity,escrowBalance
}={}){
 stop(Number(chainId)===CHAIN,'WRONG_CHAIN');
 stop(same(escrow,CONTRACT)&&same(asset,TOKEN),'ESCROW_OR_TOKEN_MISMATCH');
 stop(same(quoteAuthority,QUOTE),'QUOTE_ROLE_MISMATCH');
 stop(listed===true&&paused===false&&closed===false,'ESCROW_NOT_OPEN');
 stop(BigInt(unitPrice)===PRICE,'PRICE_CHANGED');
 stop(same(termsHash,'0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222'),'TERMS_CHANGED');
 stop(BigInt(available)>=0n&&BigInt(capacity)>=0n&&BigInt(capacity)<=10n,'BAD_CAPACITY');
 stop(BigInt(escrowBalance)>=0n,'BAD_TOKEN_BALANCE');
 return {
  status:'REAL_T1_ONCHAIN_READONLY_PASS',
  newTestEscrow:CONTRACT,
  testAsset:TOKEN,
  canSignFundsNow:false
 };
}
