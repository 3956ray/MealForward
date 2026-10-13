// Pure catalog encoding. No provider, signer, grant or deployment mutation.
import {encodeAbiParameters,encodeFunctionData,keccak256,stringToHex} from 'viem';
import {trustedBinding,jsonValue} from './index.mjs';
import {catalogAbi} from './catalog-abi.mjs';
export {catalogAbi};
const abi=name=>catalogAbi.find(x=>x.type==='function'&&x.name===name);
const word=x=>{if(typeof x!=='string'||!/^0x[0-9a-f]{64}$/.test(x)||BigInt(x)===0n)throw Error('INVALID_WORD');return x;};
const uint=(x,max=(1n<<256n)-1n)=>{if(typeof x!=='string'||! /^(0|[1-9][0-9]*)$/.test(x)||BigInt(x)>max)throw Error('INVALID_INTEGER');return BigInt(x);};
const exact=(x,keys)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join()!==[...keys].sort().join())throw Error('INVALID_FIELDS');};
export function validateTerms(input){
  const fields=abi('publish').inputs[2].components;
  exact(input,fields.map(x=>x.name));
  const t=Object.fromEntries(fields.map(f=>[f.name,f.type==='bytes32'?word(input[f.name]):uint(input[f.name],(1n<<BigInt(f.type.slice(4)))-1n)]));
  if(!t.version||!t.unitPrice||![1n,2n].includes(t.windowCount)||t.startMinute0>=t.endMinute0||t.endMinute0>1440n
    ||t.windowCount===1n&&(t.startMinute1!==0n||t.endMinute1!==0n)
    ||t.windowCount===2n&&(t.startMinute1<t.endMinute0||t.startMinute1>=t.endMinute1||t.endMinute1>1440n))throw Error('INVALID_TERMS');
  return t;
}
export function catalogTermsHash({binding,input}){
  const b=trustedBinding(binding),t=validateTerms(input);
  const schema='MealForwardTerms(uint256 schemaVersion,uint256 chainId,address escrow,bytes32 storeId,bytes32 mealId,uint256 version,address asset,uint256 unitPrice,bytes32 bodyDigest,bytes32 imageDigest,uint8 windowCount,uint16 startMinute0,uint16 endMinute0,uint16 startMinute1,uint16 endMinute1,uint16 utcOffsetMinutes)';
  const types=['bytes32','uint256','uint256','address','bytes32','bytes32','uint256','address','uint256','bytes32','bytes32','uint8','uint16','uint16','uint16','uint16','uint16'];
  const values=[keccak256(stringToHex(schema)),1n,BigInt(b.chainId),b.escrow,b.storeId,t.mealId,t.version,b.asset,t.unitPrice,t.bodyDigest,t.imageDigest,t.windowCount,t.startMinute0,t.endMinute0,t.startMinute1,t.endMinute1,480];
  return {termsHash:keccak256(encodeAbiParameters(types.map(type=>({type})),values))};
}
export function prepareCatalog(functionName,{binding,caller,parameters}){
  const b=trustedBinding(binding),fn=abi(functionName);
  if(!['publish','setListed'].includes(functionName)||caller!==b.catalogAuthority)throw Error('CATALOG_ROLE_REQUIRED');
  exact(parameters,fn.inputs.map(x=>x.name));
  const args=[word(parameters.opId),uint(parameters.expectedControlRevision)];
  if(functionName==='publish')args.push(validateTerms(parameters.input));
  else {if(typeof parameters.value!=='boolean')throw Error('INVALID_LISTED');args.push(word(parameters.mealId),parameters.value);}
  const kind=functionName==='publish'?1:2;
  const parametersHash=keccak256(encodeAbiParameters(fn.inputs.slice(1),args.slice(1)));
  const paramsDigest=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'address'},...abi('operationPayloadHash').inputs],
    [keccak256(stringToHex('MealForwardOperationV1')),1n,BigInt(b.chainId),b.escrow,kind,caller,args[0],parametersHash]));
  const data=encodeFunctionData({abi:catalogAbi,functionName,args});
  return {chainId:b.chainId,from:caller,to:b.escrow,value:'0',data,callDataDigest:keccak256(data),opId:args[0],parametersHash,paramsDigest,
    functionName,expectedRole:'catalogAuthority',args:jsonValue(args),authority:'PREPARATION_ONLY'};
}
export const preparePublish=q=>prepareCatalog('publish',q);
export const prepareSetListed=q=>prepareCatalog('setListed',q);
