import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
const root=process.cwd();
const contractPath='contracts/MealForwardPilot.sol';
const input={
  language:'Solidity',
  sources:{[contractPath]:{content:fs.readFileSync(contractPath,'utf8')}},
  settings:{
    optimizer:{enabled:true,runs:200},
    evmVersion:'cancun',
    outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}
  }
};
const imports=p=>{
 try{
  if(p.includes('..')||path.isAbsolute(p))throw Error('Unsafe import path');
  const file=path.join(root,'node_modules',p);
  return {contents:fs.readFileSync(file,'utf8')};
 }catch{return {error:'Reviewed dependency not found: '+p}}
};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:imports}));
for(const issue of output.errors??[]){
 if(issue.severity==='error')throw Error(issue.formattedMessage);
 if(issue.severity==='warning')console.warn(issue.formattedMessage);
}
const items=output.contracts?.[contractPath];
if(!items?.MealForwardPilot||!items?.PilotMealCredit)throw Error('Missing pilot contract artifacts');
const artifacts={};
for(const name of ['MealForwardPilot','PilotMealCredit']){
 const o=items[name];
 const bytecode='0x'+o.evm.bytecode.object;
 const runtime='0x'+o.evm.deployedBytecode.object;
 if(bytecode.length<100||bytecode.length>95000)throw Error('Unexpected pilot bytecode size: '+name);
 if(runtime.length<100||runtime.length>49000)throw Error('Unexpected deployed bytecode size: '+name);
 artifacts[name]={abi:o.abi,bytecode,runtimeSize:(runtime.length-2)/2};
}
fs.mkdirSync('src',{recursive:true});
fs.writeFileSync('src/contract.generated.json',JSON.stringify(artifacts,null,2)+'\n');
console.log(JSON.stringify({status:'PILOT_SOLC_COMPILED',solc:solc.version(),contracts:Object.fromEntries(Object.entries(artifacts).map(([k,v])=>[k,{deployBytes:(v.bytecode.length-2)/2,runtimeBytes:v.runtimeSize,abiEntries:v.abi.length}]))}));
