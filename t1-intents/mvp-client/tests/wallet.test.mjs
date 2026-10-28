import test from 'node:test';
import assert from 'node:assert/strict';
import {createMvpWallet} from '../wallet.mjs';
const owner='0x1111111111111111111111111111111111111111',other='0x2222222222222222222222222222222222222222',hash='0x'+'ab'.repeat(32);
function fixture(extra=()=>undefined){
 const callbacks=new Map(),calls=[];let network='0x279f',account=owner;
 const provider={on:(n,f)=>callbacks.set(n,f),removeListener:n=>callbacks.delete(n),async request(args){calls.push(args.method);const value=await extra(args,()=>callbacks.get('accountsChanged')?.([other]));if(value!==undefined)return value;if(args.method==='eth_accounts')return[account];if(args.method==='eth_chainId')return network;if(args.method==='eth_sendTransaction')return hash;throw Error('unexpected '+args.method)}};
 const view=new EventTarget();view.Event=Event;view.ethereum=provider;
 const wallet=createMvpWallet({view});wallet.select('injected');
 return {wallet,calls,setNetwork:n=>network=n,setAccount:a=>account=a};
}
const tx={chainId:10143,from:owner,to:other,data:'0x1234',value:'0x0',nonce:'0x0'};
test('discovery/inspection never requests permissions or signatures; wrong network blocks send',async()=>{
 const f=fixture();assert.deepEqual(f.calls,[]);assert.equal((await f.wallet.inspect()).account,owner);
 f.setNetwork('0x1');await assert.rejects(f.wallet.sendTransaction(owner,tx));assert.ok(!f.calls.includes('eth_sendTransaction'));f.wallet.dispose();
});
test('account context changing during final preparation prevents wallet prompt',async()=>{
 let reads=0;const f=fixture(async(args,change)=>{if(args.method==='eth_accounts'&&++reads===2)change()});
 await assert.rejects(f.wallet.sendTransaction(owner,tx));assert.ok(!f.calls.includes('eth_sendTransaction'));f.wallet.dispose();
});
test('returned original hash survives account change while wallet prompt is open; no retry',async()=>{
 const f=fixture(async(args,change)=>{if(args.method==='eth_sendTransaction'){change();return hash}});
 assert.equal(await f.wallet.sendTransaction(owner,tx),hash);assert.equal(f.calls.filter(x=>x==='eth_sendTransaction').length,1);f.wallet.dispose();
});
test('nonzero value and mismatched sender never reach provider',async()=>{
 const f=fixture();assert.throws(()=>f.wallet.sendTransaction(owner,{...tx,value:'0x1'}));assert.throws(()=>f.wallet.sendTransaction(other,tx));assert.deepEqual(f.calls,[]);f.wallet.dispose();
});
