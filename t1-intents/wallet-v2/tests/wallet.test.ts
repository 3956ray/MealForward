import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletPort} from '../src/wallet.ts';
type Handler=(...args:any[])=>void;
function provider(address:string,chain='0x279f'){
 const calls:string[]=[];const handlers=new Map<string,Handler[]>();
 const p={calls,on:(e:string,h:Handler)=>handlers.set(e,[...(handlers.get(e)||[]),h]),removeListener:(e:string,h:Handler)=>handlers.set(e,(handlers.get(e)||[]).filter(x=>x!==h)),emit:(e:string,v:any)=>handlers.get(e)?.forEach(h=>h(v)),request:async({method}:any)=>{calls.push(method);if(method==='eth_accounts'||method==='eth_requestAccounts')return [address];if(method==='eth_chainId')return chain;if(method==='eth_signTypedData_v4')return '0x'+'1'.repeat(130);throw Error('forbidden '+method)}};return p;
}
test('late multiple EIP6963 announcements, readonly inspection, explicit connect, events and wagmi signing',async()=>{
 const previous=(globalThis as any).window;const events=new EventTarget();(globalThis as any).window=events;
 const changed:string[]=[];const port=createWalletPort({changed:()=>changed.push('changed')});
 try{
  assert.deepEqual(port.providers(),[]);
  const a=provider('0x'+'1'.repeat(40));const b=provider('0x'+'2'.repeat(40),'0x1');
  for(const [id,p] of [['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',a],['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',b]] as const){const e=new Event('eip6963:announceProvider') as any;e.detail={info:{uuid:id,name:id,icon:'data:image/svg+xml,<svg/>',rdns:'io.test'},provider:p};events.dispatchEvent(e);}
  assert.equal(port.providers().length,2);port.select('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.deepEqual(await port.inspect(),{account:'0x'+'2'.repeat(40),chainId:1});
  assert.deepEqual(b.calls,['eth_accounts','eth_chainId']);await port.connect();assert.ok(b.calls.includes('eth_requestAccounts'));
  const typed={domain:{name:'x',version:'1',chainId:10143,verifyingContract:'0x'+'0'.repeat(40)},types:{X:[{name:'x',type:'string'}]},primaryType:'X',message:{x:'a'}};
  await assert.rejects(port.sign(typed,'0x'+'2'.repeat(40)),/WALLET_CONTEXT/);
  assert.ok(!b.calls.includes('eth_signTypedData_v4'));
  port.select('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await port.sign(typed,'0x'+'1'.repeat(40));assert.ok(a.calls.includes('eth_signTypedData_v4'));
  const before=changed.length;a.emit('accountsChanged',[]);assert.equal(changed.length,before+1);port.dispose();
 }finally{(globalThis as any).window=previous;}
});
test('unauthorized account is null and inspection never requests permissions',async()=>{
 const previous=(globalThis as any).window;const events=new EventTarget();(globalThis as any).window=events;
 const p=provider('0x'+'3'.repeat(40));p.request=async({method}:any)=>{p.calls.push(method);if(method==='eth_accounts')return [];if(method==='eth_chainId')return '0x279f';throw Error('forbidden')};
 const port=createWalletPort({changed:()=>{}});
 try{
  const e=new Event('eip6963:announceProvider') as any;e.detail={info:{uuid:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'Synthetic'},provider:p};events.dispatchEvent(e);
  assert.deepEqual(await port.inspect(),{account:null,chainId:10143});
  assert.deepEqual(p.calls,['eth_accounts','eth_chainId']);
 }finally{port.dispose();(globalThis as any).window=previous;}
});
