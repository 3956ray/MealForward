import React,{useEffect,useRef,useState} from 'react';
import {productOperationPath} from './product-wallet.mjs';
import {validateProductConfiguration} from './product-network.mjs';
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n;
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const quantity=v=>typeof v==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(v);
const same=(a,b)=>address(a)&&address(b)&&a.toLowerCase()===b.toLowerCase();
const pending=s=>['SEND_UNKNOWN','HASH_BOUND'].includes(s),terminal=s=>['CANCELLED','CONFIRMED','REVERTED'].includes(s);
const fail=()=>{throw Error('作废交易与原请求不一致，未发送。');};
export function cancellationPath(operation){const path=productOperationPath(operation),group=path.split('/')[1];return '/operation-cancellations/'+({intents:'intents',approvals:'approvals','catalog-operations':'publications',merchant:'redemptions'}[group])+'/'+encodeURIComponent(operation.id);}
export function validateCancellationPacket(packet,operation,session,configuration){
 const config=validateProductConfiguration(configuration),tx=packet?.transaction;
 if(packet?.id!==operation.id||packet?.kind!==operation.kind||!same(packet?.wallet,session?.wallet)||!same(operation.wallet??operation.receiver,session.wallet)||!pending(packet.state))fail();
 if(!tx||Object.keys(tx).sort().join()!=='chainId,data,from,nonce,to,value'||!same(tx.from,session.wallet)||!same(tx.to,session.wallet)||tx.value!=='0x0'||tx.data!=='0x'||!quantity(tx.chainId)||BigInt(tx.chainId)!==BigInt(config.chainId)||!quantity(tx.nonce)||!Number.isSafeInteger(Number(BigInt(tx.nonce))))fail();
 if(!quantity(packet.originalNonce)||BigInt(packet.originalNonce)!==BigInt(tx.nonce))fail();
 if(operation.transaction?.nonce!==undefined&&BigInt(operation.transaction.nonce)!==BigInt(tx.nonce))fail();
 return {...tx};
}
/** A separate, explicit self-transfer. It never resends the original business call. */
export function PendingOperationCancellation({operation,api,onRecovered,walletClient,session,configuration,isCurrent,storage=globalThis.localStorage}){
 const wallet=address(session?.wallet)?session.wallet.toLowerCase():'',owner=operation?.wallet??operation?.receiver;
 let path='',originalPath='';try{path=cancellationPath(operation);originalPath=productOperationPath(operation);}catch{}
 const visible=Boolean(path&&same(owner,wallet)&&pending(operation?.state)&&typeof api==='function'&&typeof isCurrent==='function');
 const key=wallet&&path?'mf-product-cancellation-v1:'+wallet+':'+path:'';
 const identity=JSON.stringify([key,operation?.state]),scope=useRef({identity,session,epoch:0,busy:false});
 if(scope.current.identity!==identity||scope.current.session!==session)scope.current={identity,session,epoch:scope.current.epoch+1,busy:false};
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const epoch=scope.current.epoch,current=()=>mounted.current&&scope.current.epoch===epoch&&isCurrent?.()===true;
 const check=()=>{if(!current())throw Error('钱包会话已变化，请回到原钱包查看原请求。');};
 const [view,setView]=useState(null),value=view?.epoch===epoch?view:{};
 let saved=null,storageError=false;try{const raw=key&&storage?.getItem(key);saved=raw?JSON.parse(raw):null;if(saved&&(saved.wallet!==wallet||saved.id!==operation.id||saved.hash!==undefined&&!hash(saved.hash)))throw Error();}catch{storageError=true;}
 const savedHash=saved?.hash,entered=value.hash??savedHash??(hash(operation?.cancellationHash)?operation.cancellationHash:'');
 const update=next=>setView(previous=>({...((previous?.epoch===epoch&&previous)||{}),...next,epoch}));
 function remember(record){if(!storage?.setItem)throw Error('无法保存作废交易，请先恢复浏览器本地存储。');const text=JSON.stringify({wallet,id:operation.id,...record});storage.setItem(key,text);if(storage.getItem(key)!==text)throw Error('作废交易保存失败，请保留钱包中的交易编号。');}
 function verifyResult(result){if(result?.id!==operation.id||result?.kind!==operation.kind||!same(result?.wallet??result?.receiver,wallet))fail();return result;}
 async function refreshOriginal(cancellation){
  check();let result,redirect=cancellation?.replacementOperationId;
  if(!redirect){result=verifyResult(await api(originalPath));check();redirect=result.replacementOperationId;}
  if(redirect){
   if(operation.kind!=='handover'||typeof redirect!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(redirect)||redirect===operation.id)fail();
   result=await api('/merchant/operations/'+encodeURIComponent(redirect));check();
   if(result?.id!==redirect||result.kind!=='handover'||!same(result.wallet??result.receiver,wallet)||result.handoverPreviouslyConfirmed!==true||operation.voucherId&&operation.voucherId!==result.voucherId)fail();
  }
  update({message:redirect?'原交餐记录已保留，请继续完成钱包确认，勿重复交餐。':result.state==='CANCELLED'?'原请求已安全作废，可以继续其他操作。':result.state==='CONFIRMED'?'原交易已先完成，请查看原结果。':'仍待链上核验，原请求继续保留。'});await onRecovered?.(result);
 }
 async function bind(txHash){check();const proof=verifyResult(await api(path,{method:'POST',body:{txHash:txHash.toLowerCase()}}));check();await refreshOriginal(proof);}
 async function task(run){if(!visible||scope.current.busy)return;scope.current.busy=true;update({busy:true,error:'',message:''});try{check();await run();}catch(e){if(current())update({error:e.message||'作废未确认，原请求仍保留。'});}finally{if(current()){scope.current.busy=false;update({busy:false});}}}
 async function recover(){if(!hash(entered))return;await task(()=>bind(entered));}
 async function send(){if(!value.accepted||!walletClient?.sendCancellationTransaction||savedHash)return;
  await task(async()=>{
   const packet=verifyResult(await api(path));check();
   if(terminal(packet.state)){await refreshOriginal(packet);return;}
   if(hash(packet.cancellationHash)){remember({hash:packet.cancellationHash.toLowerCase()});update({hash:packet.cancellationHash.toLowerCase()});await refreshOriginal(packet);return;}
   const config=typeof configuration==='function'?await configuration():configuration;check();
   const tx=validateCancellationPacket(packet,operation,session,config),fingerprint=JSON.stringify(tx);
   if(saved?.fingerprint&&saved.fingerprint!==fingerprint)fail();
   const observed=await walletClient.inspect();check();if(!same(observed?.account,wallet)||observed.chainId!==config.chainId)fail();
   // Persist the exact same-nonce self-transfer before showing the wallet.
   remember({fingerprint});
   const txHash=await walletClient.sendCancellationTransaction(wallet,tx,check);
   if(!hash(txHash))throw Error('钱包未返回有效的作废交易编号，原请求仍保留。');
   // Save under the OLD wallet even if it changed while the prompt was open.
   try{remember({fingerprint,hash:txHash.toLowerCase()});}catch(error){if(current())update({hash:txHash.toLowerCase(),accepted:false});throw Error('无法保存作废交易，请保留此编号并核验：'+txHash);}
   check();update({hash:txHash.toLowerCase(),accepted:false});await bind(txHash);
  });
 }
 if(!visible)return null;
 return <section aria-label="安全作废原请求"><h3>不再继续原请求</h3><p>作废会向自己的钱包发送一笔零金额交易，可能产生 Gas 费用。不会重新发送原付款、授权或交餐操作。若原交易先完成，请查询原结果；只有链上确认作废后才能释放原请求。</p>
 <label><input type="checkbox" aria-label="确认零转账作废及Gas费用" checked={Boolean(value.accepted)} disabled={value.busy||Boolean(savedHash)} onChange={e=>update({accepted:e.target.checked})}/>我了解零转账作废交易及可能的 Gas 费用</label>
 <button className="button outline" disabled={!value.accepted||value.busy||Boolean(savedHash)||!walletClient?.sendCancellationTransaction||!configuration||storageError} onClick={send}>在钱包确认作废交易</button>
 <label>已有作废交易编号<input aria-label="已有作废交易编号" value={entered} disabled={value.busy} autoComplete="off" spellCheck={false} onChange={e=>update({hash:e.target.value.trim()})} style={{width:'100%'}}/></label>
 <button className="button outline" disabled={value.busy||!hash(entered)} onClick={recover}>核验作废交易</button>
 {value.error&&<p role="alert">{value.error}</p>}{value.message&&<p role="status">{value.message}</p>}
 </section>;
}
