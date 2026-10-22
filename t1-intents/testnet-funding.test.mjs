import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Wallet,TypedDataEncoder,verifyTypedData} from 'ethers';
import {TypedDataUtils,SignTypedDataVersion} from '@metamask/eth-sig-util';
import {QUOTE,ESCROW,MEAL,TERMS,PRICE,signatureDomain,quoteTypes} from './core.mjs';
import {assertRealT0IsOpen,proveFundingQuoteDigest,T0_RUNTIME_SHA256} from './testnet-funding-chain.mjs';
const fakeQuote=(payer)=>({
 quoteId:'0x'+'1'.repeat(64),payer,mealId:MEAL,currentVersion:'1',
 termsHash:TERMS,quantity:'1',unitPrice:PRICE.toString(),
 amount:PRICE.toString(),deadline:'1999999999'
});
const mmDomain=[
 {name:'name',type:'string'},{name:'version',type:'string'},
 {name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}
];
test('REAL FundingQuote EIP712 MetaMask V4 digest equals ethers original immutable StoreEscrow digest',()=>{
 const account=Wallet.createRandom();
 const original=fakeQuote(account.address);
 const payload={
  types:{EIP712Domain:mmDomain,FundingQuote:quoteTypes.FundingQuote},
  primaryType:'FundingQuote',domain:signatureDomain,message:original
 };
 const mmDigest='0x'+Buffer.from(TypedDataUtils.eip712Hash(payload,SignTypedDataVersion.V4)).toString('hex');
 const ethersDigest=TypedDataEncoder.hash(signatureDomain,quoteTypes,original);
 assert.equal(mmDigest,ethersDigest);
 const broken={...payload,types:{FundingQuote:quoteTypes.FundingQuote}};
 assert.notEqual('0x'+Buffer.from(TypedDataUtils.eip712Hash(broken,SignTypedDataVersion.V4)).toString('hex'),ethersDigest);
});
test('funding UI must include explicit EIP712Domain and only fixed chain/account/amount',()=>{
 const page=readFileSync(new URL('./public/fund-testnet.mjs',import.meta.url),'utf8');
 assert.match(page,/eth_signTypedData_v4/);
 assert.match(page,/EIP712Domain:EIP_DOMAIN/);
 assert.match(page,/eth_sendTransaction/);
 assert.match(page,/AMOUNT=7000000n,CHAIN=10143n/);
 assert.match(page,/accountsChanged/);
 assert.match(page,/mustNotRetryOriginalOperation/);
 assert.ok(!page.includes('localStorage'));
 assert.ok(!page.includes('eth_sendRawTransaction'));
 assert.ok(!page.includes('privateKeyToAccount'));
 assert.ok(!page.includes('TESTNET_PRIVATE_KEY'));
});
test('malicious or wrong-network public RPC chain state cannot authorize 7 USDC operation',async()=>{
 const bad={send:async(name)=>{
  if(name==='eth_chainId')return '0x1';
  throw Error('UNAUTHORIZED_METHOD');
 }};
 await assert.rejects(()=>assertRealT0IsOpen({rpc:bad,payer:QUOTE}),/T1D_WRONG_MONAD_CHAIN/);
 assert.match(T0_RUNTIME_SHA256,/^[0-9a-f]{64}$/);
});
test('local original quote digest agrees with onchain bytes32 digest at identical quote shape',async()=>{
 const account=Wallet.createRandom();
 const q=fakeQuote(account.address);
 const offline=TypedDataEncoder.hash(signatureDomain,quoteTypes,q);
 const contractABI=(await import('./testnet-funding-chain.mjs')).escrowRead;
 const rpc={async send(method,params){
  if(method==='eth_blockNumber')return '0x100';
  if(method==='eth_call'&&params[0].to.toLowerCase()===ESCROW){
   const name=contractABI.parseTransaction({data:params[0].data})?.name;
   assert.equal(name,'quoteDigest');
   return contractABI.encodeFunctionResult('quoteDigest',[offline]);
  }
  throw Error('MOCK_UNEXPECTED_RPC');
 }};
 const proof=await proveFundingQuoteDigest({rpc,quote:q});
 assert.equal(proof.onchainDigest.toLowerCase(),offline.toLowerCase());
});
test('a signed real FundingQuote stays payer/QuoteId/amount bound, not the harmless T1-B signature domain',async()=>{
 const w=Wallet.createRandom(),q=fakeQuote(w.address);
 const sig=await w.signTypedData(signatureDomain,quoteTypes,q);
 assert.equal(verifyTypedData(signatureDomain,quoteTypes,q,sig).toLowerCase(),w.address.toLowerCase());
 const changed={...q,amount:'14000000'};
 assert.notEqual(verifyTypedData(signatureDomain,quoteTypes,changed,sig).toLowerCase(),w.address.toLowerCase());
});
