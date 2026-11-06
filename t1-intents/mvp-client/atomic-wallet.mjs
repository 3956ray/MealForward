import {atomicCalls} from '../product-v2/atomic-wire.mjs';
import {validateProductConfiguration} from './product-network.mjs';
const check=(v,c)=>{if(!v)throw Error(c);};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export async function atomicCapability({wallet,api,session,configuration,isCurrent}){
 const c=validateProductConfiguration(configuration),p=await api('/atomic-funding/capability');check(isCurrent(),'WALLET_CONTEXT_CHANGED');if(p.enabled!==true||p.verified!==true||p.finalized!==true||!same(p.wallet,session.wallet)||p.chainId!==c.chainId)return {enabled:false,reason:'IMPLEMENTATION_NOT_VERIFIED'};
 const capability=await wallet.atomicCapabilities(session.wallet);check(isCurrent(),'WALLET_CONTEXT_CHANGED');return {enabled:capability?.['0x'+c.chainId.toString(16)]?.atomic?.status==='supported',account:p};
}
export function createAtomicCoordinator({wallet,api,session,configuration,isCurrent,storage=globalThis.localStorage}){
 const config=validateProductConfiguration(configuration),owner=session.wallet.toLowerCase(),key=id=>'mf-atomic-v1:'+config.chainId+':'+owner+':'+id;
 const checkCurrent=()=>check(isCurrent(),'WALLET_CONTEXT_CHANGED');
 const inspect=async()=>{checkCurrent();const i=await wallet.inspect();checkCurrent();check(same(i.account,owner)&&i.chainId===config.chainId,'WALLET_CONTEXT_CHANGED');};
 const save=(id,r)=>{storage.setItem(key(id),JSON.stringify(r));check(storage.getItem(key(id))===JSON.stringify(r),'JOURNAL_FAILED');};
 const read=id=>{const r=JSON.parse(storage.getItem(key(id))||'null');if(r)check(r.wallet===owner&&r.id===id,'ATOMIC_JOURNAL_INVALID');return r;};
 const verify=o=>check(o?.kind==='support'&&o.mode==='atomic'&&same(o.wallet,owner)&&JSON.stringify(o.calls)===JSON.stringify(atomicCalls(o,config)),'ATOMIC_OPERATION_MISMATCH');
 return {
 async send(op){verify(op);check(op.state==='PREPARED'&&!read(op.id),'ATOMIC_ALREADY_ATTEMPTED');await inspect();const capability=await atomicCapability({wallet,api,session,configuration:config,isCurrent});check(capability.enabled,'ATOMIC_NOT_ENABLED');save(op.id,{id:op.id,wallet:owner,attempted:true});const r=await api('/atomic-funding/'+op.id+'/attempt',{method:'POST',body:{}});checkCurrent();verify(r.operation);check(r.allowed===true&&r.operation.id===op.id&&JSON.stringify(r.operation.calls)===JSON.stringify(op.calls)&&r.operation.state==='SEND_UNKNOWN'&&typeof r.operation.walletBatchId==='string','ATOMIC_ADMISSION_INVALID');const batchId=r.operation.walletBatchId;save(op.id,{id:op.id,wallet:owner,attempted:true,batchId});await inspect();const result=await wallet.sendAtomicCalls(owner,{version:'2.0.0',id:batchId,from:owner,chainId:'0x'+config.chainId.toString(16),atomicRequired:true,calls:op.calls},checkCurrent);check(result?.id===batchId,'ATOMIC_BATCH_ID_MISMATCH');checkCurrent();return r.operation;},
 async recover(op){verify(op);checkCurrent();const r=read(op.id);const batchId=op.walletBatchId||r?.batchId;if(!batchId)return api('/atomic-funding/'+op.id+'/status');await inspect();const status=await wallet.atomicCallsStatus(batchId);checkCurrent();check(status.id===batchId&&Number(BigInt(status.chainId))===config.chainId,'ATOMIC_STATUS_MISMATCH');if(status.status===200){check(status.atomic===true&&status.receipts?.length===1&&status.receipts[0].status==='0x1','ATOMIC_STATUS_UNVERIFIED');await api('/atomic-funding/'+op.id+'/batch',{method:'POST',body:{batchId,transactionHashes:[status.receipts[0].transactionHash]}});checkCurrent();}return api('/atomic-funding/'+op.id+'/status');}
 };
}
