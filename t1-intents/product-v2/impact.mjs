/** Public aggregate projection. No signer, credential or private row is serialized. */
const fields=['funded','available','claimed','handedOver','settled','refundPending','refunded'];
const day=t=>new Date((t+28800)*1000).toISOString().slice(0,10);
const integer=v=>{if(!/^(0|[1-9][0-9]*)$/.test(String(v)))throw Error('IMPACT_COUNT_INVALID');return BigInt(v);};
export function aggregateImpact(snapshots,days,now){
 const counts=Object.fromEntries(fields.map(k=>[k,0n])),recipients=new Set(),stores=[],funding=[],deliveries=[];
 for(const s of snapshots){if(s.verified!==true)throw Error('IMPACT_UNVERIFIED');
  for(const row of s.stores){const c=row.counts;if(integer(c.funded)!==fields.slice(1).reduce((n,k)=>n+integer(c[k]),0n))throw Error('IMPACT_NOT_CONSERVED');for(const k of fields)counts[k]+=integer(c[k]);
   const members=new Set(s.deliveries.filter(d=>d.storeId===row.id).map(d=>d.recipient.toLowerCase()));for(const w of members)recipients.add(w);
   if(integer(c.funded)>0n)stores.push({id:s.targetId+':'+row.id,storeId:row.id,targetId:s.targetId,name:row.name,legacy:s.legacy===true,closed:row.closed===true,funded:c.funded,delivered:String(integer(c.handedOver)+integer(c.settled)),users:String(members.size)});
  }
  for(const f of s.funding)funding.push({...f,targetId:s.targetId,chainId:s.chainId});
  for(const d of s.deliveries)deliveries.push({...d,targetId:s.targetId});
 }
 const complete=snapshots.every(s=>s.complete===true);
 const asOf=Math.min(now,...snapshots.map(s=>s.chainTime??s.checkedAt));
 const lastDay=day(asOf),firstDay=days==='all'?funding.reduce((d,f)=>day(f.at)<d?day(f.at):d,lastDay):day(asOf-(days-1)*86400);
 // Daily detail for short histories; bounded monthly buckets for long-lived kitchens.
 const span=Math.round((Date.parse(lastDay)-Date.parse(firstDay))/86400000)+1,granularity=span>366?'month':'day';
 const key=d=>granularity==='month'?d.slice(0,7)+'-01':d,series=[];
 if(granularity==='day')for(let i=0;i<span;i++)series.push({date:day(asOf-(span-i-1)*86400),funded:0n,delivered:0n});
 else{let cursor=Date.parse(key(firstDay));const end=Date.parse(key(lastDay));while(cursor<=end){if(series.length>=1200)throw Error('IMPACT_RANGE_TOO_LARGE');series.push({date:new Date(cursor).toISOString().slice(0,10),funded:0n,delivered:0n});const d=new Date(cursor);cursor=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);}}
 const byDay=new Map(series.map(r=>[r.date,r]));let fundedBase=0n,deliveredBase=0n;
 for(const f of funding){const d=day(f.at),r=byDay.get(key(d));if(r)r.funded+=integer(f.quantity);else if(d<firstDay)fundedBase+=integer(f.quantity);}
 for(const d of deliveries){const date=day(d.at),r=byDay.get(key(date));if(r)r.delivered++;else if(date<firstDay)deliveredBase++;}
 for(const r of series){fundedBase+=r.funded;deliveredBase+=r.delivered;r.cumulativeFunded=String(fundedBase);r.cumulativeDelivered=String(deliveredBase);}

 return {verified:true,updatedAt:Math.min(...snapshots.map(s=>s.checkedAt)),coverage:complete?'complete':'syncing',sources:snapshots.map(s=>({targetId:s.targetId,blockNumber:s.blockNumber,blockHash:s.blockHash,complete:s.complete})),counts:Object.fromEntries(fields.map(k=>[k,String(counts[k])])),metrics:{funded:String(counts.funded),delivered:String(counts.handedOver+counts.settled),users:complete?String(recipients.size):null,kitchens:String(stores.length)},trend:complete?series.map(r=>({...r,funded:String(r.funded),delivered:String(r.delivered)})):null,stores:complete?stores:[],recent:funding.sort((a,b)=>b.at-a.at).slice(0,20).map(f=>({id:f.targetId+':'+f.id,name:f.name,quantity:f.quantity,amount:f.amount,at:f.at,txHash:f.txHash,chainId:f.chainId})),days,granularity};
}
export function makeImpactService({store,chains,registry,clock=()=>Math.floor(Date.now()/1000)}){
 let busy=false,lastAttempt=0,failed=false;
 const ids=registry.ids();
 return {
  async refresh(){if(busy||clock()-lastAttempt<30)return;busy=true;lastAttempt=clock();try{
   const snapshots=await Promise.all(ids.map(async id=>{const chain=chains.get(id);await chain.scanImpactHistory?.();return {...await chain.impactSnapshot(),targetId:id,legacy:id===registry.legacyTargetId};}));
   aggregateImpact(snapshots,30,clock());
   await store.transact(s=>{const old=s.impactProjection;if(old&&ids.some(id=>(old.snapshots.find(v=>v.targetId===id)?.blockNumber??-1)>(snapshots.find(v=>v.targetId===id)?.blockNumber??-1)))return;
    // Keep the previous complete result while a new source is catching up.
    if(old?.snapshots.every(v=>v.complete)&&snapshots.some(v=>!v.complete)){s.impactProjection={...old,stale:true};return;}
    s.impactProjection={schema:1,snapshots,stale:false};
   });failed=false;
  }catch{failed=true;}finally{busy=false;}},
  async read(days=30){if(![7,30,90,'all'].includes(days))throw Error('IMPACT_RANGE_INVALID');const saved=(await store.read()).impactProjection;
   if(!saved||saved.schema!==1||saved.snapshots.length!==ids.length||ids.some(id=>!saved.snapshots.some(s=>s.targetId===id)))return {coverage:'syncing',metrics:null,trend:null,stores:[],recent:[],sources:[],days};
   return {...aggregateImpact(saved.snapshots,days,clock()),stale:failed||saved.stale||clock()-Math.min(...saved.snapshots.map(s=>s.checkedAt))>120};
  }
 };
}
