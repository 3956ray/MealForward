import {pgAuthStore} from '../mvp/auth-store.mjs';
// Reuse the reviewed SIWE queries while replacing one compile-time schema only.
// Neither schema nor SQL is supplied by an HTTP caller. Legacy factory is unchanged.
const productSql=sql=>{
  const result=sql.replaceAll('mf_mvp_usdc.','mf_product_v2.');
  if(/\bmf_mvp\b|\bmf_mvp_usdc\b/.test(result))throw Error('LEGACY_SCHEMA_DENIED');
  return result;
};
export function productAuthStore(pool){
  return pgAuthStore({
    query:(sql,params)=>pool.query(productSql(sql),params),
    async connect(){const c=await pool.connect();return {query:(sql,params)=>c.query(productSql(sql),params),release:()=>c.release()};},
  });
}
