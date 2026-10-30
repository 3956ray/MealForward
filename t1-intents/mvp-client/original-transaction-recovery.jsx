import {PendingOperationCancellation} from './pending-operation-cancellation.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {productOperationPath} from './product-wallet.mjs';
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value)&&BigInt(value)!==0n;
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);

/** Original-hash controls only record/query. The separate cancellation sibling requires its own consent. */
export function OriginalTransactionRecovery({operation,api,onRecovered,walletClient,session,configuration,isCurrent}){
 const wallet=address(operation?.wallet)?operation.wallet.toLowerCase():'';
 let path=null;try{path=productOperationPath(operation);}catch{}
 const visible=Boolean(wallet&&path&&['SEND_UNKNOWN','HASH_BOUND'].includes(operation?.state));
 const bound=hash(operation?.txHash)?operation.txHash.toLowerCase():null;
 const key=JSON.stringify([wallet,path,operation?.state,bound]);
 const scope=useRef({key,epoch:0,busy:false});
 if(scope.current.key!==key)scope.current={key,epoch:scope.current.epoch+1,busy:false};
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const epoch=scope.current.epoch,current=()=>mounted.current&&scope.current.epoch===epoch;
 const [draft,setDraft]=useState(null),[feedback,setFeedback]=useState(null);
 const value=bound||(draft?.epoch===epoch?draft.value:hash(operation?.candidateHash)?operation.candidateHash:'');
 const busy=feedback?.epoch===epoch&&feedback.busy===true;
 const message=feedback?.epoch===epoch?feedback.message:'';
 const error=feedback?.epoch===epoch?feedback.error:'';
 async function recover(){
  if(!visible||scope.current.busy||!hash(value)||typeof api!=='function')return;
  scope.current.busy=true;setFeedback({epoch,busy:true});
  try{
   if(!bound){
    await api(path+'/hash',{method:'POST',body:{txHash:value.toLowerCase()}});
    if(!current())return;
   }
   const result=await api(path);
   if(!current())return;
   const owner=result?.wallet??result?.receiver;
   if(result?.id!==operation.id||result?.kind!==operation.kind||!address(owner)||owner.toLowerCase()!==wallet){
    throw Error('返回的原操作与当前钱包不一致，请重新读取原操作。');
   }
   setFeedback({epoch,busy:false,message:result.state==='CONFIRMED'?'原交易已确认。':result.state==='REVERTED'?'原交易执行失败，请查看原操作。':'原交易结果仍待核验，不会再次发送。'});
   if(current())await onRecovered?.(result);
  }catch(err){if(current())setFeedback({epoch,busy:false,error:err.message||'暂时无法核验，请保留原交易编号。'});}
  finally{if(current())scope.current.busy=false;}
 }
 if(!visible)return null;
 return <><section aria-label="找回原交易">
  <p>从钱包交易记录复制原交易编号，仅核验，不会再次付款</p>
  <label>原交易编号<input aria-label="原交易编号" autoComplete="off" spellCheck={false} placeholder="0x…" value={value} readOnly={Boolean(bound)} disabled={busy} onChange={e=>{if(!bound)setDraft({epoch,value:e.target.value.trim()});}} style={{width:'100%',overflowWrap:'anywhere'}}/></label>
  {bound?<p>该编号已通过验证，不能更换；可以继续查询原交易。</p>:<p>请粘贴完整编号：0x 开头，后面为 64 位字符。未验证的编号可以修正。</p>}
  <button className="button outline" disabled={busy||!hash(value)||typeof api!=='function'} onClick={recover}>{busy?'正在核验原交易…':'核验原交易编号'}</button>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </section><PendingOperationCancellation operation={operation} api={api} onRecovered={onRecovered} walletClient={walletClient} session={session} configuration={configuration} isCurrent={isCurrent}/></>;
}
