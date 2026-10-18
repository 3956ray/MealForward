import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import solc from 'solc';
import {keccak256} from 'ethers';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const src=['MealForwardMonadTestOnly.sol','LocalMockUSDC.sol'];
const sources=Object.fromEntries(src.map(file=>[file,{
 content:readFileSync(resolve(root,'contracts',file),'utf8')
}]));
if(!solc.version().startsWith('0.8.28+'))throw Error('SOLC_VERSION_NOT_PINNED: '+solc.version());
const input={language:'Solidity',sources,settings:{
 optimizer:{enabled:true,runs:200},evmVersion:'cancun',
 metadata:{bytecodeHash:'ipfs'},
 outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object',
 'evm.methodIdentifiers']}}
}};
const output=JSON.parse(solc.compile(JSON.stringify(input)));
const errors=output.errors||[];
for(const err of errors){if(err.severity==='error')console.error(err.formattedMessage)}
if(errors.some(e=>e.severity==='error'))throw Error('SOLIDITY_COMPILE_FAILED');
const select=(file,name)=>{
 const info=output.contracts[file][name];
 if(!info.evm.bytecode.object||!info.evm.deployedBytecode.object)throw Error('EMPTY_SOLC_OUTPUT');
 return {
  abi:info.abi,
  bytecode:'0x'+info.evm.bytecode.object,
  runtimeCode:'0x'+info.evm.deployedBytecode.object,
  runtimeCodeHash:keccak256('0x'+info.evm.deployedBytecode.object)
 };
};
const contract=select('MealForwardMonadTestOnly.sol','MealForwardMonadTestOnly');
const mock=select('LocalMockUSDC.sol','LocalMockUSDC');
const artifact={
 kind:'MEALFORWARD_MONAD_TESTNET_HARNESS_NON_PRODUCTION',
 chainId:10143,
 sourceSha256:Object.fromEntries(src.map(f=>[f,createHash('sha256').update(sources[f].content).digest('hex')])),
 compiler:solc.version(),evmVersion:'cancun',
 token:{address:'0x534b2f3A21130d7a60830c2Df862319e593943A3',decimals:6,symbol:'USDC',
   provenance:'Circle Monad Testnet USDC'},
 unitPrice:'7000000',maxLifetimeFunded:10,reportDelaySeconds:30,
 contract,localMockToken:mock
};
const json=JSON.stringify(artifact);
writeFileSync(resolve(root,'artifact.generated.json'),json+'\n','utf8');
if(process.env.MF_EMIT_COMPILED_ARTIFACT==='true')
 console.log('MEALFORWARD_COMPILED_ARTIFACT_JSON:'+json);
console.log(JSON.stringify({status:'COMPILED',chainId:10143,
 bytecodeBytes:(contract.bytecode.length-2)/2,
 runtimeBytes:(contract.runtimeCode.length-2)/2,
 runtimeCodeHash:contract.runtimeCodeHash,
 compiler:artifact.compiler}));
