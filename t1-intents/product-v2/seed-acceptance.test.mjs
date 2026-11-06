import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Wallet} from 'ethers';
import {seedAcceptance} from './seed-acceptance.mjs';
import {startAcceptanceStack,validateAcceptanceOptions} from './acceptance-stack.mjs';
const config={verified:true,profile:'local-acceptance',chainId:31337,escrow:'0x'+'11'.repeat(20),asset:'0x'+'22'.repeat(20)};
const catalog={verified:true,stores:[],meals:[],asset:{symbol:'TEST',decimals:6},accounting:{funded:'0'}};
async function fixture(t,{configuration=config,snapshot=catalog,redirect=false}={}){
 const calls=[],server=http.createServer((req,res)=>{calls.push({method:req.method,path:req.url});if(redirect){res.writeHead(302,{location:'https://example.invalid/'});return res.end();}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url.endsWith('/configuration')?configuration:snapshot));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return {origin:`http://127.0.0.1:${server.address().port}`,calls};
}

test('public, noncanonical and non-loopback origins are rejected before any request',async()=>{
 for(const origin of ['https://example.test','http://localhost:12345','http://0.0.0.0:12345','http://127.0.0.1:65536','http://127.0.0.1:12345/path','http://127.0.0.1:12345/','http://user:pass@127.0.0.1:12345','http://127.0.0.1:12345?query'])await assert.rejects(seedAcceptance({origin,wallets:{}}),/SEED_LOCAL_ORIGIN_REQUIRED/);
});

test('public-network, unverified or invalid contract configuration cannot seed',async t=>{
 for(const configuration of [{...config,profile:'monad-testnet'},{...config,chainId:10143},{...config,verified:false},{...config,escrow:'0x'+'00'.repeat(20)}]){const f=await fixture(t,{configuration});await assert.rejects(seedAcceptance({...f,wallets:{}}),/SEED_LOCAL_CONFIGURATION_REQUIRED/);assert.deepEqual(f.calls.map(c=>c.method),['GET']);}
});

test('existing kitchen, meal or funded history is never seeded and no login/signature is attempted',async t=>{
 for(const snapshot of [{...catalog,stores:[{id:'existing'}]},{...catalog,meals:[{id:'existing'}]},{...catalog,accounting:{funded:'1'}},{...catalog,verified:false}]){const f=await fixture(t,{snapshot});await assert.rejects(seedAcceptance({...f,wallets:{}}),/SEED_REQUIRES_EMPTY_CATALOG/);assert.ok(f.calls.every(c=>c.method==='GET'));assert.equal(f.calls.length,2);}
});

test('HTTP redirects are rejected and wrong wallet network cannot reach SIWE or writes',async t=>{
 const redirected=await fixture(t,{redirect:true});await assert.rejects(seedAcceptance({...redirected,wallets:{}}),/SEED_HTTP_UNAVAILABLE/);assert.equal(redirected.calls.length,1);
 const f=await fixture(t),wallets=Object.fromEntries(['merchant','donor','recipient'].map(role=>[role,Wallet.createRandom().connect({getNetwork:async()=>({chainId:10143n})})]));await assert.rejects(seedAcceptance({...f,wallets}),/SEED_WALLET_CHAIN_MISMATCH/);assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('real new local stack seeds three funded meals and leaves recipient unclaimed',{skip:process.env.MEALFORWARD_RUN_LOCAL_SEED!=='1',timeout:180000},async t=>{
 const directory=join(validateAcceptanceOptions().base,'seed-test-'+randomUUID());let stack;t.after(async()=>{await stack?.stop();await rm(directory,{recursive:true,force:true});});
 stack=await startAcceptanceStack({workdir:directory});const result=await stack.seed();assert.equal(result.result,'SEEDED');assert.equal(result.meals.length,3);assert.deepEqual(result.meals.map(m=>m.unitPrice),['7000000','9000000','12000000']);assert.deepEqual(result.meals.map(m=>m.funded),['3','2','2']);assert.equal(result.fundedAmount,'63000000');assert.equal(result.recipientReady,true);assert.ok(!JSON.stringify(result).match(/privateKey|signature|cookie|csrf|postgres:\/\//i));
 await assert.rejects(stack.seed(),/SEED_ALREADY_ATTEMPTED/);
 const snapshot=await (await fetch(new URL('/v1/product/catalog',stack.public.url))).json();assert.equal(snapshot.accounting.available,'7');assert.equal(snapshot.accounting.claimed,'0');assert.equal(snapshot.stores[0].name,'留膳验收厨房');assert.equal(snapshot.stores[0].restingToday,false);assert.deepEqual(snapshot.stores[0].hours,[[0,1440]]);
 const html=await fetch(stack.public.url);assert.equal(html.status,200);
});
