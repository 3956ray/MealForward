/**
 * EIP712 typed consent reconstructed ONLY from the persisted private Claim.
 * No private beneficiary metadata; server never stores the raw signature.
 * OFFCHAIN ONLY: original StoreEscrow has no recipient-wallet binding.
 */
import {TypedDataEncoder,getAddress} from 'ethers';
import {DOMAIN,TYPES,FIELDS,ORIGINAL_INTENT_BYTES16} from './t1e-recipient-consent.mjs';
import {PILOT_RECIPIENT,ORIGINAL_INTENT,FIRST_VOUCHER,publicClaim} from './t1e-claim-store.mjs';
import {MEAL,TERMS,ESCROW,CHAIN} from './core.mjs';
import {FIXED} from './t1e-first-issue-readiness.mjs';
const safe=(p,c)=>{if(!p)throw Error(c)};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const domainTypes=Object.freeze([
 {name:'name',type:'string'},{name:'version',type:'string'},
 {name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}
]);
export function consentFromClaim(row,now=Math.floor(Date.now()/1000)){
 publicClaim(row); // fail-closed on wrong original/beneficiary/Terms
 safe(row.stage==='PREPARED'&&row.consent_digest===null&&
  Number.isSafeInteger(now)&&now>0&&
  BigInt(row.consent_deadline)>BigInt(now+5)&&
  BigInt(row.consent_deadline)<=BigInt(now+600),
  'T1E_PREPARED_CONSENT_EXPIRED_OR_ALREADY_USED');
 safe(same(row.beneficiary_wallet,PILOT_RECIPIENT)&&
  row.funding_intent===ORIGINAL_INTENT&&
  row.voucher_id.toLowerCase()===FIRST_VOUCHER.toLowerCase()&&
  BigInt(row.generation)===1n&&Number(row.unit_seq)===0,
  'T1E_CONSENT_ROW_NOT_REVIEWED');
 const message=Object.freeze({
  fundingIntentId:ORIGINAL_INTENT_BYTES16,
  recipient:getAddress(row.beneficiary_wallet),
  issuer:getAddress(FIXED.issuerAuthority),
  mealId:MEAL,termsHash:TERMS,voucherId:FIRST_VOUCHER,
  unitSeq:0,generation:1,
  nonce:row.consent_nonce.toLowerCase(),
  deadline:String(row.consent_deadline)
 });
 const digest=TypedDataEncoder.hash(DOMAIN,TYPES,message);
 return Object.freeze({
  kind:'RECIPIENT_OFFCHAIN_CONSENT_ONLY',
  originalFundingIntent:ORIGINAL_INTENT,
  domain:DOMAIN,types:TYPES,message,
  metaMaskV4:Object.freeze({
   domain:DOMAIN,
   primaryType:'RecipientConsent',
   types:{EIP712Domain:domainTypes,RecipientConsent:FIELDS},
   message
  }),
  digest,expiry:String(row.consent_deadline),
  onchainRecipientBinding:false,
  claimOrVoucherIssued:false,
  walletSignatureRequested:false,
  chainId:CHAIN,verifyingContract:ESCROW
 });
}
