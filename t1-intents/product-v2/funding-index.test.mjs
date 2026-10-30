import test from 'node:test';
import assert from 'node:assert/strict';
import {makeFundingIndex} from './funding-index.mjs';
import {fundingInterface,chainReference} from './funding-wire.mjs';
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),E='0x'+'a'.repeat(40),T='0x'+'b'.repeat(40),W='0x'+'c'.repeat(40);
function fixture(){
 let db={publications:{reg:{kind:'registration',state:'CONFIRMED',storeId:'known',wallet:W,confirmedBlock:10}}},tail=Promise.resolve(),logs=[],fork=false,checks=0;
 const calls=[],store={read:async()=>structuredClone(db),transact(fn){const p=tail.then(async()=>{const next=structuredClone(db),out=await fn(next);db=next;return out;});tail=p.catch(()=>{});return p;}};
 const provider={getBlock:async n=>({number:n,hash:fork&&n===19?hash(1000):hash(n),timestamp:n+100}),getLogs:async f=>{calls.push(f);return logs.filter(l=>l.blockNumber>=f.fromBlock&&l.blockNumber<=f.toBlock);}};
 const row={id:hash(44),batchId:hash(55),storeId:'known',confirmedBlock:12,blockHash:hash(12),txHash:hash(66),wallet:W,quantity:'1',amount:'1'};
 const options={provider,store,target:{chainId:31337,escrow:E,asset:T},deploymentBlock:1,context:async()=>({block:{number:42,hash:hash(42)}}),verifyLog:async()=>{checks++;return structuredClone(row);}};
 function add(){const e=fundingInterface.encodeEventLog(fundingInterface.getEvent('Funded'),[row.batchId,chainReference('known'),W,hash(88),1,hash(99),1,1,1]);logs=[{...e,address:E,blockNumber:12,blockHash:row.blockHash,transactionHash:row.txHash,index:0,removed:false}];return logs[0];}
 return {store,provider,options,row,calls,add,index:makeFundingIndex(options),db:()=>db,fork:()=>{fork=true;}};
}
test('registration start, ten-block page, exact store topic and persistent canonical cursor',async()=>{
 const f=fixture();f.add();const first=await f.index.sync();assert.equal(first.fromBlock,10);assert.equal(first.toBlock,19);assert.equal(first.imported,1);assert.equal(f.calls[0].topics[2],chainReference('known'));assert.equal(f.calls[0].address,E);assert.equal(Object.keys(f.db().indexedBatches).length,1);
 // PostgreSQL JSONB key order must not change identity/cursor semantics.
 await f.store.transact(s=>{s.fundingIndex.target=Object.fromEntries(Object.entries(s.fundingIndex.target).reverse());s.fundingIndex.stores.known=Object.fromEntries(Object.entries(s.fundingIndex.stores.known).reverse());});
 const second=await makeFundingIndex(f.options).sync();assert.equal(second.fromBlock,20);assert.equal(second.toBlock,29);assert.equal(Object.keys(f.db().indexedBatches).length,1);
});
test('canonical cursor drift and target change fail without advancing',async()=>{
 const f=fixture();await f.index.sync();f.fork();await assert.rejects(f.index.sync(),e=>e.code==='FUNDING_INDEX_REORG');assert.equal(f.db().fundingIndex.stores.known.throughBlock,19);
 const g=fixture();await g.index.sync();const other=makeFundingIndex({...g.options,target:{...g.options.target,asset:W}});await assert.rejects(other.sync(),e=>e.code==='FUNDING_INDEX_TARGET_CHANGED');
});
test('removed or mismatched evidence never commits rows or cursor',async()=>{
 const f=fixture();f.add().removed=true;await assert.rejects(f.index.sync(),e=>e.code==='FUNDING_INDEX_LOG');assert.equal(f.db().fundingIndex,undefined);
 const g=fixture();g.add();g.row.storeId='foreign';await assert.rejects(g.index.sync(),e=>e.code==='FUNDING_INDEX_EVIDENCE');assert.equal(g.db().indexedBatches,undefined);
});
test('concurrent scans have one atomic cursor winner and deduplicated batches',async()=>{
 const f=fixture();f.add();const results=await Promise.all([f.index.sync(),f.index.sync()]);assert.equal(results.filter(r=>r.advanced).length,1);assert.equal(results.find(r=>!r.advanced).reason,'CURSOR_CHANGED');assert.equal(Object.keys(f.db().indexedBatches).length,1);
});
test('one bounded page per call, rejects unbounded configuration and unknown stores',async()=>{
 const f=fixture();assert.throws(()=>makeFundingIndex({...f.options,pageBlocks:11}),/FUNDING_INDEX_CONFIGURATION/);await f.store.transact(s=>{s.publications={};});assert.equal((await f.index.sync()).advanced,false);assert.equal(f.calls.length,0);
});
test('one store bad page backs off without advancing it or starving another store',async()=>{
 const f=fixture();let now=1000;await f.store.transact(s=>{s.publications.second={kind:'registration',state:'CONFIRMED',storeId:'second',wallet:W,confirmedBlock:11};});const original=f.provider.getLogs;f.provider.getLogs=async filter=>{if(filter.topics[2]===chainReference('known'))throw Error('BAD_PAGE');return original(filter);};const index=makeFundingIndex({...f.options,clock:()=>now});
 await assert.rejects(index.sync(),/BAD_PAGE/);assert.equal(f.db().fundingIndex,undefined);const other=await index.sync();assert.equal(other.storeId,'second');assert.equal(other.advanced,true);assert.equal(f.db().fundingIndex.stores.known,undefined);
 now+=5001;await assert.rejects(index.sync(),/BAD_PAGE/);assert.equal(f.db().fundingIndex.stores.known,undefined);
});
test('caught-up and future cursors cannot silently pass canonical verification',async()=>{
 for(const cursor of [{throughBlock:42,blockHash:hash(999)},{throughBlock:43,blockHash:hash(43)}]){const f=fixture();await f.index.sync();await f.store.transact(s=>{s.fundingIndex.stores.known=cursor;});await assert.rejects(f.index.sync(),e=>['FUNDING_INDEX_REORG','FUNDING_INDEX_CURSOR'].includes(e.code));assert.deepEqual(f.db().fundingIndex.stores.known,cursor);}
});
