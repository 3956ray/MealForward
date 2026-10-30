import test from 'node:test';
import assert from 'node:assert/strict';
import {productServerConfiguration} from './server-entry.mjs';
const env=()=>({MF_PRODUCT_ENABLED:'true',MF_PRODUCT_ORIGIN:'https://mealforward-new.onrender.com',MF_PRODUCT_DATABASE_URL:'postgresql://mf_product_v2_runtime.ketfrukrcuosrqynnsay:synthetic@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres',MF_PRODUCT_RPC_URL:'https://testnet-rpc.monad.xyz',MF_PRODUCT_MANIFEST:JSON.stringify({chainId:10143,asset:'0x534b2f3a21130d7a60830c2df862319e593943a3',policySeconds:7200}),MF_PRODUCT_CLAIM_KEY:'0x'+'12'.repeat(32),MF_PRODUCT_REDEMPTION_KEY:'0x'+'23'.repeat(32),MF_PRODUCT_CREDENTIAL_PEPPER:'synthetic-not-production-pepper-32',MF_PRODUCT_DEFAULT_IMAGE_DIGEST:'0x'+'34'.repeat(32)});
test('cloud entry requires dedicated explicit testnet configuration',()=>{
 assert.equal(productServerConfiguration(env()).port,10000);
 for(const change of [{MF_PRODUCT_ENABLED:'false'},{MF_PRODUCT_ORIGIN:'http://127.0.0.1:12345'},{MF_PRODUCT_CLAIM_KEY:''},{MF_PRODUCT_CREDENTIAL_PEPPER:''},{PORT:'0'},{MF_PRODUCT_RPC_URL:'http://127.0.0.1:8545'},{MF_PRODUCT_MANIFEST:JSON.stringify({chainId:31337,policySeconds:7200})}])assert.throws(()=>productServerConfiguration({...env(),...change}),/^Error: PRODUCT_/);
});
test('legacy/admin database credentials and TLS overrides are rejected without echo',()=>{
 const base=env();for(const url of [base.MF_PRODUCT_DATABASE_URL.replace('mf_product_v2_runtime','postgres'),base.MF_PRODUCT_DATABASE_URL+'?sslmode=no-verify',base.MF_PRODUCT_DATABASE_URL.replace('ketfrukrcuosrqynnsay','anotherproject'),base.MF_PRODUCT_DATABASE_URL.replace('supabase.com','supabase.com.evil')]){
  assert.throws(()=>productServerConfiguration({...base,MF_PRODUCT_DATABASE_URL:url}),e=>e.message==='PRODUCT_DEDICATED_DATABASE_REQUIRED'&&!e.message.includes('synthetic'));
 }
});
