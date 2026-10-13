// Pure installed viem encoding only. No clients, providers, accounts or network.
import { readFileSync, readSync, fstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.on('uncaughtException', () => {process.stdout.write('{"error":"HASH_REJECTED"}\n');process.exit(1);});

const viem = fileURLToPath(new URL('../../node_modules/viem/', import.meta.url));
const metadata = JSON.parse(readFileSync(viem + 'package.json', 'utf8'));
if (metadata.name !== 'viem' || metadata.version !== '2.57.1') process.exit(1);
const { encodeAbiParameters } = await import(viem + '_esm/utils/abi/encodeAbiParameters.js');
const { keccak256 } = await import(viem + '_esm/utils/hash/keccak256.js');
const { stringToHex } = await import(viem + '_esm/utils/encoding/toHex.js');
const imageFd = process.argv.length === 3 && /^(?:[3-9]|[1-9][0-9]{1,5})$/.test(process.argv[2]) ? Number(process.argv[2]) : 3;
if (process.argv.length > 3 || process.argv.length === 3 && !/^(?:[3-9]|[1-9][0-9]{1,5})$/.test(process.argv[2])) process.exit(1);
const termsSchema = 'MealForwardTerms(uint256 schemaVersion,uint256 chainId,address escrow,bytes32 storeId,bytes32 mealId,uint256 version,address asset,uint256 unitPrice,bytes32 bodyDigest,bytes32 imageDigest,uint8 windowCount,uint16 startMinute0,uint16 endMinute0,uint16 startMinute1,uint16 endMinute1,uint16 utcOffsetMinutes)';
const termTypes = ['bytes32','uint256','uint256','address','bytes32','bytes32','uint256','address','uint256','bytes32','bytes32','uint8','uint16','uint16','uint16','uint16','uint16'];
const termFields = ['mealId','version','unitPrice','bodyDigest','imageDigest','windowCount','startMinute0','endMinute0','startMinute1','endMinute1'];
const termInputs = ['bytes32','uint256','uint256','bytes32','bytes32','uint8','uint16','uint16','uint16','uint16'];
const tuple = { type: 'tuple', components: termInputs.map((type, i) => ({type, name: termFields[i]})) };
const hash = (types, values) => keccak256(encodeAbiParameters(types.map(type => typeof type === 'string' ? {type} : type), values));
const h = text => keccak256(stringToHex(text));
function exact(object, keys) {
  if (!object || Array.isArray(object) || typeof object !== 'object' || Object.keys(object).sort().join(',') !== keys.slice().sort().join(',')) throw Error();
}
function number(value, bits=256) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw Error();
  const n = BigInt(value);
  if (n >= 1n << BigInt(bits)) throw Error();
  return n;
}
function small(value, bits) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= 2 ** bits) throw Error();
  return value;
}
function hex(value, bytes) {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${bytes*2}}$`).test(value)) throw Error();
  return value;
}
function typed(type, value) {
  if (typeof type === 'object') {
    if (!Array.isArray(value) || value.length !== 10) throw Error();
    return termInputs.map((t,i) => typed(t,value[i]));
  }
  if (type === 'bool') { if (typeof value !== 'boolean') throw Error(); return value; }
  if (type === 'address') return hex(value,20);
  if (type === 'bytes32') return hex(value,32);
  if (type === 'uint256') return number(value);
  return small(value,Number(type.slice(4)));
}
// Small strict JSON parser: reject duplicate keys, nonfinite/unsafe numbers,
// excessive nesting and control strings before processing any request.
function strictJson(text) {
  let i=0;
  const ws=()=>{while (/[ \t\r\n]/.test(text[i] || '') && i<text.length) i++;};
  function string() {
    const start=i++;
    while(i<text.length) {
      if(text[i]==='\\') {i+=2; continue;}
      if(text[i++]==='"') return JSON.parse(text.slice(start,i));
    }
    throw Error();
  }
  function value(depth=0) {
    if(depth>32) throw Error();
    ws();
    if(text[i]==='"') return string();
    if(text[i]==='{') {
      i++; ws(); const object=Object.create(null);
      if(text[i]==='}') {i++; return object;}
      for (;;) {
        if(text[i]!=='"') throw Error();
        const key=string(); if(Object.hasOwn(object,key)) throw Error();
        ws(); if(text[i++]!==':') throw Error();
        object[key]=value(depth+1); ws();
        const c=text[i++]; if(c==='}') return object; if(c!==',') throw Error(); ws();
      }
    }
    if(text[i]==='[') {
      i++; ws(); const array=[];
      if(text[i]===']') {i++; return array;}
      for (;;) {array.push(value(depth+1)); ws(); const c=text[i++]; if(c===']') return array; if(c!==',') throw Error();}
    }
    const token=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if(!token) throw Error(); i+=token[0].length;
    const result=JSON.parse(token[0]);
    if(typeof result==='number' && (!Number.isSafeInteger(result) || !Number.isFinite(result))) throw Error();
    return result;
  }
  const result=value(); ws(); if(i!==text.length) throw Error(); return result;
}

function execute(r) {
  if (r.op === 'content') {
    exact(r,['op','length','name','description','escrow','storeId','asset',...termFields.filter(k=>!['bodyDigest','imageDigest'].includes(k))]);
    const {bodyDigest}=execute({op:'body',name:r.name,description:r.description});
    const {imageDigest}=execute({op:'image',length:r.length});
    const input={op:'terms',escrow:r.escrow,storeId:r.storeId,asset:r.asset,bodyDigest,imageDigest};
    for(const key of termFields) if(!['bodyDigest','imageDigest'].includes(key)) input[key]=r[key];
    return {bodyDigest,imageDigest,...execute(input)};
  }
  if (r.op === 'body') {
    exact(r,['op','name','description']);
    for (const [key,limit] of [['name',200],['description',8192]]) {
      if(typeof r[key]!=='string' || r[key].includes('\r') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(r[key]) || Buffer.byteLength(r[key],'utf8')>limit) throw Error();
    }
    return {bodyDigest:hash(['bytes32','bytes32','bytes32'],[h('MealBodyV1(bytes32 nameDigest,bytes32 descriptionDigest)'),h(r.name),h(r.description)])};
  }
  if (r.op === 'terms') {
    exact(r,['op','escrow','storeId','asset',...termFields]);
    const values=termInputs.map((t,i)=>typed(t,r[termFields[i]]));
    if(values[1]===0n || values[2]===0n || values[5]<1 || values[5]>2 || values[6]>=values[7] || values[7]>1440 || (values[5]===1 && (values[8]!==0 || values[9]!==0)) || (values[5]===2 && (values[8]>=values[9] || values[9]>1440 || values[7]>values[8]))) throw Error();
    return {termsHash:hash(termTypes,[h(termsSchema),1n,31337n,hex(r.escrow,20),hex(r.storeId,32),values[0],values[1],hex(r.asset,20),...values.slice(2),480])};
  }
  if (r.op === 'voucher') {
    exact(r,['op','escrow','unitSeq','generation']);
    return {voucherId:hash(['bytes32','uint256','address','uint8','uint256'],[h('MealForwardVoucherV1'),31337n,hex(r.escrow,20),small(r.unitSeq,8),number(r.generation)])};
  }
  if (r.op === 'operation') {
    exact(r,['op','escrow','caller','opId','kind','parameters']);
    const schemas={1:['uint256',tuple],2:['uint256','bytes32','bool'],3:['uint256','bool'],4:['uint256'],5:['bytes32','uint8','uint256','bytes32','uint256'],6:['bytes32','uint256','uint256'],7:['bytes32','uint256','bytes32','uint256'],8:['bytes32','uint256','bytes32','bytes32'],9:['bytes32','uint256'],10:['bytes32','uint256'],11:['bytes32','uint16']};
    const types=schemas[r.kind];
    if(!Number.isInteger(r.kind) || !types || !Array.isArray(r.parameters) || r.parameters.length!==types.length) throw Error();
    const values=types.map((t,i)=>typed(t,r.parameters[i]));
    const parametersHash=hash(types,values);
    return {parametersHash,payloadHash:hash(['bytes32','uint256','uint256','address','uint8','address','bytes32','bytes32'],[h('MealForwardOperationV1'),1n,31337n,hex(r.escrow,20),r.kind,hex(r.caller,20),hex(r.opId,32),parametersHash])};
  }
  if(r.op==='image') {
    exact(r,['op','length']);
    if(!Number.isInteger(r.length) || r.length<1 || r.length>8*1024*1024) throw Error();
    // This descriptor is inherited exclusively from the server's normalized-artifact
    // allowlist, opened readonly/no-follow. No request can supply a path or fd.
    const before=fstatSync(imageFd);
    if(!before.isFile() || before.uid!==process.getuid() || before.size!==r.length || before.nlink!==1 || (before.mode & 0o077)!==0) throw Error();
    const data=Buffer.alloc(r.length+1); let count=0;
    while(count<data.length) {const got=readSync(imageFd,data,count,data.length-count,null); if(!got) break; count+=got;}
    const after=fstatSync(imageFd);
    if(count!==r.length || after.size!==before.size || after.ino!==before.ino || after.mtimeMs!==before.mtimeMs || after.ctimeMs!==before.ctimeMs || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error();
    return {imageDigest:keccak256(data.subarray(0,count))};
  }
  if(r.op==='keccak') {
    exact(r,['op','hex']);
    if(typeof r.hex!=='string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(r.hex)) throw Error();
    return {digest:keccak256(r.hex)};
  }
  throw Error();
}
try {
  const chunks=[];let size=0;
  for await (const chunk of process.stdin) {size+=chunk.length; if(size>65536) throw Error(); chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  process.stdout.write(JSON.stringify(execute(strictJson(text)))+'\n');
} catch {process.stdout.write('{"error":"HASH_REJECTED"}\n');process.exitCode=1;}
