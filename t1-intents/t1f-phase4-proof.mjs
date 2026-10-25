/**
 * Isolated T1-F Phase4 Owner/Donor SIWE-format EIP-191 possession test.
 * NO session, cookies, database, EIP-712 release, signer, Issue or funds.
 * Test-only wallet substitutions must be explicitly loopback + CI.
 */
import {randomBytes,randomUUID} from 'node:crypto';
import {createSiweMessage} from 'viem/siwe';
import {verifyMessage,getAddress} from 'ethers';
import {FIXED} from './t1e-first-issue-readiness.mjs';
import {QUOTE,CHAIN,ESCROW} from './core.mjs';

export const PHASE4_ROLES=Object.freeze({owner:FIXED.owner,donor:QUOTE});
const A=/^0x[0-9a-f]{40}$/i,S=/^0x[0-9a-f]{130}$/i;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const E=(status,code)=>Object.assign(Error(code),{status,code});
const ck=(v,code,status=422)=>{if(!v)throw E(status,code)};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===keys.slice().sort().join(',');

export function createPhase4Proof({
 origin,clock=()=>Math.floor(Date.now()/1000),testing=false,
 roleFixtures=null
}={}){
 ck(typeof origin==='string'&&(
  /^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin)||
  testing&&/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin)
 ),'T1F_PHASE4_ORIGIN_NOT_PINNED');
 ck(!roleFixtures||(testing&&/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin)),
  'T1F_PHASE4_LIVE_OVERRIDE_FORBIDDEN',403);
 const pin=roleFixtures??PHASE4_ROLES;
 ck(exact(pin,['owner','donor'])&&Object.values(pin).every(x=>A.test(x))&&
  !eq(pin.owner,pin.donor)&&
  !eq(pin.owner,FIXED.issuerAuthority)&&
  !eq(pin.donor,FIXED.issuerAuthority),
  'T1F_PHASE4_INDEPENDENT_ROLES_REQUIRED');
 const roles={owner:pin.owner.toLowerCase(),donor:pin.donor.toLowerCase()};
 const pending=new Map();let windowStart=clock(),issued=0;
 const sweep=now=>{
  for(const [id,p] of pending)if(p.expiresAt<=now)pending.delete(id);
  if(now-windowStart>=60||now<windowStart){windowStart=now;issued=0}
 };
 const status=()=>Object.freeze({
  status:'T1F_PHASE4_OWNER_DONOR_SIWE_PROOF_ONLY',
  ownerWallet:roles.owner,donorWallet:roles.donor,
  chainId:CHAIN,escrow:ESCROW,
  siweFormat:true,eip191Only:true,walletControlOnly:true,
  noPersistentSessions:true,databaseConnected:false,
  eip712RecoveryReleaseEnabled:false,successorIssueEnabled:false,
  fundEnabled:false,settleEnabled:false,
  originalClaimPreserved:true
 });
 const challenge=body=>{
  ck(exact(body,['role','address']),'T1F_PHASE4_EXACT_REQUEST_REQUIRED');
  ck(['owner','donor'].includes(body.role)&&A.test(body.address||''),
   'T1F_PHASE4_ROLE_OR_WALLET_INVALID');
  ck(eq(body.address,roles[body.role]),
   'T1F_PHASE4_ORIGINAL_WALLET_REQUIRED',403);
  const now=clock();sweep(now);
  ck(pending.size<32&&issued<40,'T1F_PHASE4_RATE_LIMIT',429);
  const challengeId=randomUUID(),nonce=randomBytes(20).toString('hex'),expiresAt=now+180;
  const message=createSiweMessage({
   address:getAddress(roles[body.role]),chainId:CHAIN,
   domain:new URL(origin).host,uri:origin,version:'1',
   requestId:challengeId,nonce,
   statement:'MealForward T1-F '+body.role.toUpperCase()+
    ' WALLET CONTROL PROOF ONLY. Not an EIP-712 release, Issue, payment or settlement authorization.',
   issuedAt:new Date(now*1000),expirationTime:new Date(expiresAt*1000)
  });
  pending.set(challengeId,{
   address:roles[body.role],role:body.role,message,issuedAt:now,expiresAt
  });issued++;
  return {status:'T1F_PHASE4_WALLET_PROOF_CHALLENGE',
   role:body.role,address:roles[body.role],chainId:CHAIN,
   challengeId,message,expiresAt,
   noSessionCreated:true,noEip712Release:true,noWalletTransaction:true};
 };
 const verify=body=>{
  ck(exact(body,['challengeId','signature'])&&
    ID.test(body.challengeId||'')&&S.test(body.signature||''),
   'T1F_PHASE4_SIGNATURE_SHAPE_INVALID');
  const now=clock();sweep(now);
  const c=pending.get(body.challengeId);
  ck(c&&c.issuedAt<=now&&c.expiresAt>now,
   'T1F_PHASE4_CHALLENGE_EXPIRED_OR_USED',409);
  pending.delete(body.challengeId);
  let address;
  try{address=verifyMessage(c.message,body.signature).toLowerCase()}
  catch{throw E(401,'T1F_PHASE4_SIGNATURE_REJECTED')}
  ck(eq(address,c.address)&&eq(address,roles[c.role]),
   'T1F_PHASE4_SIGNATURE_REJECTED',401);
  return {
   status:c.role==='owner'?'T1F_PHASE4_OWNER_CONTROL_PROVED':
    'T1F_PHASE4_DONOR_CONTROL_PROVED',
   role:c.role,address,chainId:CHAIN,verifiedAt:now,
   noSessionCreated:true,noEip712Release:true,
   noOnchainIssue:true,noFundsTransaction:true,noSettlement:true
  };
 };
 return Object.freeze({
  status,challenge,verify,
  close(){pending.clear()},
  pendingCount(){sweep(clock());return pending.size}
 });
}
