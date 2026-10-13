// Fresh incognito browser context; only the owned TLS certificate is exempted.
const fs = require('node:fs');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const { chromium } = require('/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

let phase='START';
async function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  phase='LAUNCH';
  const server = await chromium.launchServer({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,host:'127.0.0.1',port:0, env:{TMPDIR:input.temp},
    args:['--password-store=basic','--use-mock-keychain','--ignore-certificate-errors-spki-list='+input.spki]});
  const child=server.process();
  const identity=()=>execFileSync('/bin/ps',['-p',String(child.pid),'-o','uid=,lstart=,command='],{env:{LC_ALL:'C'},encoding:'utf8'}).trim();
  const original=identity();
  const registry={pid:child.pid,identityDigest:crypto.createHash('sha256').update(original).digest('hex'),stopped:false};
  const registryPath=input.temp+'/browser-pid.json';
  fs.writeFileSync(registryPath,JSON.stringify(registry),{mode:0o600,flag:'wx'});
  const stop=async()=>{
    if(child.exitCode===null && child.signalCode===null){
      if(identity()!==original)throw new Error('BROWSER_PID_REUSED');
      await server.close();
    }
    registry.stopped=true;fs.writeFileSync(registryPath,JSON.stringify(registry),{mode:0o600});
  };
  const timer=setTimeout(()=>stop().finally(()=>process.exit(1)),35000);
  phase='CONNECT';
  const browser=await chromium.connect(server.wsEndpoint());
  let checks=0;
  const expect=(condition)=>{phase='ASSERT_'+checks;if(!condition)throw new Error('BROWSER_ASSERTION');checks++;};
  try {
    const context=await browser.newContext();
    await context.route('**/*', route => route.request().url().startsWith(input.origin+'/') ? route.continue() : route.abort());
    const page=await context.newPage();
    await page.goto(input.origin+'/',{waitUntil:'domcontentloaded',timeout:10000});
    expect((await page.title()).length>0);
    const call=async(path,body,csrf,bootstrap=false)=>page.evaluate(async({path,body,csrf,bootstrap})=>{
      const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',
        'Idempotency-Key':crypto.randomUUID(),'X-C1-CSRF':csrf||'',...(bootstrap?{'X-C1-Bootstrap':'1'}:{})},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    },{path,body,csrf,bootstrap});
    const pre=await call('/v1/auth/pre-session',{},null,true);expect(pre.status===200);
    const login=await call('/v1/auth/login',{assertion:input.assertions[0]},pre.body.csrf);expect(login.status===200);
    const cookies=await context.cookies(input.origin);
    const session=cookies.find(cookie=>cookie.name==='__Host-mcpay_c1_session');
    expect(session && session.secure && session.httpOnly && session.sameSite==='Lax' && session.path==='/' && session.domain==='127.0.0.1');
    expect(!(await page.evaluate(()=>document.cookie)).includes('__Host-mcpay_c1_session'));
    expect(await page.evaluate(async()=> (await fetch('/v1/me',{credentials:'same-origin'})).status)===200);
    const denied=await call('/v1/auth/logout',{},'wrong-csrf');expect(denied.status===403);
    const reauth=await call('/v1/auth/reauth',{assertion:input.assertions[1]},login.body.csrf);expect(reauth.status===200);
    const rotated=(await context.cookies(input.origin)).find(cookie=>cookie.name===session.name);
    expect(rotated.value!==session.value && reauth.body.csrf!==login.body.csrf);
    const oldContext=await browser.newContext();
    await oldContext.addCookies([session]);
    const oldPage=await oldContext.newPage();await oldPage.goto(input.origin+'/');
    expect(await oldPage.evaluate(async()=> (await fetch('/v1/me',{credentials:'same-origin'})).status)===401);
    await oldContext.close();
    expect((await call('/v1/auth/logout',{},login.body.csrf)).status===403);
    expect((await call('/v1/auth/logout',{},reauth.body.csrf)).status===200);
    expect(await page.evaluate(async()=> (await fetch('/v1/me',{credentials:'same-origin'})).status)===401);
    await context.close();
    process.stdout.write(JSON.stringify({status:'PASS',checks,transport:'fresh-incognito-exact-SPKI',secretArtifacts:0}));
  } finally { clearTimeout(timer);await browser.close();await stop(); }
}
main().catch(()=>{process.stdout.write(JSON.stringify({status:'FAIL',code:'BROWSER_CHECK_FAILED',phase}));process.exitCode=1;});
