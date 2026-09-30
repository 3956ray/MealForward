import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createWalletClient, http, type Hex, type Address } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import type { OwnerDeployment } from '../src/wallet/owner-controller.ts'
import type { Provider } from '../src/wallet/controller.ts'
export async function startOwnerFixture(fullHttp = false) {
 const python=process.env.OWNER_TEST_PYTHON ?? '.venv/bin/python'
 const child=spawn(python,['owner-wallet-harness/test-server.py'],{stdio:['ignore','pipe','pipe'],env:{...process.env,OWNER_TEST_FULL_HTTP:fullHttp?'1':'0'}})
 let errors='';child.stderr.on('data',chunk=>{errors+=String(chunk)})
 const lines=createInterface({input:child.stdout})
 const info=await new Promise<{origin:string;rpcUrl:string;redemptionId:string;intentKey:string;code?:string;voucherId?:string;deployment:OwnerDeployment}>((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Owned fixture startup timeout '+errors))},30000)
  child.on('exit',()=>{clearTimeout(timer);reject(new Error('Owned fixture stopped '+errors))})
  lines.on('line',line=>{if(line.startsWith('{')){clearTimeout(timer);resolve(JSON.parse(line))}})
 })
 async function stop(){if(child.exitCode!==null)return;child.kill('SIGTERM');await new Promise<void>(r=>child.once('exit',()=>r()));lines.close()}
 return {info,stop}
}
export function controlledOwnerProvider(rpcUrl:string){
 // Disposable default Anvil wallet in the external test driver only.
 const account=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:5})
 const wallet=createWalletClient({account,chain:foundry,transport:http(rpcUrl)})
 let sends=0,signs=0,loseHash=false
 async function rpc(method:string,params:unknown[]=[]){const r=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();if(j.error)throw new Error(j.error.message);return j.result}
 const provider:Provider={on(){},removeListener(){},async request({method,params=[]}){
  if(method==='eth_requestAccounts'||method==='eth_accounts')return [account.address]
  if(method==='personal_sign'){signs++;assert.equal(String(params[1]).toLowerCase(),account.address.toLowerCase());return account.signMessage({message:{raw:params[0] as Hex}})}
  if(method==='eth_sendTransaction'){
   sends++;const tx=params[0] as {from:string;to:Address;data:Hex;value:string;chainId:string}
   assert.equal(tx.from.toLowerCase(),account.address.toLowerCase());assert.equal(BigInt(tx.chainId),31337n);assert.equal(BigInt(tx.value),0n)
   const hash=await wallet.sendTransaction({to:tx.to,data:tx.data,value:0n});if(loseHash)throw new Error('Injected response loss after actual broadcast');return hash
  }
  return rpc(method,params)
 }}
 return {provider,rpc,counts:()=>({sends,signs}),dropHash:()=>{loseHash=true}}
}
