import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,keccak256,toUtf8Bytes} from 'ethers';
import {fundingTransaction} from '../../product-v2/funding-wire.mjs';
import {publicationTransaction,publicationTermsHash} from '../../product-v2/publication-wire.mjs';
import {redemptionTransaction,redemptionDomain,redemptionTypes} from '../../product-v2/redemption-wire.mjs';
import {createProductJournal,executeProductOperation,reconcileProductOperation,validateProductOperation} from '../product-wallet.mjs';
const ACCOUNT='0x'+'a'.repeat(40),ESCROW='0x'+'e'.repeat(40),ASSET='0x534b2f3a21130d7a60830c2df862319e593943a3',HASH='0x'+'1'.repeat(64),OTHER='0x'+'d'.repeat(40),authority=Wallet.createRandom();
const configuration={verified:true,chainId:10143,escrow:ESCROW,asset:ASSET,redemptionAuthority:authority.address};
const now=()=>Math.floor(Date.now()/1000);
function operation(){const op={id:'support-1',kind:'support',state:'PREPARED',wallet:ACCOUNT,storeId:'store',mealId:'meal',version:1,termsHash:'0x'+'2'.repeat(64),unitPrice:'7000000',quantity:'20',amount:'140000000',expiresAt:now()+120};return {...op,transaction:fundingTransaction(op,configuration,3)};}
function fixture(op=operation()){
 let current=true,sends=0,attempts=0,records=0,reconciles=0;
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)},journal=createProductJournal(storage);
 const wallet={inspect:async()=>({account:ACCOUNT,chainId:10143}),sendTransaction:async(_a,_tx,check)=>{check();sends++;return HASH;}};
 const api=async(path)=>{if(path.endsWith('/attempt')){attempts++;return {allowed:true,intent:{...op,state:'SEND_UNKNOWN'}};}if(path.endsWith('/hash')){records++;return {id:op.id};}if(path.endsWith('/reconcile')){reconciles++;return {...op,state:'CONFIRMED'};}throw Error(path);};
 return {operation:op,configuration,session:{wallet:ACCOUNT},wallet,api,journal,isCurrent:()=>current,change:()=>current=false,get sends(){return sends;},get attempts(){return attempts;},get records(){return records;},get reconciles(){return reconciles;},storage};
}
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
test('explicit admission sends one exact multi-portion transaction, records hash first and reconciles',async()=>{
 const f=fixture();let journalBeforeHash=false;const api=f.api;f.api=async(path,o)=>{if(path.endsWith('/hash'))journalBeforeHash=f.journal.get(ACCOUNT,f.operation).txHash===HASH;return api(path,o);};
 assert.equal((await executeProductOperation(f)).state,'CONFIRMED');assert.equal(f.sends,1);assert.equal(f.attempts,1);assert.ok(journalBeforeHash);await rejects(()=>executeProductOperation(f),'ORIGINAL_OPERATION_ALREADY_ATTEMPTED');assert.equal(f.sends,1);
});
test('rejects changed recipient, calldata, amount, nonce, value, chain and unverified config before admission',async()=>{
 const mutations=[o=>o.transaction.to=OTHER,o=>o.transaction.from=OTHER,o=>o.transaction.data+='00',o=>o.amount='1',o=>o.transaction.nonce='0xffffffffffffffffffff',o=>o.transaction.value='0x1',o=>o.transaction.chainId='0x1',o=>o.transaction.extra='field'];
 for(const mutate of mutations){const f=fixture();mutate(f.operation);await assert.rejects(()=>executeProductOperation(f));assert.equal(f.sends,0);assert.equal(f.attempts,0);}
 const f=fixture();f.configuration={...configuration,verified:false};await rejects(()=>executeProductOperation(f),'PRODUCT_CONFIGURATION_UNVERIFIED');
});
test('missing allowance admission and wallet rejection never cause retry or approval',async()=>{
 const f=fixture();f.api=async()=>{throw Object.assign(Error('INSUFFICIENT_ALLOWANCE'),{code:'INSUFFICIENT_ALLOWANCE'});};await rejects(()=>executeProductOperation(f),'INSUFFICIENT_ALLOWANCE');assert.equal(f.sends,0);await rejects(()=>executeProductOperation(f),'ORIGINAL_OPERATION_ALREADY_ATTEMPTED');
 const g=fixture();g.wallet.sendTransaction=async()=>{throw Object.assign(Error('wallet declined'),{code:4001});};await rejects(()=>executeProductOperation(g),4001);await rejects(()=>executeProductOperation(g),'ORIGINAL_OPERATION_ALREADY_ATTEMPTED');
});
test('lost attempt response remains unknown and never invokes the wallet',async()=>{
 const f=fixture();f.api=async()=>{throw Error('response lost');};await assert.rejects(()=>executeProductOperation(f));assert.equal(f.sends,0);await rejects(()=>executeProductOperation(f),'ORIGINAL_OPERATION_ALREADY_ATTEMPTED');
});
test('hash recording failure recovers by original saved hash without another send',async()=>{
 const f=fixture(),api=f.api;let fail=true;f.api=async(path,o)=>{if(path.endsWith('/hash')&&fail){fail=false;throw Error('record response lost');}return api(path,o);};
 await assert.rejects(()=>executeProductOperation(f));assert.equal(f.journal.get(ACCOUNT,f.operation).txHash,HASH);assert.equal((await reconcileProductOperation(f)).state,'CONFIRMED');assert.equal(f.sends,1);
});
test('account changes after send preserve original hash but never submit using the new session',async()=>{
 const f=fixture();f.wallet.sendTransaction=async()=>{f.change();return HASH;};await rejects(()=>executeProductOperation(f),'WALLET_CONTEXT_CHANGED');assert.equal(f.journal.get(ACCOUNT,f.operation).txHash,HASH);assert.equal(f.records,0);assert.equal(f.reconciles,0);assert.equal(f.journal.get(OTHER,f.operation),null);
});
test('account changes after admission prevent the wallet prompt',async()=>{
 const f=fixture(),api=f.api;f.api=async(path,o)=>{const value=await api(path,o);if(path.endsWith('/attempt'))f.change();return value;};await rejects(()=>executeProductOperation(f),'WALLET_CONTEXT_CHANGED');assert.equal(f.sends,0);
});
test('storage failure before admission prevents all wallet activity',async()=>{
 const f=fixture();f.storage.setItem=()=>{throw Error('quota');};await assert.rejects(()=>executeProductOperation(f));assert.equal(f.attempts,0);assert.equal(f.sends,0);
});
test('registration/publication/supplement/listing strict encodings are accepted without signing or token approve',()=>{
 const ops=[{kind:'registration'}, {kind:'publication',expectedVersion:0,version:1,name:'Meal',description:'Original',unitPrice:'7000000',windows:[[0,1440]],terms:{unitPrice:'7000000',bodyDigest:keccak256(toUtf8Bytes(JSON.stringify({name:'Meal',description:'Original'}))),imageDigest:'0x'+'4'.repeat(64),windowCount:1,startMinute0:0,endMinute0:1440,startMinute1:0,endMinute1:0},quantity:'30',fundingDeadline:now()+1000}, {kind:'supplement',version:1,quantity:'50',fundingDeadline:now()+1000}, {kind:'listing',version:1,listed:false}];
 for(const fields of ops){const op={id:'catalog-op',wallet:ACCOUNT,state:'PREPARED',storeId:'store',mealId:'meal',...fields};if(op.kind==='publication')op.termsHash=publicationTermsHash(configuration,op);op.transaction=publicationTransaction(op,configuration,5);assert.deepEqual(validateProductOperation(op,{wallet:ACCOUNT},configuration),op.transaction);}
});
test('handover calldata must contain authority permit bound to owner, voucher, generation and deadline',async()=>{
 const expiresAt=now()+100,op={id:'hand',kind:'handover',state:'PREPARED',receiver:ACCOUNT,voucherId:'0x'+'5'.repeat(64),generation:2,expiresAt};
 const permit={voucherId:op.voucherId,generation:2,owner:ACCOUNT,issuedAt:expiresAt-100,deadline:expiresAt},signature=await authority.signTypedData(redemptionDomain(configuration),redemptionTypes,permit);
 op.transaction=redemptionTransaction({...op,wallet:ACCOUNT,permit,permitSignature:signature},configuration,4);
 assert.deepEqual(validateProductOperation(op,{wallet:ACCOUNT},configuration),op.transaction);
 for(const changed of [{...op,generation:3},{...op,expiresAt:expiresAt+1},{...op,voucherId:'0x'+'6'.repeat(64)}])assert.throws(()=>validateProductOperation(changed,{wallet:ACCOUNT},configuration));
 assert.throws(()=>validateProductOperation(op,{wallet:ACCOUNT},{...configuration,redemptionAuthority:OTHER}));
 const settle={...op,id:'settle',kind:'settlement'};settle.transaction=redemptionTransaction({...settle,wallet:ACCOUNT},configuration,5);assert.deepEqual(validateProductOperation(settle,{wallet:ACCOUNT},configuration),settle.transaction);
});
test('duplicate concurrent clicks admit/send exactly once',async()=>{
 const f=fixture();const outcomes=await Promise.allSettled([executeProductOperation(f),executeProductOperation(f)]);assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);assert.equal(f.attempts,1);assert.equal(f.sends,1);
});

test('approval is separate explicit exact-amount asset transaction; no hidden approval in support',async()=>{
 const {approvalTransaction}=await import('../../product-v2/approval-wire.mjs');
 const op={...operation(),id:'approval-1',kind:'approval',reviewId:'review-1',asset:ASSET,spender:ESCROW};op.transaction=approvalTransaction(op,configuration,3);
 const f=fixture(op),paths=[],base=f.api;f.api=async(path,body)=>{paths.push(path);return base(path,body);};assert.equal((await executeProductOperation(f)).state,'CONFIRMED');assert.equal(f.sends,1);assert.deepEqual(paths,['/approvals/approval-1/attempt','/approvals/approval-1/hash','/approvals/approval-1/reconcile']);
 for(const change of [o=>o.spender=OTHER,o=>o.asset=OTHER,o=>{o.amount='1';o.transaction=approvalTransaction(o,configuration,3);},o=>o.transaction.to=ESCROW,o=>o.transaction.data+='00',o=>delete o.reviewId]){const g=fixture(structuredClone(op));change(g.operation);await assert.rejects(()=>executeProductOperation(g));assert.equal(g.attempts,0);assert.equal(g.sends,0);}
});
test('approval lost hash response and identity change retain original hash without repeated authorization',async()=>{
 const {approvalTransaction}=await import('../../product-v2/approval-wire.mjs');const op={...operation(),id:'approval-2',kind:'approval',reviewId:'review-2',asset:ASSET,spender:ESCROW};op.transaction=approvalTransaction(op,configuration,3);
 const f=fixture(op),base=f.api;f.api=async(path,body)=>{if(path.endsWith('/hash'))throw Error('lost response');return base(path,body);};await assert.rejects(()=>executeProductOperation(f),/lost response/);assert.equal(f.journal.get(ACCOUNT,op).txHash,HASH);f.api=base;assert.equal((await reconcileProductOperation(f)).state,'CONFIRMED');assert.equal(f.sends,1);await rejects(()=>executeProductOperation(f),'ORIGINAL_OPERATION_ALREADY_ATTEMPTED');
 const g=fixture(op);g.wallet.sendTransaction=async()=>{g.change();return HASH;};await rejects(()=>executeProductOperation(g),'WALLET_CONTEXT_CHANGED');assert.equal(g.journal.get(ACCOUNT,op).txHash,HASH);assert.equal(g.records,0);
});

test('local coordinator accepts only explicit loopback configuration and inspects its actual chain',async()=>{
 const saved=globalThis.location;globalThis.location={origin:'http://127.0.0.1:43210'};
 try{const local={...configuration,profile:'local-acceptance',chainId:31337,asset:'0x'+'b'.repeat(40)};const op=operation();op.transaction=fundingTransaction(op,local,3);const f=fixture(op);f.configuration=local;f.wallet.inspect=async()=>({account:ACCOUNT,chainId:31337});assert.equal((await executeProductOperation(f)).state,'CONFIRMED');assert.equal(f.sends,1);
 const g=fixture(op);g.configuration=local;await rejects(()=>executeProductOperation(g),'WALLET_CONTEXT_CHANGED');assert.equal(g.sends,0);globalThis.location={origin:'https://meal.test'};assert.throws(()=>validateProductOperation(op,{wallet:ACCOUNT},local),/PRODUCT_CONFIGURATION_UNVERIFIED/);
 }finally{if(saved===undefined)delete globalThis.location;else globalThis.location=saved;}
});
