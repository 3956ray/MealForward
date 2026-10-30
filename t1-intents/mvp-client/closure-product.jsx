import {OriginalTransactionRecovery} from './original-transaction-recovery.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {formatAmount} from './catalog-state.mjs';
const terminal=o=>['CONFIRMED','REVERTED','REJECTED','CANCELLED'].includes(o?.state);
export function ClosureProduct({api,walletClient,configuration,isCurrent,session,active,catalog,onWalletOperation,onChanged,storage=globalThis.sessionStorage}){
 const wallet=session?.wallet?.toLowerCase()||'',storeId=session?.stores?.[0],key='mf-product-closure:'+wallet+':'+(storeId||'');
 const [snapshot,setSnapshot]=useState(null),[operation,setOperation]=useState(null),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const scope=useRef({wallet,storeId,active,epoch:0}),lock=useRef(false),opRef=useRef(null);
 if(scope.current.wallet!==wallet||scope.current.storeId!==storeId||scope.current.active!==active){scope.current={wallet,storeId,active,epoch:scope.current.epoch+1};lock.current=false;opRef.current=null;}
 const epoch=scope.current.epoch,valid=e=>scope.current.epoch===e;
 const remember=(op,e)=>{storage.setItem(key,JSON.stringify({id:op.id,requestId:op.requestId,kind:op.kind,state:op.state}));if(valid(e)){opRef.current=op;setOperation({...op,epoch:e});}};
 async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');const e=epoch;try{await fn(e);}catch(err){if(valid(e))setError(err.message);}finally{if(valid(e)){lock.current=false;setBusy(false);}}}
 async function load(e){const result=await api('/merchant/refunds?storeId='+encodeURIComponent(storeId));if(valid(e))setSnapshot({...result,epoch:e});}
 useEffect(()=>{setSnapshot(null);setOperation(null);setAck(false);setError('');setBusy(false);if(!active||!wallet||!storeId)return;try{const old=JSON.parse(storage.getItem(key)||'null');if(old?.requestId){opRef.current=old;setOperation({...old,state:'SEND_UNKNOWN',epoch});}}catch{setError('无法读取退款记录，请从原操作历史找回。');}void run(load);},[active,wallet,storeId,api]);
 const current=snapshot?.epoch===epoch?snapshot:null,op=operation?.epoch===epoch?operation:null;
 async function prepare(kind,item){if(opRef.current&&!terminal(opRef.current))return;await run(async e=>{
  const body={storeId,requestId:crypto.randomUUID(),...(kind==='closure'?{acknowledge:ack}:{batchId:item.batchId})};
  const original={kind,requestId:body.requestId,state:'SEND_UNKNOWN'};remember(original,e);
  try{const result=await api(kind==='closure'?'/merchant/closure':'/merchant/refunds',{method:'POST',body});if(valid(e))remember({...original,...result},e);}
  catch(err){if(valid(e)&&[400,401,403,409,422].includes(err.status))remember({...original,state:'REJECTED'},e);throw err;}
 });}
 async function recover(){if(!op)return;await run(async e=>{const result=await api(op.id?'/catalog-operations/'+encodeURIComponent(op.id):'/catalog-operations/by-request/'+encodeURIComponent(op.requestId));if(valid(e)){remember(result,e);await load(e);if(result.state==='CONFIRMED')await onChanged?.();}});}
 async function send(){if(op?.state!=='PREPARED')return;await run(async e=>{const original=op;remember({...op,state:'SEND_UNKNOWN'},e);await onWalletOperation(original);if(valid(e)){remember(await api('/catalog-operations/'+encodeURIComponent(original.id)),e);await load(e);await onChanged?.();}});}
 async function cancel(){if(op?.state!=='PREPARED')return;await run(async e=>{const result=await api('/catalog-operations/'+encodeURIComponent(op.id)+'/cancel',{method:'POST',body:{}});if(valid(e))remember(result,e);});}
 if(!active||!wallet||!storeId)return null;
 const money=v=>formatAmount(v,catalog?.asset?.decimals??6)+' '+(catalog?.asset?.symbol??'USDC');
 return <section className="panel" aria-label="永久停业与退款"><h2>永久停业与退款</h2><p role="alert">{error}</p><p>临时休息请使用“今日休息”。永久停业后不能恢复上架。</p>{current&&!current.closed&&<><p>确认后，未交餐餐券立即失效，领取人可重新领取其他餐食。餐款按原资助逐笔退回；已交餐餐款仍可结算。</p><label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>我确认永久停业，并处理全部待退款项</label><button className="button outline" disabled={!ack||busy||op&&!terminal(op)} onClick={()=>prepare('closure')}>审核永久停业</button></>}
 {current?.closed&&<><p>店铺已永久停业。以下每笔退款均退回原资助钱包，金额按当时餐价计算。</p>{current.items.map(item=><article key={item.batchId}><p>{item.quantity} 份 · {money(item.amount)} · {item.refunded?'已退款':BigInt(item.amount)===0n?'无需退款':'待退款'}</p><p style={{overflowWrap:'anywhere'}}>原资助钱包：{item.payer}</p>{!item.refunded&&BigInt(item.amount)>0n&&<button className="button" disabled={busy||op&&!terminal(op)} onClick={()=>prepare('refund',item)}>审核这笔退款</button>}</article>)}{!current.items.length&&<p>没有待退款的资助。</p>}</>}
 {op&&<section role="dialog" aria-label="停业退款原操作"><OriginalTransactionRecovery walletClient={walletClient} session={session} configuration={configuration} isCurrent={isCurrent} operation={op} api={api} onRecovered={async result=>{remember(result,epoch);await load(epoch);await onChanged?.();}}/><h3>{op.kind==='closure'?'永久停业确认':'退款确认'}</h3>{op.alreadyRefunded&&<p>该笔资助已退回，本次未重复转账。</p>}{op.kind==='refund'&&op.amount&&<><p>退回 {money(op.amount)}</p><p style={{overflowWrap:'anywhere'}}>收款钱包：{op.payer}</p></>}<p>{op.state==='CONFIRMED'?'原操作已确认':op.state==='PREPARED'?'请核对后在商家钱包确认':terminal(op)?'原操作未完成':'结果待核对，请查询原操作，不要重复发送。'}</p>{op.state==='PREPARED'&&<><button className="button" disabled={busy} onClick={send}>核对无误，钱包确认</button><button disabled={busy} onClick={cancel}>取消未发送操作</button></>}<button disabled={busy||op.state==='REJECTED'} onClick={recover}>查询原操作</button></section>}
 <button className="button outline" disabled={busy} onClick={()=>run(load)}>刷新停业与退款状态</button></section>;
}
