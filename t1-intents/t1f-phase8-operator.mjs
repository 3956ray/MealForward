/** Explicit operator CLI. Never run on stale/invented human wallet reports. No send capability. */
import {readFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {verifiedSupabasePoolerTls} from './supabase-tls.mjs';
import {makePhase8Store,phase8CapabilityPool,verifyPhase8Runtime} from './t1f-phase8-store.mjs';
import {makePhase8Service} from './t1f-phase8-service.mjs';
import {PHASE8_WALLET_OBSERVATION} from './t1f-phase8-protocol.mjs';
const check=(x,c)=>{if(!x)throw Error('T1F_PHASE8_OPERATOR_'+c)};
export function validatePhase8OperatorConfig(c,{mode,observedAt,now}={}){
 check(c&&Object.keys(c).join()==='operatorDatabaseUrl'&&typeof c.operatorDatabaseUrl==='string','CONFIG');
 check((mode&0o777)===0o600,'FILE_MODE');
 check(Number.isSafeInteger(now)&&Number.isSafeInteger(observedAt)&&observedAt>0&&observedAt<=now&&now-observedAt<=120,'FRESH_HUMAN_REPORT');
 let u;try{u=new URL(c.operatorDatabaseUrl)}catch{throw Error('T1F_PHASE8_OPERATOR_DSN')}
 check(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='aws-0-ap-southeast-2.pooler.supabase.com'&&u.port==='5432'&&u.pathname==='/postgres'&&!u.search&&!u.hash&&u.username==='mf_t1f_phase8_operator_login.ketfrukrcuosrqynnsay'&&u.password.length>=12,'DSN');return c;
}
export async function createPhase8Round({configPath,observedAt,clock=()=>Math.floor(Date.now()/1000)}={}){
 check(typeof configPath==='string'&&configPath.startsWith('/'),'CONFIG_PATH');
 const info=await stat(configPath);check(info.isFile()&&info.size<=8192,'CONFIG_FILE');
 const cfg=validatePhase8OperatorConfig(JSON.parse(await readFile(configPath,'utf8')),{mode:info.mode,observedAt,now:clock()});
 const pool=phase8CapabilityPool(new pg.Pool({connectionString:cfg.operatorDatabaseUrl,ssl:verifiedSupabasePoolerTls(),max:1,connectionTimeoutMillis:5000,query_timeout:8000}),'operator');
 try{await verifyPhase8Runtime(pool,'operator');const service=makePhase8Service({store:makePhase8Store({pool}),clock});return await service.createRound({walletObservation:{value:PHASE8_WALLET_OBSERVATION,observedAt}})}finally{await pool.end()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{check(process.argv.length===6&&process.argv[2]==='create-round'&&process.argv[5]===PHASE8_WALLET_OBSERVATION,'EXPLICIT_ARGUMENTS');const result=await createPhase8Round({configPath:process.argv[3],observedAt:Number(process.argv[4])});console.log(JSON.stringify({status:result.status,roundId:result.round?.id,digest:result.round?.digest,prepareBefore:result.round?.prepareBefore,approvalExpiresAt:result.round?.expiresAt,transactionSent:false}));}
 catch(e){console.error(/^T1F_[A-Z0-9_]+$/.test(e.message)?e.message:'T1F_PHASE8_OPERATOR_UNCONFIRMED_READ_STATUS_BEFORE_RETRY');process.exitCode=1;}
}
