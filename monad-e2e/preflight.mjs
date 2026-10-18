#!/usr/bin/env node
/**
 * MealForward NEW, independent Monad Testnet preflight.
 * READ-ONLY. Never imports wallet keys, sends tx, deploys, touches CP30,
 * or treats historical contract artifacts as a deployed contract address.
 */
import assert from 'node:assert/strict';

const RPC='https://testnet-rpc.monad.xyz';
const CHAIN=10143n;
const ERC20_DECIMALS='0x313ce567';
const ERC20_SYMBOL='0x95d89b41';
const ERC20_TOTAL_SUPPLY='0x18160ddd';
const address=/^0x[0-9a-fA-F]{40}$/;
const x64=/^0x[0-9a-fA-F]{64}$/;
async function rpc(method,params=[]){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),11000);
 try{
  const res=await fetch(RPC,{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
   signal:controller.signal
  });
  assert.equal(res.ok,true,'RPC_HTTP_UNAVAILABLE');
  const data=await res.json();
  assert.equal(data.jsonrpc,'2.0');
  assert.equal(data.error,undefined,method+' returned RPC error');
  return data.result;
 }finally{clearTimeout(timer)}
}
function decodeString(hex){
 if(!/^0x[0-9a-fA-F]+$/.test(hex))return '';
 try{
  const bytes=Buffer.from(hex.slice(2),'hex');
  if(bytes.length<96)return Buffer.from(bytes).toString('utf8').replace(/\0/g,'').trim();
  const offset=Number(BigInt('0x'+bytes.subarray(0,32).toString('hex')));
  if(offset>bytes.length-32)return '';
  const length=Number(BigInt('0x'+bytes.subarray(offset,offset+32).toString('hex')));
  if(length>80||offset+32+length>bytes.length)return '';
  return bytes.subarray(offset+32,offset+32+length).toString('utf8');
 }catch{return ''}
}
async function main(){
 const chain=await rpc('eth_chainId');
 assert.equal(BigInt(chain),CHAIN,'WRONG_CHAIN_STOP');
 const block=await rpc('eth_blockNumber');
 assert.ok(typeof block==='string'&&BigInt(block)>0n);
 const wallet=process.env.MF_E2E_TEST_WALLET;
 const token=process.env.MF_E2E_TEST_USDC;
 const out={gate:'READ_ONLY_MONAD_TESTNET',chainId:Number(CHAIN),
  rpc:RPC,block:BigInt(block).toString(),writes:0,
  walletChecked:false,tokenChecked:false,deployAllowed:false,
  originalCp30Touched:false};
 if(wallet){
  assert.ok(address.test(wallet),'WALLET_ADDRESS_INVALID');
  out.walletChecked=true;
  out.gasWei=BigInt(await rpc('eth_getBalance',[wallet,'latest'])).toString();
 }
 if(token){
  assert.ok(address.test(token),'USDC_ADDRESS_INVALID');
  const code=await rpc('eth_getCode',[token,'latest']);
  assert.ok(code&&code!=='0x'&&code.length>10,'TOKEN_CONTRACT_NOT_DEPLOYED');
  const dec=await rpc('eth_call',[{to:token,data:ERC20_DECIMALS},'latest']);
  assert.ok(x64.test(dec));
  const decimals=Number(BigInt(dec));
  assert.equal(decimals,6,'MUST_BE_REVIEWED_SIX_DECIMAL_TEST_USDC');
  const supply=await rpc('eth_call',[{to:token,data:ERC20_TOTAL_SUPPLY},'latest']);
  assert.ok(x64.test(supply));
  const symbol=decodeString(await rpc('eth_call',[{to:token,data:ERC20_SYMBOL},'latest']));
  assert.equal(symbol,'USDC','TOKEN_SYMBOL_MISMATCH');
  out.tokenChecked=true;out.tokenAddress=token;
  out.asset={symbol,decimals};
  if(wallet){
   const padded=wallet.slice(2).toLowerCase().padStart(64,'0');
   const result=await rpc('eth_call',[{to:token,data:'0x70a08231'+padded},'latest']);
   assert.ok(x64.test(result));
   out.tokenBaseUnits=BigInt(result).toString();
  }
 }
 process.stdout.write(JSON.stringify(out)+'\n');
}
main().catch(err=>{
 process.stderr.write('MONAD_READ_ONLY_PREFLIGHT_BLOCKED: '+String(err.message).slice(0,110)+'\n');
 process.exitCode=1;
});
