/**
 * T1-C real disposable PostgreSQL 17.11 integration:
 * identical idempotency across 24 parallel requests, immutable Quote ID,
 * verified original MetaMask nonce, UNKNOWN across process/repository
 * reinitialization, exact original receipt proof, no wallet transmission.
 */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {Wallet,keccak256} from 'ethers';
import {
 createT1IntentLedger,CHAIN,ESCROW,TOKEN,MEAL,TERMS,PRICE,
 erc20,escrowAbi,quoteTypes,signatureDomain
} from './core.mjs';
import {ERC20,ESCROW_ABI} from './receipt.mjs';

const DSN='postgres://postgres:t1c-disposable-only@127.0.0.1:5432/mf_t1c_disposable_ci';
const ALLOW=process.env.GITHUB_ACTIONS==='true'&&
 process.env.MF_T1C_DISPOSABLE_ONLY==='ack-fresh-t1c-postgres17'&&
 process.env.DATABASE_URL===DSN;
const STOP=/UNKNOWN|CONFLICT|NOT_FOUND|DENIED|MISMATCH|EXPIRED|REQUIRED|IMMUTABLE|ILLEGAL/;
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),FOREIGN='0x'+'3'.repeat(40);
const BLOCK='0x'+('7'.repeat(64));
const receiptBlock='0x64',head='0x68';
const HASH_A='0x'+('a'.repeat(64)),HASH_F='0x'+('b'.repeat(64));
const batch='0x'+('c'.repeat(64));
const quoteSigner=Wallet.createRandom();  // synthetic CI-only, never logged.
let pool,ledger;
let now=1792583000;
const auth=async token=>({
 A:{verified:true,source:'TESTNET_WALLET_AUTHORITY',address:A},
 B:{verified:true,source:'TESTNET_WALLET_AUTHORITY',address:B},
 FOREIGN:{verified:true,source:'WRONG_AUTH_SOURCE',address:A}
})[token]??null;
const service=()=>createT1IntentLedger({
 pool,resolveWallet:auth,now:()=>now,quoteAuthority:quoteSigner.address
});
function quoteOf(row){
 return row.unsignedQuote;
}
const approveTx=(payer,nonce=11)=>({
 from:payer,to:TOKEN,nonce,value:'0',
 data:erc20.encodeFunctionData('approve',[ESCROW,PRICE])
});
const fundTx=(payer,q,sig,nonce=12)=>({
 from:payer,to:ESCROW,nonce,value:'0',
 data:escrowAbi.encodeFunctionData('fund',[q,sig])
});
function log(address,iface,name,args){
 const {topics,data}=iface.encodeEventLog(iface.getEvent(name),args);
 return {address,topics,data};
}
function fakeRpc(txHash,transaction,{kind='approve',receipt=true,status='0x1',
  transfer=true,event=true,blockHash=BLOCK,returnAllowance=PRICE,
  liability=PRICE,escrowBalance=PRICE}={}){
 const tx={hash:txHash,from:transaction.from,to:transaction.to,
  nonce:'0x'+BigInt(transaction.nonce).toString(16),
  input:transaction.data,value:'0x0',chainId:'0x279f',
  blockHash,blockNumber:receiptBlock};
 const logs=[];
 if(kind==='approve'&&event){
  logs.push(log(TOKEN,ERC20,'Approval',[transaction.from,ESCROW,PRICE]));
 }else if(kind==='fund'){
  const info=escrowAbi.parseTransaction({data:transaction.data}).args[0];
  if(event)logs.push(log(ESCROW,ESCROW_ABI,'Funded',[
   info.quoteId,batch,info.payer,info.mealId,info.currentVersion,
   info.termsHash,info.unitPrice,info.quantity,0n,info.amount
  ]));
  if(transfer)logs.push(log(TOKEN,ERC20,'Transfer',[transaction.from,ESCROW,info.amount]));
 }
 const r=receipt?{
  transactionHash:txHash,from:transaction.from,to:transaction.to,
  status,blockHash,blockNumber:receiptBlock,logs
 }:null;
 const read=async(call)=>{
  const contract=call.to.toLowerCase();
  if(contract===TOKEN){
   const parsed=ERC20.parseTransaction({data:call.data});
   if(parsed.name==='allowance')return ERC20.encodeFunctionResult('allowance',[returnAllowance]);
   if(parsed.name==='balanceOf')return ERC20.encodeFunctionResult('balanceOf',[escrowBalance]);
  }else if(contract===ESCROW){
   const parsed=ESCROW_ABI.parseTransaction({data:call.data});
   if(parsed.name==='quoteUses')return ESCROW_ABI.encodeFunctionResult('quoteUses',['0x'+'1'.repeat(64),batch]);
   if(parsed.name==='liability')return ESCROW_ABI.encodeFunctionResult('liability',[liability]);
  }
  throw Error('UNKNOWN_READ_IN_TEST');
 };
 const calls=[];
 const rpc={async send(method,params=[]){
  calls.push(method);
  if(method==='eth_chainId')return '0x279f';
  if(method==='eth_getTransactionByHash')return tx;
  if(method==='eth_getTransactionReceipt')return r;
  if(method==='eth_blockNumber')return head;
  if(method==='eth_getBlockByNumber')return {hash:blockHash,number:params[0]};
  if(method==='eth_call')return read(params[0]);
  throw Error('UNEXPECTED_CHAIN_WRITE_'+method);
 }};
 return {rpc,calls,tx,receipt:r};
}
const signQuote=async quote=>quoteSigner.signTypedData(signatureDomain,quoteTypes,quote);
async function newBound({session='A',quantity=1,key=randomUUID()}={}){
 const original=await ledger.prepare({session,idempotencyKey:key,quantity});
 const signature=await signQuote(original.unsignedQuote);
 await ledger.bindQuote({session,intentId:original.intentId,signature});
 return {...original,signature};
}
before(async()=>{
 assert.ok(ALLOW,'DISPOSABLE_GITHUB_PG17_REQUIRED');
 pool=new pg.Pool({connectionString:DSN,max:12});
 const res=await pool.query('SHOW server_version_num');
 assert.ok(Number(res.rows[0].server_version_num)>=170000&&
  Number(res.rows[0].server_version_num)<180000);
 assert.equal((await pool.query("SELECT to_regnamespace('mf_t1c') IS NULL AS empty")).rows[0].empty,true,
  'Refuse applying schema twice or operating on a non-fresh instance');
 const schema=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
 await pool.query(schema);
 ledger=service();
});
after(async()=>{await pool?.end()});

test('concurrent same-wallet same-idempotency prepare produces one original quote id and exact amount',async()=>{
 const key=randomUUID();
 const all=await Promise.all(Array.from({length:24},()=>ledger.prepare({
  session:'A',idempotencyKey:key,quantity:2
 })));
 assert.equal(new Set(all.map(x=>x.intentId)).size,1);
 assert.equal(new Set(all.map(x=>x.quoteId)).size,1);
 assert.equal(all[0].amount,'14000000');
 assert.equal(all[0].quantity,2);
 assert.equal(all[0].stage,'PREPARED');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM mf_t1c.intents WHERE idempotency_key=$1',[key])).rows[0].n,1);
 await assert.rejects(()=>ledger.prepare({session:'A',idempotencyKey:key,quantity:1}),/IDEMPOTENCY_PAYLOAD_CONFLICT/);
});
test('wrong wallet, wrong source identity, reusing id or invalid client request cannot access original intent',async()=>{
 const a=await ledger.prepare({session:'A',idempotencyKey:randomUUID(),quantity:1});
 await assert.rejects(()=>ledger.fetchOriginal({session:'B',intentId:a.intentId}),/INTENT_NOT_FOUND/);
 await assert.rejects(()=>ledger.fetchOriginal({session:'FOREIGN',intentId:a.intentId}),/UNVERIFIED_T1_WALLET_PRINCIPAL/);
 await assert.rejects(()=>ledger.prepare({session:'A',idempotencyKey:'not-uuid',quantity:1}),/INVALID_IDEMPOTENCY_KEY/);
 await assert.rejects(()=>ledger.prepare({session:'A',idempotencyKey:randomUUID(),quantity:0}),/INVALID_QUANTITY/);
 const b=await ledger.prepare({session:'B',idempotencyKey:randomUUID(),quantity:1});
 assert.notEqual(a.quoteId,b.quoteId);
});
test('Quote signature must be original FundingQuote, non-funding T1RoleControl is rejected',async()=>{
 const row=await ledger.prepare({session:'A',idempotencyKey:randomUUID(),quantity:1});
 const unrelated=await Wallet.createRandom().signMessage('harmless T1RoleControl');
 await assert.rejects(()=>ledger.bindQuote({session:'A',intentId:row.intentId,signature:unrelated}),
  /ORIGINAL_QUOTE_SIGNER_MISMATCH/);
 const sig=await signQuote(quoteOf(row));
 const bound=await ledger.bindQuote({session:'A',intentId:row.intentId,signature:sig});
 assert.equal(bound.stage,'QUOTE_BOUND');
 assert.match(bound.quoteDigest,/^0x[0-9a-f]{64}$/);
 assert.match(bound.quoteSignatureFingerprint,/^0x[0-9a-f]{64}$/);
 await assert.rejects(()=>ledger.bindQuote({session:'A',intentId:row.intentId,signature:sig}),
  /QUOTE_ALREADY_BOUND_OR_IN_FLIGHT/);
 const attempts=await pool.query('SELECT count(*)::int AS n FROM mf_t1c.wallet_attempts WHERE intent_id=$1',[row.intentId]);
 assert.equal(attempts.rows[0].n,0,'Signatures are not sent or broadcast as transactions');
});
test('PostgreSQL immutable quote identity, amount and stage cannot be bypassed by direct UPDATE',async()=>{
 const a=await ledger.prepare({session:'A',idempotencyKey:randomUUID(),quantity:1});
 await assert.rejects(()=>pool.query('UPDATE mf_t1c.intents SET amount=1,revision=revision+1 WHERE intent_id=$1',[a.intentId]),
  e=>e.code==='23514'||e.message?.includes('T1C_IMMUTABLE_INTENT'));
 await assert.rejects(()=>pool.query("UPDATE mf_t1c.intents SET stage='FUNDED',revision=revision+1 WHERE intent_id=$1",[a.intentId]),
  /T1C_ILLEGAL_INTENT_TRANSITION/);
 assert.equal((await ledger.fetchOriginal({session:'A',intentId:a.intentId})).stage,'PREPARED');
});
test('24 parallel wallet-approve attempts admit at most one original transaction and no auto retry after process reconstruction',async()=>{
 const a=await newBound();
 const tx=approveTx(A,201);
 const result=await Promise.allSettled(Array.from({length:24},()=>ledger.reserve({
  session:'A',intentId:a.intentId,kind:'approve',transaction:tx
 })));
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(result.filter(x=>x.status==='rejected').length,23);
 assert.equal(result.find(x=>x.status==='fulfilled').value.stage,'APPROVE_UNKNOWN');
 const attemptRows=await pool.query('SELECT * FROM mf_t1c.wallet_attempts WHERE intent_id=$1',[a.intentId]);
 assert.equal(attemptRows.rowCount,1);
 assert.equal(attemptRows.rows[0].tx_hash,null);
 // Service restarts: exactly same PG state; no new approve even with same transaction.
 const restarted=service();
 const state=await restarted.fetchOriginal({session:'A',intentId:a.intentId});
 assert.equal(state.stage,'APPROVE_UNKNOWN');
 assert.equal(state.attempts[0].status,'UNKNOWN');
 assert.equal(state.attempts[0].nonce,'201');
 await assert.rejects(()=>restarted.reserve({session:'A',intentId:a.intentId,kind:'approve',transaction:tx}),
  /ORIGINAL_WALLET_ATTEMPT_UNKNOWN_OR_BLOCKED/);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM mf_t1c.audit_events WHERE intent_id=$1 AND event_type=$2',[a.intentId,'APPROVE_RESERVED'])).rows[0].n,1);
});
test('original hash locator refuses foreign sender, wrong nonce and different wallet calldata',async()=>{
 const a=await newBound();
 const tx=approveTx(A,202);
 await ledger.reserve({session:'A',intentId:a.intentId,kind:'approve',transaction:tx});
 const m=fakeRpc(HASH_A,tx);
 const bad={
  send:async(method,args)=>{
   const value=await m.rpc.send(method,args);
   return method==='eth_getTransactionByHash'?{...value,nonce:'0xff'}:value;
  }
 };
 await assert.rejects(()=>ledger.bindOriginalHash({
  session:'A',intentId:a.intentId,kind:'approve',txHash:HASH_A,rpc:bad
 }),/TX_NOT_ORIGINAL_WALLET_INTENT/);
 assert.equal((await ledger.fetchOriginal({session:'A',intentId:a.intentId})).attempts[0].txHash,null);
 const bound=await ledger.bindOriginalHash({session:'A',intentId:a.intentId,kind:'approve',txHash:HASH_A,rpc:m.rpc});
 assert.equal(bound.locatorOnly,true);
 assert.equal((await ledger.fetchOriginal({session:'A',intentId:a.intentId})).stage,'APPROVE_UNKNOWN');
 assert.equal((await ledger.bindOriginalHash({session:'A',intentId:a.intentId,kind:'approve',txHash:HASH_A,rpc:m.rpc})).hash,HASH_A);
});
test('only original success Receipt + exact Approval event + actual allowance marks APPROVED',async()=>{
 const a=await newBound();
 const tx=approveTx(A,203),h='0x'+('d'.repeat(64));
 await ledger.reserve({session:'A',intentId:a.intentId,kind:'approve',transaction:tx});
 const m=fakeRpc(h,tx);
 await ledger.bindOriginalHash({session:'A',intentId:a.intentId,kind:'approve',txHash:h,rpc:m.rpc});
 const pending=fakeRpc(h,tx,{receipt:false});
 const wait=await ledger.reconcile({session:'A',intentId:a.intentId,kind:'approve',rpc:pending.rpc});
 assert.equal(wait.status,'UNKNOWN');
 const invalid=fakeRpc(h,tx,{event:false});
 await assert.rejects(()=>ledger.reconcile({session:'A',intentId:a.intentId,kind:'approve',rpc:invalid.rpc}),/ORIGINAL_APPROVAL_EVENT_NOT_PROVEN/);
 const insufficient=fakeRpc(h,tx,{returnAllowance:0n});
 await assert.rejects(()=>ledger.reconcile({session:'A',intentId:a.intentId,kind:'approve',rpc:insufficient.rpc}),/ORIGINAL_ALLOWANCE_NOT_PROVEN/);
 assert.equal((await ledger.fetchOriginal({session:'A',intentId:a.intentId})).stage,'APPROVE_UNKNOWN');
 const proof=await ledger.reconcile({session:'A',intentId:a.intentId,kind:'approve',rpc:m.rpc});
 assert.equal(proof.stage,'APPROVED');
 assert.equal((await service().reconcile({session:'A',intentId:a.intentId,kind:'approve',rpc:m.rpc})).alreadyFinal,true);
 assert.ok(!m.calls.some(x=>x.startsWith('eth_send')),'read-only RPC only');
});
test('verified Approve + signed quote may reserve Fund once, and receipt must prove Funded + token transfer + solvency',async()=>{
 const a=await newBound(),approve=approveTx(A,204);
 const h='0x'+('e'.repeat(64));
 await ledger.reserve({session:'A',intentId:a.intentId,kind:'approve',transaction:approve});
 const rpcApprove=fakeRpc(h,approve);
 await ledger.bindOriginalHash({session:'A',intentId:a.intentId,kind:'approve',txHash:h,rpc:rpcApprove.rpc});
 await ledger.reconcile({session:'A',intentId:a.intentId,kind:'approve',rpc:rpcApprove.rpc});
 const tx=fundTx(A,a.unsignedQuote,a.signature,205);
 const reserve=await ledger.reserve({session:'A',intentId:a.intentId,kind:'fund',transaction:tx});
 assert.equal(reserve.stage,'FUND_UNKNOWN');
 const hfund='0x'+('f'.repeat(64)),rp=fakeRpc(hfund,tx,{kind:'fund'});
 await ledger.bindOriginalHash({session:'A',intentId:a.intentId,kind:'fund',txHash:hfund,rpc:rp.rpc});
 await assert.rejects(()=>ledger.reconcile({session:'A',intentId:a.intentId,kind:'fund',rpc:fakeRpc(hfund,tx,{kind:'fund',transfer:false}).rpc}),
  /EXACT_ERC20_TRANSFER_NOT_PROVEN/);
 await assert.rejects(()=>ledger.reconcile({session:'A',intentId:a.intentId,kind:'fund',rpc:fakeRpc(hfund,tx,{kind:'fund',liability:14000000n,escrowBalance:7000000n}).rpc}),
  /POST_FUND_ESCROW_INSOLVENT/);
 assert.equal((await ledger.fetchOriginal({session:'A',intentId:a.intentId})).stage,'FUND_UNKNOWN');
 const proof=await ledger.reconcile({session:'A',intentId:a.intentId,kind:'fund',rpc:rp.rpc});
 assert.equal(proof.status,'CONFIRMED');
 assert.equal(proof.stage,'FUNDED');
 assert.equal((await service().fetchOriginal({session:'A',intentId:a.intentId})).stage,'FUNDED');
 await assert.rejects(()=>ledger.reserve({session:'A',intentId:a.intentId,kind:'fund',transaction:tx}),
  /ORIGINAL_WALLET_ATTEMPT_UNKNOWN_OR_BLOCKED/);
});
test('genuine SECOND NODE PROCESS restores committed UNKNOWN and rejects duplicate wallet broadcast',async()=>{
 const a=await newBound(),tx=approveTx(A,210);
 await ledger.reserve({session:'A',intentId:a.intentId,kind:'approve',transaction:tx});
 // Unlike a new JS instance, execFileSync starts a brand-new operating-system
 // process and independent PG connection after original transaction commit.
 const out=execFileSync(process.execPath,[
  fileURLToPath(new URL('./recovery-second-process.ci.mjs',import.meta.url)),
  a.intentId
 ],{encoding:'utf8',env:process.env,timeout:12000});
 const result=JSON.parse(out.trim());
 assert.equal(result.status,'T1C_CROSS_PROCESS_UNKNOWN_NO_RETRY_PASS');
 assert.equal(result.walletTxSubmitted,false);
 assert.equal(result.anotherAttemptReserved,false);
 assert.equal((await ledger.fetchOriginal({session:'A',intentId:a.intentId})).attempts.length,1);
});
test('expired immutable signed quote blocks future Approve and cannot be silently refreshed',async()=>{
 const a=await newBound();
 const previous=now;
 try{
  now+=2000;
  await assert.rejects(()=>ledger.reserve({
   session:'A',intentId:a.intentId,kind:'approve',transaction:approveTx(A,211)
  }),/SIGNED_QUOTE_EXPIRED/);
  await assert.rejects(()=>ledger.bindQuote({
   session:'A',intentId:a.intentId,signature:a.signature
  }),/QUOTE_ALREADY_BOUND_OR_IN_FLIGHT/);
 }finally{now=previous}
 const state=await ledger.fetchOriginal({session:'A',intentId:a.intentId});
 assert.equal(state.stage,'QUOTE_BOUND');
 assert.equal(state.attempts.length,0);
});
test('ERC20 allowance cannot be for foreign spender, wrong amount or native value',async()=>{
 const a=await newBound();
 const tx=approveTx(A,212);
 await assert.rejects(()=>ledger.reserve({
  session:'A',intentId:a.intentId,kind:'approve',
  transaction:{...tx,data:erc20.encodeFunctionData('approve',[B,PRICE])}
 }),/APPROVE_ALLOWANCE_NOT_EXACT/);
 await assert.rejects(()=>ledger.reserve({
  session:'A',intentId:a.intentId,kind:'approve',
  transaction:{...tx,data:erc20.encodeFunctionData('approve',[ESCROW,PRICE*2n])}
 }),/APPROVE_ALLOWANCE_NOT_EXACT/);
 await assert.rejects(()=>ledger.reserve({
  session:'A',intentId:a.intentId,kind:'approve',
  transaction:{...tx,value:1n}
 }),/TX_VALUE_MUST_BE_ZERO/);
 assert.equal((await ledger.fetchOriginal({session:'A',intentId:a.intentId})).attempts.length,0);
});
test('wallet nonce is globally unique per payer even across different intents',async()=>{
 const a=await newBound(),b=await newBound();
 await ledger.reserve({session:'A',intentId:a.intentId,kind:'approve',transaction:approveTx(A,206)});
 await assert.rejects(()=>ledger.reserve({session:'A',intentId:b.intentId,kind:'approve',transaction:approveTx(A,206)}),
  e=>e.code==='23505');
 assert.equal((await ledger.fetchOriginal({session:'A',intentId:b.intentId})).stage,'QUOTE_BOUND');
});
test('fund transaction enforces original calldata, EIP712 signature, fixed quoteId and unique nonce',async()=>{
 const a=await newBound(),b=await newBound();
 const approved=approveTx(A,207),h='0x'+('1'.repeat(64));
 await ledger.reserve({session:'A',intentId:a.intentId,kind:'approve',transaction:approved});
 const ap=fakeRpc(h,approved);
 await ledger.bindOriginalHash({session:'A',intentId:a.intentId,kind:'approve',txHash:h,rpc:ap.rpc});
 await ledger.reconcile({session:'A',intentId:a.intentId,kind:'approve',rpc:ap.rpc});
 const bad=fundTx(A,b.unsignedQuote,b.signature,208);
 await assert.rejects(()=>ledger.reserve({session:'A',intentId:a.intentId,kind:'fund',transaction:bad}),
  /QUOTE_CALLDATA_MISMATCH_quoteId/);
 await assert.rejects(()=>ledger.reserve({session:'A',intentId:a.intentId,kind:'fund',
  transaction:{...fundTx(A,a.unsignedQuote,a.signature,208),to:TOKEN}}),/ORIGINAL_TRANSACTION_TARGET_MISMATCH/);
 assert.equal((await ledger.fetchOriginal({session:'A',intentId:a.intentId})).stage,'APPROVED');
});
test('confirmed reverted original tx goes FINAL_FAILED and never signs or reserves again',async()=>{
 const a=await newBound(),t=approveTx(A,209);
 const h='0x'+('2'.repeat(64));
 await ledger.reserve({session:'A',intentId:a.intentId,kind:'approve',transaction:t});
 const rp=fakeRpc(h,t,{status:'0x0',event:false});
 await ledger.bindOriginalHash({session:'A',intentId:a.intentId,kind:'approve',txHash:h,rpc:rp.rpc});
 const done=await ledger.reconcile({session:'A',intentId:a.intentId,kind:'approve',rpc:rp.rpc});
 assert.equal(done.stage,'FAILED');
 await assert.rejects(()=>ledger.reserve({session:'A',intentId:a.intentId,kind:'approve',transaction:t}),
 /ORIGINAL_WALLET_ATTEMPT_UNKNOWN_OR_BLOCKED/);
});
test('this new service is not an externally reachable funding application',()=>{
 assert.equal(typeof ledger.reserve,'function');
 assert.equal('listen' in ledger,false);
 assert.equal('sendTransaction' in ledger,false);
 assert.equal('signQuote' in ledger,false);
});
