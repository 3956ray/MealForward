/** Disposable local PostgreSQL validation, never connects to Supabase or old DBs. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import pg from 'pg';
import {verifyProductPermissions} from './permissions.mjs';
import {productAuthStore} from './auth-store.mjs';
import {productStore} from './store.mjs';
import {makeProductService} from './service.mjs';
import {fundingTransaction} from './funding-wire.mjs';
import {makeClaimService} from './claims.mjs';
import {claimCalldata} from './claim-wire.mjs';
import {Wallet,keccak256} from 'ethers';
const bin=process.env.PRODUCT_TEST_PG_BIN||'/opt/homebrew/opt/postgresql@17/bin';
const directory=await mkdtemp(join(tmpdir(),'mealforward-product-pg-'));
const port=await new Promise(resolve=>{const socket=createServer();socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));});});
let started=false,pool,admin;
try {
  execFileSync(join(bin,'initdb'),['-D',join(directory,'data'),'-A','trust','-U','product_test'],{stdio:'pipe'});
  execFileSync(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-l',join(directory,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${directory}`,'-w','start'],{stdio:'pipe'});started=true;
  admin=new pg.Pool({host:'127.0.0.1',port,user:'product_test',database:'postgres'});
  await admin.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  pool=new pg.Pool({host:'127.0.0.1',port,user:'product_test',database:'postgres',options:'-c role=mf_product_v2_runtime'});
  await verifyProductPermissions(pool);
  const drift=async(grant,restore)=>{await admin.query(grant);await assert.rejects(()=>verifyProductPermissions(pool));await admin.query(restore);await verifyProductPermissions(pool);};
  await drift('GRANT TRUNCATE ON mf_product_v2.state TO mf_product_v2_runtime','REVOKE TRUNCATE ON mf_product_v2.state FROM mf_product_v2_runtime');
  await drift('GRANT UPDATE(version) ON mf_product_v2.schema_version TO mf_product_v2_runtime','REVOKE UPDATE(version) ON mf_product_v2.schema_version FROM mf_product_v2_runtime');
  await drift('ALTER TABLE mf_product_v2.state DISABLE ROW LEVEL SECURITY','ALTER TABLE mf_product_v2.state ENABLE ROW LEVEL SECURITY');
  const auth=productAuthStore(pool),now=1800000000,preHash='1'.repeat(64),csrfHash='2'.repeat(64),sessionHash='3'.repeat(64),sessionCsrfHash='4'.repeat(64);
  await auth.createPre({preHash,csrfHash,expiresAt:now+300});
  const challenge={challengeId:'12345678-1234-1234-1234-123456789abc',expiresAt:now+180};
  assert.equal(await auth.createChallenge({preHash,csrfHash,challenge,now}),true);
  const login={preHash,csrfHash,challenge,sessionHash,sessionCsrfHash,wallet:'0x'+'a'.repeat(40),expiresAt:now+3600,now};
  const consumed=await Promise.all([auth.consumeAndCreateSession(login),auth.consumeAndCreateSession(login)]);assert.equal(consumed.filter(Boolean).length,1);
  assert.equal((await auth.getSessionWithCsrf(sessionHash,sessionCsrfHash,now)).wallet,login.wallet);
  assert.equal(await auth.getSessionWithCsrf(sessionHash,'5'.repeat(64),now),null);
  await auth.revokeSession(sessionHash,sessionCsrfHash,now);assert.equal(await auth.getSession(sessionHash,now),null);
  const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x'+'c'.repeat(40),OWNER='0x'+'d'.repeat(40);
  const target={asset:'0x'+'c'.repeat(40),chainId:31337,escrow:'0x'+'e'.repeat(40)},termsHash='0x'+'f'.repeat(64);
  const chain={target,fundingEnabled:true,fundingAllowance:async owner=>({verified:true,finalized:true,blockNumber:1,owner,asset:target.asset,spender:target.escrow,allowance:'99999999999999999'}),catalog:async()=>({verified:true,blockNumber:1,stores:[{id:'kitchen',name:'Synthetic',owner:OWNER}],meals:[{id:'meal',storeId:'kitchen',name:'Meal',version:1,unitPrice:'7000000',termsHash,remaining:'20',listed:true,fundingDeadline:1900000000}]}),prepareFunding:async intent=>fundingTransaction(intent,target,0)};
  const service=()=>makeProductService({store:productStore(pool),chain,clock:()=>1800000000});
  const s1=service(),s2=service();
  const review=(s,w,r,q='12')=>s.reviewSupport(w,{storeId:'kitchen',mealId:'meal',version:1,quantity:q,requestId:r});
  const a=await review(s1,A,'a'),b=await review(s2,B,'b');
  const outcomes=await Promise.allSettled([s1.confirmSupport(A,{reviewId:a.id,requestId:'a-confirm'}),s2.confirmSupport(B,{reviewId:b.id,requestId:'b-confirm'})]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'INSUFFICIENT_INVENTORY');
  const original=outcomes.find(x=>x.status==='fulfilled').value;
  assert.equal((await service().catalog()).meals[0].remaining,'8');
  const c=await review(s2,C,'c','8'),other=await s2.confirmSupport(C,{reviewId:c.id,requestId:'c-confirm'});
  const attempts=await Promise.allSettled([s1.attempt(original.wallet,original.id),s2.cancel(original.wallet,original.id)]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await service().orders(C)).items[0].id,other.id);
  // Failed mutations roll back even after the callback wrote data.
  const before=(await pool.query('SELECT revision,data FROM mf_product_v2.state WHERE id=1')).rows[0];
  await assert.rejects(productStore(pool).transact(state=>{state.drafts.bad={};throw Error('abort');}));
  assert.deepEqual((await pool.query('SELECT revision,data FROM mf_product_v2.state WHERE id=1')).rows[0],before);
  const platform=Wallet.createRandom();
  const claimChain={...chain,claimEnabled:true,target:{...target,claimAuthority:platform.address,maxFeePerGas:'1000000000',maxTransactionFee:'1000000000000000'},
    claimCandidate:async(storeId,mealId)=>({verified:true,storeId,mealId,name:'Original meal',batchId:'0x'+'1'.repeat(64),unitIndex:'0',expectedGeneration:1,version:1,windows:[[0,1440]],termsHash}),
    eligibility:async()=>({verified:true,nextEligibleAt:0,policySeconds:7200}),
    signClaim:async intent=>{const raw=await platform.signTransaction({chainId:31337,to:target.escrow,nonce:0,gasLimit:1000000,gasPrice:1,data:claimCalldata(intent)});return {verified:true,raw,hash:keccak256(raw)};},
    broadcastClaim:async()=>{throw Error('synthetic response loss');},verifyClaim:async()=>({verified:false})};
  const claims=()=>makeClaimService({store:productStore(pool),chain:claimChain,policySeconds:7200,pepper:'synthetic-only-product-claim-pepper-32',clock:()=>1800000000});
  const c1=claims(),c2=claims();
  const cr1=await c1.review(A,{storeId:'kitchen',mealId:'meal',requestId:'claim-review-a'}),cr2=await c2.review(B,{storeId:'kitchen',mealId:'meal',requestId:'claim-review-b'});
  const allocated=await Promise.allSettled([c1.confirm(A,{reviewId:cr1.id,requestId:'claim-confirm-a'}),c2.confirm(B,{reviewId:cr2.id,requestId:'claim-confirm-b'})]);
  assert.equal(allocated.filter(r=>r.status==='fulfilled').length,1);assert.equal(allocated.find(r=>r.status==='rejected').reason.code,'UNIT_RESERVED');
  const allocatedClaim=allocated.find(r=>r.status==='fulfilled').value;
  await c1.signNext();await c1.dispatch(allocatedClaim.id);
  await assert.rejects(claims().dispatch(allocatedClaim.id),e=>e.code==='CLAIM_ALREADY_ATTEMPTED');
  assert.equal(Object.values((await productStore(pool).read()).claims)[0].state,'SEND_UNKNOWN');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name LIKE 'mf_mvp%'")).rows[0].n,0);
  console.log('PASS: real restricted-role PostgreSQL, permission drift gates, SIWE session single consumption, last-stock and Claim allocation races, independent payers, attempt/cancel, reconnect, rollback and durable platform outbox; synthetic chain evidence only.');
} finally {
  await pool?.end();await admin?.end();
  if(started)execFileSync(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-m','fast','-w','stop'],{stdio:'pipe'});
  await rm(directory,{recursive:true,force:true});
}
