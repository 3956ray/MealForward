import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BATCH, CONTRACT, OPERATOR, PRICE, GAS_CAP, IssuanceError, issueData, parseConfig, parseView, statuses, type View, type Config } from '../../src/testnet-issuance/contracts.ts'
import { ATTRIBUTION, IssuanceController, STALE_NOTICE, TEST_BANNER, VOUCHER_NOTE, displayError, statusText, statusTexts } from '../../src/testnet-issuance/controller.ts'
import { createIssuanceApi, type IssuanceApi } from '../../src/testnet-issuance/api.ts'

const issuanceId='0x'+'56'.repeat(32)
const txHash='0x'+'78'.repeat(32)
const otherHash='0x'+'21'.repeat(32)
const operationId='0xf7c3386a2ba4aa138739e1d2789c105152b1a8f1e4b922170743c8acf8a679c8'
const voucherId='0x4ea3d40c479eba51652f35d3571c429e26939cd8e97124e3341458d15a625c68'
const ruleVersion='0x5281a766c67b94209702620ff559de451e9c0389a4b79ad543c30d7787c13c06'
const config:Config={chainId:10143,contract:CONTRACT,ruleVersion,priceWei:PRICE,testOnly:true,configured:true,partnerLabel:'partner-a'}
function accounting() { return {F:PRICE,A:'0',R:PRICE,H:'0',S:'0',liabilityWei:PRICE,contractBalanceWei:PRICE,totalFundedWei:'2000000000000000',blockNumber:11,blockHash:txHash} }
function fixture(status:View['operation']['status']='PREPARED'): View {
  const verified=status==='ACCOUNTING_VERIFIED'
  const broadcast=!['PREPARED','HALTED','RESTORE_QUARANTINE'].includes(status)
  return {operation:{issuanceId,operationId,batchId:BATCH,voucherId,partnerLabel:'partner-a',recipientRef:'test-recipient-01',status,
    txHash:broadcast?txHash:null,errorCode:null,receiptBlock:broadcast?10:null,receiptBlockHash:broadcast?txHash:null,
    finalizedBlock:verified||status==='FINALIZED_REVERT'?11:null,gasFeeWei:broadcast?'101000000000000':null,scanThrough:100,
    budgetViolation:false,finalizedReceipt:null,receiptConflict:null},
    intent:{chainId:10143,to:CONTRACT,data:issueData(operationId,BATCH,voucherId),valueWei:'0',quantity:1,ruleVersion,gasLimitCap:GAS_CAP,maxFeePerGasCapWei:'200000000000'},
    accounting:verified?accounting():null}
}
function setup(status:View['operation']['status']='PREPARED') {
  let view=fixture(status)
  const calls:string[]=[]
  const api:IssuanceApi={config:async()=>structuredClone(config),operation:async(cached=false)=>{calls.push(cached?'operation?cached=1':'operation');return structuredClone(view)}}
  const controller=new IssuanceController(api)
  return {api,controller,calls,setView:(next:View)=>{view=next}}
}
test('deterministic issue calldata mirrors the frozen domain derivation',()=>{
  assert.equal(issueData(operationId,BATCH,voucherId),
    '0xc532ff9b'+operationId.slice(2)+BATCH.slice(2)+'60'.padStart(64,'0')+'1'.padStart(64,'0')+voucherId.slice(2))
})
test('page loads without any 18975 session: zero /api/v1/work requests, no wallet access',async()=>{
  let ethereumTouched=false
  Object.defineProperty(globalThis,'ethereum',{get(){ethereumTouched=true;return undefined},configurable:true})
  const s=setup()
  await s.controller.load()
  assert.deepEqual(s.calls,['operation?cached=1'])
  assert.ok(s.controller.state.config?.configured)
  assert.equal(s.controller.state.view?.operation.status,'PREPARED')
  assert.match(statusText(s.controller.state),/等待测试负责人放行/)
  assert.equal(s.controller.state.view?.operation.partnerLabel,'partner-a')
  assert.equal(ethereumTouched,false)
  Object.defineProperty(globalThis,'ethereum',{value:undefined,configurable:true,writable:true})
})
test('mount never triggers a sync GET; manual refresh triggers exactly one bounded sync',async()=>{
  const s=setup()
  await s.controller.load()
  assert.deepEqual(s.calls,['operation?cached=1'])
  await s.controller.refresh()
  assert.deepEqual(s.calls,['operation?cached=1','operation'])
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.deepEqual(s.calls,['operation?cached=1','operation'])  // no polling
})
test('late responses keep original identity; identity change is rejected',async()=>{
  const s=setup()
  await s.controller.load()
  assert.equal(s.controller.state.view?.operation.status,'PREPARED')
  s.api.operation=async()=>{await new Promise(resolve=>setTimeout(resolve,10));return fixture('BROADCAST')}
  await s.controller.refresh()
  assert.equal(s.controller.state.view?.operation.status,'BROADCAST')
  s.api.operation=async()=>{const v=fixture('ACCOUNTING_VERIFIED');v.operation.operationId=otherHash;return v}
  await s.controller.refresh()
  assert.equal(s.controller.state.error,'INVALID_RESPONSE')
  assert.equal(s.controller.state.view?.operation.operationId,operationId)
  assert.equal(s.controller.state.view?.operation.status,'BROADCAST')
})
for(const status of statuses) test(`status machine text for ${status}`,async()=>{
  const s=setup(status)
  await s.controller.load()
  const text=statusText(s.controller.state)
  switch(status){
    case 'PREPARED': assert.match(text,/计划已冻结/);assert.match(text,/等待测试负责人放行/);break
    case 'BROADCAST': assert.equal(text,statusTexts.BROADCAST);break
    case 'INCLUDED_SUCCESS': assert.equal(text,statusTexts.INCLUDED_SUCCESS);break
    case 'INCLUDED_REVERT': case 'FINALIZED_REVERT': assert.match(text,/执行失败/);assert.match(text,/不再尝试/);break
    case 'FINALIZED_SUCCESS': assert.match(text,/最终确认/);break
    case 'ACCOUNTING_VERIFIED': assert.equal(text,'测试餐券已发行，批次账目已核验');break
    case 'HALTED': assert.match(text,/核验隔离/);break
    case 'RESTORE_QUARANTINE': assert.match(text,/恢复隔离/);break
  }
})
test('constant annotations and attribution wording are exact',()=>{
  assert.equal(TEST_BANNER,'Monad 测试网 · 虚构领取者 · 测试MON · 不证明供餐')
  assert.equal(VOUCHER_NOTE,'本片无领取凭证，此券暂不可领取/不可分发')
  assert.equal(ATTRIBUTION,'机构伙伴（partner-a）名义发行 · 平台受限发行服务钥匙代发（Leader 测试计划放行）')
  assert.doesNotMatch(ATTRIBUTION,/工作账号已授权/)
  assert.doesNotMatch(ATTRIBUTION,/operator\s*=\s*partner/)
  assert.match(OPERATOR,/0xc23581f5656247057213bfafd279732993728c80/i)
})
test('stale non-budget errorCode shows top banner and keeps historical evidence',async()=>{
  const s=setup('ACCOUNTING_VERIFIED')
  await s.controller.load()
  assert.equal(s.controller.state.stale,false)
  for(const code of ['RPC_UNAVAILABLE','RPC_TIMEOUT','SYNC_BUDGET','TRANSACTION_UNAVAILABLE','RECEIPT_UNAVAILABLE']){
    s.setView({...fixture('ACCOUNTING_VERIFIED'),operation:{...fixture('ACCOUNTING_VERIFIED').operation,errorCode:code}})
    await s.controller.refresh()
    assert.equal(s.controller.state.stale,true,code)
    assert.equal(s.controller.state.error,code)
    assert.equal(s.controller.state.view?.accounting?.F,PRICE)
  }
  assert.equal(STALE_NOTICE,'本次读取未完成，下列内容仅为上次已核结果')
  s.setView(fixture('ACCOUNTING_VERIFIED'))
  await s.controller.refresh()
  assert.equal(s.controller.state.stale,false);assert.equal(s.controller.state.error,null)
})
test('RATE_LIMITED surfaces a manual-retry notice and never auto-retries',async()=>{
  const s=setup()
  await s.controller.load()
  let attempts=0
  s.api.operation=async()=>{attempts++;throw new IssuanceError('RATE_LIMITED')}
  await s.controller.refresh()
  assert.equal(attempts,1)
  assert.equal(s.controller.state.error,'RATE_LIMITED')
  assert.equal(displayError('RATE_LIMITED'),'查询过于频繁，请稍后手动重查')
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal(attempts,1)
})
test('DTO tampering fails closed with INVALID_RESPONSE',()=>{
  const withReceipt=()=>{const v=fixture('ACCOUNTING_VERIFIED');return v}
  const mutations:[string,(v:View)=>void][]=[
    ['operationId',(v:View)=>{v.operation.operationId=otherHash}],
    ['voucherId',(v:View)=>{v.operation.voucherId=otherHash}],
    ['batchId',(v:View)=>{v.operation.batchId=otherHash}],
    ['label',(v:View)=>{v.operation.partnerLabel='Partner A'}],
    ['calldata',(v:View)=>{v.intent.data='0x'}],
    ['value',(v:View)=>{(v.intent as {valueWei:string}).valueWei='0x1'}],
    ['gasCap',(v:View)=>{(v.intent as {gasLimitCap:number}).gasLimitCap=250001}],
    ['feeCap',(v:View)=>{v.intent.maxFeePerGasCapWei='200000000001'}],
    ['accountingA',(v:View)=>{if(v.accounting)v.accounting.A=PRICE}],
    ['globalLiability',(v:View)=>{if(v.accounting)v.accounting.liabilityWei='2'}],
    ['broadcastWithoutHash',(v:View)=>{v.operation.status='BROADCAST';v.operation.txHash=null}],
  ]
  for(const [name,mutate] of mutations){
    const v=withReceipt();mutate(v)
    assert.throws(()=>parseView(v),/INVALID_RESPONSE/,name)
  }
  assert.throws(()=>parseConfig({...config,partnerLabel:'Partner A'}),/INVALID_RESPONSE/)
  assert.throws(()=>parseConfig({...config,configured:false}),/INVALID_RESPONSE/)
  assert.throws(()=>parseConfig({chainId:1,contract:CONTRACT,ruleVersion,priceWei:PRICE,testOnly:true,configured:false}),/INVALID_RESPONSE/)
})
test('accounting invariants parse when verified',()=>{
  assert.equal(parseView(fixture('ACCOUNTING_VERIFIED')).accounting?.R,PRICE)
  const broken=fixture('ACCOUNTING_VERIFIED');broken.accounting={...accounting(),F:'3'}
  assert.throws(()=>parseView(broken),/INVALID_RESPONSE/)
})
test('API uses exact same-origin GET route, sanitized errors and no retry',async()=>{
  const calls:{url:unknown,init:RequestInit|undefined}[]=[]
  const api=createIssuanceApi((async(url,init)=>{
    calls.push({url,init})
    const body=String(url).endsWith('/config')?config:fixture('ACCOUNTING_VERIFIED')
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}})
  }) as typeof fetch)
  await api.config()
  await api.operation(true)
  assert.equal(calls[0].url,'/api/v1/testnet-issuance/config')
  assert.equal(calls[1].url,'/api/v1/testnet-issuance/operation?cached=1')
  assert.equal(calls[0].init?.method,'GET');assert.equal(calls[0].init?.credentials,'same-origin');assert.equal(calls[0].init?.cache,'no-store')
  let attempts=0
  const bad=createIssuanceApi((async()=>{attempts++;return new Response(JSON.stringify({code:'secret https://token'}),{status:500})}) as typeof fetch)
  await assert.rejects(bad.operation(),/REQUEST_FAILED/)
  assert.equal(attempts,1)
})
test('unmount during in-flight refresh discards the response',async()=>{
  const s=setup()
  await s.controller.load()
  let release:(v:View)=>void=()=>{}
  s.api.operation=async()=>new Promise<View>(resolve=>{release=resolve})
  const inFlight=s.controller.refresh()
  s.controller.dispose()
  release(fixture('ACCOUNTING_VERIFIED'))
  await inFlight
  assert.equal(s.controller.state.view?.operation.status,'PREPARED')
})
test('budget violation stays prominent in read-only status text',async()=>{
  const s=setup('FINALIZED_SUCCESS')
  await s.controller.load()
  s.setView({...fixture('FINALIZED_SUCCESS'),operation:{...fixture('FINALIZED_SUCCESS').operation,budgetViolation:true,errorCode:'BUDGET_EXCEEDED'}})
  await s.controller.refresh()
  assert.match(statusText(s.controller.state),/预算/)
  assert.equal(s.controller.state.stale,false)
})
// service-dto.fixture.json is emitted by the real Python IssuanceService (fake RPC) via
//   .venv/bin/python -m tests.test_testnet_issuance IssuanceTests.regenerate_cross_layer_fixture
// and tests/test_testnet_issuance.py::test_cross_layer_dto_matches_frontend_contract pins it
// byte-identical to live service output, so parsing it here exercises the strict frontend
// contract against real server DTOs instead of hand-written fixture fields.
test('real-service DTO fixture parses through the strict frontend contract',()=>{
  const payload=JSON.parse(readFileSync(new URL('./service-dto.fixture.json',import.meta.url),'utf8'))
  const config=parseConfig(payload.config)
  assert.equal(config.configured,true)
  assert.equal(config.ruleVersion,ruleVersion)
  const view=parseView(payload.view)
  assert.equal(view.operation.status,'ACCOUNTING_VERIFIED')
  assert.equal(view.operation.txHash,'0x'+'34'.repeat(32))
  assert.equal((view.intent as {ruleVersion:string}).ruleVersion,ruleVersion)
  assert.equal(view.accounting?.F,PRICE)
  assert.equal(view.accounting?.totalFundedWei,'2000000000000000')
})
