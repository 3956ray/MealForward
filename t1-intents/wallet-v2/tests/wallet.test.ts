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
  port.select('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.deepEqual(await port.inspect(),{account:null,chainId:10143});
  assert.deepEqual(p.calls,['eth_accounts','eth_chainId']);
 }finally{port.dispose();(globalThis as any).window=previous;}
});
test('ambiguous legacy and announced providers require explicit selection before inspection or connection',async()=>{
 const previous=(globalThis as any).window;const events=new EventTarget() as any;const legacy=provider('0x'+'1'.repeat(40));const announced=provider('0x'+'2'.repeat(40));events.ethereum=legacy;(globalThis as any).window=events;
 const port=createWalletPort({changed:()=>{}});
 try{
  const e=new Event('eip6963:announceProvider') as any;e.detail={info:{uuid:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'Other Wallet'},provider:announced};events.dispatchEvent(e);
  assert.equal(port.providers().length,2);
  await assert.rejects(port.inspect(),/WALLET_NO_PROVIDER/);
  await assert.rejects(port.connect(),/WALLET_NO_PROVIDER/);
  assert.deepEqual(legacy.calls,[]);assert.deepEqual(announced.calls,[]);
  port.select('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.equal((await port.inspect()).account,'0x'+'2'.repeat(40));
 }finally{port.dispose();(globalThis as any).window=previous;}
});
test('provider switch during account inspection cannot prompt captured earlier provider',async()=>{
 const previous=(globalThis as any).window;const events=new EventTarget();(globalThis as any).window=events;
 let release:(x:any)=>void=()=>{};const waiting=new Promise<any>(resolve=>{release=resolve});
 const a=provider('0x'+'1'.repeat(40));const original=a.request;a.request=async(args:any)=>args.method==='eth_accounts'?waiting:original(args);
 const b=provider('0x'+'1'.repeat(40));const port=createWalletPort({changed:()=>{}});
 const add=(id:string,p:any)=>{const e=new Event('eip6963:announceProvider') as any;e.detail={info:{uuid:id,name:id},provider:p};events.dispatchEvent(e)};
 try{
  add('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',a);add('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',b);
  port.select('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const typed={domain:{name:'x',version:'1',chainId:10143,verifyingContract:'0x'+'0'.repeat(40)},types:{X:[{name:'x',type:'string'}]},primaryType:'X',message:{x:'a'}};
  const pending=port.sign(typed,'0x'+'1'.repeat(40));port.select('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');release(['0x'+'1'.repeat(40)]);
  await assert.rejects(pending,/WALLET_CONTEXT/);
  assert.ok(!a.calls.includes('eth_signTypedData_v4'));assert.ok(!b.calls.includes('eth_signTypedData_v4'));
 }finally{port.dispose();(globalThis as any).window=previous;}
});
test('provider replacement under selected id invalidates pending sign',async()=>{
 const previous=(globalThis as any).window;const events=new EventTarget();(globalThis as any).window=events;
 let release:(x:any)=>void=()=>{};const waiting=new Promise<any>(resolve=>{release=resolve});
 const a=provider('0x'+'1'.repeat(40));const original=a.request;a.request=async(args:any)=>args.method==='eth_accounts'?waiting:original(args);
 const replacement=provider('0x'+'1'.repeat(40));const port=createWalletPort({changed:()=>{}});
 const add=(p:any)=>{const e=new Event('eip6963:announceProvider') as any;e.detail={info:{uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Synthetic'},provider:p};events.dispatchEvent(e)};
 try{
  add(a);port.select('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const typed={domain:{name:'x',version:'1',chainId:10143,verifyingContract:'0x'+'0'.repeat(40)},types:{X:[{name:'x',type:'string'}]},primaryType:'X',message:{x:'a'}};
  const pending=port.sign(typed,'0x'+'1'.repeat(40));add(replacement);release(['0x'+'1'.repeat(40)]);
  await assert.rejects(pending,/WALLET_CONTEXT/);
  assert.ok(!a.calls.includes('eth_signTypedData_v4'));assert.deepEqual(replacement.calls,[]);
 }finally{port.dispose();(globalThis as any).window=previous;}
});
test('explicit permission rejection is sanitized and does not retry',async()=>{
 const previous=(globalThis as any).window;const events=new EventTarget();(globalThis as any).window=events;
 const p=provider('0x'+'1'.repeat(40));p.request=async({method}:any)=>{p.calls.push(method);if(method==='eth_requestAccounts')throw Error('private provider reason');if(method==='eth_chainId')return '0x279f';return ['0x'+'1'.repeat(40)]};
 const port=createWalletPort({changed:()=>{}});
 try{
  const e=new Event('eip6963:announceProvider') as any;e.detail={info:{uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Synthetic'},provider:p};events.dispatchEvent(e);
  port.select('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await assert.rejects(port.connect(),e=>String(e)==='Error: WALLET_CONNECT');
  assert.equal(p.calls.filter(x=>x==='eth_requestAccounts').length,1);
 }finally{port.dispose();(globalThis as any).window=previous;}
});
