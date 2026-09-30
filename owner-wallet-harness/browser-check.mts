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
const fixture=await startOwnerFixture()
const controlled=controlledOwnerProvider(fixture.info.rpcUrl)
const browser=await chromium.launch({executablePath,headless:true})
try {
 const {info}=fixture
 const context=await browser.newContext({viewport:{width:1440,height:1100}})
 const errors:string[]=[]
 await context.exposeBinding('__ownerTestRequest',async(_source:unknown,args:{method:string;params?:unknown[]})=>controlled.provider.request(args))
 await context.addInitScript(({info}: {info: typeof fixture.info})=>{
  const key=`mealforward.cp16.owner.${encodeURIComponent(info.origin)}.${encodeURIComponent(info.deployment.deploymentId)}.owner-a`
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({redemptionId:info.redemptionId,intentKey:info.intentKey,startAttempted:false}))
  const win=window as Window & {ethereum?:unknown;__ownerTestRequest:(args:unknown)=>Promise<unknown>}
  win.ethereum={request:(args:unknown)=>win.__ownerTestRequest(args),on:()=>{},removeListener:()=>{}}
 },{info})
 const page=await context.newPage();page.on('pageerror',(e:Error)=>errors.push(e.message))
 await page.goto(info.origin)
 assert.deepEqual(controlled.counts(),{sends:0,signs:0})
 await page.getByLabel('本地工作密码').fill('local-only-password')
 await page.getByRole('button',{name:'登录本地工作账号',exact:true}).click()
 await page.getByRole('heading',{name:'餐馆老板 · 逐笔结算'}).waitFor()
 assert.deepEqual(controlled.counts(),{sends:0,signs:0})
 await page.getByRole('button',{name:'主动连接钱包',exact:true}).click()
 await page.getByRole('button',{name:'签署身份验证消息',exact:true}).click()
 await page.getByText('当前身份已验证',{exact:false}).waitFor()
 assert.deepEqual(controlled.counts(),{sends:0,signs:1})
 await page.getByLabel('原应付款 ID').fill(info.redemptionId)
 await page.getByRole('button',{name:'准备并审核原应付款',exact:true}).click()
 const send=page.getByRole('button',{name:'确认此笔结算并请求钱包签名',exact:true})
 await send.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='确认此笔结算并请求钱包签名'&&!b.disabled))
 assert.match(await page.locator('body').innerText(),/钱包转入本金：0/)
 await page.screenshot({path:output+'/owner-review-desktop.png',fullPage:true})
 controlled.dropHash();await send.click()
 await page.getByText('服务端状态：SUBMISSION_UNKNOWN',{exact:true}).waitFor()
 assert.equal(await send.isDisabled(),true);assert.deepEqual(controlled.counts(),{sends:1,signs:1})
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
 await page.screenshot({path:output+'/owner-finalized-mobile.png',fullPage:true})
 assert.deepEqual(errors,[])
 const result={checks:['no auto wallet prompt','explicit identity personal_sign only','fixed merchant/contract/value0 and gas review','one external transaction with lost hash','reload read-only original recovery','real Anvil FINALIZED_SUCCESS','390px no horizontal overflow'],provider:'controlled injected EIP1193, external test-driver wallet only',counts:controlled.counts(),errors}
 await writeFile(output+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
} finally {await browser.close();await fixture.stop()}
