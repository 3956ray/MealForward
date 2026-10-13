import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeFunctionData,encodeAbiParameters,keccak256,stringToHex} from 'viem';
import {catalogAbi,preparePublish,prepareSetListed,catalogTermsHash} from './catalog.mjs';
const w=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const b={chainId:10143,escrow:a(1),asset:a(2),storeId:w(3),owner:a(4),receiver:a(4),quoteAuthority:a(5),catalogAuthority:a(6),issuerAuthority:a(7),operatorAuthority:a(8)};
const input={mealId:w(10),version:'1',unitPrice:'500000',bodyDigest:w(11),imageDigest:w(12),windowCount:'1',startMinute0:'0',endMinute0:'420',startMinute1:'0',endMinute1:'0'};
test('ABI entries match accepted contract artifact exactly',()=>{
 const accepted=JSON.parse(readFileSync(new URL('../../../cp30-contracts/out/s0b-final/StoreEscrow.sol/StoreEscrow.json',import.meta.url))).abi;
 for(const name of ['publish','setListed','computeTermsHash'])assert.deepEqual(catalogAbi.find(x=>x.type==='function'&&x.name===name),accepted.find(x=>x.type==='function'&&x.name===name));
});
test('catalog-only exact publish and listing descriptors use independent opIds/revisions',()=>{
 const p=preparePublish({binding:b,caller:b.catalogAuthority,parameters:{opId:w(20),expectedControlRevision:'0',input}});
 assert.equal(p.expectedRole,'catalogAuthority');assert.equal(p.to,b.escrow);assert.equal(p.value,'0');assert.equal(p.authority,'PREPARATION_ONLY');
 const decoded=decodeFunctionData({abi:catalogAbi,data:p.data});assert.equal(decoded.functionName,'publish');assert.equal(decoded.args[2].unitPrice,500000n);
 const listing=prepareSetListed({binding:b,caller:b.catalogAuthority,parameters:{opId:w(21),expectedControlRevision:'1',mealId:input.mealId,value:true}});
 assert.notEqual(p.opId,listing.opId);assert.equal(decodeFunctionData({abi:catalogAbi,data:listing.data}).args[1],1n);
 for(const caller of [b.owner,b.operatorAuthority,b.issuerAuthority])assert.throws(()=>preparePublish({binding:b,caller,parameters:{opId:w(20),expectedControlRevision:'0',input}}));
 assert.throws(()=>prepareSetListed({binding:b,caller:b.catalogAuthority,parameters:{opId:w(21),expectedControlRevision:'1',mealId:input.mealId,value:'true'}}));
});
test('terms commitment matches fixed 480-minute offset and distinct chain/meal/version',()=>{
 const names='schemaVersion:uint256 chainId:uint256 escrow:address storeId:bytes32 mealId:bytes32 version:uint256 asset:address unitPrice:uint256 bodyDigest:bytes32 imageDigest:bytes32 windowCount:uint8 startMinute0:uint16 endMinute0:uint16 startMinute1:uint16 endMinute1:uint16 utcOffsetMinutes:uint16'.split(' ').map(x=>x.split(':'));
 const schema='MealForwardTerms('+names.map(([name,type])=>type+' '+name).join(',')+')';
 const expected=keccak256(encodeAbiParameters([{type:'bytes32'},...names.map(([,type])=>({type}))],[keccak256(stringToHex(schema)),1n,10143n,b.escrow,b.storeId,input.mealId,1n,b.asset,500000n,input.bodyDigest,input.imageDigest,1,0,420,0,0,480]));
 const hash=catalogTermsHash({binding:b,input}).termsHash;assert.equal(hash,expected);
 for(const other of [{...input,version:'2'},{...input,mealId:w(99)},{...input,unitPrice:'7000000'}])assert.notEqual(catalogTermsHash({binding:b,input:other}).termsHash,hash);
 assert.notEqual(catalogTermsHash({binding:{...b,chainId:31337},input}).termsHash,hash);
 for(const other of [{...input,endMinute0:'0'},{...input,startMinute1:'1'},{...input,unitPrice:'0'},{...input,windowCount:'3'},{...input,extra:'x'}])assert.throws(()=>catalogTermsHash({binding:b,input:other}));
});
