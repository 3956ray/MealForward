/**
 * MEALFORWARD T1-E: OFFCHAIN ONLY beneficiary-wallet consent.
 *
 * IMPORTANT: the original, already deployed T0 StoreEscrow.issue() DOES NOT
 * accept a recipient address, signature or authorization at all. This
 * EIP-712 message protects a future private enrollment workflow, but it is
 * NOT enforced by the contract and it does NOT establish eligibility, food
 * handover or resistance to a malicious Issuer/Operator/Owner collusion.
 *
 * No wallet, signature collection server, voucher delivery API, nonce
 * database, claim entitlement or chain write method lives in this module.
 * It must NOT be exposed as a claim/Issue endpoint before a separate,
 * durable, independently authorized recipient ledger is built and audited.
 */
import {getAddress,verifyTypedData,TypedDataEncoder,keccak256} from 'ethers';
import {CHAIN,ESCROW,MEAL,TERMS,PRICE,QUOTE} from './core.mjs';
import {FIXED,originalVoucherId} from './t1e-first-issue-readiness.mjs';

const strict=(value,code)=>{if(!value)throw Error(code)};
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const HEX32=/^0x[0-9a-fA-F]{64}$/;
const HEX130=/^0x[0-9a-fA-F]{130}$/;
const UUID='2b9ae6f1-2bb7-4096-8136-70f30f302eea';
const ORIGINAL_INTENT_BYTES16='0x2b9ae6f12bb74096813670f30f302eea';
const ZERO='0x'+'0'.repeat(64);
const roles=new Set([
 FIXED.owner,FIXED.catalogAuthority,
 FIXED.issuerAuthority,FIXED.operatorAuthority,QUOTE
].map(x=>x.toLowerCase()));
const DOMAIN=Object.freeze({
 name:'MealForward T1-E Recipient Consent - OFFCHAIN ONLY',
 version:'1',chainId:CHAIN,verifyingContract:ESCROW
});
const FIELDS=Object.freeze([
 {name:'fundingIntentId',type:'bytes16'},
 {name:'recipient',type:'address'},
 {name:'issuer',type:'address'},
 {name:'mealId',type:'bytes32'},
 {name:'termsHash',type:'bytes32'},
 {name:'voucherId',type:'bytes32'},
 {name:'unitSeq',type:'uint8'},
 {name:'generation',type:'uint256'},
 {name:'nonce',type:'bytes32'},
 {name:'deadline',type:'uint256'}
]);
const TYPES=Object.freeze({RecipientConsent:FIELDS});
const metaMaskDomain=[
 {name:'name',type:'string'}, {name:'version',type:'string'},
 {name:'chainId',type:'uint256'}, {name:'verifyingContract',type:'address'}
];

function recipientAddress(wallet){
 strict(typeof wallet==='string'&&/^0x[0-9a-fA-F]{40}$/.test(wallet),
  'T1E_RECIPIENT_WALLET_REQUIRED');
 const x=getAddress(wallet);
 strict(!roles.has(x.toLowerCase())&&
  !eq(x,'0x0000000000000000000000000000000000000000'),
  'T1E_RECIPIENT_MUST_BE_INDEPENDENT');
 return x;
}
function num(value){
 strict((typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)||
  (typeof value==='bigint'&&value>=0n)||
  (typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)),
  'T1E_CONSENT_UINT_INVALID');
 return BigInt(value);
}
const current=()=>{
 const now=Math.floor(Date.now()/1000);
 strict(now>0,'T1E_SERVER_CLOCK_INVALID');
 return now;
};
export function buildRecipientConsent({
 recipient,nonce,deadline,now=current(),fundedUnitProof
}={}){
 const who=recipientAddress(recipient);
 strict(HEX32.test(nonce||'')&&!eq(nonce,ZERO),
  'T1E_NONCE_FROM_DURABLE_LEDGER_REQUIRED');
 strict(Number.isSafeInteger(now)&&now>0,'T1E_SERVER_CLOCK_INVALID');
 const end=num(deadline);
 strict(end>BigInt(now+30)&&end<=BigInt(now+600),
  'T1E_CONSENT_VALIDITY_MAX_10_MINUTES');
 strict(fundedUnitProof&&
  fundedUnitProof.status==='T1E_ORIGINAL_FUNDED_UNIT_READONLY_ISSUE_GATE_PASS'&&
  fundedUnitProof.chainId===CHAIN&&eq(fundedUnitProof.escrow,ESCROW)&&
  eq(fundedUnitProof.mealId,MEAL)&&
  fundedUnitProof.firstUnitSequence===0&&
  fundedUnitProof.nextGeneration===1&&
  fundedUnitProof.unitPrice===PRICE.toString()&&
  fundedUnitProof.originalQuoteUsed===true&&
  fundedUnitProof.verifiedFirstBatch===true&&
  fundedUnitProof.issuedOnchain===false,
  'T1E_PINNED_FRESH_FUNDED_UNIT_PROOF_REQUIRED');
 const payload=Object.freeze({
  fundingIntentId:ORIGINAL_INTENT_BYTES16,
  recipient:who,
  issuer:getAddress(FIXED.issuerAuthority),
  mealId:MEAL,termsHash:TERMS,
  voucherId:originalVoucherId(0,1n),
  unitSeq:0,generation:1,
  nonce:nonce.toLowerCase(),
  deadline:end.toString()
 });
 return Object.freeze({
  kind:'RECIPIENT_OFFCHAIN_CONSENT_ONLY',
  originalFundingIntent:UUID,
  domain:DOMAIN,types:TYPES,message:payload,
  digest:TypedDataEncoder.hash(DOMAIN,TYPES,payload),
  metaMaskV4:Object.freeze({
   types:{EIP712Domain:metaMaskDomain,RecipientConsent:FIELDS},
   primaryType:'RecipientConsent',domain:DOMAIN,message:payload
  }),
  expiry:end.toString(),
  onchainRecipientBinding:false,
  claimOrVoucherIssued:false,
  walletSignatureRequested:false
 });
}

export function verifyRecipientConsent({
 prepared,signature,sessionWallet,nonceReservedInPrivateDatabase=false,now=current()
}={}){
 strict(prepared&&prepared.kind==='RECIPIENT_OFFCHAIN_CONSENT_ONLY',
  'T1E_CONSENT_NOT_PREPARED');
 strict(nonceReservedInPrivateDatabase===true,
  'T1E_DURABLE_NONCE_AND_CLAIM_REQUIRED');
 strict(Number.isSafeInteger(now)&&now>0,'T1E_SERVER_CLOCK_INVALID');
 strict(BigInt(prepared.expiry)>BigInt(now+5)&&
  BigInt(prepared.expiry)<=BigInt(now+600)&&
  BigInt(prepared.message?.deadline??0)===BigInt(prepared.expiry),
  'T1E_RECIPIENT_CONSENT_EXPIRED');
 strict(HEX130.test(signature||''),'T1E_WRONG_ECDSA_SIGNATURE');
 const who=recipientAddress(sessionWallet);
 strict(eq(prepared.message.recipient,who),
  'T1E_SIWE_RECIPIENT_NOT_CONSENT_SIGNER');
 strict(eq(prepared.message.fundingIntentId,ORIGINAL_INTENT_BYTES16)&&
  eq(prepared.message.issuer,FIXED.issuerAuthority)&&
  eq(prepared.message.mealId,MEAL)&&
  eq(prepared.message.termsHash,TERMS)&&
  eq(prepared.message.voucherId,originalVoucherId(0,1n))&&
  prepared.message.unitSeq===0&&
  num(prepared.message.generation)===1n&&
  HEX32.test(prepared.message.nonce)&&
  !eq(prepared.message.nonce,ZERO),
  'T1E_RECIPIENT_CONSENT_ORIGINAL_UNIT_CHANGED');
 strict(eq(prepared.domain.name,DOMAIN.name)&&
  prepared.domain.version===DOMAIN.version&&
  prepared.domain.chainId===DOMAIN.chainId&&
  eq(prepared.domain.verifyingContract,DOMAIN.verifyingContract),
  'T1E_CONSENT_DOMAIN_INVALID');
 strict(eq(TypedDataEncoder.hash(DOMAIN,TYPES,prepared.message),prepared.digest),
  'T1E_CONSENT_DIGEST_CHANGED');
 strict(eq(verifyTypedData(DOMAIN,TYPES,prepared.message,signature),who),
  'T1E_RECIPIENT_SIGNATURE_MISMATCH');
 return Object.freeze({
  status:'OFFCHAIN_RECIPIENT_SIGNATURE_CRYPTO_VERIFIED_ONLY',
  originalFundingIntent:UUID,
  recipient:who,
  digest:prepared.digest,
  signatureFingerprint:keccak256(signature),
  nonce:prepared.message.nonce,
  deadline:prepared.expiry,
  onchainIssued:false,
  beneficiaryEligibilityVerified:false,
  onchainRecipientBinding:false,
  foodHandoverVerified:false,
  merchantSettlementAuthorized:false
 });
}
export {DOMAIN,TYPES,FIELDS,ORIGINAL_INTENT_BYTES16};
