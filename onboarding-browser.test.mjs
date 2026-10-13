// Isolated UI contract checks with an in-memory adapter, never a real wallet or backend.
import assert from 'node:assert/strict';
import {chromium} from '/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const base=process.env.MEALFORWARD_PREVIEW_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const adapter=`
const id='0x'+'a'.repeat(64),storeId='b'.repeat(64);
const registration=()=>({registrationId:id,storeId:'0x'+storeId,state:window.fixtureState||'DRAFT',businessReady:window.fixtureReady||false,walletActionsEnabled:true,transactionHash:window.fixtureState==='DRAFT'?null:'0x'+'c'.repeat(64),escrow:'0x'+'d'.repeat(40),request:{name:'New kitchen',firstMeal:{name:'First bowl',description:'Seasonal rice',unitPrice:'7000000',windows:[[660,780]]}}});
const store={id:storeId,name:'New kitchen'};
const meal={id:'m',name:'First bowl',description:'Seasonal rice',unitPrice:'7000000',windows:[[660,780]],listed:true,financial:{counts:{A:0}}};
const setup={walletLoginEnabled:true,registrationEnabled:true,assetDecimals:6,assetSymbol:'test USDC'};
window.calls=[];
export const liveApi={
async getContext(){if(window.offline)throw Error('Service unavailable');return {setup,session:window.signedIn?{wallet:'0x'+'e'.repeat(40),stores:window.fixtureReady?[storeId]:[]}:null,registration:window.saved?registration():null,registrations:window.saved?[registration()]:[],store:window.fixtureReady?store:null};},
async getWalletAccounts(){return ['0x'+'e'.repeat(40)];},async loginWallet({address}){window.calls.push('login');window.signedIn=true;return this.getContext();},async logout(){window.calls.push('logout');window.signedIn=false;window.saved=false;},
async saveRegistration(input){window.calls.push('save');window.saved=true;window.fixtureState='DRAFT';await new Promise(r=>setTimeout(r,80));return registration();},
async signRegistration(){window.calls.push('sign');return {signed:true,registrationId:id};},
async enableRegistration(){window.calls.push('enable');window.fixtureState='UNKNOWN';return registration();},
async getRegistration(){window.calls.push('get');return registration();},
async listStores(){return [store];},async getStoreMeals(){return [meal];},async getOwnerMeals(){return {items:[meal],capabilities:{create:false,edit:false,upload:false,publish:false,listing:false},unavailableReasons:{edit:'Not connected'}};},async getOwnerOverview(){return {financial:{counts:{F:0,A:0,R:0}}};}
};`;
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:950}});const errors=[];
  await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  await context.route('**/live-api.mjs',route=>route.fulfill({contentType:'text/javascript',body:adapter}));
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'#register');await page.getByRole('button',{name:'Sign in with wallet',exact:true}).last().click();await page.getByLabel('Accounts available to this website').selectOption('0x'+'e'.repeat(40));await page.getByRole('button',{name:'Continue with selected account',exact:true}).click();await page.goto(base+'#register');
  await page.getByLabel('Kitchen name',{exact:true}).fill('New kitchen');await page.getByLabel('First meal name',{exact:true}).fill('First bowl');await page.getByLabel('Meal description',{exact:true}).fill('Seasonal rice');await page.getByLabel('Price per meal',{exact:false}).fill('7');
  await page.getByLabel('Meal photo',{exact:true}).setInputFiles({name:'meal.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP00AAAAASUVORK5CYII=','base64')});
  await page.getByLabel('Start 1',{exact:true}).selectOption('11:00');await page.getByLabel('End 1',{exact:true}).selectOption('13:00');
  await page.getByRole('button',{name:'Add service time',exact:true}).click();await page.getByLabel('Start 2',{exact:true}).selectOption('17:00');await page.getByLabel('End 2',{exact:true}).selectOption('18:00');
  assert.equal(await page.getByLabel('Kitchen name',{exact:true}).inputValue(),'New kitchen');
  await page.getByRole('button',{name:'Save kitchen & first meal',exact:true}).dblclick();
  await page.getByRole('heading',{name:'Draft saved',exact:true}).waitFor();assert.equal(await page.evaluate(()=>calls.filter(x=>x==='save').length),1);
  await page.getByRole('button',{name:'Sign deployment authorization',exact:true}).click();await page.getByRole('button',{name:'Enable automatic deployment',exact:true}).click();
  await page.getByRole('heading',{name:'Deployment needs verification',exact:true}).waitFor();assert.equal(await page.locator('#registration-form').count(),0);assert.equal(await page.getByRole('button',{name:'Enable automatic deployment',exact:true}).count(),0);
  await page.evaluate(()=>{window.fixtureState='CONFIRMED';});await page.getByRole('button',{name:'Check original progress',exact:true}).click();await page.getByRole('heading',{name:'Contract confirmed · Check listing',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Enter my kitchen',exact:true}).count(),0);
  await page.evaluate(()=>{window.fixtureReady=true;});await page.getByRole('button',{name:'Check original progress',exact:true}).click();await page.getByRole('link',{name:'Enter my kitchen',exact:true}).click();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();assert.ok((await page.locator('main').innerText()).includes('Available to claim'));
  for(const label of ['Meals','Verify','Payouts']){await page.getByRole('navigation',{name:'Kitchen workspace'}).getByRole('link',{name:label,exact:true}).click();await page.getByRole('heading',{name:label,exact:true}).waitFor();}
  await page.goto(base+'#home');await page.getByRole('link',{name:'View kitchen',exact:true}).waitFor();assert.ok(!(await page.locator('main').innerText()).includes('Simulated'));assert.equal(await page.locator('.demo-controls').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/mealforward-live-home-'+width+'.png',fullPage:true});
  await page.addInitScript(()=>{window.signedIn=true;window.saved=true;window.fixtureState='UNKNOWN';});await page.goto(base+'#register');await page.reload();await page.getByRole('heading',{name:'Deployment needs verification',exact:true}).waitFor();assert.equal(await page.evaluate(()=>calls.filter(x=>['save','enable'].includes(x)).length),0);
  await page.evaluate(()=>{window.offline=true;});await page.getByRole('button',{name:'Check connection & recover',exact:true}).first().click();await page.getByText('Connection unavailable.',{exact:false}).waitFor();assert.ok((await page.locator('main').innerText()).includes('Deployment needs verification'));
  await page.screenshot({path:'/tmp/mealforward-live-register-'+width+'.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await context.close();console.log('PASS',width,'registration, duplicate prevention, UNKNOWN, publication gating, four kitchen views, reload and offline recovery');
 }
}finally{await browser.close();}
