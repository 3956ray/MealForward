/**
 * T1-F Phase 5: EIP-712 WALLET-COMPATIBILITY PRACTICE ONLY.
 * This deliberately differs from the real Recovery domain, version and
 * primary type. It cannot be replayed as an actual Issue release.
 * Challenge, signature and verification results never reach a database.
 */
import {randomBytes,randomUUID} from 'node:crypto';
import {verifyTypedData} from 'ethers';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {CHAIN,ESCROW,QUOTE} from './core.mjs';

const PINNED=Object.freeze({owner:FIXED.owner.toLowerCase(),donor:QUOTE.toLowerCase()});
const HEX_ADDRESS=/^0x[0-9a-f]{40}$/i,HEX_SIG=/^0x[0-9a-f]{130}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSE='PRACTICE ONLY - NO RECOVERY RELEASE, NO ISSUE, NO FUNDS';
const DOMAIN=Object.freeze({
 name:'MealForward Phase5 Typed Wallet Practice',
 version:'0',chainId:CHAIN,verifyingContract:ESCROW
});
const TYPES=Object.freeze({
 PracticeControl:Object.freeze([
  {name:'role',type:'string'}, {name:'wallet',type:'address'},
  {name:'challengeId',type:'string'}, {name:'nonce',type:'bytes32'},
  {name:'issuedAt',type:'uint256'},{name:'expiresAt',type:'uint256'},
  {name:'purpose',type:'string'}
 ])
});
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const failure=(status,code)=>Object.assign(Error(code),{status,code});
const check=(pass,code,status=422)=>{if(!pass)throw failure(status,code)};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
export const PHASE5_TYPED_PRACTICE_DOMAIN=DOMAIN;

export function makePhase5TypedPractice({
 origin,clock=()=>Math.floor(Date.now()/1000),
 testing=false,roleFixtures=null
}={}){
 check(typeof origin==='string'&&
  (/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin)||
   testing&&/^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/.test(origin)),
  'T1F_PHASE5_ORIGIN_INVALID');
 check(!roleFixtures||(testing&&/^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/.test(origin)),
  'T1F_PHASE5_PRODUCTION_ROLE_OVERRIDE_FORBIDDEN',403);
 const roles=roleFixtures??PINNED;
 check(exact(roles,['owner','donor'])&&
  Object.values(roles).every(x=>HEX_ADDRESS.test(x))&&
  !eq(roles.owner,roles.donor)&&
  !eq(roles.owner,FIXED.issuerAuthority)&&
  !eq(roles.donor,FIXED.issuerAuthority),
  'T1F_PHASE5_DISTINCT_AUTHORITY_REQUIRED');
 const registered=Object.freeze({
  owner:roles.owner.toLowerCase(),donor:roles.donor.toLowerCase()
 });
 const pending=new Map();
 let starts=clock(),count=0;
 const sweep=now=>{
  for(const [key,value] of pending)if(value.expiresAt<=now)pending.delete(key);
  if(now<starts||now-starts>=60){starts=now;count=0}
 };
 const status=()=>Object.freeze({
  status:'T1F_PHASE5_TYPED_WALLET_PRACTICE_ONLY',
  chainId:CHAIN,ownerWallet:registered.owner,donorWallet:registered.donor,
  typedDataDomain:DOMAIN.name,typedDataVersion:DOMAIN.version,
  eip712PracticeOnly:true,liveReleaseDomainMatch:false,
  createsRecoveryApproval:false,canIssue:false,canFund:false,
  canSettle:false,databaseConnected:false,hasSession:false,
  storesSignature:false,requiresHumanSignature:true
 });
 const challenge=body=>{
  check(exact(body,['role','address'])&&
    ['owner','donor'].includes(body.role)&&HEX_ADDRESS.test(body.address||''),
   'T1F_PHASE5_EXACT_PINNED_ROLE_REQUIRED');
  check(eq(body.address,registered[body.role]),
   'T1F_PHASE5_WRONG_ROLE_ADDRESS',403);
  const now=clock();sweep(now);
  check(count<30&&pending.size<24,'T1F_PHASE5_RATE_LIMIT',429);
  const challengeId=randomUUID(),issuedAt=now,expiresAt=now+120;
  const message={
   role:body.role.toUpperCase(),
   wallet:registered[body.role],
   challengeId,
   nonce:'0x'+randomBytes(32).toString('hex'),
   issuedAt:String(issuedAt),
   expiresAt:String(expiresAt),
   purpose:PURPOSE
  };
  const typedData=Object.freeze({
   domain:DOMAIN,types:TYPES,primaryType:'PracticeControl',message
  });
  pending.set(challengeId,{
   role:body.role,address:registered[body.role],issuedAt,expiresAt,
   message
  });
  count++;
  return Object.freeze({
   status:'T1F_PHASE5_TYPED_PRACTICE_CHALLENGE',challengeId,
   role:body.role,address:registered[body.role],chainId:CHAIN,expiresAt,
   typedData,notRecoveryRelease:true,notTransaction:true
  });
 };
 const verify=body=>{
  check(exact(body,['challengeId','signature'])&&
    UUID.test(body.challengeId||'')&&HEX_SIG.test(body.signature||''),
   'T1F_PHASE5_EXACT_SIGNATURE_REQUIRED');
  const now=clock();sweep(now);
  const record=pending.get(body.challengeId);
  check(record&&now>=record.issuedAt&&now<record.expiresAt,
   'T1F_PHASE5_CHALLENGE_USED_OR_EXPIRED',409);
  // Single-use on both success and invalid signature.
  pending.delete(body.challengeId);
  let signer;
  try{signer=verifyTypedData(DOMAIN,TYPES,record.message,body.signature)}
  catch{throw failure(401,'T1F_PHASE5_SIGNATURE_INVALID')}
  check(eq(signer,record.address)&&eq(signer,registered[record.role]),
   'T1F_PHASE5_SIGNATURE_INVALID',401);
  return Object.freeze({
   status:record.role==='owner'?
    'T1F_PHASE5_OWNER_TYPED_PRACTICE_PASS':
    'T1F_PHASE5_DONOR_TYPED_PRACTICE_PASS',
   role:record.role,address:record.address,chainId:CHAIN,
   proofVerified:true,releaseApproved:false,
   originalIssuePreserved:true,noFundsOrChainWrites:true,
   signaturePersisted:false,sessionCreated:false
  });
 };
 return Object.freeze({
  status,challenge,verify,pendingCount(){sweep(clock());return pending.size},
  close(){pending.clear()}
 });
}
