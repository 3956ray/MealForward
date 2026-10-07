import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
if(!process.env.CP24_PLAYWRIGHT_MODULE || !process.env.CP24_BROWSER_EXECUTABLE) throw new Error('Supply external CP24_PLAYWRIGHT_MODULE and CP24_BROWSER_EXECUTABLE')
const {chromium}=await import(process.env.CP24_PLAYWRIGHT_MODULE)
const browser=await chromium.launch({executablePath:process.env.CP24_BROWSER_EXECUTABLE,headless:true})
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:15247/#/owner')
 await page.getByLabel('账号',{exact:true}).fill('owner-a');await page.getByLabel('密码',{exact:true}).fill('local-only-password');await page.getByRole('button',{name:'登录工作台',exact:true}).click()
 await page.getByText('已声明交餐',{exact:true}).waitFor();await page.getByText('只读查询',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'我已交餐，记录声明',exact:true}).count(),0)
 await page.screenshot({path:'evidence/cp24/restart-original-state.png',fullPage:true})
 const result=await page.request.get('http://127.0.0.1:15247/api/cp24/public').then(r=>r.json())
 assert.equal(result.batch.R,'1000000000000000');assert.equal(result.recovery.state,'ACTIVE')
 await writeFile('evidence/cp24/restart-result.json',JSON.stringify({check:'normal full stack native Anvil save/load; original handed-off state and R retained; refreshed terminal read-only',...result},null,2))
 console.log('Full-stack restart browser original state PASS')
}finally{await browser.close()}
