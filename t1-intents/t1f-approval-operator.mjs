/** Explicit operator round creation; no automatic startup round or wallet access. */
import {pathToFileURL} from 'node:url';
import {openApprovalRuntime} from './t1f-approval-server.mjs';
import {WALLET_OBSERVATION,requireApproval as check} from './t1f-approval-protocol.mjs';
export function parseApprovalOperator(args){
 check(Array.isArray(args)&&args.length===5&&args[0]==='create'&&args[1]==='--wallet-observation'&&args[2]===WALLET_OBSERVATION&&args[3]==='--observed-at'&&/^[1-9][0-9]{8,12}$/.test(args[4]),'OPERATOR_ARGUMENTS');
 const observedAt=Number(args[4]);check(Number.isSafeInteger(observedAt),'OPERATOR_CLOCK');
 return {walletObservation:{value:WALLET_OBSERVATION,observedAt}};
}
export async function runApprovalOperator({args=process.argv.slice(2),env=process.env,openRuntime=openApprovalRuntime}={}){
 const input=parseApprovalOperator(args),runtime=await openRuntime({env});
 try{const state=await runtime.service.createRound(input);return {status:state.status,noRelease:true,round:state.round?{id:state.round.id,digest:state.round.digest,expiresAt:state.round.expiresAt}:null}}
 finally{await runtime.pool.end()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(await runApprovalOperator())+'\n')}
 catch{process.stderr.write('T1F_APPROVAL_CREATE_NOT_CONFIRMED_READ_STATE_BEFORE_ANY_NEXT_ACTION\n');process.exitCode=1}
}
