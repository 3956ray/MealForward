/**
 * Real, local EVM E2E of the TESTNET-ONLY independent pilot.
 * Never opens a public RPC, wallet key, original CP30 or database.
 * Uses ephemeral local Anvil chain ID 10143 with synthetic signer keys.
 */
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {
 createPublicClient,createWalletClient,createTestClient,defineChain,
 http,parseEther,parseUnits,decodeEventLog
} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';

const chain=defineChain({
 id:10143,name:'Pilot Local Monad Testnet',
 nativeCurrency:{name:'Test MON',symbol:'MON',decimals:18},
 rpcUrls:{default:{http:['http://127.0.0.1:18545']}}
});
const rpc='http://127.0.0.1:18545';
const artifacts=JSON.parse(readFileSync(new URL('../src/contract.generated.json',import.meta.url),'utf8'));
const abi=artifacts.MealForwardPilot.abi;
const tokenAbi=artifacts.PilotMealCredit.abi;
let node=null,stderr='';
const nil='0x0000000000000000000000000000000000000000';
const assertReject=async(promise,label)=>{
 await assert.rejects(promise,undefined,label);
};
const rpcReady=async()=>{
 for(let i=0;i<60;i++){
  if(node.exitCode!==null)throw Error('Anvil process exited early: '+stderr.slice(-700));
  try{
   const res=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});
   const data=await res.json();
   if(data.result==='0x279f')return;
  }catch{}
  await sleep(250);
 }
 throw Error('Local isolated Anvil 10143 did not become ready');
};
const log=(name,extra={})=>console.log(JSON.stringify({test:name,status:'PASS',...extra}));
async function main(){
 node=spawn('anvil',['--host','127.0.0.1','--port','18545','--chain-id','10143','--silent'],{
  stdio:['ignore','ignore','pipe'],env:{...process.env}
 });
 node.stderr.on('data',buffer=>{stderr+=buffer.toString();});
 await rpcReady();
 const pc=createPublicClient({transport:http(rpc),chain});
 const client=createTestClient({mode:'anvil',transport:http(rpc),chain});
 const merchant=privateKeyToAccount(generatePrivateKey());
 const supporter=privateKeyToAccount(generatePrivateKey());
 const recipient=privateKeyToAccount(generatePrivateKey());
 const attacker=privateKeyToAccount(generatePrivateKey());
 for(const account of [merchant,supporter,recipient,attacker]){
  await client.setBalance({address:account.address,value:parseEther('8')});
 }
 const wc=createWalletClient({transport:http(rpc),chain});
 const put=async(account,fn,args,address,contractAbi=abi)=>{
  const hash=await wc.writeContract({address,abi:contractAbi,functionName:fn,args,account,chain});
  const receipt=await pc.waitForTransactionReceipt({hash,timeout:20000});
  assert.equal(receipt.status,'success',fn+' receipt reverted');
  return receipt;
 };
 const deployHash=await wc.deployContract({
  abi,bytecode:artifacts.MealForwardPilot.bytecode,args:[],account:merchant,chain
 });
 const deployed=await pc.waitForTransactionReceipt({hash:deployHash});
 assert.equal(deployed.status,'success');
 const contract=deployed.contractAddress;
 assert.ok(contract&&contract!==nil);
 const token=await pc.readContract({address:contract,abi,functionName:'credit'});
 const tokenName=await pc.readContract({address:token,abi:tokenAbi,functionName:'name'});
 assert.match(tokenName,/NO VALUE/);
 const eoaTokenBalance=()=>pc.readContract({address:token,abi:tokenAbi,functionName:'balanceOf',args:[merchant.address]});
 log('deploy fresh mock token and independent pilot',{contract,token});

 await put(merchant,'registerKitchen',['清和食堂',parseUnits('5',6)],contract);
 const count=await pc.readContract({address:contract,abi,functionName:'kitchenCount'});
 assert.equal(count,1n);
 const kitchen=await pc.readContract({address:contract,abi,functionName:'getKitchen',args:[1n]});
 assert.equal(kitchen.owner.toLowerCase(),merchant.address.toLowerCase());
 assert.equal(kitchen.unitPrice,parseUnits('5',6));
 log('register kitchen owner and immutable meal price');

 await put(supporter,'faucet',[],token,tokenAbi);
 assert.equal(await pc.readContract({address:token,abi:tokenAbi,functionName:'balanceOf',args:[supporter.address]}),parseUnits('100',6));
 await assertReject(pc.simulateContract({address:token,abi:tokenAbi,functionName:'faucet',account:supporter.address}), 'faucet must be one time');
 await assertReject(pc.simulateContract({address:contract,abi,functionName:'fund',args:[1n,1n],account:supporter.address}), 'cannot fund before ERC20 approve');
 await put(supporter,'approve',[contract,parseUnits('5',6)],token,tokenAbi);
 await put(supporter,'fund',[1n,1n],contract);
 const afterFund=await pc.readContract({address:contract,abi,functionName:'getKitchen',args:[1n]});
 assert.equal(afterFund.available,1n);
 assert.equal(afterFund.totalFunded,parseUnits('5',6));
 const donated=await pc.readContract({address:contract,abi,functionName:'contributions',args:[1n,supporter.address]});
 assert.equal(donated,parseUnits('5',6));
 log('donor faucet, actual ERC20 approve and fund with source-accounted on-chain receipt');

 await put(recipient,'claim',[1n],contract);
 const voucherId=await pc.readContract({address:contract,abi,functionName:'voucherOf',args:[1n,recipient.address]});
 assert.match(voucherId,/^0x[0-9a-f]{64}$/i);
 const v1=await pc.readContract({address:contract,abi,functionName:'getVoucher',args:[voucherId]});
 assert.equal(v1.status,1);
 assert.equal(v1.recipient.toLowerCase(),recipient.address.toLowerCase());
 await assertReject(pc.simulateContract({address:contract,abi,functionName:'claim',args:[1n],account:recipient.address}), 'recipient may not double-claim');
 log('recipient issue one real persisted voucher, no duplicate claim',{voucherId});

 const block=await pc.getBlock();
 const deadline=block.timestamp+110n;
 const digest=await pc.readContract({address:contract,abi,functionName:'credentialDigest',args:[voucherId,deadline]});
 const wrong=await attacker.signMessage({message:{raw:digest}});
 await assertReject(pc.simulateContract({address:contract,abi,functionName:'reserve',args:[voucherId,deadline,wrong],account:merchant.address}), 'foreign signer must not reserve');
 const permit=await recipient.signMessage({message:{raw:digest}});
 await assertReject(pc.simulateContract({address:contract,abi,functionName:'reserve',args:[voucherId,deadline,permit],account:attacker.address}), 'another merchant cannot reserve');
 await put(merchant,'reserve',[voucherId,deadline,permit],contract);
 const v2=await pc.readContract({address:contract,abi,functionName:'getVoucher',args:[voucherId]});
 assert.equal(v2.status,2);
 await assertReject(pc.simulateContract({address:contract,abi,functionName:'reserve',args:[voucherId,deadline,permit],account:merchant.address}), 'QR reuse must revert');
 log('real wallet EIP191 signed 120-second voucher, merchant lock and negative permissions');

 await assertReject(pc.simulateContract({address:contract,abi,functionName:'confirmHandover',args:[voucherId],account:attacker.address}), 'non-owner handover must revert');
 await put(merchant,'confirmHandover',[voucherId],contract);
 const v3=await pc.readContract({address:contract,abi,functionName:'getVoucher',args:[voucherId]});
 assert.equal(v3.status,3);
 await assertReject(pc.simulateContract({address:contract,abi,functionName:'settle',args:[voucherId],account:merchant.address}), 'settle must respect block time delay');
 await client.increaseTime({seconds:32});
 await client.mine({blocks:1});
 const originalMerchantBalance=await eoaTokenBalance();
 await put(merchant,'settle',[voucherId],contract);
 const final=await pc.readContract({address:contract,abi,functionName:'getVoucher',args:[voucherId]});
 assert.equal(final.status,4);
 const paidMerchantBalance=await eoaTokenBalance();
 assert.equal(paidMerchantBalance-originalMerchantBalance,parseUnits('5',6));
 const lastKitchen=await pc.readContract({address:contract,abi,functionName:'getKitchen',args:[1n]});
 assert.equal(lastKitchen.settled,1n);
 assert.equal(lastKitchen.totalPaid,parseUnits('5',6));
 assert.equal(lastKitchen.handedOver,0n);
 assert.equal(await pc.readContract({address:token,abi:tokenAbi,functionName:'balanceOf',args:[contract]}),0n);
 await assertReject(pc.simulateContract({address:contract,abi,functionName:'settle',args:[voucherId],account:merchant.address}), 'settled voucher cannot be paid again');
 log('merchant handover, 30s delay, final settlement and token delta; no double pay');
 console.log(JSON.stringify({status:'PILOT_REAL_EVM_E2E_PASS',chainId:await pc.getChainId(),accounts:4,transactions:7,contract,token,finalVoucherStatus:Number(final.status)}));
}
try{await main()}catch(e){console.error('PILOT_REAL_EVM_E2E_FAIL:',e?.shortMessage||e?.message||e);process.exitCode=1;}
finally{if(node){node.kill('SIGTERM');await sleep(250).catch(()=>{});if(node.exitCode===null)node.kill('SIGKILL');}}
