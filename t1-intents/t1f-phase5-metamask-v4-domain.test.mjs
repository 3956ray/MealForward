import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,TypedDataEncoder,verifyTypedData} from 'ethers';
import {makePhase5TypedPractice} from './t1f-phase5-typed-practice.mjs';

const owner=Wallet.createRandom(),donor=Wallet.createRandom();
const now=1792740000;
const proof=makePhase5TypedPractice({
 origin:'http://127.0.0.1:19123',testing:true,clock:()=>now,
 roleFixtures:{owner:owner.address,donor:donor.address}
});
test('Owner and Donor JSON-RPC V4 explicitly declare the same domain ethers verifies',()=>{
 for(const [role,wallet] of [['owner',owner],['donor',donor]]){
  const ch=proof.challenge({role,address:wallet.address});
  const v4=JSON.parse(JSON.stringify(ch.typedData));
  assert.deepEqual(v4.types.EIP712Domain,[
   {name:'name',type:'string'},
   {name:'version',type:'string'},
   {name:'chainId',type:'uint256'},
   {name:'verifyingContract',type:'address'}
  ]);
  assert.equal(v4.domain.chainId,10143);
  assert.equal(v4.primaryType,'PracticeControl');
  assert.equal(v4.domain.name,'MealForward Phase5 Typed Wallet Practice');
  assert.equal(v4.domain.version,'0');
  const includedDomain=Object.fromEntries(
   v4.types.EIP712Domain.map(field=>[field.name,v4.domain[field.name]])
  );
  const messageTypes={PracticeControl:v4.types.PracticeControl};
  const metamaskDigest=TypedDataEncoder.hash(
   includedDomain,messageTypes,v4.message
  );
  const metamaskV4Signature=wallet.signingKey.sign(metamaskDigest).serialized;
  assert.equal(verifyTypedData(v4.domain,messageTypes,v4.message,metamaskV4Signature).toLowerCase(),wallet.address.toLowerCase());
  const done=proof.verify({challengeId:ch.challengeId,signature:metamaskV4Signature});
  assert.equal(done.role,role);
  assert.equal(done.releaseApproved,false);
  assert.equal(done.signaturePersisted,false);

  // Reproduce original bug: eth-sig-util sanitizes an undeclared
  // types.EIP712Domain to [], which hashes an empty domain separator.
  const old=proof.challenge({role,address:wallet.address});
  const emptyDomainDigest=TypedDataEncoder.hash(
   {},messageTypes,old.typedData.message
  );
  const oldSignature=wallet.signingKey.sign(emptyDomainDigest).serialized;
  assert.notEqual(verifyTypedData(
   v4.domain,messageTypes,old.typedData.message,oldSignature
  ).toLowerCase(),wallet.address.toLowerCase());
  assert.throws(()=>proof.verify({
   challengeId:old.challengeId,signature:oldSignature
  }),/T1F_PHASE5_SIGNATURE_INVALID/);
 }
 proof.close();
});
test('MetaMask JSON envelope uses Practice-only domain with no real release schema',()=>{
 const challenge=makePhase5TypedPractice({
  origin:'http://127.0.0.1:19124',testing:true,clock:()=>now,
  roleFixtures:{owner:owner.address,donor:donor.address}
 });
 const c=challenge.challenge({role:'owner',address:owner.address});
 assert.equal(c.typedData.domain.name,'MealForward Phase5 Typed Wallet Practice');
 assert.equal(c.typedData.primaryType,'PracticeControl');
 assert.ok(c.typedData.message.purpose.startsWith('PRACTICE ONLY'));
 assert.equal(c.typedData.types.SuccessorIssueRelease,undefined);
 assert.equal(c.notRecoveryRelease,true);
 assert.equal(c.notTransaction,true);
 challenge.close();
});
