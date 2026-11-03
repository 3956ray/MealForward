import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./deployment-review-client.mjs',import.meta.url),'utf8');
async function page({attempt=null}={}) {
  const nodes=Object.fromEntries(['connect','deploy','refresh','verify','review','status','hash','result'].map(id=>[id,{}]));
  const storage=new Map(),sent=[];let reads=0,reserveBody,account='0x123',release,entered;
  const reserved=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const config={deployer:account,chainId:10143,nonce:'0x1',gas:'0x100',gasPrice:'0x2',data:'0x1234',dataHash:'hash',checkedAt:Date.now(),attempt};
  const provider={isMetaMask:true,on(){},request:async({method,params})=>{
    if(method==='eth_chainId')return '0x279f';
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [account];
    if(method==='eth_sendTransaction'){sent.push(params[0]);return '0x'+'a'.repeat(64);}throw Error(method);
  }};
  const context={document:{getElementById:id=>nodes[id]},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},window:{ethereum:provider,addEventListener(){}},fetch:async(path,options)=>{
    if(path==='/preflight'){reads++;return {ok:true,json:async()=>({...config})};}
    if(path==='/reserve'){reserveBody=JSON.parse(options.body);entered();await gate;return {ok:true};}throw Error(path);
  }};
  await vm.runInNewContext('(async()=>{'+source+'})()',context);
  return {nodes,storage,sent,reserved,release,config,setAccount:value=>{account=value;},getReads:()=>reads,getReservation:()=>reserveBody};
}
test('delayed reservation cannot be replaced by overlapping refresh/connect/verify',async()=>{
  const p=await page();await p.nodes.connect.onclick();const pending=p.nodes.deploy.onclick();await p.reserved;
  const readCount=p.getReads();assert.equal(p.nodes.refresh.disabled,true);
  await p.nodes.refresh.onclick();await p.nodes.connect.onclick();await p.nodes.verify.onclick();
  assert.equal(p.getReads(),readCount);assert.equal(p.nodes.deploy.disabled,true);
  p.config.nonce='0x2';p.config.gas='0x200';p.release();await pending;
  assert.equal(p.sent.length,1);assert.equal(p.sent[0].nonce,p.getReservation().nonce);assert.equal(p.sent[0].gas,p.getReservation().gas);
  await p.nodes.deploy.onclick();assert.equal(p.sent.length,1);
});
test('account change during reservation leaves durable attempt and sends nothing',async()=>{
  const p=await page();await p.nodes.connect.onclick();const pending=p.nodes.deploy.onclick();await p.reserved;
  p.setAccount('0x456');p.release();await pending;
  assert.equal(p.sent.length,0);assert.equal(JSON.parse([...p.storage.values()][0]).state,'UNKNOWN');assert.equal(p.nodes.deploy.disabled,true);
});
test('fresh browser without localStorage respects server-side original attempt',async()=>{
  const p=await page({attempt:{nonce:'0x1'}});await p.nodes.connect.onclick();
  assert.equal(p.nodes.deploy.disabled,true);await p.nodes.deploy.onclick();assert.equal(p.sent.length,0);
});
