/**
 * Browser smoke for a built, static isolated Pilot. No wallet private keys,
 * no Monad RPC request, no CP30 and no user data.
 */
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import assert from 'node:assert/strict';

const URL='http://127.0.0.1:4173';
let proc=null,browser=null;
async function checkServer(){
 for(let i=0;i<35;i++){
  if(proc.exitCode!==null)throw Error('Vite preview terminated before smoke');
  try{
   const response=await fetch(URL+'/');
   if(response.ok)return;
  }catch{}
  await sleep(300);
 }
 throw Error('Vite did not start on localhost');
}
async function test(){
 proc=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4173','--strictPort'],{
  stdio:['ignore','ignore','pipe']
 });
 await checkServer();
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const errors=[];
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL+'/',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:/留一份餐/}).waitFor();
 assert.equal(await page.getByRole('button',{name:/部署独立测试环境|由 MetaMask 部署新 Pilot/}).count(),1);
 assert.equal(await page.getByRole('heading',{name:/三角色|按真实区块链回执/}).count(),1);
 assert.equal(await page.getByRole('link',{name:/完整测试清单/}).count(),1);
 const size=await page.evaluate(()=>({
  width:document.documentElement.clientWidth,
  scroll:document.documentElement.scrollWidth
 }));
 assert.ok(size.scroll<=size.width+2,'Mobile page is horizontally overflowing: '+JSON.stringify(size));
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>typeof window.QRCode),'function');
 console.log(JSON.stringify({browser:'MOBILE',status:'PASS',viewport:size,errors:0}));
 await page.getByRole('link',{name:/查看完整测试清单/}).click();
 await page.waitForURL('**/test-guide.html');
 assert.equal(await page.locator('input[type=checkbox]').count(),10);
 await page.locator('input[type=checkbox]').first().check();
 assert.equal(await page.locator('input[type=checkbox]').first().isChecked(),true);
 console.log(JSON.stringify({browser:'MOBILE_TEST_GUIDE',status:'PASS',steps:10}));

 const desktop=await browser.newPage({viewport:{width:1440,height:900}});
 desktop.on('pageerror',e=>errors.push(e.message));
 await desktop.goto(URL+'/',{waitUntil:'networkidle'});
 await desktop.getByRole('heading',{name:/留一份餐/}).waitFor();
 assert.deepEqual(errors,[]);
 assert.ok((await desktop.locator('nav a').count())>=3);
 console.log(JSON.stringify({browser:'DESKTOP',status:'PASS',errors:0}));

 const account='0x'+'1'.repeat(40);
 const profile=await browser.newPage({viewport:{width:390,height:844}});
 await profile.addInitScript(address=>{
  window.ethereum={
   request:async({method,params})=>{
    if(method==='eth_chainId')return '0x279f';
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [address];
    throw Error('unexpected mock RPC '+method);
   },
   on:()=>{},
   removeListener:()=>{}
  };
 },account);
 profile.on('pageerror',e=>errors.push(e.message));
 await profile.goto(URL+'/',{waitUntil:'networkidle'});
 await profile.getByRole('button',{name:/0x1111111/}).waitFor();
 await profile.getByRole('button',{name:/连接 MetaMask|0x1111111/}).click();
 await profile.getByRole('button',{name:/0x1111111/}).waitFor();
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({browser:'WALLET_UI_STUB',status:'PASS',accountOnlyNoSigning:true}));
}
try{await test();console.log(JSON.stringify({status:'PILOT_BROWSER_UI_SMOKE_PASS'}))}
catch(e){console.error('PILOT_BROWSER_UI_SMOKE_FAIL',e.stack||e);process.exitCode=1}
finally{
 if(browser)await browser.close().catch(()=>{});
 if(proc){proc.kill('SIGTERM');await sleep(250);if(proc.exitCode===null)proc.kill('SIGKILL')}
}
