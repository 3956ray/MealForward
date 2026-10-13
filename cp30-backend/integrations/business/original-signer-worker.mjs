// Future private authority EOA worker only. Agent checks must never execute this entry.
// Key bytes are a dedicated inherited FD, never argv/env/stdin/logs or journal contents.
import {readSync} from 'node:fs';
import {privateKeyToAccount} from 'viem/accounts';
import {prepareFundingQuote,attachFundingSignature,prepareIssue,prepareLock,prepareMarkHandover,prepareReport,jsonValue} from './index.mjs';
import {preparePublish,prepareSetListed} from './catalog.mjs';
import {prepare_original_envelope,inspect_signed_transaction} from './transaction-crypto.mjs';

const equal=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error();};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>equal(canonical(jsonValue(a)),canonical(jsonValue(b)));
const roles={publish:['catalogAuthority',preparePublish],setListed:['catalogAuthority',prepareSetListed],issue:['issuerAuthority',prepareIssue],lock:['operatorAuthority',prepareLock],markHandover:['operatorAuthority',prepareMarkHandover],report:['operatorAuthority',prepareReport]};
let secretBytes;
try {
 if(process.argv.length!==3||!/^(?:[3-9]|[1-9][0-9]+)$/.test(process.argv[2]))throw Error();
 const buffer=Buffer.alloc(8192),chunks=[];let n,total=0;
 while((n=readSync(0,buffer,0,buffer.length,null))!==0){total+=n;if(total>131072)throw Error();chunks.push(Buffer.from(buffer.subarray(0,n)));}
 const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(Object.keys(input).sort().join(',')!=='expected,mode,profile,record,role')throw Error();
 const {mode,profile,record,role}=input;
 if(!['quoteAuthority','issuerAuthority','operatorAuthority','catalogAuthority'].includes(role))throw Error();
 const binding=profile.binding,accountAddress=binding[role];
 if(accountAddress===binding.owner||accountAddress===binding.receiver||accountAddress===profile.registrar)throw Error();
 for(const field of ['namespace','binding','escrowCodeHash','chainProfileDigest'])same(record[field],profile[field]);
 let prepared,expected;
 if(mode==='quote'){
  if(role!=='quoteAuthority'||['operation','deployment','transaction'].some(k=>Object.hasOwn(record,k)))throw Error();
  prepared=prepareFundingQuote({binding,quote:record.quote,now:'0'});
  same(jsonValue(prepared.typedData),record.typedData);same(prepared.digest,record.digest);same(prepared.quote.quoteId,record.quoteId);same(jsonValue(prepared),input.expected);
 }else if(mode==='transaction'){
  const config=roles[record.operation];if(!config||config[0]!==role)throw Error();
  prepared=config[1]({binding,caller:accountAddress,parameters:record.parameters,now:'0'});
  same(jsonValue(prepared),record.deployment);same(prepared.opId,record.opId);
  const tx=record.transaction;
  if(Object.keys(tx).sort().join(',')!=='gas,maxFeePerGas,maxPriorityFeePerGas,nonce')throw Error();
  if(BigInt(tx.gas)>BigInt(profile.maxGas)||BigInt(tx.maxFeePerGas)>BigInt(profile.maxFeePerGas)||BigInt(tx.maxPriorityFeePerGas)>BigInt(profile.maxPriorityFeePerGas))throw Error();
  expected=prepare_original_envelope(record.deployment,{type:'eip1559',...tx,gasBudgetWei:profile.maxTransactionCostWei});
  same(expected,input.expected);
 }else throw Error();
 // Exact scope/preparation checks precede any read of the already-granted private FD.
 secretBytes=Buffer.alloc(68);let bytes=0,count;
 while((count=readSync(Number(process.argv[2]),secretBytes,bytes,68-bytes,null))!==0){bytes+=count;if(bytes===68)throw Error();}
 const secret=secretBytes.subarray(0,bytes).toString('utf8').trim();
 if(!/^0x[0-9a-fA-F]{64}$/.test(secret))throw Error();
 const account=privateKeyToAccount(secret);if(account.address.toLowerCase()!==accountAddress)throw Error();
 if(mode==='quote'){
  const signature=(await account.signTypedData(prepared.typedData)).toLowerCase();
  await attachFundingSignature({binding,quote:record.quote,signature,now:'0'});
  process.stdout.write(JSON.stringify({signature}));
 }else{
  const raw=(await account.signTransaction({type:'eip1559',chainId:expected.chainId,nonce:Number(expected.nonce),to:expected.to,value:0n,data:expected.data,
    gas:BigInt(expected.gas),maxFeePerGas:BigInt(expected.maxFeePerGas),maxPriorityFeePerGas:BigInt(expected.maxPriorityFeePerGas),accessList:[]})).toLowerCase();
  const inspected=await inspect_signed_transaction(raw,expected);
  process.stdout.write(JSON.stringify({raw,hash:inspected.hash}));
 }
}catch{process.stdout.write('{"error":"ORIGINAL_AUTHORITY_SIGNING_REJECTED"}');process.exitCode=1;}
finally{if(secretBytes)secretBytes.fill(0);}
