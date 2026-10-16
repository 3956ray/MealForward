/** Live public ledger. Only aggregated CP30 DTO fields, never private vouchers. */
import {priceLabel} from './onboarding-view.mjs';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COUNT_KEYS=['F','A','R','H','S','X'];
const COUNT_LABELS={F:'Meals supported',A:'Available to claim',R:'Claimed, awaiting meal',H:'Handover reported, awaiting payout',S:'Settled',X:'Refunded'};
const COUNT_LIMIT=/^(0|[1-9][0-9]{0,76})$/;
const count=value=>COUNT_LIMIT.test(String(value??''))?BigInt(value):null;
const amount=(value,setup)=>count(value)===null?'Not available':priceLabel(String(value),setup?.assetDecimals??6,setup?.assetSymbol??'test USDC');
const viewValue=value=>value===null?'Not available':value.toString();

export function verifiedLedgerRows(items){
  if(!Array.isArray(items))return [];
  return items.map(item=>{
    const id=typeof item?.store==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(item.store)?item.store:null;
    const raw=item?.financial?.counts;
    const counts=Object.fromEntries(COUNT_KEYS.map(key=>[key,count(raw?.[key])]));
    const valid=Boolean(id)&&COUNT_KEYS.every(key=>counts[key]!==null)
      && counts.F===counts.A+counts.R+counts.H+counts.S+counts.X
      && (item.funded===undefined||count(item.funded)===counts.F);
    return {id,valid,counts,financial:item?.financial??null};
  });
}

export function renderPublicLedger({items=[],stores=[],setup={},loading=false,error=''}={}){
  const header='<div class="breadcrumb"><a href="#home">MealForward home</a> / Public meal ledger</div><div class="page-heading"><div class="eyebrow">EVERY MEAL, ACCOUNTED FOR</div><h1>Kindness, with a clear record.</h1><p>Public meal counts and accounting from the connected service. Recipient identities and private voucher codes are never displayed.</p></div>';
  const start='<div class="container page live-public-ledger">'+header;
  if(loading)return start+'<section class="panel" role="status">Checking the public meal ledger…</section></div>';
  if(error)return start+`<section class="panel"><p class="error" role="alert">The ledger is temporarily unavailable. ${e(error)}</p><p>Previously loaded values are not presented as current. Try again when the service is available.</p><a class="button outline" href="#stores">View kitchens</a></section></div>`;
  if(!Array.isArray(items))return start+'<section class="panel" role="alert">Ledger response needs verification. No accounting totals are displayed.</section></div>';
  if(items.length===0)return start+'<section class="panel"><h2>No verified kitchen accounting yet.</h2><p>No ledger entries have been returned by the connected service. No totals are assumed.</p><a class="button outline" href="#stores">View kitchens</a></section></div>';
  const rows=verifiedLedgerRows(items),allValid=rows.every(r=>r.valid);
  const totals=Object.fromEntries(COUNT_KEYS.map(key=>[key,allValid?rows.reduce((s,r)=>s+r.counts[key],0n):null]));
  const summary=`<div class="ledger-stats">${[['F','Lifetime supported'],['A','Available now'],['R','Claimed'],['H','Reported, not yet paid'],['S','Settled'],['X','Refunded']].map(([key,description])=>`<section class="stat"><h2>${COUNT_LABELS[key]}</h2><strong>${viewValue(totals[key])}</strong><small>${description}</small></section>`).join('')}</div>`;
  const names=new Map((Array.isArray(stores)?stores:[]).filter(s=>typeof s?.id==='string'&&typeof s.name==='string').map(s=>[s.id,s.name]));
  const kitchenCards=rows.map(row=>{
    const title=row.id?(names.get(row.id)||'Registered kitchen'):'Unverified kitchen';
    if(!row.valid)return `<article class="panel"><h2>${e(title)}</h2><p class="notice warning" role="status">This kitchen's accounting projection needs verification. No incomplete or inconsistent values are shown.</p></article>`;
    const c=row.counts,amounts=row.financial;
    return `<article class="panel"><h2><a href="#store/${encodeURIComponent(row.id)}">${e(title)}</a></h2><dl class="facts">${COUNT_KEYS.map(k=>`<div><dt>${COUNT_LABELS[k]}</dt><dd>${viewValue(c[k])}</dd></div>`).join('')}<div><dt>Total funded value</dt><dd>${e(amount(amounts.F,setup))}</dd></div><div><dt>Awaiting payout value</dt><dd>${e(amount(amounts.H,setup))}</dd></div><div><dt>Settled value</dt><dd>${e(amount(amounts.S,setup))}</dd></div><div><dt>Current outstanding liability</dt><dd>${e(amount(amounts.liability,setup))}</dd></div></dl><details><summary>How these totals are counted</summary><p>F = A + R + H + S + X. Reports and settlements are different states. Only actual finalized operation evidence can advance the relevant bucket.</p></details></article>`;
  }).join('');
  return `${start}${allValid?'':'<p class="notice warning" role="status">Some public records need verification. Aggregate totals are withheld until the projections are consistent.</p>'}${summary}<div class="ledger-kitchens">${kitchenCards}</div><p class="notice">These values describe the connected service's verified on-chain accounting projection, not independent proof of real-world meal delivery. No private claimant or short-lived voucher information is published.</p></div>`;
}
