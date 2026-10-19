import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateManifest,compareRuntime,asUint,asAddress,asBytes32,TESTNET_CHAIN_ID,CIRCLE_TEST_USDC} from './runtime-proof.mjs';

const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const hex32=n=>'0x'+n.toString(16).padStart(64,'0');
const base={mode:'single-wallet-smoke',chainId:TESTNET_CHAIN_ID,asset:CIRCLE_TEST_USDC,
contract:addr(9),deployer:addr(1),owner:addr(1),quoteAuthority:addr(1),catalogAuthority:addr(1),
issuerAuthority:addr(1),operatorAuthority:addr(1),deploymentTx:hex32(8),storeId:hex32(2),
mealId:hex32(3),bodyDigest:hex32(4),imageDigest:hex32(5),version:1,unitPrice:'7000000',minConfirmations:2};
test('manifest explicitly limits chain, token, role model, price and confirmations',()=>{
 assert.equal(validateManifest(base).roleSeparationVerified,false);
 for(const [key,value] of [['chainId',143],['asset',addr(8)],['unitPrice','14000000'],['minConfirmations',1],['deploymentTx',hex32(0)]]){
  assert.throws(()=>validateManifest({...base,[key]:value}),key);
 }
 assert.throws(()=>validateManifest({...base,issuerAuthority:addr(6)}),/SMOKE_MUST_USE_ONE_DISPOSABLE_WALLET/);
 const distinct={...base,mode:'role-separated-e2e',quoteAuthority:addr(2),catalogAuthority:addr(3),issuerAuthority:addr(4),operatorAuthority:addr(5)};
 assert.equal(validateManifest(distinct).roleSeparationVerified,true);
 assert.throws(()=>validateManifest({...distinct,issuerAuthority:addr(2)}),/ROLE_SEPARATION_NOT_PROVEN/);
});
test('runtime matcher denies unexpected byte, length or immutable overlap',()=>{
 const compiled='0x'+Buffer.alloc(96,0x11).toString('hex');
 const expected=Buffer.from(compiled.slice(2),'hex');
 const observed=Buffer.from(expected);observed.fill(0x22,16,36);
 const refs={asset:[{start:16,length:20}]};
 assert.equal(compareRuntime(compiled,'0x'+observed.toString('hex'),refs).immutableBytes,20);
 assert.throws(()=>compareRuntime(compiled,'0x'+observed.toString('hex')),/RUNTIME_MISMATCH/);
 observed[50]=0x44;
 assert.throws(()=>compareRuntime(compiled,'0x'+observed.toString('hex'),refs),/RUNTIME_MISMATCH/);
 assert.throws(()=>compareRuntime(compiled,compiled+'00'),/RUNTIME_LENGTH_MISMATCH/);
 assert.throws(()=>compareRuntime(compiled,compiled,{x:[{start:0,length:10}],y:[{start:9,length:20}]}),/IMMUTABLE_OVERLAP/);
 assert.throws(()=>compareRuntime(compiled,compiled,{x:[{start:95,length:2}]}),/IMMUTABLE_OUT_OF_RANGE/);
});
test('ABI word parsing is strict and type preserving',()=>{
 const payload='0x'+addr(12).slice(2).padStart(64,'0')+hex32(7).slice(2);
 assert.equal(asAddress(payload,0).toLowerCase(),addr(12).toLowerCase());
 assert.equal(asUint(payload,1),7n);
 assert.equal(asBytes32(payload,1),hex32(7));
 assert.throws(()=>asUint('0x1234'),/INVALID_ABI_WORDS/);
 assert.throws(()=>asUint(payload,2),/ABI_WORD_MISSING/);
});
