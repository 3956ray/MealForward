/** Aggregate diagnostics only: no wallets, voucher IDs, packets or credentials in logs. */
export function makeWorkerMonitor({store,provider,targets,clock=()=>Math.floor(Date.now()/1000),log=line=>process.stdout.write(line+'\n')}){
 let lastCheck=0,lastSummary='',lastLog=0;
 return {async sample(){const now=clock();if(now-lastCheck<30)return;lastCheck=now;
  const root=await store.read(),states=[root,...Object.values(root.targetStates||{})],tasks=states.flatMap(s=>[...Object.values(s.claims||{}),...Object.values(s.autoSettlements||{})]).filter(t=>!['CONFIRMED','CANCELLED','REJECTED'].includes(t.state));
  const balanceLow=[];for(const t of targets){if(balanceLow.includes(t.claimAuthority.toLowerCase()))continue;try{if(await provider.getBalance(t.claimAuthority,'pending')<BigInt(t.maxTransactionFee)*3n)balanceLow.push(t.claimAuthority.toLowerCase());}catch{balanceLow.push('RPC_UNAVAILABLE');}}
  const oldestPendingSeconds=Math.max(0,...tasks.map(t=>Math.max(0,now-(t.availableAt??t.createdAt??now))));
  const report={checkedAt:now,pending:tasks.length,unresolved:tasks.filter(t=>['SIGNED','SEND_UNKNOWN','HASH_BOUND'].includes(t.state)).length,delayed:tasks.filter(t=>['DELAYED','REVERTED'].includes(t.state)).length,oldestPendingSeconds,lowBalance:balanceLow.length>0,backlogAlert:oldestPendingSeconds>600};
  await store.transact(s=>{s.workerStatus=report;});const summary=JSON.stringify({lowBalance:report.lowBalance,backlogAlert:report.backlogAlert,delayed:report.delayed});
  if(summary!==lastSummary||now-lastLog>=300){log(JSON.stringify({event:'PRODUCT_WORKER_HEALTH',...report}));lastSummary=summary;lastLog=now;}return report;
 }};
}
