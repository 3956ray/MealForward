import {validateProductConfiguration} from './product-network.mjs';
import {validateApprovalTransaction} from '../product-v2/approval-wire.mjs';
import {validateFundingTransaction} from '../product-v2/funding-wire.mjs';
import {keccak256,toUtf8Bytes} from 'ethers';
import {publicationTermsHash,validatePublicationTransaction} from '../product-v2/publication-wire.mjs';
import {redemptionInterface,validatePermitSignature,validateRedemptionTransaction} from '../product-v2/redemption-wire.mjs';
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const ref=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const fail=code=>{throw Object.assign(Error(code),{code});};
export function productOperationPath(operation){
 if(!ref(operation?.id))fail('INVALID_OPERATION');
 const group=operation.kind==='approval'?'/approvals':operation.kind==='support'?'/intents':['registration','publication','supplement','listing','closure','refund'].includes(operation.kind)?'/catalog-operations':['handover','settlement'].includes(operation.kind)?'/merchant/operations':null;
 if(!group)fail('INVALID_OPERATION_KIND');return group+'/'+encodeURIComponent(operation.id);
}
export function createProductJournal(storage=globalThis.localStorage){
 const key=(wallet,operation)=>{if(!address(wallet))fail('INVALID_WALLET');return 'mf-product-wallet-v1:'+wallet.toLowerCase()+':'+productOperationPath(operation);};
 return Object.freeze({
  get(wallet,op){const value=storage?.getItem(key(wallet,op));if(value==null)return null;let item;try{item=JSON.parse(value);}catch{fail('RECOVERY_JOURNAL_INVALID');}if(item.wallet!==wallet.toLowerCase()||item.id!==op.id||item.kind!==op.kind||item.attempted!==true||item.txHash!==undefined&&!hash(item.txHash))fail('RECOVERY_JOURNAL_INVALID');return item;},
  set(wallet,op,value){if(!storage?.setItem)fail('RECOVERY_STORAGE_REQUIRED');const record={wallet:wallet.toLowerCase(),id:op.id,kind:op.kind,attempted:true,...(value.txHash?{txHash:value.txHash.toLowerCase()}:{})};if(record.txHash&&!hash(record.txHash))fail('INVALID_TRANSACTION_HASH');storage.setItem(key(wallet,op),JSON.stringify(record));if(storage.getItem(key(wallet,op))!==JSON.stringify(record))fail('RECOVERY_STORAGE_REQUIRED');return record;},
 });
}
function context(options){
 const {operation,session,configuration,wallet,api,isCurrent,journal}=options;
 const path=productOperationPath(operation),account=session?.wallet;
 if(!address(account)||!same(operation.wallet??operation.receiver,account))fail('OPERATION_WALLET_MISMATCH');
 validateProductConfiguration(configuration);
 if(typeof api!=='function'||typeof isCurrent!=='function'||!journal?.get||!journal?.set)fail('PRODUCT_CONTEXT_REQUIRED');
 const check=()=>{if(isCurrent()!==true)fail('WALLET_CONTEXT_CHANGED');};
 const inspect=async()=>{check();if(typeof wallet?.inspect!=='function')fail('WALLET_REQUIRED');const observed=await wallet.inspect();check();if(observed.chainId!==configuration.chainId||!same(observed.account,account))fail('WALLET_CONTEXT_CHANGED');};
 return {path,account,check,inspect};
}
/** Only immutable operation calldata is accepted, never a generic backend tx. */
export function validateProductOperation(operation,session,configuration,now=Math.floor(Date.now()/1000)){
 const account=session?.wallet,tx=operation?.transaction;
 productOperationPath(operation);
 if(operation.state!=='PREPARED'||!tx)fail('ORIGINAL_OPERATION_NOT_PREPARED');
 if(!address(account)||!same(operation.wallet??operation.receiver,account))fail('OPERATION_WALLET_MISMATCH');
 validateProductConfiguration(configuration);
 if(operation.expiresAt!==undefined&&(!Number.isSafeInteger(operation.expiresAt)||operation.expiresAt<=now))fail('OPERATION_EXPIRED');
 const op={...operation,wallet:account};
 try {
  if(op.kind==='approval'){
   if(!ref(op.reviewId)||BigInt(op.quantity)<=0n||BigInt(op.unitPrice)<=0n||BigInt(op.amount)!==BigInt(op.quantity)*BigInt(op.unitPrice))fail('APPROVAL_AMOUNT_MISMATCH');
   return validateApprovalTransaction(op,configuration,tx);
  }
  if(op.kind==='support'){
   if(BigInt(op.quantity)<=0n||BigInt(op.unitPrice)<=0n||BigInt(op.amount)!==BigInt(op.quantity)*BigInt(op.unitPrice))fail('AMOUNT_MISMATCH');
   return validateFundingTransaction(op,configuration,tx);
  }
  if(['publication','supplement','listing','registration','closure','refund'].includes(op.kind)){
   if(op.kind==='closure'&&(!ref(op.storeId)||op.acknowledge!==true))fail('CLOSURE_ACKNOWLEDGEMENT_REQUIRED');
   if(op.kind==='refund'&&(!ref(op.storeId)||!hash(op.batchId)||!address(op.payer)||BigInt(op.quantity)<=0n||BigInt(op.amount)<=0n))fail('REFUND_EVIDENCE_REQUIRED');
   if(['publication','supplement'].includes(op.kind)&&BigInt(op.quantity)<=0n)fail('INVALID_QUANTITY');
   if(op.kind==='publication'){
    if(!Number.isSafeInteger(op.expectedVersion)||op.expectedVersion<0||op.version!==op.expectedVersion+1||!Array.isArray(op.windows)||![1,2].includes(op.windows.length)||BigInt(op.terms.unitPrice)!==BigInt(op.unitPrice)||op.terms.windowCount!==op.windows.length||op.terms.startMinute0!==op.windows[0][0]||op.terms.endMinute0!==op.windows[0][1]||op.terms.startMinute1!==(op.windows[1]?.[0]||0)||op.terms.endMinute1!==(op.windows[1]?.[1]||0)||!same(op.terms.bodyDigest,keccak256(toUtf8Bytes(JSON.stringify({name:op.name,description:op.description}))))||!same(op.termsHash,publicationTermsHash(configuration,op)))fail('PUBLICATION_TERMS_MISMATCH');
   }
   if(['publication','supplement'].includes(op.kind)&&(!Number.isSafeInteger(op.fundingDeadline)||op.fundingDeadline<=now))fail('FUNDING_DEADLINE_PASSED');
   return validatePublicationTransaction(op,configuration,tx);
  }
  if(!hash(op.voucherId)||!Number.isSafeInteger(op.generation)||op.generation<1)fail('VOUCHER_UNVERIFIED');
  if(op.kind==='handover'){
   const decoded=redemptionInterface.decodeFunctionData('redeem',tx.data),p=decoded[3];
   const permit={voucherId:p.voucherId,generation:p.generation,owner:p.owner,issuedAt:p.issuedAt,deadline:p.deadline};
   if(!same(permit.voucherId,op.voucherId)||permit.generation!==BigInt(op.generation)||!same(permit.owner,account)||permit.deadline!==BigInt(op.expiresAt)||permit.issuedAt>BigInt(now+30)||permit.deadline<=permit.issuedAt||permit.deadline-permit.issuedAt>120n)fail('REDEMPTION_PERMIT_MISMATCH');
   validatePermitSignature(permit,decoded[4],configuration);
   return validateRedemptionTransaction({...op,permit,permitSignature:decoded[4]},configuration,tx);
  }
  return validateRedemptionTransaction(op,configuration,tx);
 }catch(error){if(error.code)throw error;fail('TRANSACTION_UNVERIFIED');}
}
/** Caller must invoke this from an explicit user action. No implicit approval or extra signature. */
export async function executeProductOperation(options){
 const {operation,session,configuration,wallet,api,journal}=options;
 const {path,account,check,inspect}=context(options);
 check();const transaction=validateProductOperation(operation,session,configuration);
 await inspect();
 if(journal.get(account,operation)?.attempted)fail('ORIGINAL_OPERATION_ALREADY_ATTEMPTED');
 // Durable before admission. A lost admission reply cannot result in another send.
 journal.set(account,operation,{attempted:true});
 const admitted=await api(path+'/attempt',{method:'POST',body:{}});check();
 const admittedOperation=admitted.operation??admitted.intent;
 if(admitted.allowed!==true||admittedOperation?.id!==operation.id||admittedOperation?.kind!==operation.kind||admittedOperation?.state!=='SEND_UNKNOWN')fail('SEND_NOT_ADMITTED');
 await inspect();check();
 const txHash=await wallet.sendTransaction(account,transaction,check);
 if(!hash(txHash))fail('INVALID_TRANSACTION_HASH');
 // Keep a returned hash even if account change occurred during the wallet prompt.
 try {journal.set(account,operation,{attempted:true,txHash});}
 catch(error){throw Object.assign(Error('HASH_STORAGE_FAILED'),{code:'HASH_STORAGE_FAILED',operationId:operation.id,wallet:account,txHash,cause:error});}
 check();
 await api(path+'/hash',{method:'POST',body:{txHash}});check();
 const result=await api(path+'/reconcile',{method:'POST',body:{}});check();return result;
}
/** Read/record the original transaction only. It never calls a wallet action. */
export async function reconcileProductOperation(options){
 const {operation,api,journal}=options,{path,account,check}=context(options);
 check();const record=journal.get(account,operation);
 if(record?.txHash){await api(path+'/hash',{method:'POST',body:{txHash:record.txHash}});check();}
 const result=await api(path+'/reconcile',{method:'POST',body:{}});check();return result;
}
