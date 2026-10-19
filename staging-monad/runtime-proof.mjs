import {createHash} from 'node:crypto';

export const TESTNET_CHAIN_ID=10143;
export const CIRCLE_TEST_USDC='0x534b2f3A21130d7a60830c2Df862319e593943A3';
export const REVIEWED_SOURCE_SHA256='bd84f387a46428802a453f28306ad6f9de7317465ff48844619d550713ce0c66';
export const REVIEWED_CREATION_SHA256='9c2583ee25a9fc08aa2434efde455ee7fc0c945847d3ef7789dfd370735d7a8d';

const isHex=(x,n)=>typeof x==='string'&&new RegExp('^0x[0-9a-fA-F]{'+n+'}$').test(x);
const isAddress=x=>isHex(x,40)&&!/^0x0{40}$/i.test(x);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export const sha256Hex=bytes=>createHash('sha256').update(bytes).digest('hex');

function assert(condition,message){if(!condition)throw Error(message)}
export function validateManifest(m){
 assert(m&&typeof m==='object'&&!Array.isArray(m),'MANIFEST_REQUIRED');
 assert(m.mode==='single-wallet-smoke'||m.mode==='role-separated-e2e','MODE_NOT_EXPLICIT');
 assert(m.chainId===TESTNET_CHAIN_ID,'WRONG_CHAIN_STOP');
 assert(same(m.asset,CIRCLE_TEST_USDC),'UNKNOWN_TOKEN_STOP');
 for(const field of ['contract','deployer','owner','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority']){
  assert(isAddress(m[field]),'INVALID_ADDRESS_'+field);
 }
 for(const field of ['deploymentTx','storeId','mealId','bodyDigest','imageDigest']){
  assert(isHex(m[field],64)&&!/^0x0{64}$/i.test(m[field]),'INVALID_BYTES32_'+field);
 }
 assert(m.version===1,'MUST_USE_ISOLATED_VERSION_1');
 assert(m.unitPrice==='7000000','MUST_USE_REVIEWED_7_TEST_USDC');
 assert(Number.isInteger(m.minConfirmations)&&m.minConfirmations>=2&&m.minConfirmations<=100,'INVALID_CONFIRMATIONS');
 const parties=['owner','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority'].map(k=>m[k].toLowerCase());
 const separated=new Set(parties).size===parties.length;
 if(m.mode==='role-separated-e2e')assert(separated,'ROLE_SEPARATION_NOT_PROVEN');
 if(m.mode==='single-wallet-smoke')assert(new Set(parties).size===1&&same(m.deployer,m.owner),'SMOKE_MUST_USE_ONE_DISPOSABLE_WALLET');
 return {roleSeparationVerified:separated,mode:m.mode};
}

export function compareRuntime(compiled,deployed,immutableReferences={}){
 const format=/^0x(?:[0-9a-fA-F]{2})+$/;
 assert(format.test(compiled)&&format.test(deployed),'INVALID_RUNTIME_BYTECODE');
 const want=Buffer.from(compiled.slice(2),'hex'),got=Buffer.from(deployed.slice(2),'hex');
 assert(want.length===got.length,'RUNTIME_LENGTH_MISMATCH');
 assert(want.length<=24576,'RUNTIME_OVERSIZE_EIP170');
 const mask=new Uint8Array(want.length);
 assert(immutableReferences&&typeof immutableReferences==='object'&&!Array.isArray(immutableReferences),'INVALID_IMMUTABLE_REFS');
 for(const refs of Object.values(immutableReferences)){
  assert(Array.isArray(refs)&&refs.length,'INVALID_IMMUTABLE_LIST');
  for(const ref of refs){
   assert(Number.isInteger(ref.start)&&Number.isInteger(ref.length)&&ref.length>0,'INVALID_IMMUTABLE_RANGE');
   assert(ref.start>=0&&ref.start+ref.length<=want.length,'IMMUTABLE_OUT_OF_RANGE');
   for(let i=ref.start;i<ref.start+ref.length;i++){
    assert(!mask[i],'IMMUTABLE_OVERLAP');
    mask[i]=1;
   }
  }
 }
 for(let i=0;i<want.length;i++)if(!mask[i]&&want[i]!==got[i])
  throw Error('RUNTIME_MISMATCH_AT_BYTE_'+i);
 return {runtimeBytes:got.length,immutableBytes:mask.reduce((n,x)=>n+x,0),deployedRuntimeSha256:sha256Hex(got)};
}

export function wordAt(data,index){
 assert(/^0x(?:[0-9a-fA-F]{64})+$/.test(data),'INVALID_ABI_WORDS');
 assert(Number.isInteger(index)&&index>=0&&data.length>=2+(index+1)*64,'ABI_WORD_MISSING');
 return data.slice(2+index*64,2+(index+1)*64);
}
export function asUint(data,index=0){return BigInt('0x'+wordAt(data,index))}
export function asAddress(data,index=0){return '0x'+wordAt(data,index).slice(24)}
export function asBytes32(data,index=0){return '0x'+wordAt(data,index)}
export function equalHex(a,b){return same(a,b)}
