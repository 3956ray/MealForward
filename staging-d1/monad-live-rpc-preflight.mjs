import assert from 'node:assert/strict';
const ENDPOINT='https://testnet-rpc.monad.xyz';
const CHAIN=10143;
const USDC='0x534b2f3A21130d7a60830c2Df862319e593943A3';
const METHODS=new Set(['eth_chainId','eth_blockNumber','eth_getCode','eth_call']);
let count=0;
async function rpc(method,params=[]){
 assert.ok(METHODS.has(method),'read-only RPC allowlist');
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const result=await fetch(ENDPOINT,{method:'POST',
   headers:{'Content-Type':'application/json','Accept':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:++count,method,params}),
   redirect:'error',signal:controller.signal});
  assert.equal(result.ok,true,'RPC_HTTP_'+result.status);
  const json=await result.json();
  assert.equal(json.jsonrpc,'2.0');
  assert.equal(json.error,undefined,'RPC_JSON_ERROR');
  assert.match(json.result,/^0x[0-9a-fA-F]+$/);
  return json.result;
 }finally{clearTimeout(timeout)}
}
const chain=Number(BigInt(await rpc('eth_chainId')));
assert.equal(chain,CHAIN,'NEVER run testnet work on mainnet');
const block=Number(BigInt(await rpc('eth_blockNumber')));
assert.ok(block>0&&Number.isSafeInteger(block));
const code=await rpc('eth_getCode',[USDC,'latest']);
assert.ok(code.length>4,'Circle test USDC must contain contract code');
const decimals=Number(BigInt(await rpc('eth_call',[{to:USDC,data:'0x313ce567'},'latest'])));
assert.equal(decimals,6,'USDC decimals must be exactly 6');
console.log(JSON.stringify({
 status:'PASS',mode:'MONAD_TESTNET_READ_ONLY',chainId:chain,blockNumber:block,
 usdcAddress:USDC,usdcDecimals:decimals,codeExists:true,
 walletTransactionSent:false,signaturesRequested:false,
 oldCp30RuntimeTouched:false
}));
