import test from 'node:test';
import assert from 'node:assert/strict';
import {mvpConfig,startMvpRuntime} from './mvp-runtime.mjs';
const env={PUBLIC_ORIGIN:'https://mealforward-t1e-claim-laodao.onrender.com',MVP_ENABLED:'true',MVP_WALLET_ACTIONS_ENABLED:'false',MVP_DB_URL:'postgres://mf_mvp_usdc_runtime.ketfrukrcuosrqynnsay:'+('x'.repeat(32))+'@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres',MVP_CODE_PEPPER:'x'.repeat(43)};
const res=()=>({status:null,headers:null,body:null,writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}});
const req=(url)=>({url,method:'GET',headers:{host:new URL(env.PUBLIC_ORIGIN).host}});
test('disabled MVP opens no database and leaves legacy paths alone',async()=>{
 const app=await startMvpRuntime({env:{},poolFactory(){throw Error('must not connect')}});const r=res();assert.equal(await app.handle(req('/v1/t1f/phase8/status'),r),false);await app.handle(req('/v1/mvp/status'),r);assert.equal(r.status,404);await app.close();
});
test('configuration rejects other roles, projects, weak pepper and ambiguous flags',()=>{
 for(const patch of [{MVP_ENABLED:'yes'},{MVP_DB_URL:env.MVP_DB_URL.replace('mf_mvp_usdc_runtime','mf_mvp_runtime')},{MVP_DB_URL:env.MVP_DB_URL.replace('mf_mvp_usdc_runtime','postgres')},{MVP_DB_URL:env.MVP_DB_URL+'?sslmode=disable'},{MVP_CODE_PEPPER:'short'},{PUBLIC_ORIGIN:'https://example.com'}])assert.throws(()=>mvpConfig({...env,...patch}));
 assert.equal(mvpConfig(env).writesEnabled,false);
});
test('MVP startup failure is contained, never exposes raw error or falls through',async()=>{
 let ended=0;const app=await startMvpRuntime({env,poolFactory:()=>({end:async()=>{ended++}}),verify:async()=>{throw Error('secret-dsn')}});assert.equal(app.ready,false);const r=res();assert.equal(await app.handle(req('/v1/mvp/status'),r),true);assert.equal(r.status,503);assert.ok(!r.body.includes('secret'));assert.equal(await app.handle(req('/t1f-phase8.html'),res()),false);assert.equal(ended,1);await app.close();
});
test('only merchant-capable pages allow camera; no arbitrary file path or foreign host',async()=>{
 let closed=0;const app=await startMvpRuntime({env,poolFactory:()=>({end:async()=>{closed++}}),verify:async()=>{},load:async()=>({makeMvpHttp:()=>({handle:async(_q,r)=>{r.writeHead(200,{});r.end('{}')}})}),read:async()=>Buffer.from('test')});
 const m=res();await app.handle(req('/mvp/merchant.html'),m);assert.match(m.headers['Permissions-Policy'],/camera=\(self\)/);
 const product=res();await app.handle(req('/mvp/product.html'),product);assert.equal(product.status,200);assert.match(product.headers['Permissions-Policy'],/camera=\(self\)/);
 const privatePage=res();await app.handle(req('/mvp/product-recipient.html'),privatePage);assert.equal(privatePage.status,200);assert.match(privatePage.headers['Permissions-Policy'],/camera=\(\)/);
 const p=res();await app.handle(req('/mvp/recipient.html'),p);assert.match(p.headers['Permissions-Policy'],/camera=\(\)/);
 const bad=res();await app.handle({...req('/v1/mvp/status'),headers:{host:'evil.example'}},bad);assert.equal(bad.status,403);
 const unknown=res();await app.handle(req('/mvp/unknown'),unknown);assert.equal(unknown.status,404);await app.close();assert.equal(closed,1);
});

 test('auth namespaces accept complete old/new tuples but reject mixed cookies',async()=>{
 const {makePilotHandler}=await import('./auth/core.mjs');
 const base={prefix:'/v1/mvp',sessionCookie:'__Host-mf_mvp_usdc_session',preCookie:'__Host-mf_mvp_usdc_pre',csrfHeader:'x-mvp-usdc-csrf',bootstrapHeader:'x-mvp-usdc-bootstrap'};
 assert.equal(typeof makePilotHandler({origin:env.PUBLIC_ORIGIN,namespace:base}),'function');
 assert.throws(()=>makePilotHandler({origin:env.PUBLIC_ORIGIN,namespace:{...base,sessionCookie:'__Host-mf_mvp_session'}}),/INVALID_AUTH_NAMESPACE/);
 });
