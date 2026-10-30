import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductWallet,validateProductConfiguration,PRODUCT_USDC} from '../product-network.mjs';
const owner='0x'+'11'.repeat(20),escrow='0x'+'22'.repeat(20),asset='0x'+'33'.repeat(20),other='0x'+'44'.repeat(20),hash='0x'+'ab'.repeat(32);
const local={verified:true,profile:'local-acceptance',chainId:31337,asset,escrow};
const production={verified:true,chainId:10143,asset:PRODUCT_USDC,escrow};
function fixture({configuration=local,origin='http://127.0.0.1:43210',extra=()=>undefined}={}){
 const calls=[],events=new Map();let account=owner,network=configuration?.chainId===10143?'0x279f':'0x7a69',changes=0;
 const provider={on:(n,f)=>events.set(n,f),removeListener:n=>events.delete(n),async request(args){calls.push(args);const r=await extra(args,()=>events.get('accountsChanged')?.([other]));if(r!==undefined)return r;if(['eth_accounts','eth_requestAccounts'].includes(args.method))return [account];if(args.method==='eth_chainId')return network;if(args.method==='eth_sendTransaction')return hash;if(args.method==='personal_sign')return '0x'+'11'.repeat(65);throw Error('unexpected '+args.method);}};
 const view=new EventTarget();Object.assign(view,{Event,ethereum:provider,location:{origin}});const wallet=createProductWallet({view,configuration,onChange:()=>changes++});wallet.select('injected');
 return {wallet,view,calls,setAccount:a=>account=a,setNetwork:n=>network=n,get changes(){return changes;}};
}
const tx={chainId:31337,from:owner,to:escrow,data:'0x1234',value:'0x0',nonce:'0x0'};
test('synthetic policy: production is Monad and fixed USDC; local profile is explicit loopback only',()=>{
 assert.equal(validateProductConfiguration(production,'https://meal.test').profile,'monad-testnet');assert.equal(validateProductConfiguration(local,'http://127.0.0.1:43210').chainId,31337);
 for(const origin of ['https://127.0.0.1:43210','http://localhost:43210','http://0.0.0.0:43210','http://127.0.0.1','http://127.0.0.1:65536','http://127.0.0.1:0','http://127.0.0.1:43210/path','http://127.0.0.1:43210.evil.test','https://meal.test',undefined])assert.throws(()=>validateProductConfiguration(local,origin),/PRODUCT_CONFIGURATION_UNVERIFIED/);
 for(const config of [{...production,profile:'production'},{...local,profile:undefined},{...local,profile:'test'},{...local,chainId:10143},{...production,asset},{...production,chainId:31337},{...production,verified:'true'},{...local,asset:'0x'+'0'.repeat(40)}])assert.throws(()=>validateProductConfiguration(config,'http://127.0.0.1:43210'),/PRODUCT_CONFIGURATION_UNVERIFIED/);
});
test('synthetic provider: discovery and inspect are passive; unconfigured actions are denied',async()=>{
 const f=fixture({configuration:null});assert.deepEqual(f.calls,[]);assert.equal((await f.wallet.inspect()).account,owner);assert.deepEqual(f.calls.map(x=>x.method),['eth_accounts','eth_chainId']);await assert.rejects(f.wallet.connect(),/CONFIGURATION_REQUIRED/);await assert.rejects(f.wallet.signMessage(owner,'login'),/CONFIGURATION_REQUIRED/);assert.throws(()=>f.wallet.sendTransaction(owner,tx),/CONFIGURATION_REQUIRED/);assert.ok(!f.calls.some(x=>['eth_requestAccounts','personal_sign','eth_sendTransaction'].includes(x.method)));f.wallet.configure(local);const previousWindow=globalThis.window;globalThis.window=f.view;try{assert.equal((await f.wallet.connect()).chainId,31337);}finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}assert.equal(f.calls.filter(x=>x.method==='eth_requestAccounts').length,1);f.wallet.dispose();
});
test('synthetic provider: local explicit sign/send match configured account, network and targets',async()=>{
 const f=fixture();await f.wallet.signMessage(owner,'explicit login');assert.equal(f.calls.filter(x=>x.method==='personal_sign').length,1);assert.equal(await f.wallet.sendTransaction(owner,tx),hash);assert.equal(f.calls.filter(x=>x.method==='eth_sendTransaction').length,1);
 for(const changed of [{...tx,value:'0x1'},{...tx,to:other},{...tx,to:null},{...tx,chainId:10143},{...tx,from:other}])assert.throws(()=>f.wallet.sendTransaction(owner,changed));f.setNetwork('0x279f');await assert.rejects(f.wallet.sendTransaction(owner,tx),/ACCOUNT_OR_NETWORK/);assert.equal(f.calls.filter(x=>x.method==='eth_sendTransaction').length,1);f.wallet.dispose();
});
test('synthetic provider: changed configuration or identity blocks preparation but returned hash survives prompt changes',async()=>{
 let reads=0;const f=fixture({extra:(a,change)=>{if(a.method==='eth_accounts'&&++reads===2)change();}});await assert.rejects(f.wallet.sendTransaction(owner,tx));assert.ok(!f.calls.some(x=>x.method==='eth_sendTransaction'));f.wallet.dispose();
 const g=fixture({extra:(a,change)=>{if(a.method==='eth_sendTransaction'){change();return hash;}}});assert.equal(await g.wallet.sendTransaction(owner,tx),hash);assert.equal(g.calls.filter(x=>x.method==='eth_sendTransaction').length,1);const count=g.changes;g.wallet.configure(local);assert.equal(g.changes,count);g.wallet.configure({...local,escrow:other});assert.equal(g.changes,count+1);g.wallet.dispose();
});
test('synthetic provider: changing origin never keeps local signing enabled',async()=>{
 const f=fixture();f.view.location.origin='https://meal.test';await assert.rejects(f.wallet.signMessage(owner,'login'),/PRODUCT_CONFIGURATION_UNVERIFIED/);assert.throws(()=>f.wallet.sendTransaction(owner,tx),/PRODUCT_CONFIGURATION_UNVERIFIED/);assert.ok(!f.calls.some(x=>['personal_sign','eth_sendTransaction'].includes(x.method)));f.wallet.dispose();
});

test('real local provider: isolated Anvil explicit connect/sign/send produces a canonical receipt', {skip:process.env.MF_TEST_LOCAL_PROVIDER!=='1'},async()=>{
 const {spawn}=await import('node:child_process'),{createServer}=await import('node:net'),{verifyMessage}=await import('viem');
 const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(r=>server.close(r));
 const child=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--silent'],{stdio:'ignore'});let startError,wallet;child.on('error',e=>startError=e);
 const calls=[];let sequence=0;const rpc=async(method,params=[])=>{const r=await fetch('http://127.0.0.1:'+port,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})});const v=await r.json();if(v.error)throw Error(v.error.message);return v.result;};
 const oldWindow=globalThis.window;
 try{
  let ready=false;for(let i=0;i<100;i++){if(startError)throw startError;try{if(await rpc('eth_chainId')==='0x7a69'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}assert.ok(ready,'isolated Anvil started');
  const accounts=await rpc('eth_accounts');const config={...local,escrow:accounts[1],asset:accounts[2]},view=new EventTarget();
  const provider={on(){},removeListener(){},request:async({method,params})=>{calls.push(method);return rpc(method==='eth_requestAccounts'?'eth_accounts':method,params);}};
  Object.assign(view,{Event,ethereum:provider,location:{origin:'http://127.0.0.1:'+port}});globalThis.window=view;
  wallet=createProductWallet({view,configuration:config});assert.deepEqual(calls,[]);wallet.select('injected');await wallet.inspect();assert.ok(!calls.includes('eth_requestAccounts'));const connected=await wallet.connect();assert.equal(connected.account,accounts[0]);assert.equal(connected.chainId,31337);
  const message='MealForward isolated local wallet acceptance';const signature=await wallet.signMessage(accounts[0],message);assert.equal(await verifyMessage({address:accounts[0],message,signature}),true);
  const nonce=await rpc('eth_getTransactionCount',[accounts[0],'pending']);const txHash=await wallet.sendTransaction(accounts[0],{from:accounts[0],to:accounts[1],chainId:'0x7a69',nonce,value:'0x0',data:'0x'});assert.match(txHash,/^0x[0-9a-f]{64}$/i);
  let receipt;for(let i=0;i<100&&!receipt;i++){receipt=await rpc('eth_getTransactionReceipt',[txHash]);if(!receipt)await new Promise(r=>setTimeout(r,20));}assert.ok(receipt,'real transaction mined');const actual=await rpc('eth_getTransactionByHash',[txHash]),block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);assert.equal(receipt.status,'0x1');assert.equal(receipt.blockHash,block.hash);assert.equal(actual.to,accounts[1]);assert.equal(actual.chainId,'0x7a69');assert.equal(actual.nonce,nonce);assert.equal(actual.value,'0x0');assert.equal(calls.filter(m=>m==='eth_sendTransaction').length,1);
 }finally{wallet?.dispose();if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null||startError)return r();child.once('exit',r);});}
});
test('explicit cancellation method only sends empty zero-value self transfer at original nonce',async()=>{
 const f=fixture(),cancel={from:owner,to:owner,chainId:'0x7a69',nonce:'0x3',value:'0x0',data:'0x'};
 assert.equal(await f.wallet.sendCancellationTransaction(owner,cancel),hash);const sent=f.calls.find(c=>c.method==='eth_sendTransaction').params[0];assert.equal(sent.to,owner);assert.equal(sent.nonce,'0x3');assert.equal(sent.data,'0x');
 for(const patch of [{to:escrow},{data:'0x1234'},{value:'0x1'},{nonce:'0x03'},{chainId:10143},{from:other},{gas:'0x5208'}])assert.throws(()=>f.wallet.sendCancellationTransaction(owner,{...cancel,...patch}),/CANCELLATION_TRANSACTION/);
 assert.throws(()=>f.wallet.sendTransaction(owner,cancel),/TRANSACTION/);assert.equal(f.calls.filter(c=>c.method==='eth_sendTransaction').length,1);f.wallet.dispose();
});
