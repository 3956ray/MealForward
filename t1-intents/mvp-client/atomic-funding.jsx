import {t as tr,translateError} from './locale.mjs';
import {useLanguage} from './locale-react.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {atomicCapability,createAtomicCoordinator} from './atomic-wallet.mjs';
export function AtomicFundingChoice({api,walletClient,session,configuration,isCurrent,review,operation,children}){
 useLanguage();
 const recoveryKey=review&&session?'mf-atomic-prepare:'+session.wallet.toLowerCase()+':'+review.id:null;
 const restore=()=>{try{const r=JSON.parse(globalThis.localStorage?.getItem(recoveryKey)||'null');return r?.wallet===session?.wallet.toLowerCase()&&r.reviewId===review?.id?{requestId:r.requestId,state:'PREPARING_UNKNOWN'}:null;}catch{return null;}};
 const [enabled,setEnabled]=useState(null),[op,setOp]=useState(()=>operation||restore()),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef(crypto.randomUUID()),active=useRef(true),lock=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const current=()=>active.current&&isCurrent?.()===true;
 useEffect(()=>{let alive=true;if(operation){setEnabled(true);return;}if(!walletClient?.atomicCapabilities||!session||!configuration){setEnabled(false);return;}Promise.resolve(typeof configuration==='function'?configuration():configuration).then(c=>atomicCapability({wallet:walletClient,api,session,configuration:c,isCurrent:current})).then(r=>{if(alive&&current())setEnabled(r.enabled);}).catch(()=>{if(alive)setEnabled(false);});return()=>{alive=false;};},[review?.id,operation?.id,session?.wallet]);
 async function act(action){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(e){if(current())setError(e.message);}finally{lock.current=false;if(current())setBusy(false);}}
 async function coordinator(){const config=typeof configuration==='function'?await configuration():configuration;return createAtomicCoordinator({wallet:walletClient,api,session,configuration:config,isCurrent:current});}
 function prepare(){act(async()=>{const record=JSON.stringify({requestId:request.current,wallet:session.wallet.toLowerCase(),reviewId:review.id});globalThis.localStorage.setItem(recoveryKey,record);if(globalThis.localStorage.getItem(recoveryKey)!==record)throw Error('JOURNAL_FAILED');setOp({state:'PREPARING_UNKNOWN',requestId:request.current});const result=await api('/atomic-funding/prepare',{method:'POST',body:{reviewId:review.id,requestId:request.current}});if(current())setOp(result);});}
 function send(){act(async()=>{const c=await coordinator(),original=op;setOp({...original,state:'SEND_UNKNOWN'});const result=await c.send(original);if(current())setOp(result);});}
 function recover(){act(async()=>{let result;if(!op.id)result=await api('/atomic-funding/by-request/'+encodeURIComponent(op.requestId));else{const original=await api('/atomic-funding/'+op.id+'/status');result=original.state==='SEND_UNKNOWN'?await (await coordinator()).recover(original):original;}if(current())setOp(result);});}
 function cancelExpired(){act(async()=>{const result=await api('/atomic-funding/'+op.id+'/cancel-expired',{method:'POST',body:{}});if(current())setOp(result);});}
 if(enabled===null&&!op)return <p>{tr("正在核验钱包付款方式…")}</p>;
 if(!enabled&&!op)return <><p>{tr("当前钱包或账户实现尚未通过单次确认核验。需要先确认精确额度授权，再单独确认付款；授权本身不扣餐款。")}</p>{children}</>;
 return <section aria-label={tr("合并授权付款")}><p>{tr("已验证的钱包可将精确额度授权与付款合并；两步必须全部成功。首次账户升级可能还需钱包确认。")}</p>{!op?<button disabled={busy} onClick={prepare}>{tr("审核合并授权与付款")}</button>:<><p>{op.state==='CANCELLED'?tr("链上已确认原付款过期且未完成，可以重新选择餐品。"):op.state==='CONFIRMED'?tr("资助已确认"):op.state==='PREPARED'?tr("请在钱包确认本次合并付款"):tr("原批次待核验，不会改用另一次付款。")}</p>{op.state==='PREPARED'&&<button disabled={busy} onClick={send}>{tr("钱包确认合并付款")}</button>}<button disabled={busy} onClick={recover}>{tr("查询原付款批次")}</button>{op.id&&op.state==='SEND_UNKNOWN'&&op.expiresAt<=Math.floor(Date.now()/1000)&&<button disabled={busy} onClick={cancelExpired}>{tr("核验过期并解除未付款占位")}</button>}</>}{error&&<p role="alert">{translateError(error)}</p>}</section>;
}
