/** Optional verification driver. Playwright is supplied externally, not added to root dependencies. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { startOwnerFixture, controlledOwnerProvider } from './test-utils.ts'
const modulePath = process.env.OWNER_PLAYWRIGHT_MODULE
const executablePath = process.env.OWNER_BROWSER_EXECUTABLE
if (!modulePath || !executablePath) throw new Error('Supply dedicated Playwright module and browser executable paths')
const { chromium } = await import(modulePath)
const output = process.env.OWNER_BROWSER_OUTPUT ?? '/tmp/mealforward-owner-browser'
await mkdir(output,{recursive:true})
const fixture=await startOwnerFixture(true)
const controlled=controlledOwnerProvider(fixture.info.rpcUrl)
const browser=await chromium.launch({executablePath,headless:true})
try {
 const {info}=fixture
 const context=await browser.newContext({viewport:{width:1440,height:1100}})
 const errors:string[]=[]
 await context.exposeBinding('__ownerTestRequest',async(_source:unknown,args:{method:string;params?:unknown[]})=>controlled.provider.request(args))
 await context.addInitScript(()=>{
  const win=window as Window & {ethereum?:unknown;__ownerTestRequest:(args:unknown)=>Promise<unknown>}
  win.ethereum={request:(args:unknown)=>win.__ownerTestRequest(args),on:()=>{},removeListener:()=>{}}
 })
 const page=await context.newPage();page.on('pageerror',(e:Error)=>errors.push(e.message))
 await page.goto(info.origin)
 assert.deepEqual(controlled.counts(),{sends:0,signs:0})
 await page.getByLabel('本地工作密码').fill('local-only-password')
 await page.getByRole('button',{name:'登录本地工作账号',exact:true}).click()
 await page.getByRole('heading',{name:'餐馆老板 · 本地链工作台'}).waitFor()
 assert.deepEqual(controlled.counts(),{sends:0,signs:0})
 await page.getByRole('button',{name:'主动连接钱包',exact:true}).click()
 await page.getByRole('button',{name:'签署身份验证消息',exact:true}).click()
 await page.getByText('当前身份已验证',{exact:false}).waitFor()
 assert.deepEqual(controlled.counts(),{sends:0,signs:1})
 assert(info.code)
 // Hold an actual successful HTTP precheck response while its UI scope changes.
 async function delayedPrecheck(change:()=>Promise<void>) {
  let release!:()=>void, arrived!:()=>void
  const held=new Promise<void>(resolve=>{release=resolve})
  const received=new Promise<void>(resolve=>{arrived=resolve})
  const pattern='**/api/v1/work/prechecks'
  await page.route(pattern,async(route:any)=>{
   const response=await route.fetch();assert.equal(response.status(),200)
   arrived();await held;await route.fulfill({response})
  })
  try {
   await page.getByRole('button',{name:'只读核验展示码',exact:true}).click()
   await received;await change();release()
   await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='只读核验展示码'&&!b.disabled))
   assert.equal(await page.getByRole('button',{name:'确认锁定这一券（后台代发）',exact:true}).isDisabled(),true)
   assert.equal(await page.getByText('展示码预检通过，尚未锁定或扣款。',{exact:true}).count(),0)
  } finally {release();await page.unroute(pattern)}
 }
 await page.getByLabel('领取者当前展示码').fill(info.code)
 const differentCode=info.code.slice(0,7)+(info.code.endsWith('0')?'1':'0')
 await delayedPrecheck(async()=>{await page.getByLabel('领取者当前展示码').fill(differentCode)})
 await page.getByLabel('领取者当前展示码').fill(info.code)
 await delayedPrecheck(async()=>{
  await page.getByLabel('领取者当前展示码').fill(differentCode)
  await page.getByLabel('领取者当前展示码').fill(info.code!)
 })
 await delayedPrecheck(async()=>{
  await page.getByRole('button',{name:'撤销钱包身份证明',exact:true}).click()
  await page.getByRole('button',{name:'主动连接钱包',exact:true}).click()
  await page.getByRole('button',{name:'签署身份验证消息',exact:true}).click()
  await page.getByText('当前身份已验证',{exact:false}).waitFor()
 })
 assert.deepEqual(controlled.counts(),{sends:0,signs:2})
 await page.getByLabel('领取者当前展示码').fill(info.code)
 await page.getByRole('button',{name:'只读核验展示码',exact:true}).click()
 await page.getByText('展示码预检通过，尚未锁定或扣款。',{exact:true}).waitFor()
 const rotated=await context.request.post(info.origin+'/__test/refresh-code',{headers:{Origin:info.origin},data:{}})
 assert.equal(rotated.status(),200)
 const freshCode=(await rotated.json()).code
 assert(freshCode && freshCode!==info.code)
 await page.getByRole('button',{name:'确认锁定这一券（后台代发）',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'展示码已失效，本次未受理'}).waitFor()
 const rejectedState=await (await context.request.get(info.origin+'/__test/state')).json()
 assert.equal(rejectedState.operations.filter((item:{kind:string})=>item.kind==='lock').length,0)
 await page.getByLabel('领取者当前展示码').fill(freshCode)
 await page.getByRole('button',{name:'只读核验展示码',exact:true}).click()
 await page.getByText('展示码预检通过，尚未锁定或扣款。',{exact:true}).waitFor()
 await page.getByRole('button',{name:'确认锁定这一券（后台代发）',exact:true}).click()
 await page.getByText('处理状态：LOCK_PENDING',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'声明本人已交餐',exact:true}).isDisabled(),true)
 async function finalizeWork(){const r=await context.request.post(info.origin+'/__test/tick',{headers:{Origin:info.origin},data:{finalize:true}});assert.equal(r.status(),200)}
 await finalizeWork()
 await page.getByRole('button',{name:'查询原处理与本店应付款',exact:true}).click()
 await page.getByText('处理状态：LOCKED',{exact:true}).waitFor()
 await page.getByRole('button',{name:'声明本人已交餐',exact:true}).click()
 await page.getByText('处理状态：HANDED_OFF',{exact:true}).waitFor()
 assert.deepEqual(controlled.counts(),{sends:0,signs:2})
 await page.getByRole('button',{name:'确认申报交餐（后台代发）',exact:true}).click()
 await page.getByText('处理状态：REPORT_PENDING',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'选择这笔应付款',exact:true}).count(),0)
 await finalizeWork()
 await page.getByRole('button',{name:'查询原处理与本店应付款',exact:true}).click()
 await page.getByText('处理状态：REPORTED',{exact:true}).waitFor()
 await page.getByRole('button',{name:'选择这笔应付款',exact:true}).click()
 await page.waitForFunction(()=>!!(document.querySelector('input[placeholder="redemptionId"]') as HTMLInputElement)?.value)
 assert.deepEqual(controlled.counts(),{sends:0,signs:2})
 await page.getByRole('button',{name:'准备并审核原应付款',exact:true}).click()
 const send=page.getByRole('button',{name:'确认此笔结算并请求钱包签名',exact:true})
 await send.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='确认此笔结算并请求钱包签名'&&!b.disabled))
 assert.match(await page.locator('body').innerText(),/钱包转入本金：0/)
 await page.screenshot({path:output+'/owner-review-desktop.png',fullPage:true})
 controlled.dropHash();await send.click()
 await page.getByText('服务端状态：SUBMISSION_UNKNOWN',{exact:true}).waitFor()
 assert.equal(await send.isDisabled(),true);assert.deepEqual(controlled.counts(),{sends:1,signs:2})
 await page.reload();await page.getByLabel('本地工作密码').fill('local-only-password');await page.getByRole('button',{name:'登录本地工作账号',exact:true}).click()
 await page.getByRole('button',{name:'只查询原操作',exact:true}).waitFor()
 assert.equal(controlled.counts().sends,1)
 await controlled.rpc('anvil_mine',['0x80'])
 const tick=await context.request.post(info.origin+'/__test/tick',{headers:{Origin:info.origin},data:{}});assert.equal(tick.status(),200)
 await page.getByRole('button',{name:'只查询原操作',exact:true}).click()
 await page.getByText('服务端状态：FINALIZED_SUCCESS',{exact:true}).waitFor()
 assert.equal(controlled.counts().sends,1)
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.evaluate(()=>window.scrollTo(0,0))
 await page.screenshot({path:output+'/owner-mobile-top.png'})
 await page.getByText('服务端状态：FINALIZED_SUCCESS',{exact:true}).scrollIntoViewIfNeeded()
 await page.screenshot({path:output+'/owner-finalized-mobile.png'})
 const stateResponse=await context.request.get(info.origin+'/__test/state');assert.equal(stateResponse.status(),200)
 const state=await stateResponse.json()
 assert.deepEqual(state.batch,{F:1000000000000000,A:0,R:0,H:0,S:1000000000000000})
 assert.equal(state.outboxKinds.some((item:{kind:string})=>item.kind==='settle'),false)
 assert.equal(state.operations.filter((item:{kind:string;status:string})=>['lock','report','settle'].includes(item.kind)&&item.status==='FINALIZED_SUCCESS').length,3)
 assert.deepEqual(errors,[])
 const result={checks:['delayed precheck invalidated by code change and change-back','delayed precheck invalidated by proof logout/reverification','actual HTTP issue/invitation/delivery/recipient presentation','rotated code rejected before acceptance then fresh code succeeds','browser precheck/lock/finalized handoff/report','automatic selected payable wiring without manual id','no auto wallet prompt','explicit identity personal_sign only','fixed merchant/contract/value0 and gas review','one external transaction with lost hash','reload read-only original recovery','real Anvil FINALIZED_SUCCESS','390px no horizontal overflow'],provider:'controlled injected EIP1193, external test-driver wallet only',counts:controlled.counts(),ledger:state.batch,errors}
 await writeFile(output+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
} finally {await browser.close();await fixture.stop()}
