import {hashTypedData} from 'viem';
import {CHAIN_ID,OWNER,DONOR,DOMAIN,DOMAIN_FIELDS,MESSAGE_FIELDS,PINS,type PublicState,type Role,type ApprovalMessage} from './contract.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const H32=/^0x[0-9a-f]{64}$/;
const UINT=/^(0|[1-9][0-9]*)$/;
const UINT256=(1n<<256n)-1n;
const fail=():never=>{throw Error('VALIDATION_INVALID_STATE')};
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:unknown,keys:readonly string[]):x is Record<string,unknown>=>obj(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const uuid=(x:unknown)=>typeof x==='string'&&UUID.test(x);
const h32=(x:unknown)=>typeof x==='string'&&H32.test(x)&&BigInt(x)!==0n;
const uint=(x:unknown)=>typeof x==='string'&&UINT.test(x)&&BigInt(x)<=UINT256;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function roleFor(account:string|null):Role|null{
 if(typeof account!=='string')return null;
 const v=account.toLowerCase();return v===OWNER?'owner':v===DONOR?'donor':null;
}
export function validateState(value:unknown,now:number):PublicState{
 if(!Number.isSafeInteger(now)||now<=0||!exact(value,['noRelease','canIssue','chainId','wallets','roles','serverTime','status','round']))fail();
 const s=value as Record<string,unknown>;
 if(s.noRelease!==true||s.canIssue!==false||s.chainId!==CHAIN_ID||!exact(s.wallets,['owner','donor'])||s.wallets.owner!==OWNER||s.wallets.donor!==DONOR||!exact(s.roles,['owner','donor'])||typeof s.roles.owner!=='boolean'||typeof s.roles.donor!=='boolean'||!Number.isSafeInteger(s.serverTime)||Math.abs(Number(s.serverTime)-now)>30)fail();
 const roles=s.roles as Record<string,boolean>;
 if(s.round===null){if(s.status!=='NO_ROUND'||roles.owner||roles.donor)fail();return value as PublicState;}
 if(!exact(s.round,['id','digest','expiresAt','typedData']))fail();
 const r=s.round as Record<string,unknown>;if(!uuid(r.id)||!h32(r.digest)||!Number.isSafeInteger(r.expiresAt)||Number(r.expiresAt)<=0||Number(r.expiresAt)>Number(s.serverTime)+300)fail();
 const t=r.typedData;if(!exact(t,['domain','types','primaryType','message'])||t.primaryType!=='SuccessorIssueRelease'||!exact(t.domain,Object.keys(DOMAIN))||!Object.entries(DOMAIN).every(([k,v])=>(t.domain as Record<string,unknown>)[k]===v)||!exact(t.types,['EIP712Domain','SuccessorIssueRelease'])||!same(t.types.EIP712Domain,DOMAIN_FIELDS)||!same(t.types.SuccessorIssueRelease,MESSAGE_FIELDS))fail();
 const m=(t as Record<string,unknown>).message as Record<string,string>;if(!exact(m,MESSAGE_FIELDS.map(f=>f.name)))fail();
 for(const f of MESSAGE_FIELDS){const v=m[f.name];if(typeof v!=='string')fail();if(f.type==='uint256'&&!uint(v))fail();if(f.type==='bytes32'&&!h32(v))fail();}
 if(!uuid(m.claimId)||!uuid(m.reviewId)||!uuid(m.slotId)||!Object.entries(PINS).every(([k,v])=>m[k]===v)||m.newOpId===m.originalOpId||m.observedBlockNumber==='0'||m.newDeadline!==String(BigInt(m.approvalExpiresAt)+180n)||r.expiresAt!==Number(m.approvalExpiresAt))fail();
 const expired=Number(s.serverTime)>=Number(r.expiresAt);
 if(expired?s.status!=='EXPIRED':s.status!==(roles.owner&&roles.donor?'COLLECTED_NO_RELEASE':'COLLECTING'))fail();
 try{
  const message=Object.fromEntries(MESSAGE_FIELDS.map(f=>[f.name,f.type==='uint256'?BigInt(m[f.name]):m[f.name]])) as Record<string,string|bigint>;
  const digest=hashTypedData({domain:DOMAIN,types:{SuccessorIssueRelease:MESSAGE_FIELDS},primaryType:'SuccessorIssueRelease',message:message as never});
  if(digest!==r.digest)fail();
 }catch{fail();}
 return value as PublicState;
}
