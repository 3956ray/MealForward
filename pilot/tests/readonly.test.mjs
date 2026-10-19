import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('preview is explicitly read-only and cannot call wallet signing/transactions',()=>{
 assert.match(html,/READ ONLY/);
 assert.match(html,/Chain ID 10143/);
 assert.match(html,/0x534b2f3A21130d7a60830c2Df862319e593943A3/);
 for(const forbidden of ["eth_sendTransaction","eth_sendRawTransaction","personal_sign","eth_signTypedData","wallet_sendCalls",
  "privateKey","mnemonic","wallet_requestPermissions"]){
  assert.ok(!html.includes(forbidden),forbidden);
 }
 for(const permitted of ["eth_chainId","eth_getCode","eth_call","eth_getBalance","eth_getTransactionReceipt","eth_requestAccounts"]){
  assert.ok(html.includes(permitted),permitted);
 }
});
test('wallet address state is invalidated when browser account or network changes',()=>{
 assert.match(html,/accountsChanged/);
 assert.match(html,/chainChanged/);
 assert.match(html,/address=null/);
});
test('preview files are isolated from any CP30 services or Vercel serverless funding endpoint',()=>{
 assert.ok(!html.includes("cp30-backend"));
 assert.ok(!html.includes("eth_send"));
 const dir=new URL('../',import.meta.url);
 const entries=readdirSync(dir).sort();
 assert.ok(entries.includes('vercel.json'));
 assert.ok(entries.includes('index.html'));
 assert.ok(!entries.includes('.env'));
});
