import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,Wallet,ContractFactory,JsonRpcProvider,keccak256} from 'ethers';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {makeNonceCancellationVerifier} from './nonce-cancellation.mjs';
import {chainReference} from './funding-wire.mjs';
import {makeProductChain} from './chain-adapter.mjs';
const A='0x'+'a'.repeat(40),E='0x'+'b'.repeat(40),T='0x'+'c'.repeat(40),OTHER='0x'+'d'.repeat(40),H='0x'+'1'.repeat(64),B='0x'+'2'.repeat(64),F='0x'+'3'.repeat(64);
const requestABI=new Interface(['function getRequest(address,bytes32) view returns(tuple(bytes32 payloadHash,bytes32 result,bool exists))']);
function fixture(){
 const op={id:'original',kind:'support',wallet:A,state:'SEND_UNKNOWN',transaction:{from:A,to:E,chainId:'0x7a69',nonce:'0x2',value:'0x0',data:'0x12345678'}};
 const tx={hash:H,from:A,to:A,chainId:31337n,nonce:2,value:0n,data:'0x',type:2,blockNumber:8,blockHash:B};
 const receipt={hash:H,from:A,to:A,status:1,blockNumber:8,blockHash:B,logs:[],contractAddress:null};
 const final={verified:true,chainId:31337,escrow:E,asset:T,blockNumber:10,blockHash:F};let exists=false,network=31337n;const calls=[];
 const blocks={8:{number:8,hash:B,timestamp:100},10:{number:10,hash:F,timestamp:102}};
 const provider={getNetwork:async()=>({chainId:network}),getBlock:async n=>({...blocks[n]}),getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt,call:async arg=>{calls.push(arg);return requestABI.encodeFunctionResult('getRequest',[[H,H,exists]]);}};
 const chain={target:{chainId:31337,escrow:E,asset:T},verifyTarget:async()=>final};
 return {op,tx,receipt,final,blocks,provider,chain,calls,verify:(o=op,h=H)=>makeNonceCancellationVerifier({provider,chain}).verify(o,h),setExists:x=>exists=x,setNetwork:x=>network=x};
}
test('final empty same-wallet nonce cancellation binds original identity and reads original request at final snapshot',async()=>{
 const f=fixture(),proof=await f.verify();assert.equal(proof.verified,true);assert.equal(proof.invalidated,true);assert.equal(proof.finalized,true);assert.equal(proof.originalNonce,2);assert.equal(proof.operationId,f.op.id);assert.equal(proof.wallet,A);assert.equal(proof.blockNumber,8);assert.equal(proof.finalizedBlockNumber,10);assert.equal(proof.chainTime,102);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].to,E);assert.equal(f.calls[0].blockTag,10);const args=requestABI.parseTransaction(f.calls[0]).args;assert.equal(args[0].toLowerCase(),A);assert.equal(args[1],chainReference(f.op.id));
 f.tx.type=0;assert.equal((await f.verify()).verified,true);
});
test('original operation, target and network cannot be substituted or forged as an unattempted rejection',async()=>{
 for(const mutation of [f=>f.op.wallet=OTHER,f=>f.op.state='PREPARED',f=>f.op.state='REJECTED',f=>f.op.kind='claim',f=>f.op.transaction.nonce=-1,f=>f.op.transaction.nonce=undefined,f=>f.op.transaction.chainId='0x279f',f=>f.op.transaction.to=T,f=>f.op.transaction.value='0x1',f=>f.op.transaction.data='0x',f=>f.final.verified=false,f=>f.final.escrow=OTHER,f=>f.final.asset=OTHER,f=>f.final.chainId=10143,f=>f.setNetwork(10143n)]){const f=fixture();mutation(f);assert.equal((await f.verify()).verified,false);}
 const f=fixture();assert.equal((await f.verify(f.op,'bad')).verified,false);assert.throws(()=>makeNonceCancellationVerifier({provider:f.provider,chain:{...f.chain,target:{...f.chain.target,chainId:1}}}));
});
test('wrong nonce, wallet, chain and all business or token calls are rejected',async()=>{
 for(const [key,value]of [['nonce',3],['from',OTHER],['to',E],['to',T],['chainId',10143n],['value',1n],['data','0x12345678'],['type',1],['type',3],['type',4],['authorizationList',[{}]],['blobVersionedHashes',[H]]]){const f=fixture();f.tx[key]=value;assert.equal((await f.verify()).verified,false, key);}
});
test('absent, nonfinal, malformed and inconsistent receipts never release an operation',async()=>{
 const absent=fixture();absent.provider.getTransactionReceipt=async()=>null;assert.equal((await absent.verify()).reason,'CANCELLATION_PENDING');
 const noTx=fixture();noTx.provider.getTransaction=async()=>null;assert.equal((await noTx.verify()).reason,'CANCELLATION_PENDING');
 const late=fixture();late.final.blockNumber=7;late.blocks[7]={number:7,hash:F,timestamp:99};assert.equal((await late.verify()).reason,'CANCELLATION_NOT_FINAL');
 for(const [key,value]of [['from',OTHER],['to',E],['hash',B],['status',0],['status',null],['logs',[{}]],['logs',undefined],['contractAddress',A],['blockHash',F],['blockNumber',7]]){const f=fixture();f.receipt[key]=value;assert.equal((await f.verify()).verified,false,key);}
 const f=fixture();f.tx.blockHash=F;assert.equal((await f.verify()).verified,false);f.tx.blockHash=B;f.tx.blockNumber=9;assert.equal((await f.verify()).verified,false);
});
test('receipt reorg, final snapshot reorg and unavailable evidence fail closed without writes',async()=>{
 for(const reorg of [8,10]){const f=fixture();let reads=0;const read=f.provider.getBlock;f.provider.getBlock=async n=>{const b=await read(n);if(n===reorg&&++reads===2)b.hash=H;return b;};assert.equal((await f.verify()).reason,'CANCELLATION_REORG');}
 const f=fixture();f.provider.call=async()=>{throw Error('disconnected');};assert.equal((await f.verify()).reason,'CANCELLATION_EVIDENCE_UNAVAILABLE');
});
test('already completed original request requires original business recovery, not cancellation',async()=>{
 const f=fixture();f.setExists(true);assert.equal((await f.verify()).reason,'ORIGINAL_REQUEST_COMPLETED');
 f.op.kind='approval';f.op.transaction.to=T;assert.equal((await f.verify()).verified,true);assert.equal(f.calls.length,1);
});
test('handover permit must be expired strictly before the verified final timestamp',async()=>{
 const f=fixture();f.op.kind='handover';for(const expiresAt of [undefined,103,102]){f.op.expiresAt=expiresAt;assert.equal((await f.verify()).reason,'CANCELLATION_PERMIT_STILL_VALID');}
 f.op.expiresAt=101;assert.equal((await f.verify()).verified,true);assert.equal(f.calls.length,1);
});
test('mutable caller objects cannot change the bound original operation during an evidence read',async()=>{
 const f=fixture(),read=f.chain.verifyTarget;f.chain.verifyTarget=async()=>{f.op.wallet=OTHER;f.op.transaction.nonce=9;return read();};const proof=await f.verify();assert.equal(proof.verified,true);assert.equal(proof.wallet,A);assert.equal(proof.originalNonce,2);
});
async function freePort(){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
test('real isolated Anvil: finalized cancellation makes the original signed escrow transaction impossible',{skip:process.env.MEALFORWARD_RUN_LOCAL_NONCE!=='1',timeout:90000},async t=>{
 const port=await freePort(),child=spawn(process.env.PRODUCT_TEST_ANVIL_BIN||'anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--accounts','0','--slots-in-an-epoch','1','--silent'],{stdio:'ignore'});let spawnError=false;child.once('error',()=>{spawnError=true;});const provider=new JsonRpcProvider('http://127.0.0.1:'+port,31337,{cacheTimeout:-1,pollingInterval:50});
 t.after(async()=>{provider.destroy();if(child.exitCode===null&&!spawnError){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);if(child.exitCode===null)child.kill('SIGKILL');}});
 let ready=false;for(let i=0;i<60&&!spawnError;i++){try{await provider.send('eth_chainId',[]);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}assert.equal(ready,true,'independent Anvil started');
 const wallet=Wallet.createRandom().connect(provider),platform=Wallet.createRandom(),redemption=Wallet.createRandom();await provider.send('anvil_setBalance',[wallet.address,'0x56bc75e2d63100000']);
 const tokenArtifact=JSON.parse(await readFile(new URL('../../mvp-contracts/out/AcceptanceTestAsset.sol/AcceptanceTestAsset.json',import.meta.url),'utf8')),escrowArtifact=JSON.parse(await readFile(new URL('../../mvp-contracts/out/ProductEscrow.sol/ProductEscrow.json',import.meta.url),'utf8'));
 const token=await new ContractFactory(tokenArtifact.abi,tokenArtifact.bytecode.object,wallet).deploy();await token.waitForDeployment();const escrow=await new ContractFactory(escrowArtifact.abi,escrowArtifact.bytecode.object,wallet).deploy(await token.getAddress(),platform.address,redemption.address,7200);await escrow.waitForDeployment();const deployment=await escrow.deploymentTransaction().wait();await provider.send('anvil_mine',['0x3','0x1']);
 const manifest={chainId:31337,escrow:await escrow.getAddress(),asset:await token.getAddress(),claimAuthority:platform.address,redemptionAuthority:redemption.address,escrowCodeHash:keccak256(await provider.getCode(await escrow.getAddress())),assetCodeHash:keccak256(await provider.getCode(await token.getAddress())),policySeconds:7200,assetDecimals:6,deploymentBlock:deployment.blockNumber,maxFeePerGas:'10000000000',maxTransactionFee:'50000000000000000',claimGasLimit:'1000000'};
 const chain=makeProductChain({provider,manifest,store:{read:async()=>({}),transact:async()=>{throw Error('unexpected cancellation write');}},profile:'local-acceptance'}),verifier=makeNonceCancellationVerifier({provider,chain}),nonce=await provider.getTransactionCount(wallet.address,'pending');
 const op={id:'real-cancelled-register',kind:'registration',state:'SEND_UNKNOWN',wallet:wallet.address.toLowerCase(),transaction:{from:wallet.address.toLowerCase(),to:manifest.escrow,chainId:'0x7a69',nonce:'0x'+nonce.toString(16),value:'0x0',data:escrow.interface.encodeFunctionData('registerStore',[chainReference('real-cancelled-register'),chainReference('never-registered')])}};
 const original=await wallet.signTransaction({...op.transaction,type:2,gasLimit:180000,maxFeePerGas:3000000000n,maxPriorityFeePerGas:1000000000n});
 const cancellation=await wallet.sendTransaction({to:wallet.address,nonce,value:0,data:'0x',type:2,gasLimit:21000,maxFeePerGas:4000000000n,maxPriorityFeePerGas:1000000000n});await cancellation.wait();await provider.send('anvil_mine',['0x3','0x1']);
 const proof=await verifier.verify(op,cancellation.hash);assert.equal(proof.verified,true,proof.reason);assert.equal(proof.originalNonce,nonce);let rejected=false;
 try{await provider.broadcastTransaction(original);}catch(error){rejected=error.code==='NONCE_EXPIRED'||/nonce too low/i.test(error.shortMessage||error.message||'');}
 assert.equal(rejected,true,'the original signed business transaction cannot execute after its nonce is finalized');assert.equal((await escrow.getRequest(wallet.address,chainReference(op.id))).exists,false);assert.equal(await escrow.storeOwner(chainReference('never-registered')),'0x'+'0'.repeat(40));
 const legacyNonce=await provider.getTransactionCount(wallet.address,'pending'),legacyOp={...op,id:'legacy-cancel',transaction:{...op.transaction,nonce:'0x'+legacyNonce.toString(16)}};const legacy=await wallet.sendTransaction({to:wallet.address,nonce:legacyNonce,value:0,data:'0x',type:0,gasLimit:21000,gasPrice:4000000000n});await legacy.wait();await provider.send('anvil_mine',['0x3','0x1']);assert.equal((await verifier.verify(legacyOp,legacy.hash)).verified,true);
});
