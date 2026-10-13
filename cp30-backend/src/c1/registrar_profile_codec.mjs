// Fixed private factory profile reader/validator. No provider or caller ABI.
import {readFileSync} from 'node:fs';
import {encodeFunctionData,decodeFunctionResult,parseAbi,keccak256} from 'viem';
import {verifyRuntimeTemplate,runtimeTemplates} from '../../integrations/wallet/registration-observer.mjs';
const fields=['asset','registrar','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority','escrowCreationCodeHash'];
const abi=parseAbi([...fields.map(name=>`function ${name}() view returns (${name==='escrowCreationCodeHash'?'bytes32':'address'})`),'function storeCount() view returns (uint256)']);
try {
  const input=JSON.parse(readFileSync(0));
  if(input.op==='calls')process.stdout.write(JSON.stringify({calls:Object.fromEntries([...fields,'storeCount'].map(name=>[name,encodeFunctionData({abi,functionName:name})]))}));
  else if(input.op==='verify'){
    verifyRuntimeTemplate(input.code,'factory',input.profile.runtimeTemplatePins.factory);
    if(keccak256(input.code)!==input.profile.factoryCodeHash)throw Error();
    if(input.profile.runtimeTemplatePins.factory!==runtimeTemplates.factory.templateHash)throw Error();
    for(const field of fields){const value=decodeFunctionResult({abi,functionName:field,data:input.values[field]});if(String(value).toLowerCase()!==String(input.profile[field]).toLowerCase())throw Error();}
    const count=decodeFunctionResult({abi,functionName:'storeCount',data:input.values.storeCount});if(count>3n)throw Error();
    process.stdout.write(JSON.stringify({verified:true,count:Number(count)}));
  }else throw Error();
}catch{process.stdout.write('{"error":"FACTORY_PROFILE_REJECTED"}');process.exitCode=1;}
