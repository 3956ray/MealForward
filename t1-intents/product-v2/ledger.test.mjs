import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProductService,emptyState} from './service.mjs';
function fixture(){const state={...emptyState(),intents:{paid:{kind:'support',state:'CONFIRMED',confirmedBlock:122,storeId:'kitchen',mealId:'meal',name:'Rice',version:1,quantity:'3',amount:'3000000',txHash:'0x'+'ab'.repeat(32),wallet:'private-payer',transaction:{data:'private-data'}},unknown:{kind:'support',state:'SEND_UNKNOWN',amount:'999999',wallet:'private-payer'}},vouchers:{secret:{wallet:'private-recipient',credential:'private-code'}}};
 const snapshot={verified:true,blockNumber:123,blockHash:'0x'+'bc'.repeat(32),asset:{symbol:'USDC',decimals:6},stores:[],meals:[],accounting:{funded:'3',available:'1',claimed:'1',handedOver:'0',settled:'1',refundPending:'0',refunded:'0'}};
 const service=makeProductService({store:{read:async()=>state,transact:async fn=>fn(state)},chain:{target:{chainId:31337},catalog:async()=>snapshot}});return {service,snapshot};}
test('public ledger is derived from verified accounting and strips all private state',async()=>{const f=fixture(),r=await f.service.ledger();assert.equal(r.items.length,1);assert.equal(r.counts.funded,'3');assert.equal(r.blockNumber,123);assert.doesNotMatch(JSON.stringify(r),/private-|credential|wallet|transaction/);assert.equal(r.items[0].amount,'3000000');});
test('unverified or nonconserving accounting fails closed',async()=>{for(const change of [{accounting:null},{verified:false},{accounting:{funded:'3',available:'9',claimed:'0',handedOver:'0',settled:'0',refundPending:'0',refunded:'0'}}]){const f=fixture();Object.assign(f.snapshot,change);await assert.rejects(f.service.ledger());}});

test('public records never outrun the accounting block',async()=>{const f=fixture();f.snapshot.blockNumber=121;assert.equal((await f.service.ledger()).items.length,0);});
