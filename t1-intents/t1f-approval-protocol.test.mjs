import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,TypedDataEncoder} from 'ethers';
import {SignTypedDataVersion,signTypedData} from '@metamask/eth-sig-util';
import {fixture,NOW,HEX} from './t1f-approval-test-fixture.mjs';
import {reconstructApproval,approvalTypedData,recoverApproval,verifyApprovalRole,publicApproval} from './t1f-approval-protocol.mjs';
import {T1F_RELEASE_TYPES,T1F_RELEASE_OWNER,T1F_RELEASE_DONOR} from './t1f-successor-dual-approval.mjs';
test('stored manifest reconstructs at creation time, including last valid second; expiry dominates 2/2',()=>{
 const {context,row}=fixture();
 const manifest=reconstructApproval({row,context,now:NOW+299});
 assert.equal(manifest.digest,row.digest);
 assert.throws(()=>reconstructApproval({row,context,now:NOW+300}),/EXPIRED/);
 row.approvals=[{role:'owner',wallet:T1F_RELEASE_OWNER,fingerprint:HEX('a')},{role:'donor',wallet:T1F_RELEASE_DONOR,fingerprint:HEX('b')}];
 const dto=publicApproval({row,context,now:NOW+300});
 assert.equal(dto.status,'EXPIRED');assert.equal(dto.noRelease,true);
 assert.equal(dto.roles.owner,true);assert.equal(dto.roles.donor,true);
 assert.doesNotMatch(JSON.stringify(dto),/PRIVATE_BENEFICIARY|consent|fingerprint|calldata|issuer_tx/);
});
test('canonical value, context, bounds and hashes are reconstructed rather than trusted',()=>{
 const {context,row}=fixture();
 for(const change of [{digest:HEX('9')},{candidate_calldata_hash:HEX('9')},{created_at_epoch:NOW+1},{observed_block_time:NOW-121},{value:{...row.value,newNonce:0}},{value:{...row.value,newNonce:'00'}},{value:{...row.value,unexpected:'x'}},{value:{...row.value,newOpId:HEX('9')}},{value:{...row.value,reviewId:'aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb'}}]){
  assert.throws(()=>reconstructApproval({row:{...row,...change},context,now:NOW}),/T1F_/);
 }
 assert.throws(()=>reconstructApproval({row,context:{...context,claim:{...context.claim,stage:'ISSUED'}},now:NOW}),/T1F_/);
});
test('MetaMask V4 real synthetic recovery works; production never accepts synthetic authority',async()=>{
 const {context,row}=fixture(),m=reconstructApproval({row,context,now:NOW}),typed=approvalTypedData(m);
 assert.equal(typed.types.EIP712Domain.length,4);
 assert.deepEqual(typed.types.SuccessorIssueRelease,T1F_RELEASE_TYPES.SuccessorIssueRelease);
 const wallet=Wallet.createRandom();
 const signature=signTypedData({privateKey:Buffer.from(wallet.privateKey.slice(2),'hex'),data:typed,version:SignTypedDataVersion.V4});
 const result=recoverApproval({manifest:m,signature});
 assert.equal(result.wallet,wallet.address.toLowerCase());assert.notEqual(result.fingerprint,signature);
 for(const role of ['owner','donor'])assert.throws(()=>verifyApprovalRole({manifest:m,role,signature,expectedSigner:wallet.address}),/SIGNER/);
 const modified={...m,value:{...m.value,nonceDomain:HEX('7')}};
 assert.notEqual(recoverApproval({manifest:modified,signature}).wallet,result.wallet);
 const personal=await wallet.signMessage(m.digest);
 assert.notEqual(recoverApproval({manifest:m,signature:personal}).wallet,result.wallet);
 const practice=await wallet.signTypedData({...m.domain,name:'MealForward Phase5 Typed Wallet Practice'},m.types,m.value);
 assert.notEqual(recoverApproval({manifest:m,signature:practice}).wallet,result.wallet);
 assert.equal(TypedDataEncoder.hash(typed.domain,m.types,typed.message),row.digest);
});
