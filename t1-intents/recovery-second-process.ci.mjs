/**
 * A SECOND NODE PROCESS, not a re-instantiated JS object. It must discover
 * the previously committed UNKNOWN original attempt from the same PG17
 * database and categorically reject resending that wallet operation.
 *
 * RUNNER-GUARDED DISPOSABLE TEST ONLY. No API listener, no wallet provider.
 */
import pg from 'pg';
import {createT1IntentLedger,ESCROW,TOKEN,PRICE,erc20} from './core.mjs';
const DSN='postgres://postgres:t1c-disposable-only@127.0.0.1:5432/mf_t1c_disposable_ci';
const id=process.argv[2];
if(process.env.GITHUB_ACTIONS!=='true'||
 process.env.MF_T1C_DISPOSABLE_ONLY!=='ack-fresh-t1c-postgres17'||
 process.env.DATABASE_URL!==DSN||
 !/^[0-9a-f-]{36}$/i.test(id??'')){
 process.stderr.write('DISPOSABLE_CRASH_RESTART_PROBE_DENIED\n');
 process.exitCode=2;
}else{
 const p=new pg.Pool({connectionString:DSN,max:2});
 try{
  const service=createT1IntentLedger({
   pool:p,
   resolveWallet:async()=>({
    verified:true,source:'TESTNET_WALLET_AUTHORITY',
    address:'0x'+'1'.repeat(40)
   })
  });
  const original=await service.fetchOriginal({session:'synthetic-original',intentId:id});
  if(original.stage!=='APPROVE_UNKNOWN'||original.attempts?.[0]?.status!=='UNKNOWN')
   throw Error('UNKNOWN_NOT_RESTORED_FROM_PG');
  const tx={
   from:'0x'+'1'.repeat(40),to:TOKEN,nonce:Number(original.attempts[0].nonce),
   value:'0',data:erc20.encodeFunctionData('approve',[ESCROW,PRICE])
  };
  let failed=false;
  try{await service.reserve({
   session:'synthetic-original',intentId:id,kind:'approve',transaction:tx
  })}
  catch(e){failed=e?.message==='ORIGINAL_WALLET_ATTEMPT_UNKNOWN_OR_BLOCKED'}
  if(!failed)throw Error('POST_CRASH_DUPLICATE_RESERVATION_WAS_ALLOWED');
  process.stdout.write(JSON.stringify({
   status:'T1C_CROSS_PROCESS_UNKNOWN_NO_RETRY_PASS',stage:original.stage,
   walletTxSubmitted:false,anotherAttemptReserved:false
  })+'\n');
 }catch{
  process.stderr.write('T1C_CRASH_RESTART_NOT_PROVEN\n');
  process.exitCode=1;
 }finally{await p.end()}
}
