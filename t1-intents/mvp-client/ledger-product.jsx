import React,{useEffect,useState} from 'react';
import {formatAmount} from './catalog-state.mjs';
export function LedgerProduct({api}){
 const [ledger,setLedger]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true;setError('');api('/ledger').then(value=>{if(active)setLedger(value);}).catch(()=>{if(active)setError('暂时无法核验公共账，请稍后刷新。');});return()=>{active=false;};},[api,refresh]);
 const labels={funded:'已资助',available:'待领取',claimed:'已领取待使用',handedOver:'已交餐待结算',settled:'已结算',refundPending:'退款处理中',refunded:'已退款'};
 return <section><h1>公共账</h1><p>每份资助都记录去向；此处不展示领取人的身份或餐券凭证。</p><button className="button outline" onClick={()=>setRefresh(n=>n+1)}>刷新账目</button><p role="alert">{error}</p>{!ledger&&!error&&<p role="status">正在核验账目…</p>}{ledger&&<><p>已核验至区块 {ledger.blockNumber}{error?'；以下保留上次结果。':'。'}</p><div className="store-grid">{Object.entries(labels).map(([key,label])=><article className="panel" key={key}><h2>{label}</h2><strong>{ledger.counts[key]??'0'} 份</strong></article>)}</div><h2>最近的资助</h2>{ledger.items.map(item=><article className="panel" key={item.txHash}><h3>{item.name}</h3><p>{item.quantity} 份 · {formatAmount(item.amount,ledger.asset.decimals)} {ledger.asset.symbol} · 原餐品版本 {item.version}</p>{item.txHash&&(ledger.chainId===10143?<a href={'https://testnet.monadexplorer.com/tx/'+item.txHash} target="_blank" rel="noreferrer">查看链上记录</a>:<p>本地验收交易：{item.txHash.slice(0,14)}…</p>)}</article>)}{!ledger.items.length&&<p>暂无已确认的资助记录。</p>}</>}</section>;
}
