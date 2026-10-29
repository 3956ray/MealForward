import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,TypedDataEncoder} from 'ethers';
import {PHASE8_FIXED as F,PHASE8_DOMAIN,PHASE8_TYPES,assessRecovery,buildRecoveryManifest,reconstructRecoveryManifest,recoveryTypedData,verifyRecoveryApproval,recoverRecoveryApproval,validateRecoveryObservation} from './t1f-phase8-protocol.mjs';
const H=c=>'0x'+c.repeat(64),NOW=1793081000;
const fixture=()=>({now:NOW,predecessor:{...F.predecessor},walletObservation:{value:'ISSUER_REPORTED_NO_PENDING_OR_SENT_TRANSACTIONS',observedAt:NOW},observation:{version:'T1F_PHASE8_OBSERVATION_V1',chainId:10143,issuer:F.issuer,escrow:F.escrow,finalizedBlockNumber:'74584000',finalizedBlockHash:H('a'),finalizedBlockTime:NOW-3,finalizedCanonical:true,observedBlockNumber:'74584004',observedBlockHash:H('b'),observedBlockTime:NOW-1,freshCanonical:true,issuerLatestNonce:'0',issuerPendingNonce:'0',originalOperationSeen:false,predecessorOperationSeen:false,unitAvailable:true,unitIssued:false,unitGeneration:'0',unitSeq:'0',mealId:F.mealId,termsHash:F.termsHash,codeAndAuthorityValid:true,accountingValid:true},newOpId:H('c'),nonceDomain:H('d')});
test('safe recovery assessment distinguishes wallet report from chain proof and never reserves or broadcasts',()=>{
 const a=assessRecovery(fixture());assert.equal(a.status,'ELIGIBLE_FOR_FRESH_DUAL_APPROVAL');assert.equal(a.noPendingTxProven,false);assert.equal(a.mayBroadcast,false);assert.equal(a.originalRecordsPreserved,true);
});
test('all evidence unsafe variants fail closed including finality, time, nonce, operation and generation',()=>{
 for(const delta of [{finalizedBlockTime:1793079866},{finalizedCanonical:false},{freshCanonical:false},{finalizedBlockNumber:'74584005'},{finalizedBlockNumber:'74584004'},{observedBlockTime:NOW-121},{observedBlockTime:NOW+1},{issuerLatestNonce:'1'},{issuerPendingNonce:'1'},{originalOperationSeen:true},{predecessorOperationSeen:true},{unitAvailable:false},{unitIssued:true},{unitGeneration:'1'},{unitSeq:'1'},{termsHash:H('f')},{accountingValid:false},{codeAndAuthorityValid:false},{issuer:'0x'+'1'.repeat(40)},{unexpected:true}]){
 const f=fixture();Object.assign(f.observation,delta);assert.throws(()=>assessRecovery(f),/T1F_PHASE8_/);
 }
 for(const delta of [{observedAt:NOW-121},{observedAt:NOW+1},{value:'NO_TX_PROVEN'},{extra:true}]){const f=fixture();Object.assign(f.walletObservation,delta);assert.throws(()=>assessRecovery(f),/T1F_PHASE8_/);}
 for(const delta of [{successor_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{issuer_issue_deadline:1793079868},{tx_hash:H('a')},{stage:'ISSUED'},{revision:1},{calldata_hash:H('f')}]){const f=fixture();Object.assign(f.predecessor,delta);assert.throws(()=>assessRecovery(f),/T1F_PHASE8_/);}
});
test('V2 manifest pins predecessor and original, fixed windows and no calldata leak',()=>{
 const m=buildRecoveryManifest(fixture());assert.equal(m.domain.version,'2');assert.equal(m.value.predecessorOpId,F.predecessor.operation_id);assert.equal(m.value.predecessorDataHash,F.predecessor.calldata_hash);assert.equal(m.value.newDeadline,String(NOW+480));assert.equal(m.value.approvalExpiresAt,String(NOW+300));assert.equal(m.prepareBefore,NOW+210);assert.equal(m.sendBefore,NOW+210);assert.equal(m.digest,TypedDataEncoder.hash(PHASE8_DOMAIN,PHASE8_TYPES,m.value));assert.equal(m.transaction,undefined);assert.equal(m.data,undefined);
 const typed=recoveryTypedData(m);assert.equal(typed.primaryType,'RecoveryChildIssueRelease');assert.equal(typed.types.EIP712Domain.length,4);
 for(const delta of [{newOpId:F.predecessor.operation_id},{newOpId:F.originalOperationId},{nonceDomain:H('0')},{newOpId:H('0')}])assert.throws(()=>buildRecoveryManifest({...fixture(),...delta}),/T1F_PHASE8_/);
});
test('stored reconstruction verifies exact schema, pinning, digest, hash, windows and expiry',()=>{
 const f=fixture(),m=buildRecoveryManifest(f),row={value:m.value,digest:m.digest,candidate_calldata_hash:m.candidateCalldataHash,created_at_epoch:NOW};
 assert.equal(reconstructRecoveryManifest({row,predecessor:f.predecessor,now:NOW+299}).digest,m.digest);
 assert.throws(()=>reconstructRecoveryManifest({row,predecessor:f.predecessor,now:NOW+300}),/EXPIRED/);
 assert.equal(reconstructRecoveryManifest({row,predecessor:f.predecessor,now:NOW+300,allowExpired:true}).digest,m.digest);
 for(const delta of [{digest:H('a')},{candidate_calldata_hash:H('a')},{created_at_epoch:NOW+1},{value:{...m.value,newNonce:'00'}},{value:{...m.value,predecessorRoundId:'bad'}},{value:{...m.value,approvalExpiresAt:String(NOW+301)}},{value:{...m.value,extra:true}}])assert.throws(()=>reconstructRecoveryManifest({row:{...row,...delta},predecessor:f.predecessor,now:NOW}),/T1F_PHASE8_/);
});
test('EIP712 recovers synthetic signer while role acceptance remains pinned, old domain and mutations fail role verification',async()=>{
 const m=buildRecoveryManifest(fixture()),wallet=Wallet.createRandom();
 const signature=await wallet.signTypedData(m.domain,m.types,m.value);
 assert.equal(recoverRecoveryApproval({manifest:m,signature}).wallet,wallet.address.toLowerCase());
 for(const role of ['owner','donor','issuer'])assert.throws(()=>verifyRecoveryApproval({manifest:m,role,signature,expectedSigner:wallet.address}),/T1F_PHASE8_/);
 assert.throws(()=>recoverRecoveryApproval({manifest:{...m,digest:H('a')},signature}),/T1F_PHASE8_/);
 const v1=await wallet.signTypedData({...m.domain,version:'1'},m.types,m.value);
 assert.notEqual(recoverRecoveryApproval({manifest:m,signature:v1}).wallet,wallet.address.toLowerCase());
});

test('every missing evidence field is rejected; expiry anchor equality is valid',()=>{
 for(const key of Object.keys(fixture().observation)){const f=fixture();delete f.observation[key];assert.throws(()=>assessRecovery(f),/T1F_PHASE8_/);}
 const f=fixture();f.observation.finalizedBlockTime=F.predecessor.issuer_issue_deadline;assert.equal(assessRecovery(f).status,'ELIGIBLE_FOR_FRESH_DUAL_APPROVAL');
});

test('fresh chain validation for existing approvals never fabricates a new wallet report',()=>{
 const f=fixture();delete f.walletObservation;assert.equal(validateRecoveryObservation(f).mayBroadcast,false);assert.throws(()=>assessRecovery(f),/WALLET_REPORT/);
});
