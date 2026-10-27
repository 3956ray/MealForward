/** Only enumerated operational codes may leave the server; never raw errors. */
const stages=new Set(['read_round','verify_signature','observe_chain','recheck_round','record_approval','readback']);
export function phase8Failure(e){
 const stage=stages.has(e?.phase8Stage)?e.phase8Stage:'request';
 const rpc=/^T1F_EXECUTION_(RPC_HTTP|RPC_RESPONSE|RPC_JSON|RPC_SIZE|RPC_TIMEOUT|RPC_BUDGET|RPC_METHOD|RPC_CONFIG)$/.exec(e?.message||'');
 const dbCodes={'42501':'DATABASE_PERMISSION','57014':'DATABASE_TIMEOUT','55P03':'DATABASE_BUSY','08000':'DATABASE_CONNECTION','08001':'DATABASE_CONNECTION','08003':'DATABASE_CONNECTION','08006':'DATABASE_CONNECTION','ECONNRESET':'DATABASE_CONNECTION','ECONNREFUSED':'DATABASE_CONNECTION','ETIMEDOUT':'DATABASE_TIMEOUT'};
 const db=Object.hasOwn(dbCodes,e?.code)?dbCodes[e.code]:null;
 if(rpc||db)return {status:503,error:'T1F_PHASE8_'+(rpc?rpc[1]:db),stage};
 if(/^T1F_PHASE8_[A-Z_]{3,80}$/.test(e?.message||''))return {status:409,error:e.message,stage};
 return {status:503,error:'T1F_PHASE8_UNAVAILABLE',stage};
}
export async function phase8Step(stage,fn){try{return await fn()}catch(e){const wrapped=new Error(typeof e?.message==='string'?e.message:'');wrapped.code=e?.code;wrapped.phase8Stage=stage;throw wrapped}}
