/** Shared by every target and worker under the root store transaction lock. */
import {TARGET_SCOPE} from './target-store.mjs';
import {Transaction} from 'ethers';
export const platformPending=s=>['SIGNED','SEND_UNKNOWN','HASH_BOUND'].includes(s);
export const platformLane=target=>`${target.chainId}:${target.claimAuthority.toLowerCase()}`;
export function laneAvailable(state,target){
 if(state[TARGET_SCOPE]?.hasPendingPlatformTransactions())return false;
 for(const group of ['intents','approvals','publications','redemptions']){const operations=state[TARGET_SCOPE]?.globalRecords(group)||Object.values(state[group]||{});if(operations.some(o=>o.wallet?.toLowerCase()===target.claimAuthority.toLowerCase()&&o.transaction&&['PREPARED','SEND_UNKNOWN','HASH_BOUND'].includes(o.state)))return false;}
 const lane=state.platformOutbox?.[platformLane(target)];
 if(lane&&platformPending(lane.state))return false;
 return !Object.values(state.claims||{}).some(c=>platformPending(c.state))&&!Object.values(state.autoSettlements||{}).some(c=>platformPending(c.state));
}
export function reservePacket(state,target,operation,kind,packet){
 if(!laneAvailable(state,target))throw Error('PLATFORM_NONCE_BUSY');
 const tx=Transaction.from(packet.raw),key=platformLane(target);state.platformOutbox||={};
 const previous=state.platformOutbox[key];
 if(previous&&Number.isSafeInteger(previous.nonce)&&tx.nonce<=previous.nonce)throw Error('PLATFORM_NONCE_NOT_ADVANCED');
 state.platformOutbox[key]={id:operation.id,targetId:`${target.chainId}:${target.escrow.toLowerCase()}`,kind,nonce:tx.nonce,txHash:packet.hash.toLowerCase(),state:'SIGNED'};
}
export function updatePacket(state,target,operation,next){
 const lane=state.platformOutbox?.[platformLane(target)];if(!lane)return; // Pre-upgrade records are reconciled without creating a new signature.
 if(lane.id!==operation.id||lane.txHash!==operation.txHash)return;
 lane.state=next;
}
