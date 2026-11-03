// Configuration-only checks: no pool/RPC creation, no secrets, no cloud calls.
import test from 'node:test';import assert from 'node:assert/strict';
import {multiTargetConfiguration} from './server-entry.mjs';
import {approvedProductDeployment} from '../product-v2/server-entry.mjs';
import {targetIdOf} from '../product-v2/target-registry.mjs';
const env=()=>({MF_PRODUCT_ENABLED:'true',MF_PRODUCT_ORIGIN:'https://mealforward-new.onrender.com',MF_PRODUCT_DATABASE_URL:'postgresql://mf_product_v2_runtime.ketfrukrcuosrqynnsay:synthetic@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres',MF_PRODUCT_RPC_URL:'https://testnet-rpc.monad.xyz',MF_PRODUCT_MANIFEST:JSON.stringify(approvedProductDeployment),MF_PRODUCT_CLAIM_KEY:'0x'+'12'.repeat(32),MF_PRODUCT_REDEMPTION_KEY:'0x'+'23'.repeat(32),MF_PRODUCT_CREDENTIAL_PEPPER:'synthetic-not-production-pepper-32',MF_PRODUCT_DEFAULT_IMAGE_DIGEST:'0x'+'34'.repeat(32),MF_PRODUCT_PROCESS_ROLE:'web',MF_PRODUCT_LEGACY_WORKER_STOPPED:'true'});
test('multi-target entry requires explicit web/worker and legacy worker handoff before startup',()=>{
 for(const role of ['web','worker']){const c=multiTargetConfiguration({...env(),MF_PRODUCT_PROCESS_ROLE:role});assert.equal(c.role,role);assert.equal(c.registry.legacyTargetId,targetIdOf(approvedProductDeployment));}
 for(const patch of [{MF_PRODUCT_PROCESS_ROLE:undefined},{MF_PRODUCT_PROCESS_ROLE:'both'},{MF_PRODUCT_LEGACY_WORKER_STOPPED:undefined},{MF_PRODUCT_LEGACY_WORKER_STOPPED:'false'}])assert.throws(()=>multiTargetConfiguration({...env(),...patch}),/PRODUCT_PROCESS_ROLE_REQUIRED|LEGACY_WORKER_HANDOFF_REQUIRED/);
});
test('active target must be in committed approvals, environment cannot substitute deployed target',()=>{
 const c=multiTargetConfiguration(env());assert.equal(c.registry.activeTargetId,c.registry.legacyTargetId);
 assert.throws(()=>multiTargetConfiguration({...env(),MF_PRODUCT_ACTIVE_TARGET:'10143:0x'+'cd'.repeat(20)}),/UNKNOWN_TARGET/);
 assert.throws(()=>multiTargetConfiguration({...env(),MF_PRODUCT_MANIFEST:JSON.stringify({...approvedProductDeployment,escrow:'0x'+'cd'.repeat(20),contractVersion:3})}),/PRODUCT_APPROVED_DEPLOYMENT_REQUIRED/);
});
test('old dedicated database, HTTPS origin, network and budget guards survive new entry',()=>{
 const base=env();for(const change of [{MF_PRODUCT_ENABLED:'false'},{MF_PRODUCT_ORIGIN:'http://127.0.0.1:12345'},{MF_PRODUCT_RPC_URL:'http://127.0.0.1:8545'},{MF_PRODUCT_DATABASE_URL:base.MF_PRODUCT_DATABASE_URL.replace('mf_product_v2_runtime','postgres')},{MF_PRODUCT_MANIFEST:JSON.stringify({...approvedProductDeployment,maxTransactionFee:'999999999999999999999'})}])assert.throws(()=>multiTargetConfiguration({...base,...change}),/^Error: PRODUCT_/);
});

test('rollback defaults new funding off without changing the recovery registry',()=>{
 for(const [flag,expected] of [[undefined,false],['false',false],['true',true]]){const c=multiTargetConfiguration({...env(),MF_PRODUCT_NEW_FUNDING_ENABLED:flag});assert.equal(c.newFundingEnabled,expected);assert.equal(c.registry.get(c.registry.legacyTargetId).escrow.toLowerCase(),approvedProductDeployment.escrow.toLowerCase());}
 assert.throws(()=>multiTargetConfiguration({...env(),MF_PRODUCT_NEW_FUNDING_ENABLED:'yes'}),/INVALID_NEW_FUNDING_SWITCH/);
});
