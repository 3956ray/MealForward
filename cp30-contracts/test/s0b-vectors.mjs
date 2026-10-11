// Pure installed viem fixture encoding; no client/signing/network or private data.
import { encodeAbiParameters, encodeFunctionData, keccak256, stringToHex, parseAbi } from 'viem';
import { writeFileSync, readFileSync } from 'node:fs';
const enc=(types,values)=>encodeAbiParameters(types.map(type=>({type})),values);
const hash=(types,values)=>keccak256(enc(types,values));
const h=text=>keccak256(stringToHex(text));
const b32=n=>`0x${BigInt(n).toString(16).padStart(64,'0')}`;
export function bodyDigest(name,description){if(name.includes('\r')||description.includes('\r'))throw Error('CR rejected; exact UTF8/LF only');return hash(['bytes32','bytes32','bytes32'],[h('MealBodyV1(bytes32 nameDigest,bytes32 descriptionDigest)'),h(name),h(description)]);}
const body=bodyDigest('合成午餐','synthetic\nexact LF');const image=keccak256('0x0001feff');
let crRejected=false;try{bodyDigest('synthetic','a\r\nb');}catch{crRejected=true;}if(!crRejected)throw Error('CR not rejected');
const typeString='MealForwardTerms(uint256 schemaVersion,uint256 chainId,address escrow,bytes32 storeId,bytes32 mealId,uint256 version,address asset,uint256 unitPrice,bytes32 bodyDigest,bytes32 imageDigest,uint8 windowCount,uint16 startMinute0,uint16 endMinute0,uint16 startMinute1,uint16 endMinute1,uint16 utcOffsetMinutes)';
const termTypes=['bytes32','uint256','uint256','address','bytes32','bytes32','uint256','address','uint256','bytes32','bytes32','uint8','uint16','uint16','uint16','uint16','uint16'];
const escrow='0x0000000000000000000000000000000000003000',asset='0x0000000000000000000000000000000000004000',caller='0x0000000000000000000000000000000000000402',meal=h('synthetic meal A');
const t=[meal,1n,3n,body,image,2,540,600,780,1440];
const termsHash=hash(termTypes,[h(typeString),1n,31337n,escrow,b32(44),meal,1n,asset,3n,body,image,2,540,600,780,1440,480]);
const tuple='(bytes32 mealId,uint256 version,uint256 unitPrice,bytes32 bodyDigest,bytes32 imageDigest,uint8 windowCount,uint16 startMinute0,uint16 endMinute0,uint16 startMinute1,uint16 endMinute1)';
const sigs=[`publish(bytes32 opId,uint256 expectedControlRevision,${tuple} input) returns (bytes32)`,
'setListed(bytes32 opId,uint256 expectedControlRevision,bytes32 mealId,bool listed) returns (uint256)',
'setPaused(bytes32 opId,uint256 expectedControlRevision,bool paused) returns (uint256)',
'close(bytes32 opId,uint256 expectedControlRevision) returns (uint256)',
'issue(bytes32 opId,bytes32 mealId,uint8 expectedUnitSeq,uint256 expectedNextGeneration,bytes32 expectedTermsHash,uint256 deadline) returns (bytes32)',
'lock(bytes32 opId,bytes32 voucherId,uint256 generation,uint256 deadline) returns (bytes32)',
'markHandover(bytes32 opId,bytes32 voucherId,uint256 generation,bytes32 lockId,uint256 deadline) returns (bytes32)',
'report(bytes32 opId,bytes32 voucherId,uint256 generation,bytes32 lockId,bytes32 markerId) returns (bytes32)',
'settle(bytes32 opId,bytes32 voucherId,uint256 generation) returns (uint256)',
'expire(bytes32 opId,bytes32 voucherId,uint256 generation) returns (uint8)',
'refundWithIntent(bytes32 opId,bytes32 batchId,uint16 mask) returns (uint256)'];
const abi=parseAbi(sigs.map(s=>'function '+s));const id=b32(7),v=b32(8),l=b32(9),m=b32(10),deadline=1800000600n;
const args=[[id,0n,t],[id,0n,meal,false],[id,0n,true],[id,0n],[id,meal,0,1n,termsHash,deadline],[id,v,1n,deadline],[id,v,1n,l,deadline],[id,v,1n,l,m],[id,v,1n],[id,v,1n],[id,b32(11),3]];
const operations=sigs.map((s,i)=>{const name=s.split('(')[0],data=encodeFunctionData({abi,functionName:name,args:args[i]});
const parametersHash=keccak256('0x'+data.slice(10+64));const payloadHash=hash(['bytes32','uint256','uint256','address','uint8','address','bytes32','bytes32'],[h('MealForwardOperationV1'),1n,31337n,escrow,i+1,caller,id,parametersHash]);
return {kind:i+1,name,selector:data.slice(0,10),calldata:data,parametersHash,payloadHash};});
const voucherId=hash(['bytes32','uint256','address','uint8','uint256'],[h('MealForwardVoucherV1'),31337n,escrow,0,1n]);
const vector={scope:'public synthetic offline fixture; fixed 0x3000/0x4000 are not deployments',chainId:31337,escrow,asset,caller,bodySchema:'MealBodyV1(bytes32 nameDigest,bytes32 descriptionDigest)',name:'合成午餐',description:'synthetic\nexact LF',imageBytes:'0x0001feff',bodyDigest:body,imageDigest:image,crRejected,typeString,typeHash:h(typeString),terms:t,termsHash,voucherId,operations};
writeFileSync(new URL('../evidence/s0b/s0b-vector.json',import.meta.url),JSON.stringify(vector,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
// Verify the committed fixed Solidity constants; never rewrite source during evidence generation.
const fixture=readFileSync(new URL('./S0bVectorConstants.sol',import.meta.url),'utf8');
for(const value of [body,image,termsHash,voucherId,...operations.flatMap(x=>[x.selector,x.payloadHash])]) {
  if(!fixture.includes(value))throw Error('Committed Solidity vector differs from independently generated viem value: '+value);
}
process.stdout.write(JSON.stringify({termsHash,voucherId,operations:operations.length,crRejected})+'\n');
