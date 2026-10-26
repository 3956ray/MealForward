/** Narrow SQL capability adapter. No signatures, RPC, issuance or login creation. */
import {TypedDataEncoder,keccak256} from 'ethers';
import {T1F_RELEASE_DOMAIN,T1F_RELEASE_TYPES} from './t1f-successor-dual-approval.mjs';
import {MEAL,TERMS} from './core.mjs';
import {t0} from './t1e-first-issue-readiness.mjs';

export function makeApprovalStore({pool}={}){
 if(typeof pool?.query!=='function')throw Error('T1F_APPROVAL_POOL_REQUIRED');
 const call=async(sql,args=[],beforeExecute)=>{
  // Guarded writes require the capability adapter; raw pg is only used by
  // disposable unguarded fixtures. Never evaluate the guard before setup.
  const result=await (beforeExecute===undefined?pool.query(sql,args):pool.query(sql,args,{beforeExecute}));
  if(result.rowCount!==1)throw Error('T1F_APPROVAL_STORE_RESULT_INVALID');
  return result.rows[0].result;
 };
 return Object.freeze({
  context:()=>call('SELECT mf_t1f_recovery.context() AS result'),
  current:()=>call('SELECT mf_t1f_recovery.current_round() AS result'),
  get:roundId=>call('SELECT mf_t1f_recovery.get_round($1::uuid) AS result',[roundId]),
  create:({roundId,manifest,createdAt,observedBlockTime,beforeExecute})=>{
   const digest=TypedDataEncoder.hash(T1F_RELEASE_DOMAIN,T1F_RELEASE_TYPES,manifest.value);
   const calldataHash=keccak256(t0.encodeFunctionData('issue',[
    manifest.value.newOpId,MEAL,0,1,TERMS,BigInt(manifest.value.newDeadline)
   ]));
   if(digest!==manifest.digest||calldataHash!==manifest.candidateCalldataHash)
    throw Error('T1F_APPROVAL_MANIFEST_HASH_MISMATCH');
   return call('SELECT mf_t1f_recovery.create_round($1::uuid,$2::jsonb,$3,$4::bigint,$5::bigint,$6) AS result',
    [roundId,JSON.stringify(manifest.value),digest,createdAt,observedBlockTime,calldataHash],beforeExecute);
  },
  record:({roundId,digest,role,wallet,fingerprint,beforeExecute})=>call(
   'SELECT mf_t1f_recovery.record_approval($1::uuid,$2,$3,$4,$5) AS result',
   [roundId,digest,role,wallet,fingerprint],beforeExecute)
 });
}
