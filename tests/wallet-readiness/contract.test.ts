import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Readiness} from '../../wallet-readiness-harness/controller.ts'
import {roleNames} from '../../wallet-readiness-harness/contract.ts'
const m=JSON.parse(readFileSync(new URL('../../server/wallet_readiness/historical-manifest.json',import.meta.url),'utf8'))
const manifest={...m,manifestDigest:'9778ea2d23648aad464fb7a575b25ead7f8e4a365c3c682b9722cd783c29252f'}
const address='0x'+'0'.repeat(40)
function provider(){const events=new Map<string,()=>void>();return {isMetaMask:true,events,request:async({method}:{method:string})=>method==='eth_chainId'?'0x279f':[address],on:(e:string,f:()=>void)=>events.set(e,f),removeListener:(e:string)=>events.delete(e)}}
const result=()=>({address,profileId:'monad-testnet-readonly-cp26-v1',sourceLabel:'synthetic',targetChainId:10143,rpcChainId:10143,startedAt:1000,checkedAt:1001,expiresAt:1060,network:{status:'PASS'},account:{status:'PASS'},deployment:{status:'PASS',runtimeKeccak:m.expectedRuntimeKeccak},manifest,newBusinessTarget:null,block:{number:10,hash:'0x'+'1'.repeat(64),timestamp:1000},roles:{status:'OBSERVED',reason:'HISTORICAL_ROLES_OBSERVED',values:Object.fromEntries(roleNames.map(n=>[n,false])),merchant:m.expectedMerchant.toLowerCase(),merchantMatches:false,paused:false,ruleVersion:m.expectedRuleVersion}})
const response=(value:any)=>new Response(JSON.stringify(value))
async function setup(transport:typeof fetch){const p=provider();const c=new Readiness(()=>p,transport,()=>1002000);c.configure(manifest);await c.connect();return {p,c}}
test('native-like receiver, all false roles preserve connection and multiple roles remain separate',async()=>{
 for(const multi of [false,true]){let calls=0;const r=result();r.roles.values.SUPPORTER_ROLE=multi;r.roles.values.SETTLER_ROLE=multi
  const {c}=await setup(async function(this:unknown){assert.equal(this,undefined);calls++;return response(r)})
  await c.check();assert.equal(calls,1);assert.equal(c.state.account,address);assert.equal(c.state.result?.roles.status,'OBSERVED');assert.equal(c.state.result?.roles.values?.SUPPORTER_ROLE,multi);c.dispose()
 }
})
test('wrong manifest target/digest, partial or malformed roles and block are refused',async()=>{
 const variants=[(r:any)=>r.rpcChainId=31337,(r:any)=>r.profileId='wrong-profile',(r:any)=>r.deployment.runtimeKeccak='0x'+'0'.repeat(64),(r:any)=>r.manifest={...manifest,contractAddress:address},(r:any)=>r.manifest={...manifest,manifestDigest:'bad'},(r:any)=>r.roles.values.DEFAULT_ADMIN_ROLE=2,(r:any)=>delete r.roles.values.SETTLER_ROLE,(r:any)=>r.roles.merchantMatches=true,(r:any)=>r.roles.ruleVersion='bad',(r:any)=>r.block.hash='bad',(r:any)=>r.network.status='FAIL',(r:any)=>r.roles.status='NOT_CHECKED',(r:any)=>r.newBusinessTarget={address}]
 for(const modify of variants){const r=result();modify(r);const {c}=await setup(async()=>response(r));await c.check();assert.equal(c.state.error,'RESULT_INVALID');assert.equal(c.state.result,undefined);c.dispose()}
})
test('failed dynamic group clears old observations while retaining valid base and connected account',async()=>{
 let data:any=result();const {c}=await setup(async()=>response(data));await c.check();assert.ok(c.state.result?.roles.values)
 data={...result(),roles:{status:'NOT_CHECKED',reason:'RPC_TIMEOUT'}};await c.check()
 assert.equal(c.state.result?.network.status,'PASS');assert.equal(c.state.result?.roles.values,undefined);assert.equal(c.state.account,address);c.dispose()
})
test('end-block conflict never displays same-block success',async()=>{
 const r:any=result();r.network={status:'FAIL',reason:'BLOCK_CONFLICT'};r.account={status:'NOT_CHECKED'};r.deployment={status:'NOT_CHECKED'};r.roles={status:'NOT_CHECKED',reason:'BLOCK_CONFLICT'};r.checkedAt=null;delete r.block
 const {c}=await setup(async()=>response(r));await c.check();assert.equal(c.state.result?.network.status,'FAIL');assert.equal(c.state.result?.roles.values,undefined);c.dispose()
})
test('manifest disappearance invalidates pending response without disconnecting wallet',async()=>{
 let deliver!:(r:Response)=>void;let start!:()=>void;const began=new Promise<void>(r=>{start=r})
 const {c}=await setup(()=>{start();return new Promise(r=>{deliver=r})});const pending=c.check();await began;c.configure(null);deliver(response(result()));await pending
 assert.equal(c.state.result,undefined);assert.equal(c.state.account,address);assert.equal(c.state.busy,false);c.dispose()
})
test('unknown manifest prevents requests and clears prior result',async()=>{
 let calls=0;const {c}=await setup(async()=>{calls++;return response(result())});await c.check();c.configure({...manifest,schemaVersion:2});await c.check();assert.equal(calls,1);assert.equal(c.state.result,undefined);c.dispose()
})
test('wallet events and TTL invalidate historical roles',async()=>{
 for(const event of ['accountsChanged','chainChanged','disconnect']){const {p,c}=await setup(async()=>response(result()));await c.check();p.events.get(event)!();assert.equal(c.state.result,undefined);c.dispose()}
 const p=provider();let now=1002000;const c=new Readiness(()=>p,async()=>response(result()),()=>now);c.configure(manifest);await c.connect();await c.check();now=1060000;c.expire();assert.equal(c.state.result,undefined);c.dispose()
})
