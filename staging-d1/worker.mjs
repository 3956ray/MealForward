// MealForward independently isolated D1 OFF-CHAIN acceptance service.
// No blockchain, wallet funds, existing CP30 database or Render Auth Pilot.
const HEAD={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEAD});
const failure=(message,status=400)=>response({error:message},status);
const id=()=>crypto.randomUUID();
const valid=s=>typeof s==='string'&&s.length>=1&&s.length<=50&&!/[<>]/.test(s);
const roleMap=new Set(['merchant','donor','recipient']);
const token=()=>crypto.randomUUID()+'-'+crypto.randomUUID();
const sha=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function person(request,db){
 const match=/^Bearer ([0-9a-f-]{73})$/.exec(request.headers.get('authorization')||'');
 if(!match)return null;
 return db.prepare('SELECT id,role FROM testers WHERE token_hash=?').bind(await sha(match[1])).first();
}
async function event(db,ref,event,actor){return db.prepare('INSERT INTO events(id,ref_id,event,actor) VALUES(?,?,?,?)').bind(id(),ref,event,actor).run();}
async function bodyOf(request){
 const raw=await request.text();if(raw.length>3000)throw Error('BODY_TOO_LARGE');
 return JSON.parse(raw||'{}');
}
export default {async fetch(request,env){
 const url=new URL(request.url),path=url.pathname,db=env.DB;
 if(path==='/'&&request.method==='GET')return new Response(__HTML__,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','x-content-type-options':'nosniff'}});
 if(path==='/health'&&request.method==='GET'){try{await db.prepare('SELECT COUNT(*) n FROM kitchens').first();return response({status:'READY',mode:'OFFCHAIN_PERSISTENT_D1',chainTransactions:false});}catch{return failure('DATABASE_UNAVAILABLE',503)}}
 if(!path.startsWith('/api/'))return failure('NOT_FOUND',404);
 if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return failure('ORIGIN_REJECTED',403);
 try{
 if(path==='/api/identities'&&request.method==='POST'){
  const b=await bodyOf(request);if(!roleMap.has(b.role))return failure('INVALID_ROLE');
  const t=token(),uid=id();await db.prepare('INSERT INTO testers(id,role,token_hash) VALUES(?,?,?)').bind(uid,b.role,await sha(t)).run();
  return response({identity:{id:uid,role:b.role},token:t},201);
 }
 const me=await person(request,db);
 if(!me)return failure('TEST_IDENTITY_REQUIRED',401);
 if(path==='/api/me'&&request.method==='GET')return response(me);
 if(path==='/api/overview'&&request.method==='GET'){
  const [k,o,v]=await db.batch([
   db.prepare('SELECT * FROM kitchens ORDER BY created_at DESC LIMIT 50'),
   db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100'),
   db.prepare('SELECT id,order_id,kitchen_id,recipient,state,created_at FROM vouchers ORDER BY created_at DESC LIMIT 200')
  ]);
  // This is an explicit shared TEST dataset; do not display sensitive real data.
  return response({mode:'OFFCHAIN_ONLY',kitchens:k.results,orders:o.results,vouchers:v.results});
 }
 if(path==='/api/kitchens'&&request.method==='POST'){
  if(me.role!=='merchant')return failure('MERCHANT_ROLE_REQUIRED',403);
  const b=await bodyOf(request);
  if(!valid(b.name)||!valid(b.mealName)||!Number.isSafeInteger(b.price)||b.price<1||b.price>100)return failure('INVALID_KITCHEN');
  const uid=id();await db.prepare('INSERT INTO kitchens(id,name,owner,price,meal_name) VALUES(?,?,?,?,?)').bind(uid,b.name,me.id,b.price,b.mealName).run();
  await event(db,uid,'KITCHEN_CREATED',me.id);return response({id:uid,status:'OFFCHAIN_KITCHEN_CREATED'},201);
 }
 if(path==='/api/orders'&&request.method==='POST'){
  if(me.role!=='donor')return failure('DONOR_ROLE_REQUIRED',403);
  const b=await bodyOf(request),q=b.quantity;
  if(!Number.isSafeInteger(q)||q<1||q>10)return failure('INVALID_QUANTITY');
  const k=await db.prepare('SELECT id,price FROM kitchens WHERE id=?').bind(b.kitchenId).first();
  if(!k)return failure('KITCHEN_NOT_FOUND',404);
  const uid=id();await db.prepare('INSERT INTO orders(id,kitchen_id,donor,quantity,remaining,amount,status) VALUES(?,?,?,?,?,?,?)').bind(uid,k.id,me.id,q,q,q*k.price,'SIMULATED_FUND').run();
  await event(db,uid,'OFFCHAIN_FUND',me.id);return response({id:uid,status:'SIMULATED_FUND'},201);
 }
 if(path==='/api/vouchers'&&request.method==='POST'){
  if(me.role!=='recipient')return failure('RECIPIENT_ROLE_REQUIRED',403);
  const b=await bodyOf(request),o=await db.prepare('SELECT id,kitchen_id,remaining FROM orders WHERE id=?').bind(b.orderId).first();
  if(!o)return failure('ORDER_NOT_FOUND',404);
  if(o.remaining<=0)return failure('NO_MEALS_REMAIN',409);
  const uid=id();
  // D1 batch is a transaction: insertion is gated by SQLite changes()
  // after the atomic decrement, and cannot over-issue the available count.
  const changes=await db.batch([
   db.prepare('UPDATE orders SET remaining=remaining-1 WHERE id=? AND remaining>0').bind(o.id),
   db.prepare("INSERT INTO vouchers(id,order_id,kitchen_id,recipient,state) SELECT ?,?,?,?,'ISSUED' WHERE changes()=1").bind(uid,o.id,o.kitchen_id,me.id)
  ]);
  if((changes[1].meta?.changes||0)!==1)return failure('NO_MEALS_REMAIN',409);
  await event(db,uid,'SIMULATED_ISSUE',me.id);return response({id:uid,state:'ISSUED'},201);
 }
 const match=/^\/api\/vouchers\/([a-z0-9-]{36})\/(check|lock|report|settle)$/.exec(path);
 if(match&&request.method==='POST'){
  if(me.role!=='merchant')return failure('MERCHANT_ROLE_REQUIRED',403);
  const v=await db.prepare('SELECT v.id,v.state,v.kitchen_id,k.owner FROM vouchers v JOIN kitchens k ON k.id=v.kitchen_id WHERE v.id=?').bind(match[1]).first();
  if(!v)return failure('VOUCHER_NOT_FOUND',404);
  if(v.owner!==me.id)return failure('NOT_YOUR_KITCHEN',403);
  const transitions={check:['ISSUED','CHECKED'],lock:['CHECKED','LOCKED'],report:['LOCKED','REPORTED'],settle:['REPORTED','SETTLED']};
  const [previous,next]=transitions[match[2]],stamp={check:'checked_at',lock:'locked_at',report:'reported_at',settle:'settled_at'}[match[2]];
  const result=await db.prepare('UPDATE vouchers SET state=?, '+stamp+'=CURRENT_TIMESTAMP WHERE id=? AND state=?').bind(next,v.id,previous).run();
  if(result.meta.changes!==1)return failure('INVALID_TRANSITION_EXPECTED_'+previous,409);
  await event(db,v.id,'SIMULATED_'+next,me.id);
  return response({id:v.id,state:next,mode:'OFFCHAIN_ONLY'});
 }
 return failure('NOT_FOUND',404);
 }catch(e){return failure(/^(BODY_TOO_LARGE|INVALID)/.test(e.message)?e.message:'REQUEST_FAILED',400)}
}};
