import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
if(!process.env.CP24_PLAYWRIGHT_MODULE || !process.env.CP24_BROWSER_EXECUTABLE) throw new Error('Supply external CP24_PLAYWRIGHT_MODULE and CP24_BROWSER_EXECUTABLE')
const {chromium}=await import(process.env.CP24_PLAYWRIGHT_MODULE)
const url=process.env.CP24_URL || 'http://127.0.0.1:15247'
const output=process.env.CP24_BROWSER_OUTPUT || 'evidence/cp24'
await mkdir(output,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CP24_BROWSER_EXECUTABLE,headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true,permissions:[]})
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
const checks=[]
async function click(name){await page.getByRole('button',{name,exact:true}).click()}
async function nav(name){await page.locator('nav').getByRole('link',{name:new RegExp(name)}).click()}
async function login(role){await page.getByLabel('账号',{exact:true}).fill(role+'-a');await page.getByLabel('密码',{exact:true}).fill('local-only-password');await click('登录工作台')}
async function confirm(){await page.getByRole('dialog').getByRole('button',{name:'确认本次本地钱包操作',exact:true}).click()}
try{
 await page.goto(url);await page.getByRole('button',{name:'审阅本地钱包支持',exact:true}).waitFor()
 await page.screenshot({path:output+'/01-support.png',fullPage:true})
 await click('审阅本地钱包支持');await page.getByRole('dialog').waitFor();await click('取消准备')
 await click('继续原支持审阅');await confirm()
 await page.getByText('本地最终确认',{exact:true}).waitFor({timeout:40000});checks.push('support explicit confirmation and prepare cancellation')
 await nav('机构伙伴');await login('partner');await click('发行本轮唯一餐券')
 await click('生成私密领取链接');const privateUrl=await page.getByLabel('私密链接（仅保留在当前页面）').inputValue()
 const recipient=await context.newPage();await recipient.goto(privateUrl);await recipient.getByRole('button',{name:'查看我的餐券',exact:true}).click()
 assert(!recipient.url().includes(privateUrl.split('/').at(-1)))
 await recipient.getByRole('button',{name:'我已到店，生成展示码',exact:true}).click()
 const manual=await recipient.locator('.manual-code').innerText()
 const downloadPromise=recipient.waitForEvent('download');await recipient.getByRole('button',{name:'保存本次二维码图片',exact:true}).click()
 const download=await downloadPromise;await download.saveAs(output+'/display.png')
 await recipient.screenshot({path:output+'/02-recipient.png',fullPage:true});checks.push('UI issuance private link exchange and actual QR image download')
 await nav('餐馆老板');await login('owner');await click('审阅本地钱包身份挑战');await confirm()
 await page.getByText('● 钱包控制证明有效',{exact:true}).waitFor()
 // Exercise the denial UI in browsers without BarcodeDetector; image decoding remains actual jsQR.
 await page.evaluate(()=>{window.BarcodeDetector ||= class {async detect(){return []}}})
 await click('打开相机扫码');await page.getByRole('alert').filter({hasText:'相机权限被拒绝'}).waitFor()
 checks.push('camera permission denied by browser policy, actionable image/manual fallback; detector availability shim only')
 await page.locator('input[type=file]').setInputFiles(output+'/display.png')
 await page.getByRole('status').filter({hasText:'二维码已在本机识别'}).waitFor()
 await click('预检餐券');await page.getByRole('status').filter({hasText:'尚未取得处理权'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'我已交餐，记录声明',exact:true}).count(),0)
 checks.push('actual generated QR image decoded in UI and prechecked without lock')
 await page.getByLabel('六位码或二维码内容').fill(manual);await click('预检餐券')
 await click('确认有餐，申请唯一处理权')
 await page.getByRole('button',{name:'我已交餐，记录声明',exact:true}).waitFor({timeout:40000})
 await page.screenshot({path:output+'/03-owner-lock.png',fullPage:true});checks.push('manual code precheck and unique finalized lock')
 await page.reload();await page.getByText('只读查询',{exact:true}).waitFor()
 await page.getByRole('checkbox',{name:'原终端已停止处理，接管只恢复原处理',exact:true}).check();await click('接管原处理')
 await click('我已交餐，记录声明')
 await page.getByLabel('备注内容').fill('本地演练核对：保留原交餐声明。');await click('保存待核对备注')
 assert.equal(await page.getByRole('button',{name:'确认原声明并提交申报',exact:true}).isDisabled(),true)
 await page.getByRole('checkbox',{name:'我已重新核对上方原交餐声明，确认其内容并继续申报',exact:true}).check()
 await click('确认原声明并提交申报')
 await page.getByRole('button',{name:'审阅本地钱包结算',exact:true}).waitFor({timeout:40000})
 assert.equal(await page.getByRole('dialog').count(),0);checks.push('reload read-only explicit takeover; note requires renewed report confirmation; no auto settlement')
 await click('审阅本地钱包结算');await click('取消准备');await click('审阅本地钱包结算');await confirm()
 await page.getByText('本轮本地演练已完成。原处理与餐账保留供核对。',{exact:true}).waitFor({timeout:40000})
 await nav('公开餐账');await page.screenshot({path:output+'/04-ledger-desktop.png',fullPage:true})
 const publicState=await context.request.get(url+'/api/cp24/public').then(r=>r.json())
 assert.equal(publicState.batch.S,'1000000000000000');assert.equal(publicState.batch.R,'0');assert.equal(publicState.batch.H,'0')
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/05-ledger-mobile.png',fullPage:true})
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 await nav('餐馆老板');await page.screenshot({path:output+'/06-owner-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 checks.push('explicit owner settlement FINALIZED S=P; desktop1440/mobile390 no overflow')
 assert.deepEqual(errors,[])
 await writeFile(output+'/browser-result.json',JSON.stringify({checks,ledger:publicState.batch,instanceId:publicState.instanceId,errors,realCamera:'NOT_RUN',physicalPhone:'NOT_RUN'},null,2))
 console.log(JSON.stringify({checks,ledger:publicState.batch,errors}))
}catch(e){await page.screenshot({path:output+'/failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-7000));throw e}
finally{await browser.close()}
