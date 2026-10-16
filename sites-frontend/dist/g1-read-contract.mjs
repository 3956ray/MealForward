/**
 * CP31 G1 source-contract assertions. These checks verify API DTO shape,
 * NOT finality of the original CP30 ledger or session ownership. Only the
 * original backend can enforce wallet-principal isolation and receipt truth.
 * No synthesized values, write requests, private credentials or DB access.
 */
const STORE=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VOUCHER=/^0x[0-9a-f]{64}$/;
const POSINT=/^(0|[1-9][0-9]{0,77})$/;
const STAGE=/^[A-Z][A-Z_]{1,63}$/;
const BUCKETS=['A','R','H','S','X'];
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const decimal=x=>typeof x==='string'&&POSINT.test(x);
const fail=(scope)=>Object.assign(new Error('The '+scope+' response is incomplete or inconsistent. No original operation has been changed.'),{code:'READ_RESPONSE_INVALID'});
const check=(condition,scope)=>{if(!condition)throw fail(scope)};
const validStore=id=>typeof id==='string'&&STORE.test(id);
const validVoucher=id=>typeof id==='string'&&VOUCHER.test(id);
const nullable=(value,validator)=>value==null||validator(value);
const validAmount=x=>decimal(x);
const safeWindow=x=>Array.isArray(x)&&x.length<=2&&x.length>0&&x.every(w=>Array.isArray(w)&&w.length===2&&w.every(Number.isInteger)&&w[0]>=0&&w[0]<w[1]&&w[1]<=1440)&&x.every((w,i)=>i===0||x[i-1][1]<=w[0]);
const SENSITIVE_FIELDS=new Set(['email','emailhash','recipientkey','recipient_key','phone','cookie','csrf','signature','signingkey','privatekey','secret','accesstoken','display','displaycode','displayurl','sessiontoken','walletsignature','voucheraccess','recipientaddress']);
const cleanPublic=(node,scope,depth=0)=>{
  check(depth<=7,scope);
  if(Array.isArray(node)){check(node.length<=5000,scope);for(const item of node)cleanPublic(item,scope,depth+1);}
  else if(object(node)){
    check(Object.keys(node).length<=150,scope);
    for(const [key,value]of Object.entries(node)){check(!SENSITIVE_FIELDS.has(key.toLowerCase()),scope);cleanPublic(value,scope,depth+1);}
  }
};
const list=(value,scope)=>{
  check(object(value)&&Array.isArray(value.items)&&value.items.length<=500,scope);
  return value.items;
};
const unique=(items,key,scope)=>{
  const keys=new Set();
  for(const item of items){
    const id=key(item);
    check(typeof id==='string'&&!keys.has(id),scope);
    keys.add(id);
  }
};
function financial(projection,scope){
  check(object(projection)&&object(projection.counts),scope);
  const c=projection.counts;
  for(const key of ['F',...BUCKETS])check(decimal(c[key])&&decimal(projection[key]),scope);
  const totals=BUCKETS.map(k=>BigInt(c[k]));
  check(BigInt(c.F)===totals.reduce((a,b)=>a+b,0n),scope);
  const amounts=BUCKETS.map(k=>BigInt(projection[k]));
  check(BigInt(projection.F)===amounts.reduce((a,b)=>a+b,0n),scope);
  check(decimal(projection.liability)&&BigInt(projection.liability)===amounts[0]+amounts[1]+amounts[2],scope);
  return c;
}

export function verifiedPublicStores(value){
  const items=list(value,'public kitchens');
  for(const item of items){
    check(object(item)&&validStore(item.id)&&item.store===item.id, 'public kitchens');
    check(typeof item.name==='string'&&item.name.trim().length>0&&item.name.length<=200,'public kitchens');
    cleanPublic(item,'public kitchens');
  }
  unique(items,i=>i.id,'public kitchens');
  return items;
}

export function verifiedPublicMeals(value,storeId){
  const scope='public meals';
  check(validStore(storeId),scope);
  const items=list(value,scope);
  for(const meal of items){
    check(object(meal)&&STORE.test(meal.id)&&meal.store===storeId,scope);
    check(meal.mealId==='0x'+meal.id&&meal.listed!==undefined&&typeof meal.listed==='boolean',scope);
    check(meal.published===true&&typeof meal.name==='string'&&meal.name.trim().length>0&&meal.name.length<=200,scope);
    check(decimal(meal.unitPrice)&&BigInt(meal.unitPrice)>0n&&safeWindow(meal.windows),scope);
    check(decimal(meal.eligible)&&decimal(meal.supported),scope);
    const counts=financial(meal.financial,scope);
    check(meal.eligible===counts.A&&meal.supported===counts.F,scope);
    cleanPublic(meal,scope);
  }
  unique(items,i=>i.id,scope);
  return items;
}
export function verifiedContributions(value){
  const items=list(value,'my contributions');
  for(const intent of items){
    check(object(intent)&&UUID.test(intent.id)&&intent.intentId===intent.id&&intent.action==='fund', 'my contributions');
    check(typeof intent.stage==='string'&&STAGE.test(intent.stage)&&validStore(intent.store),'my contributions');
    check(nullable(intent.quantity,decimal)&&nullable(intent.amount,validAmount),'my contributions');
    check(nullable(intent.mealId,id=>VOUCHER.test(id)), 'my contributions');
    check(nullable(intent.transactionHash,id=>VOUCHER.test(id)), 'my contributions');
  }
  unique(items,i=>i.id,'my contributions');
  return items;
}
export function verifiedClaimIntents(value){
  const items=list(value,'my claims');
  for(const intent of items){
    check(object(intent)&&UUID.test(intent.id)&&intent.intentId===intent.id&&intent.action==='issue','my claims');
    check(typeof intent.stage==='string'&&STAGE.test(intent.stage)&&validStore(intent.store),'my claims');
    check(nullable(intent.transactionHash,id=>VOUCHER.test(id)),'my claims');
  }
  unique(items,i=>i.id,'my claims');
  return items;
}
function assertVoucher(value){
  const scope='my meals';
  check(object(value)&&validVoucher(value.id)&&value.voucherId===value.id&&validStore(value.store),scope);
  check(['R','H','S','X','OLD_GENERATION'].includes(value.state),scope);
  check(nullable(value.expiresAt,decimal)&&nullable(value.mealId,validVoucher),scope);
  check(nullable(value.generation,decimal)&&nullable(value.version,decimal),scope);
  if(value.terms!=null){
    check(object(value.terms)&&typeof value.terms.name==='string'&&value.terms.name.length>0,scope);
    check(safeWindow(value.terms.windows),scope);
  }
}
export function verifiedMyVouchers(value){
  const items=list(value,'my meals');
  for(const voucher of items)assertVoucher(voucher);
  unique(items,v=>v.id,'my meals');
  return items;
}
export function verifiedVoucher(value){
  assertVoucher(value);
  return value;
}
export function verifiedPublicLedger(value){
  const scope='public ledger';
  const items=list(value,scope);
  for(const row of items){
    check(object(row)&&validStore(row.store)&&decimal(row.funded),scope);
    const counts=financial(row.financial,scope);
    check(row.funded===counts.F,scope);
    cleanPublic(row,scope);
  }
  unique(items,row=>row.store,scope);
  return items;
}
