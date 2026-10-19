/**
 * CP31 G1-A isolated PostgreSQL read probe, NEVER original CP30 data.
 *
 * Not mounted by default. Requires a dedicated read-only DB login; cannot
 * borrow the Render Auth Pilot DB owner credential, and will not treat a
 * pilot SIWE cookie as an original CP30 finance principal.
 *
 * All records here are deliberately synthetic; real order/voucher routes
 * remain unavailable until the separately approved original source exists.
 */
import {createHash} from 'node:crypto';

const SESSION_COOKIE='__Host-mcpay_c1_session';
const EXPECTED_ROLE='mf_g1_probe_login';
const EXPECTED_SCOPE='ISOLATED_SYNTHETIC_READ_TEST';
const TEST_DATABASES=new Set(['mealforward_g1_read_ci_only','mealforward_cp31_test_pg']);
const WALLETRX=/^0x[0-9a-f]{40}$/;
const deny=reason=>{throw Error(reason)};

function sessionDigest(req){
 const cookieHeader=req.headers.cookie;
 if(typeof cookieHeader!=='string'||cookieHeader.length>4096)return null;
 const entries=cookieHeader.split(';').map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+'='));
 if(entries.length!==1)return null;
 const token=entries[0].slice(SESSION_COOKIE.length+1);
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
 return createHash('sha256').update(token,'utf8').digest('hex');
}

export function makeG1IsolatedProbeReader({
 authStore,readPool,origin,clock=()=>Math.floor(Date.now()/1000),enabled=false
}={}){
 if(enabled!==true||typeof authStore?.getSession!=='function'||
    typeof readPool?.connect!=='function'||
    typeof origin!=='string'||!/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin) &&
      !/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin))
   deny('G1_PROBE_DISABLED_OR_UNCONFIGURED');
 const host=new URL(origin).host;
 const responseHeaders=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer',
  'X-MealForward-Data-Source':EXPECTED_SCOPE
 });
 const reply=(res,status,body)=>{
  res.writeHead(status,responseHeaders);res.end(JSON.stringify(body));
 };
 async function fetchOwn(wallet,kind){
  const conn=await readPool.connect();
  let began=false;
  try{
   await conn.query('BEGIN READ ONLY');began=true;
   // Permission attestation is done on this SAME checked-out connection.
   // The auth database OWNER credential must never be accepted here.
   const att=await conn.query(
    "SELECT current_database() AS db,current_user AS login,"+
    "(SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS elevated,"+
    "has_schema_privilege(current_user,'public','CREATE') AS creates_public,"+
    "has_schema_privilege(current_user,'mf_cp31_auth_pilot','USAGE') AS auth_schema_usage,"+
    "has_table_privilege(current_user,'mf_cp31_auth_pilot.sessions','SELECT') AS auth_session_select,"+
    "has_table_privilege(current_user,'mf_g1_probe.orders','UPDATE') AS can_update_probe,"+
    "to_regnamespace('c1_private') IS NOT NULL AS original_private_present"
   );
   const a=att.rows[0];
   if(att.rowCount!==1||!TEST_DATABASES.has(a.db)||a.login!==EXPECTED_ROLE||
      a.elevated!==false||a.creates_public!==false||
      a.auth_schema_usage!==false||a.auth_session_select!==false||
      a.can_update_probe!==false||a.original_private_present!==false)
    deny('G1_READER_PRIVILEGE_OR_DATABASE_MISMATCH');
   const scope=await conn.query(
    'SELECT scope,actual_original_cp30_connected,funded_or_settled_on_chain FROM mf_g1_probe.provenance WHERE singleton=1'
   );
   if(scope.rowCount!==1||scope.rows[0].scope!==EXPECTED_SCOPE||
      scope.rows[0].actual_original_cp30_connected!==false||
      scope.rows[0].funded_or_settled_on_chain!==false)
    deny('G1_PROVENANCE_NOT_SYNTHETIC');
   // Authenticated session wallet is generated server-side; no request
   // parameter or user-supplied header can choose another wallet.
   const sql=kind==='orders'
    ? 'SELECT id::text,store_id,meal_id,quantity,amount_base_units::text AS amount,status,record_origin FROM mf_g1_probe.orders WHERE owner_wallet=$1 ORDER BY id LIMIT 100'
    : 'SELECT id,store_id,meal_id,status,record_origin FROM mf_g1_probe.vouchers WHERE owner_wallet=$1 ORDER BY id LIMIT 100';
   const rows=await conn.query(sql,[wallet]);
   if(rows.rowCount>100||rows.rows.some(r=>r.status!=='TEST_RECORD_ONLY'||
       r.record_origin!=='SYNTHETIC_G1_PROBE'))
    deny('G1_PROBE_INVALID_ROW');
   await conn.query('COMMIT');began=false;
   return rows.rows;
  }catch(e){
   if(began)await conn.query('ROLLBACK').catch(()=>{});
   throw e;
  }finally{conn.release()}
 }
 return async function readOnlyProbe(req,res){
  try{
   const u=new URL(req.url||'/',origin);
   if(req.headers.host!==host||u.host!==host||u.search||
      u.username||u.password||req.headers.authorization||
      req.headers['x-wallet']||req.headers['x-recipient']||
      req.headers.origin&&req.headers.origin!==origin||
      req.headers['sec-fetch-site']&&
      !['same-origin','none'].includes(req.headers['sec-fetch-site'])){
     reply(res,403,{error:'G1_TEST_ORIGIN_DENIED'});return;
   }
   const kind=u.pathname==='/__g1_probe/my/orders'?'orders':
      u.pathname==='/__g1_probe/my/vouchers'?'vouchers':null;
   if(!kind){reply(res,404,{error:'NOT_FOUND'});return;}
   if(req.method!=='GET'){reply(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
   const digest=sessionDigest(req);
   if(!digest){reply(res,401,{error:'UNAUTHENTICATED'});return;}
   const session=await authStore.getSession(digest,clock());
   if(!session||typeof session.wallet!=='string'||!WALLETRX.test(session.wallet)){
    reply(res,401,{error:'UNAUTHENTICATED'});return;
   }
   const items=await fetchOwn(session.wallet,kind);
   reply(res,200,{
    mode:'ISOLATED_SYNTHETIC_G1_READ_TEST',originalCp30Connected:false,
    finalizedOnchainTransactions:false,items
   });
  }catch{
   if(!res.headersSent)reply(res,503,{error:'G1_TEST_READ_SOURCE_UNAVAILABLE'});
   else res.end();
  }
 };
}
