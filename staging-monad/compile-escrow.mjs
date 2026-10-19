/**
 * Reproducible, isolated, artifact-only compilation of the original CP30
 * StoreEscrow.sol, with NO wallet, RPC, signer, deploy, or network transaction.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import solc from 'solc';

const root=path.dirname(fileURLToPath(import.meta.url));
const original=path.resolve(root,'../cp30-contracts/contracts/StoreEscrow.sol');
const source=fs.readFileSync(original,'utf8');
const sourceDigest=crypto.createHash('sha256').update(source).digest('hex');
if(!solc.version().startsWith('0.8.28+'))throw Error('UNEXPECTED_SOLC_VERSION');
const remap='@openzeppelin/contracts/';
function findImports(location){
 if(typeof location!=='string'||!location.startsWith(remap)||location.includes('..'))
  return {error:'Non-whitelisted compiler import'};
 const relative=location.slice(remap.length);
 const candidate=path.join(root,'node_modules','@openzeppelin','contracts',relative);
 const canonical=path.resolve(candidate);
 const allowed=path.resolve(root,'node_modules','@openzeppelin','contracts')+path.sep;
 if(!canonical.startsWith(allowed))return{error:'Import escapes pinned OZ'};
 try{return{contents:fs.readFileSync(canonical,'utf8')}}catch{return{error:'Pinned OZ source missing'}}
}
const input={
 language:'Solidity',
 sources:{'StoreEscrow.sol':{content:source}},
 settings:{
  optimizer:{enabled:true,runs:200},
  evmVersion:'cancun',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}
 }
};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:findImports}));
const errors=output.errors?.filter(e=>e.severity==='error')||[];
if(errors.length)throw Error(errors.map(x=>x.formattedMessage).join('\n'));
const contract=output.contracts?.['StoreEscrow.sol']?.StoreEscrow;
if(!contract?.abi?.length||!contract?.evm?.bytecode?.object)throw Error('EMPTY_COMPILED_ESCROW');
const abi=contract.abi;
const names=abi.filter(x=>x.type==='function').map(x=>x.name);
for(const critical of ['asset','owner','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority',
 'fund','issue','lock','markHandover','report','settle','catalog','computeTermsHash']){
 if(!names.includes(critical))throw Error('REQUIRED_ABI_MISSING_'+critical);
}
const creationBytecodeSha256=crypto.createHash('sha256').update(Buffer.from(contract.evm.bytecode.object,'hex')).digest('hex');
const artifact={
 contractName:'StoreEscrow',chainId:10143,
 originalPath:'cp30-contracts/contracts/StoreEscrow.sol',
 compiler:solc.version(),optimizerRuns:200,evmVersion:'cancun',
 sourceSha256:sourceDigest,creationBytecodeSha256,
 bytecode:'0x'+contract.evm.bytecode.object,
 runtimeBytecode:'0x'+contract.evm.deployedBytecode.object,
 immutableReferences:contract.evm.deployedBytecode.immutableReferences||{},
 abi
};
const dir=path.join(root,'artifacts');fs.mkdirSync(dir,{recursive:true});
const outPath=path.join(dir,'StoreEscrow.json');
fs.writeFileSync(outPath,JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({
 status:'BUILD_ONLY_PASS',compiler:artifact.compiler,chainId:10143,
 sourceSha256:sourceDigest,creationBytecodeSha256,constructor:abi.find(x=>x.type==='constructor')?.inputs?.map(x=>x.name),
 bytecodeBytes:contract.evm.bytecode.object.length/2,
 deployedBytecodeBytes:contract.evm.deployedBytecode.object.length/2,
 artifact:'staging-monad/artifacts/StoreEscrow.json',
 walletTransactionSent:false,oldCP30Touched:false
}));
