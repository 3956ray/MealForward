import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mon,parseLedger} from '../../src/testnet/api.ts'
import {batchId,contractAddress} from '../../src/testnet/contracts.ts'
const valid={batchId,amounts:{F:'1000000000000000',A:'0',R:'0',H:'0',S:'1000000000000000'},contractBalanceWei:'0',liabilityWei:'0',source:{chainId:10143,contract:contractAddress,blockNumber:67799206,blockHash:'0x'+'a'.repeat(64),finality:'finalized',checkedAt:'2026-10-03T10:00:00Z'},sync:{state:'HISTORY_SYNCING',accountingState:'VERIFIED',eventsState:'SYNCING',scannedThrough:67797293,verifiedThrough:67799206,targetBlock:67799206,lastAttemptAt:'2026-10-03T10:00:00Z',lastErrorCode:null}}
test('exact wei formatting and absent amounts never become zero',()=>{
 assert.equal(mon(null),'—');assert.equal(mon(undefined),'—');assert.equal(mon('0'),'0');assert.equal(mon('1000000000000000'),'0.001');assert.equal(mon('123456789123456789123456789'),'123456789.123456789123456789');assert.throws(()=>mon('1e18'))
})
test('fixed deployment whitelist and separate scan/finality reject forged data',()=>{
 const result=parseLedger({...valid,secret:'do not expose'});assert.deepEqual(result,valid);assert.ok(!('secret' in result))
 for(const bad of [{...valid,batchId:'other'},{...valid,source:{...valid.source,chainId:31337}},{...valid,source:{...valid.source,finality:'latest'}},{...valid,amounts:{...valid.amounts,S:'0'}},{...valid,sync:{...valid.sync,state:'HALTED'}},{...valid,sync:{...valid.sync,state:'VERIFIED'}}])assert.throws(()=>parseLedger(bad))
 const empty={...valid,amounts:null,source:null,contractBalanceWei:null,liabilityWei:null,sync:{...valid.sync,state:'UNAVAILABLE',accountingState:'UNAVAILABLE',verifiedThrough:null,targetBlock:null}}
 assert.equal(parseLedger(empty).amounts,null)
})
