/**
 * T1-D: REAL PUBLIC MONAD TESTNET READ-ONLY preflight.
 * There is no wallet, signer, private RPC secret or eth_sendTransaction.
 * Exact original T0 deployed runtime/asset/quote authority/menu is pinned.
 */
import {createHash} from 'node:crypto';
import {Interface} from 'ethers';
import {
 CHAIN,ESCROW,TOKEN,MEAL,TERMS,QUOTE,PRICE,
 quoteTypes,signatureDomain
} from './core.mjs';

export const T0_RUNTIME_SHA256='31417d9cdf4bd883f5a07d717cfeee368758f23190dc6d2ec41b30c3d676c6c8';
const strict=(ok,reason)=>{if(!ok)throw Error(reason)};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export const escrowRead=new Interface([
 'function asset() view returns (address)',
 'function quoteAuthority() view returns (address)',
 'function currentVersion(bytes32) view returns (uint256)',
 'function listed(bytes32) view returns (bool)',
 'function paused() view returns (bool)',
 'function closed() view returns (bool)',
 'function lifetimeFundedUnits() view returns (uint256)',
 'function catalog(bytes32,uint256) view returns (uint256 unitPrice,bytes32 termsHash)',
 'function quoteDigest((bytes32 quoteId,address payer,bytes32 mealId,uint256 currentVersion,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 deadline)) view returns (bytes32)'
]);
export const erc20Read=new Interface([
 'function balanceOf(address) view returns (uint256)',
 'function allowance(address,address) view returns (uint256)'
]);
// ethers Interface.decodeFunctionResult('catalog') returns a flat Result:
// [unitPrice, termsHash]. The values are not nested tuples.
export function assertPinnedCatalog(result){
 strict(result?.length===2&&result[0]===PRICE&&same(result[1],TERMS),
  'T1D_UNEXPECTED_MEAL_PRICE_OR_TERMS');
 return {unitPrice:result[0],termsHash:result[1]};
}
function hashCode(raw){
 strict(typeof raw==='string'&&/^0x[0-9a-f]*$/i.test(raw)&&raw.length>100,
  'T0_ESCROW_RUNTIME_UNAVAILABLE');
 return createHash('sha256').update(Buffer.from(raw.slice(2),'hex')).digest('hex');
}
async function readAt(rpc,to,abi,fn,args,blockTag){
 const encoded=abi.encodeFunctionData(fn,args);
 const raw=await rpc.send('eth_call',[{to,data:encoded},blockTag]);
 strict(typeof raw==='string'&&/^0x[0-9a-f]+$/i.test(raw),
  'T1D_INVALID_PUBLIC_RPC_RESULT');
 return abi.decodeFunctionResult(fn,raw);
}
const toHex=x=>'0x'+BigInt(x).toString(16);
export async function assertRealT0IsOpen({rpc,payer=null}={}){
 strict(rpc&&typeof rpc.send==='function','T1D_PINNED_READONLY_RPC_REQUIRED');
 const chain=await rpc.send('eth_chainId',[]);
 strict(BigInt(chain)===BigInt(CHAIN),'T1D_WRONG_MONAD_CHAIN');
 const height=await rpc.send('eth_blockNumber',[]);
 const block=await rpc.send('eth_getBlockByNumber',[height,false]);
 strict(block?.hash&&/^0x[0-9a-f]{64}$/i.test(block.hash),
  'T1D_UNTRUSTED_CHAIN_BLOCK');
 const code=await rpc.send('eth_getCode',[ESCROW,height]);
 strict(hashCode(code)===T0_RUNTIME_SHA256,
  'T1D_UNREVIEWED_T0_ESCROW_BYTECODE');
 const calls=[
  ['asset',[]],['quoteAuthority',[]],['currentVersion',[MEAL]],
  ['listed',[MEAL]],['paused',[]],['closed',[]],
  ['lifetimeFundedUnits',[]],['catalog',[MEAL,1]]
 ];
 const values={};
 for(const [method,args] of calls)
  values[method]=await readAt(rpc,ESCROW,escrowRead,method,args,height);
 strict(same(values.asset[0],TOKEN),'T1D_WRONG_ERC20_ASSET');
 strict(same(values.quoteAuthority[0],QUOTE),'T1D_WRONG_QUOTE_AUTHORITY');
 strict(values.currentVersion[0]===1n,'T1D_MEAL_VERSION_CHANGED');
 strict(values.listed[0]===true&&values.paused[0]===false&&values.closed[0]===false,
  'T1D_ESCROW_NOT_OPERATING');
 strict(values.lifetimeFundedUnits[0]<10n,'T1D_LIFETIME_CAP_EXHAUSTED');
 assertPinnedCatalog(values.catalog);
 let assets=null;
 if(payer!==null){
  strict(same(payer,QUOTE),'T1D_ONLY_VERIFIED_QUOTE_WALLET_FOR_FIRST_TEST');
  const [balance]=await readAt(rpc,TOKEN,erc20Read,'balanceOf',[payer],height);
  const [allowance]=await readAt(rpc,TOKEN,erc20Read,'allowance',[payer,ESCROW],height);
  assets={balance:balance.toString(),allowance:allowance.toString()};
 }
 const last=await rpc.send('eth_getBlockByNumber',[height,false]);
 strict(same(last?.hash,block.hash),'T1D_BLOCK_REORG_DURING_READ');
 return Object.freeze({
  chainId:CHAIN,contract:ESCROW,token:TOKEN,payer:QUOTE,
  mealId:MEAL,termsHash:TERMS,unitPrice:PRICE.toString(),
  unitsFunded:values.lifetimeFundedUnits[0].toString(),
  remainingUnits:(10n-values.lifetimeFundedUnits[0]).toString(),
  blockNumber:BigInt(height).toString(),
  blockHash:block.hash,assets,
  quoteAuthority:QUOTE,
  testnetOnly:true,amountForOne:PRICE.toString(),
  canSignAndFundTestnet:true
 });
}
export async function proveFundingQuoteDigest({rpc,quote}={}){
 const tag=await rpc.send('eth_blockNumber',[]);
 const [onchain]=await readAt(rpc,ESCROW,escrowRead,'quoteDigest',[quote],tag);
 const {TypedDataEncoder}=await import('ethers');
 const offline=TypedDataEncoder.hash(signatureDomain,quoteTypes,quote);
 strict(same(onchain,offline),'T1D_ONCHAIN_FUNDING_QUOTE_EIP712_MISMATCH');
 return {onchainDigest:onchain,offlineDigest:offline};
}
