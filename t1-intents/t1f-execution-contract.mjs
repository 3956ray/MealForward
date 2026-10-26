/** Trusted service attestations; never accept these objects from HTTP bodies.
 * observedAt is the fresh canonical block timestamp, not a local wall-clock attestation.
 * All integers in evidence are canonical decimal strings; booleans are JSON booleans.
 * consumption is an immutable SQL receipt. It grants no collector send capability.
 */
export const OBSERVATION_VERSION='T1F_EXECUTION_OBSERVATION_V1';
export const BIND_VERSION='T1F_BOUND_TRANSACTION_V1';
export const RECONCILE_VERSION='T1F_RECONCILIATION_V1';
export const CONSUMPTION_VERSION='T1F_CONSUMPTION_V1';
export const OBSERVATION_KEYS=Object.freeze(['version','roundId','digest','signedBlockNumber','signedBlockHash','observedBlockNumber','observedBlockHash','observedAt','issuerLatestNonce','issuerPendingNonce','calldataHash','historicalAnchorCanonical','freshAnchorCanonical','originalOperationSeen','unitAvailable','unitIssued','codeAndAuthorityValid','accountingValid','simulationPassed']);
export const BIND_KEYS=Object.freeze(['version','chainId','from','to','nonce','value','calldataHash','txHash']);
export const RECONCILE_KEYS=Object.freeze(['version','txHash','blockNumber','blockHash','canonical','receiptSucceeded','expectedEventsValid','operationValid','accountingValid']);
export const CONSUMPTION_KEYS=Object.freeze(['consumption_id','version','round_id','digest','claim_id','slot_id','release_id','successor_id','consumed_at_epoch','no_release','can_issue','may_broadcast_by_server','approved_for_settlement']);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join() === [...keys].sort().join();
export function validateExecutionEvidence(value,kind){
 const keys={observation:OBSERVATION_KEYS,bind:BIND_KEYS,reconcile:RECONCILE_KEYS}[kind];
 const version={observation:OBSERVATION_VERSION,bind:BIND_VERSION,reconcile:RECONCILE_VERSION}[kind];
 if(!keys||!exact(value,keys)||value.version!==version)throw Error('T1F_EXECUTION_EVIDENCE_INVALID');
 const bool=new Set(['historicalAnchorCanonical','freshAnchorCanonical','originalOperationSeen','unitAvailable','unitIssued','codeAndAuthorityValid','accountingValid','simulationPassed','canonical','receiptSucceeded','expectedEventsValid','operationValid']);
 for(const [key,v] of Object.entries(value))if(bool.has(key)?typeof v!=='boolean':typeof v!=='string')throw Error('T1F_EXECUTION_EVIDENCE_INVALID');
 return value;
}
export function validateConsumption(value,{round,context,operation}={}){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 if(!exact(value,CONSUMPTION_KEYS)||value.version!==CONSUMPTION_VERSION||!/^0x[0-9a-f]{64}$/.test(value.digest)||
 !['consumption_id','round_id','claim_id','slot_id','release_id','successor_id'].every(k=>typeof value[k]==='string'&&uuid.test(value[k]))||
 !Number.isSafeInteger(value.consumed_at_epoch)||value.consumed_at_epoch<=0||value.no_release!==true||value.can_issue!==false||value.may_broadcast_by_server!==false||value.approved_for_settlement!==false||
 (round&&(round.round_id!==value.round_id||round.digest!==value.digest||round.value.claimId!==value.claim_id||round.value.slotId!==value.slot_id))||
 (context&&(context.claim.claim_id!==value.claim_id||context.slot.attempt_id!==value.slot_id))||
 (operation&&(operation.successor_id!==value.successor_id||operation.release_id!==value.release_id||operation.claim_id!==value.claim_id||operation.slot_id!==value.slot_id)))throw Error('T1F_CONSUMPTION_INVALID');
 return value;
}
