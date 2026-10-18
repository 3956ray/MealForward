import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('./chain-e2e.html',import.meta.url),'utf8');
const source=html.match(/<script type="module">([\s\S]+?)<\/script>/)?.[1];
test('wallet smoke page parses in modern browser JavaScript syntax',()=>{
 assert.ok(source&&source.length>8000);
 assert.doesNotThrow(()=>new vm.Script(source,{filename:'isolated-monad-smoke.js'}));
});
test('only explicit owner wallet actions can request transactions; no private-key capture',()=>{
 const sends=source.match(/eth_sendTransaction/g)||[];
 assert.equal(sends.length,1,'all outgoing tx actions pass the single guarded function');
 assert.match(source,/await chain\(\);if\(state\.txs\?\.\[step\]\)/);
 assert.match(source,/const tx=await rpc\('eth_sendTransaction'/);
 assert.match(source,/state\.pending=\{step,hash:tx\}/);
 assert.match(source,/if\(state\.pending\)throw Error/);
 for(const forbidden of ['eth_sendRawTransaction','privateKeyToAccount','mnemonicToAccount','window.localStorage.setItem("secret"','chainId:143']){
  assert.ok(!source.includes(forbidden),'unsupported sensitive operation '+forbidden);
 }
});
test('uses actual Circle USDC on Monad testnet, never D1 simulated checkout',()=>{
 assert.match(source,/CHAIN=10143/);
 assert.match(source,/0x534b2f3A21130d7a60830c2Df862319e593943A3/);
 assert.match(source,/PRICE=7000000n/);
 assert.match(source,/eth_chainId/);
 assert.match(source,/await rpc\('eth_getTransactionReceipt'/);
 assert.match(source,/decodeEventLog/);
 assert.match(source,/issue:'Issued'/);
 assert.match(source,/primaryType:'FundingQuote'/);
 assert.ok(!source.includes('/api/orders'),'testnet smoke must not mutate D1 fake ledger');
});
test('ABI and bytecode pins correspond to reviewed source-only build',()=>{
 assert.match(source,/bd84f387a46428802a453f28306ad6f9de7317465ff48844619d550713ce0c66/);
 assert.match(source,/9c2583ee25a9fc08aa2434efde455ee7fc0c945847d3ef7789dfd370735d7a8d/);
 assert.match(source,/sha256\(bytes\)!==BYTE_SHA/);
 assert.match(source,/runtimeBytecode\.length-2\)\/2>24576/);
 assert.match(source,/if\(state\.contract\)throw Error/);
});
test('real lifecycle includes user-initiated issuer/merchant steps with receipt verification',()=>{
 for(const stage of ["'deploy'","'approve'","'fund'","'issue'","'lock'","'mark'","'report'","'settle'"]){
  assert.ok(source.includes(stage),stage);
 }
 assert.match(source,/status!=='0x1'/);
 assert.match(source,/await op\('markHandover'/);
 assert.match(source,/await op\('report'/);
 assert.match(source,/await op\('settle'/);
 assert.match(html,/同一個/);
});
