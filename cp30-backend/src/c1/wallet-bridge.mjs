// Fixed offline JSON boundary; no provider, account client, network or signer.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {getAddress,keccak256,encodeAbiParameters,stringToHex} from 'viem';
import {prepareApprove,prepareFund,prepareSettle,decodeRegistrationEvent,
  registrationConfigHash,prepareRegistrationTypedData,registrationDigest,
  matchOriginalTransaction,compiledStoreEscrowCreationCodeHash} from '../../integrations/wallet/index.mjs';

import {businessEscrowAbi} from '../../integrations/business/escrow-abi.mjs';
const same=(a,b)=>getAddress(a)===getAddress(b);
const normalize=value=>JSON.parse(JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item));
const equal=(a,b)=>JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
const fail=()=>{throw Error('ORIGINAL_EVIDENCE_MISMATCH');};
export function prepareWallet(material,now){
  const wallet={chainId:material.binding.chainId,account:material.expectedAccount};
  if(material.kind==='fund')return {kind:'fund',transactions:[
    prepareApprove({binding:material.binding,wallet,payer:material.signedQuote.quote.payer,amount:material.signedQuote.quote.amount}),
    prepareFund({binding:material.binding,wallet,signedQuote:material.signedQuote,now})]};
  if(material.kind==='settle')return {kind:'settle',transactions:[
    prepareSettle({binding:material.binding,wallet,...material.operation})]};
  fail();
}
export function bridge(request){
  if(request.op==='prepareWallet'){
    const result=normalize(prepareWallet(request.material,request.now));
    for(const tx of result.transactions){
      tx.from=tx.from.toLowerCase();tx.to=tx.to.toLowerCase();tx.data=tx.data.toLowerCase();tx.callDataDigest=keccak256(tx.data);
      if(tx.functionName==='settle'){
        const abi=businessEscrowAbi.find(x=>x.name==='settle');
        const inputs=businessEscrowAbi.find(x=>x.name==='operationPayloadHash').inputs;
        const parametersHash=keccak256(encodeAbiParameters(abi.inputs.slice(1),tx.args.slice(1)));
        tx.paramsDigest=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'address'},...inputs],[keccak256(stringToHex('MealForwardOperationV1')),1n,BigInt(tx.chainId),tx.to,9,tx.from,tx.args[0],parametersHash]));
      }
    }
    return result;
  }
  fail();
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  try{const raw=readFileSync(0);if(raw.length>1048576)fail();const result=normalize(bridge(JSON.parse(raw)));process.stdout.write(JSON.stringify(result));}
  catch{process.stdout.write('{"error":"OFFLINE_BRIDGE_REJECTED"}');process.exitCode=1;}
}
